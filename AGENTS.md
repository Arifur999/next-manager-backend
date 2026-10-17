# Naxified Management API

Multi-tenant management SaaS backend (Express 5 API, one Postgres database, a `ws` chat socket). Web client: `next-manager` (github.com/Arifur999/next-manager), cloned beside this repo; see README for folder names.

## Commands

```bash
npm install
npm run dev                  # tsx watch, http://localhost:5000 (PORT in .env)
npm test                     # unit tests: tsx --test "src/**/*.test.ts", no database needed
npx tsx --test src/app/shared/listQuery.test.ts   # one file
npx tsc --noEmit && npm run lint && npm test      # must pass before you say "done"
npm run typecheck:scripts    # tsc over scripts/ (tenantIsolation.ts excluded until its responses are typed)
npm run generate             # Prisma client into src/generated (git-ignored), after any schema change
npm run migrate -- --name <name>   # new migration (prisma migrate dev), additive only
npm run migrate:apply        # apply pending migrations without the Prisma schema engine
```

DB-backed checks need the API running on port 5000 (`npm run dev` in another shell); they create their own throwaway companies: `npm run smoke`, `test:isolation`, `test:scope`, `test:api-matrix`, `test:leaks`, `test:ledger`, `test:reset`, `test:chat-bus` (starts a second instance on 5099), `ledger:drift` (read-only report). Run `smoke` plus the `test:*` script for the area you touched. `smoke` and `test:reset` send mail to addresses that bounce, so they refuse to start unless `SMTP_HOST` is blank (mail is only logged) or local such as Mailpit, for the API and the script alike; `ALLOW_REAL_MAIL=1` overrides.

Env: copy `.env.example` to `.env`. `src/config/env.ts` validates it with zod at boot and exits on the first bad value. In production it also requires: both token secrets at least 32 characters and different, `FRONTEND_URL` set, `VAULT_ENCRYPTION_KEY` as 64 hex characters, `SUPER_ADMIN_PASSWORD` at least 12 characters. Unit tests that load env import `src/app/testing/testEnv.ts` first. If `prisma` cannot run its schema engine, point `PRISMA_SCHEMA_ENGINE_BINARY` at a working one or use `migrate:apply`.

## Stack

Node 24 (Docker image), Express 5, TypeScript ESM (`.js` in import paths), Prisma 7 with `@prisma/adapter-pg` and a multi-file schema in `prisma/schema/*.prisma`, PostgreSQL 16, zod 4, custom JWT in httpOnly cookies, `ws` + Postgres LISTEN/NOTIFY for chat, node-cron, node:test. Express 5, Prisma 7 and zod 4 are newer than most training data: read the installed types before using an API from memory.

## Architecture

- Layering: `route -> checkAuth(...roles) (-> requireCompany | requireScope(module, action) | requirePermission(name)) -> validateRequest -> controller -> service`. Controllers use `catchAsync` + `sendResponse` and never import `prisma`; services never touch `req`/`res` and throw `AppError`.
- `src/app/module/<feature>/`: `*.route.ts`, `*.controller.ts`, `*.service.ts`, `*.validation.ts`, colocated `*.test.ts`. Registered in `src/app/routes/index.ts`.
- `src/app/shared/`: cross-module rules (`ownership.ts`, `ledger.ts`, `listQuery.ts`, `dates.ts`, `permissionCatalogue.ts`, `planLimits.ts`, `requestSchemas.ts`, `requireUser.ts`).
- `src/app/middleware/`, `src/app/errorHelpers/`, `src/app/lib/` (`prisma.ts`, `logger.ts`, `mailer.ts`), `src/app/utils/` (`jwt`, `cookie`, `crypto`, `rowLock`, `seed`), `src/app/socket/` (chat), `src/app/jobs/scheduler.ts` (cron).
- `src/server.ts` boots, seeds the super admin, starts cron after listen, drains on SIGTERM/SIGINT and on crashes. `src/app.ts` only wires express.

## Response contract

