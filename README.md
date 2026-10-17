# Naxified Management: Backend

The API behind Naxified Management, a multi-tenant management SaaS: Express 5 + TypeScript (ESM) + Prisma 7 + PostgreSQL + zod 4, with a WebSocket chat. The web app is [next-manager](https://github.com/Arifur999/next-manager).

Rules for changing the code (layering, tenancy, money, the response contract) are in [AGENTS.md](AGENTS.md).

## Setup

Needs Node 22 or later and a PostgreSQL 16 database.

```bash
npm install
cp .env.example .env        # fill DATABASE_URL, the token secrets, VAULT_ENCRYPTION_KEY, SUPER_ADMIN_*
npm run generate            # Prisma client into src/generated (git-ignored)
npm run migrate:apply       # apply the committed migrations to the database in DATABASE_URL
npm run dev                 # http://localhost:5000
```

`migrate:apply` runs `scripts/migrate.mjs`, which applies `prisma/migrations/*` in order inside transactions and records them exactly as `prisma migrate deploy` would. Either command works; the script exists for machines where Prisma's schema engine binary is blocked. Use `npm run migrate -- --name <change>` only to create a new migration.

On first start the API creates the platform super admin from `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`. It never resets the password of an account that already exists.

`ACCESS_TOKEN_SECRET` must match the web app's `JWT_ACCESS_SECRET`: the web app's `src/proxy.ts` verifies the access token itself before rendering a route.

## Environment

Validated at boot by `src/config/env.ts`; the API refuses to start with a list of what is wrong.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | no | `development` (default), `production` or `test` |
| `PORT` | no | default 5000 |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` | yes | production: at least 32 characters each, and different (`openssl rand -hex 32`) |
| `ACCESS_TOKEN_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN` | no | default `1d` and `7d`; cookie lifetimes follow them |
| `FRONTEND_URL` | production | web origin(s), comma-separated; CORS and the links in reset and invite emails |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` | yes | production: password at least 12 characters |
| `VAULT_ENCRYPTION_KEY` | yes | production: 64 hex characters. Losing it loses every stored credential |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | no | without `SMTP_HOST` mail is logged instead of sent; `.env.example` lists providers |

## Roles and tenancy

Each company is an organization, and every company record carries `organization_id`; every query is scoped by it, and another company's row answers 404. Roles: `admin`, `sales`, `project_manager` and `operations` inside a company, plus `super_admin`, who runs the platform and belongs to no company. Within a role, each company can narrow access on the permission grid (module x action x scope, see `src/app/shared/permissionCatalogue.ts`).

## Endpoints

All under `/api/v1`, mounted in `src/app/routes/index.ts`; each module's `*.route.ts` lists its routes with their role gate. `scripts/api-matrix.expected.txt` is the role table for the company GET endpoints (reads only), kept honest by `npm run test:api-matrix`. Unauthenticated routes: sign-up, sign-in, password reset, invite acceptance (`/join`, `/platform-join`, `/agency-join`), `GET /public/plans`, and `GET /health`.

## Scripts

| Script | Needs the API on :5000 | What it does |
|---|---|---|
| `npm run dev` | | start with reload |
| `npm run build`, `npm start` | | compile to `dist/` and run it |
| `npm test` | | unit tests (`src/**/*.test.ts`), no database |
| `npm run lint` | | eslint |
| `npm run generate` | | Prisma client |
| `npm run migrate -- --name <change>` | | create and apply a new migration |
| `npm run migrate:apply` | | apply committed migrations |
| `npm run studio` | | Prisma Studio |
| `npm run smoke` | yes | end-to-end checks across every module |
| `npm run test:isolation` | yes | one company cannot read or write another's data |
| `npm run test:scope` | yes | the permission grid narrows reads and writes |
| `npm run test:api-matrix` | yes | each listed company GET endpoint answers the roles in `scripts/api-matrix.expected.txt` |
| `npm run test:leaks` | yes | responses never carry secrets |
| `npm run test:ledger` | yes | edits and deletes reverse ledger rows exactly once |
| `npm run test:reset` | yes | the password-reset flow |
| `npm run test:chat-bus` | yes | two API instances share chat events (starts one on :5099) |
| `npm run test:mail` | | checks the SMTP settings; with an address, sends a real message |
| `npm run ledger:drift` | | read-only report of balances skewed by old double reversals |
| `npm run perf <seed\|measure\|fks\|drop>` | | load a large throwaway company and time key queries |

The DB-backed checks create their own throwaway companies in the database from `.env`; point it at a development database.

## Layout

```
src/
  server.ts              boot, super admin seed, cron start, graceful shutdown
  app.ts                 express wiring, CORS, request ids, /api/v1, /health
  config/env.ts          environment schema
  app/
    module/<feature>/    route, controller, service, validation, tests
    routes/index.ts      one router.use per module
    middleware/          checkAuth, requireCompany, requireScope, requirePermission,
                         validateRequest, rateLimit, requestLogger, globalErrorHandler
    shared/              ownership checks, ledger, list paging, dates, permission catalogue
    lib/                 prisma.ts, logger.ts, mailer.ts
    socket/              chat WebSocket and its Postgres LISTEN/NOTIFY bus
    jobs/scheduler.ts    cron: currency rate, subscription expiry, platform snapshot, login-event pruning
    utils/               jwt, cookie, password, crypto (vault), rowLock, seed
    errorHelpers/        AppError, Prisma and zod error mapping
    testing/             helpers for unit tests
prisma/schema/*.prisma   schema split by domain
prisma/migrations/       committed migrations
scripts/                 DB-backed checks and tools
docker/                  container entrypoint and nginx config
```

## Running the whole product in Docker

Four containers behind one port: nginx terminates TLS and is the only thing published; the web app, this API and Postgres talk over a private network. Migrations run at container start, before the API accepts a connection.

`docker-compose.yml` builds the web app from `../naxified`, so the two repositories must sit side by side with the web app in a folder named `naxified`:

```
<parent>/
  naxified/            the web app (clone of next-manager)
  naxified_backend/    this repo; compose lives here
```

Clone with those folder names (`git clone https://github.com/Arifur999/next-manager.git naxified`), or change `services.web.build.context` in `docker-compose.yml` to wherever your web app clone is.

```bash
cp .env.docker.example .env.docker      # then fill it in

# nginx will not start without a certificate. For a local run:
mkdir -p docker/nginx/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout docker/nginx/certs/privkey.pem -out docker/nginx/certs/fullchain.pem -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost"

docker compose --env-file .env.docker up -d --build
```

`--env-file` is not optional. Without it compose substitutes from `.env`, the development environment, whose `DATABASE_URL` points at localhost (inside a container, that is the container).

TLS is not optional either. Auth cookies are `Secure` in production, and a browser drops them over plain http, so sign-in would answer 200 and then bounce every page back to the login form.

| | |
|---|---|
| logs | `docker compose --env-file .env.docker logs -f api` |
| stop | `docker compose --env-file .env.docker down` |
| stop and wipe the database | `docker compose --env-file .env.docker down -v` |
