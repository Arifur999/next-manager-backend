# Production image for the Naxified API.
#
# Four stages so the thing that ships carries neither the toolchain nor the dev
# dependencies: the TypeScript compiler, eslint, tsx and the whole Prisma CLI
# never reach the server.
#
# Pinned to a MINOR, not a major. `24-alpine` floats across every 24.x release,
# so two builds of the same commit a month apart would run different Node
# versions - a change in TLS, HTTP parsing or ESM resolution arriving during a
# routine rebuild is exactly the surprise a pin is supposed to prevent.
ARG NODE_VERSION=24.20-alpine

# ---------------------------------------------------------------- deps
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# Only the manifests, so this layer is reused on every build that did not
# change a dependency - which is most of them.
COPY package.json package-lock.json ./
# A cache mount rather than a layer: the downloaded tarballs are shared with
# the prod-deps stage below and with every later build, and none of it ends up
# in the image.
RUN --mount=type=cache,target=/root/.npm npm ci

# --------------------------------------------------------------- build
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `prisma generate` reads prisma.config.ts, which reads DATABASE_URL. Generating
# a client needs no database - it only reads the schema - but the config would
# fail on an undefined value, so a syntactically valid URL is supplied and never
# connected to. It is not a secret and does not survive this stage.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
RUN npm run generate

# tsc has rootDir ./src, so the client generated into src/generated/prisma is
# compiled along with everything else and lands in dist/generated/prisma.
RUN npm run build

# ---------------------------------------------------------- prod-deps
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./

# --omit=dev AND --omit=optional, which together are what actually drops the
# Prisma CLI, Prisma Studio's browser UI, the Rust engines and typescript.
#
# --omit=dev alone did not, and the reason is worth writing down because the
# obvious explanation is wrong. @prisma/client declares `prisma` and
# `typescript` as peers, but marks BOTH optional in peerDependenciesMeta, so
# npm does not pull them in as peers at all. They survived because npm resolved
# them into the tree as `devOptional` - 132 of the 395 entries in the lockfile
# carry that flag - and npm drops a devOptional node only when both omissions
# are given. `--omit=peer` was the wrong lever, which is why it recovered 9 MB
# of 749 and no more.
#
# The only strictly-optional package in the production set is pg-cloudflare, a
# socket shim for Cloudflare Workers that a Node server never loads.
#
# This also skips prisma's install script, so the Rust engines are not even
# downloaded during the build.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --omit=optional

# -------------------------------------------------------------- runner
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

# Belt and braces with compose: `environment:` there pins this too, because
# env_file silently overrides an image's ENV and two things depend on the flag -
# Secure on auth cookies, and hidden stack traces in the error handler.
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Migrations run at startup, so the SQL and the runner that applies it both have
# to be in the image. scripts/migrate.mjs applies prisma/migrations in name
# order inside a transaction, using pg directly - no Prisma CLI, and no
# schema-engine binary, neither of which is installed here.
COPY --from=build /app/prisma/migrations ./prisma/migrations
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build /app/docker/entrypoint.sh ./docker/entrypoint.sh

# The node user ships with the image and owns nothing outside /app. A process
# that is compromised should not also be root inside its own container.
USER node

# Documentation only - nothing is published to the host. nginx reaches this
# over the compose network, which is the only way in.
EXPOSE 5000

# Distinguishes "still migrating", "serving" and "alive but listening to
# nothing" from outside, which nothing else can. start-period covers the
# migration, which on a fresh database applies every file before the port opens.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:5000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The entrypoint migrates, then EXECS the server so it becomes PID 1 and
# receives SIGTERM directly - server.ts drains on it and exits 0. The migration
# phase is signal-aware too; see docker/entrypoint.sh for why that needs more
# than a shell chain.
ENTRYPOINT ["sh", "docker/entrypoint.sh"]