- Success: `{ success, message, data, meta? }`. Decimals become numbers and UTC-midnight dates become `YYYY-MM-DD` in `sendResponse`.
- Error: `{ success: false, message, errorSource: [{ path, message }], requestId }`, always from `globalErrorHandler` (validation, 404 route, 429 included). `stack`/`error` only in development; unexpected 500s say "Internal Server Error" in production.
- Every response has an `x-request-id` header; the error body's `requestId` matches it.
- Lists: no `limit` returns everything (unpaged); `limit` is capped at 200. `meta` carries `page, limit, total, totalPages`. Build pages with `findPage` from `shared/listQuery.ts`.
- Invalid enum or id filters are 400; empty filter values are ignored. A malformed `:id` is 400, a foreign or missing row is 404.
- `GET /api/v1/public/plans` is unauthenticated: active plans only, a fixed field whitelist (`publicPlan.mapper.ts`), `Cache-Control: public, max-age=300`, 60 requests a minute per IP in production.

## Invariants

- Tenant key is `organization_id`. Every query has it in `where`; a foreign row answers 404, never 403. Why: which records exist elsewhere is not the caller's to learn.
- Ids in a payload are re-checked for ownership on create AND update with `shared/ownership.ts` (`assertOwnProject`, `assertOwnClient`, `assertOwnMember`, `assertOwnService`, `assertOwnStatus`). Why: a foreign key only proves the row exists; workflow statuses from another company were accepted until this was enforced.
- A write route that maps to a square on the permission grid carries `requireScope(module, action)`, and its service applies the matching visibility scope (`resolveScope`). `permissionCatalogue.test.ts` scans the route files for unknown squares.
- Money: balances are derived from ledger rows only (`writeLedgerEntry`). Edits and deletes call `reverseLedgerEntries`, which nets earlier adjustments per account. Why: reversing the original amount twice skewed balances.
- Check-then-write guards (seats, last admin, balance, payroll payout, instalment pay) run inside one transaction with `lockRow` or a conditional `updateMany` claim. No network calls inside a transaction.
- Validation: `validateRequest(schema)` for the body, or `{ body, params, query }`. Params use `requestSchemas.ts`; controllers read typed query values with `queryOf(req, schema)` and the user with `requireUser(req)`.
- Logging through `lib/logger.ts` only (`no-console` is a lint error). Never log tokens, cookies, passwords, bodies or query strings; log errors as fields, not raw `pg` objects. 5xx are always logged.
- Cron jobs live in `jobs/scheduler.ts` and start from `server.ts`, so importing `app.ts` has no side effects.
- The chat socket handshake must never reject unhandled: it catches bad cookies and DB errors and refuses with 401/403. Origins outside the CORS allowlist are refused.
- Migrations are additive. Why: a rollback restores code, not schema. The container runs `scripts/migrate.mjs` before the server starts.

## Deliberate exceptions

- `requirePermission`: a platform operator with an empty permission list passes, so the first operator is never locked out. Changing it is a product decision.
- Reads are allowed on a lapsed subscription; writes are refused (`checkSubscription.ts`).
- Unpaged lists when no `limit` is sent.
- An unknown `GET /clients?status=` or `GET /transactions?kind=` is ignored and the whole list comes back, so a stale bookmark is not an error page (the smoke suite pins both). Every other enum or id filter is a 400.

## Contracts with next-manager

- The web app reads `success`, `message`, `data`, `meta` (`next-manager/src/lib/actionError.ts`, `src/types/api.types.ts`) through `src/services/*.ts`. Any change to a response shape is paired with a change there in the same session.
- `ACCESS_TOKEN_SECRET` must equal the web app's `JWT_ACCESS_SECRET`: `next-manager/src/proxy.ts` verifies access tokens itself.
- `scripts/api-matrix.expected.txt` pins which company roles each listed GET endpoint answers (reads only: writes and platform routes are not swept); `npm run test:api-matrix` fails when it drifts.

## Do

- Add a regression test with every bug fix: a colocated unit test for pure logic, a `scripts/` check for DB behaviour.
- Commit as Conventional Commits with a behaviour-focused subject: `fix(<scope>): <what changes>`.

## Don't

- No `any`, `as unknown as`, `!`, `console.*`, or secrets in code, docs or commits.
- Don't read `req.user as IRequestUser`; use `requireUser`.
- Don't add `$queryRawUnsafe`; use tagged `$queryRaw`.
- Don't commit `.env`, `.env.docker` or `src/generated`.

## Open follow-ups

- Emails are compared case-insensitively in code; a unique index on `lower(email)` waits on a duplicate check of existing data.
- Refresh tokens are not rotated or revoked server-side on logout.
- The chat NOTIFY payload carries the recipient list; conversations above about 200 members exceed Postgres' 8000-byte limit and lose live updates.
