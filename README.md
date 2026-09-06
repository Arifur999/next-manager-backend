# Naxified Management — Backend

Express 5 + TypeScript (ESM) + Prisma 7 + PostgreSQL + Zod v4 API, built on the
modular `route → controller → service → prisma` pattern.

## Setup

```bash
npm install
cp .env.example .env        # then fill DATABASE_URL and the token secrets
npm run generate            # generate the Prisma client into src/generated
npm run migrate -- --name init
npm run dev                 # http://localhost:5000
```

`ACCESS_TOKEN_SECRET` must match the frontend's `JWT_ACCESS_SECRET` — the
Next.js proxy verifies the access token locally before letting a route render.

## Running the whole thing in Docker

Four containers behind one port: nginx terminates TLS and is the only thing
published, and Next, this API and Postgres talk over a private network.

It builds the web app from `../naxified`, so the two repositories have to sit
side by side — which is how they are cloned.

```bash
cp .env.docker.example .env.docker      # then fill it in

# nginx will not start without a certificate. For a local run:
mkdir -p docker/nginx/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365   -keyout docker/nginx/certs/privkey.pem   -out    docker/nginx/certs/fullchain.pem   -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost"

docker compose --env-file .env.docker up -d --build
```

**`--env-file` is not optional.** Without it compose substitutes from `.env`,
which is the development environment — its `DATABASE_URL` points at localhost,
and inside a container that is the container.

**TLS is not optional either.** This API sets its auth cookies with
`secure: isProduction`, and a browser discards a Secure cookie over plain
http — so a production build served on http answers 200 to a login and then
bounces every page back to it, which reads like a broken login form rather than
a missing certificate.

Migrations run at container start, before the server accepts a connection, so a
deploy needs no separate migration step. The runner takes a Postgres advisory
lock first, so several replicas starting together is safe.

| | |
|---|---|
| logs | `docker compose --env-file .env.docker logs -f api` |
| stop | `docker compose --env-file .env.docker down` |
| stop and wipe the database | `… down -v` |

## Layout

```
src/
  server.ts               bootstrap, seeds the super admin, signal handlers
  app.ts                  express wiring, CORS, /api/v1 mount
  config/env.ts           typed config, required vars checked at boot
  app/
    lib/prisma.ts         the single PrismaClient
    routes/index.ts       one router.use("/kebab-case", XRoutes) per module
    module/<feature>/     route + controller + service + validation
    middleware/           checkAuth, requirePermission, validateRequest,
                          globalErrorHandler, notFound, rateLimit
    errorHelpers/         AppError + Prisma/Zod normalizers
    shared/               catchAsync, sendResponse, listQuery
    utils/                jwt, cookie, password, seed
    interfaces/           IRequestUser, error shapes, Express augmentation
prisma/schema/*.prisma    multi-file schema, split by domain
```

## Adding a module

1. Model in `prisma/schema/<domain>.prisma`, then `npm run migrate -- --name add_<thing>`
2. `<feature>.validation.ts` — zod schemas, payload types inferred from them
3. `<feature>.service.ts` — owner-scoped Prisma calls, `AppError` on missing rows
4. `<feature>.controller.ts` — `catchAsync` + `sendResponse`
5. `<feature>.route.ts` — `checkAuth` → `validateRequest` → handler
6. Register in `src/app/routes/index.ts`

Rules that are not optional: a controller never imports `prisma`; a service never
touches `req`/`res`; every query filters on `owner_id: user.ownerId`; updates and
deletes `findFirst` by `{ id, owner_id }` before writing.

## Endpoints so far

| Method | Path | Access |
|---|---|---|
| POST | `/api/v1/auth/register` | public (creates a workspace owner) |
| POST | `/api/v1/auth/login` | public |
| POST | `/api/v1/auth/refresh-token` | refresh cookie |
| POST | `/api/v1/auth/logout` | public |
| GET | `/api/v1/auth/me` | any signed-in user |
| POST | `/api/v1/auth/change-password` | any signed-in user |
| GET | `/api/v1/users` | owner, manager |
| GET | `/api/v1/users/:id` | owner, manager |
| POST | `/api/v1/users` | owner |
| PATCH | `/api/v1/users/:id` | owner |
| DELETE | `/api/v1/users/:id` | owner |
