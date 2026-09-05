# Production image for the Naxified API.
#
# Four stages so the thing that ships carries neither the toolchain nor the dev
# dependencies: ~200 MB of TypeScript, eslint and tsx never reach the server.
#
# Pinned to a minor rather than floating on `node:alpine`, for the same reason
# the nginx image next door is pinned - a major version should arrive because
# somebody decided it would, not during a routine rebuild.
ARG NODE_VERSION=24-alpine

# ---------------------------------------------------------------- deps
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# Only the manifests, so this layer is reused on every build that did not
# change a dependency - which is most of them.
COPY package.json package-lock.json ./
RUN npm ci

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
# Known bloat, deliberately left alone for now: this layer is ~380 MB.
#
# @prisma/client declares `prisma` and `typescript` as PEER dependencies, and
# npm installs peers automatically, so --omit=dev does NOT drop them. The image
# therefore carries the Prisma CLI (40 MB), Prisma Studio's browser UI (42 MB),
# the dev server (18 MB), the Rust engines (24 MB), typescript and effect -
# none of which this server runs. It reaches Postgres through
# @prisma/adapter-pg, and migrations go through scripts/migrate.mjs over plain
# pg.
#
# --omit=peer was tried and recovered 9 MB: `npm ci` reproduces the lockfile
# exactly, so the flag has almost nothing to act on. Deleting the directories
# by hand would work until the day the client lazily requires one of them, and
# that failure would land in production rather than here.
#
# Left as is because the cost is small in practice - the layer is cached and
# only re-transfers when a dependency actually changes - and correctness beats
# 300 MB. Worth revisiting if Prisma stops declaring the CLI as a peer.
RUN npm ci --omit=dev && npm cache clean --force

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

# The node user ships with the image and owns nothing outside /app. A process
# that is compromised should not also be root inside its own container.
USER node

# Documentation only - nothing is published to the host. nginx reaches this
# over the compose network, which is the only way in.
EXPOSE 5000

# Migrate, then serve. Sequential on purpose: a server that starts before its
# schema exists answers 500s that look like application bugs.
#
# `node --run` rather than a shell chain, so signals reach the server process
# directly and `docker stop` is a clean shutdown rather than a 10-second wait
# followed by SIGKILL. server.ts installs handlers for SIGTERM and SIGINT.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node dist/server.js"]
