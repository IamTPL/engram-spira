# API conventions (`apps/api`)

## The Elysia chain — order is load-bearing

`apps/api/src/index.ts` is the entire bootstrap, one fluent chain:

```
new Elysia({ aot: true })            // index.ts:126 — AOT explicitly on
  .use(requestLoggerPlugin)
  .use(cors({ … }))
  .onAfterHandle(…)                  // 4 security headers — 2xx responses ONLY
  .onError(…)                        // THE status-code mapping
  .get('/health', …)                 // public DB probe
  .use(authRoutes) … .use(experienceRoutes)   // 16 plugins, fixed order
  .listen(ENV.PORT)

export type App = typeof app         // index.ts:304 — the Eden Treaty contract
```

Mount order (`index.ts:187-202`): auth, classes, folders, decks, card-templates, cards, study, notifications, feedback, users, import-export, ai, embedding, search, kg, experience.

14 of 16 modules carry `new Elysia({ prefix: '/x' })`. **`importExportRoutes` and `experienceRoutes` have no prefix** and register at the API root.

### CORS

| `NODE_ENV` | `origin` |
|---|---|
| exactly `'production'` | `ENV.ALLOWED_ORIGINS` (allowlist) |
| anything else (incl. `'test'`, unset) | `[/^http:\/\/localhost:\d+$/, ...ENV.ALLOWED_ORIGINS]` |

`credentials: true`. `allowedHeaders` is exactly `Content-Type`, `Authorization`, `x-timezone-offset` — **add any new custom header there or preflight fails**. The dev regex matches only `http://localhost:<port>`: not `127.0.0.1`, not `https`. In production `ALLOWED_ORIGINS` still defaults to `['http://localhost:3002']` if unset, so a deploy that forgets it silently rejects the real frontend.

### Security headers (`index.ts:138-144`)

`X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` · `Referrer-Policy: strict-origin-when-cross-origin` · `Permissions-Policy: camera=(), microphone=(), geolocation=()`

No CSP, no HSTS. They are set in `onAfterHandle`, which **Elysia does not run when a handler throws** — so every *thrown* error response (everything routed through `onError`: 401, 404, 422, 500 …) carries none of them. A handler that *returns* normally with a non-2xx status still gets them: verified by running the API against a dead database, `GET /health` returns `503` **with** all four headers, while `GET /classes` returns `401` with none.

## The error contract

Every failure response is `{ error: string }`. Nothing else — no code, no field path, no details. `getApiError()` in `apps/web/src/api/client.ts` walks that shape; changing it breaks the client.

`onError` evaluates in this order (`index.ts:145-169`):

| # | Condition | Status | Body |
|---|---|---|---|
| 1 | `error instanceof AppError` | `error.statusCode` | `{ error: error.message }` |
| 2 | `error.code === 'VALIDATION'` | 422 | first `all[0].summary`, else `.message`, else `'Validation failed'` |
| 3 | `error.message === 'Unauthorized'` | 401 | `{ error: 'Unauthorized' }` |
| 4 | anything else | 500 | `{ error: 'Internal server error' }` + `logger.error` |

### Error classes (`src/shared/errors.ts`)

| Class | Status | Signature |
|---|---|---|
| `AppError(statusCode, message)` | caller-supplied | base |
| `UnauthorizedError(message?)` | 401 | default `'Unauthorized'` |
| `ForbiddenError(message?)` | 403 | default `'Forbidden'` |
| `NotFoundError(resource)` | 404 | message becomes `` `${resource} not found` `` |
| `ConflictError(message)` | 409 | required |
| `PayloadTooLargeError(message?)` | 413 | default `'Payload too large'` |
| `ValidationError(message)` | 422 | required |
| `TooManyRequestsError(message?)` | 429 | default `'Too many requests'` |

**No subclass produces 400.** 503 comes only from `/health`. Never throw a plain `Error` for a client-facing failure — it becomes an opaque 500 and the real message only reaches the log.

## Authentication

`requireAuth` (`modules/auth/auth.middleware.ts:6`) is the only auth mechanism: an Elysia plugin named `'require-auth'` using `derive({ as: 'scoped' })`. It reads `cookie[ENV.SESSION_COOKIE_NAME]`, throws `UnauthorizedError()` if absent or invalid, and injects:

- `currentUser` — exactly `{ id, email, displayName, avatarUrl, emailVerified }`
- `currentSession` — `{ id, userId, expiresAt }`

There is **no `.resolve()`, no `macro`, and no `.guard()`** anywhere in `apps/api/src`. `derive` is the only injection mechanism (2 call sites: this and the logger plugin).

> **The hazard.** Elysia applies hooks only to routes registered *after* them. `.use(requireAuth)` sits at `auth.routes.ts:148` and `users.routes.ts:21`, which is how `/auth/register`, `/auth/login`, `/auth/me`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email` and `GET /users/avatars` stay public. **Inserting a new route above that line silently ships it unauthenticated.**

### Sessions

| | |
|---|---|
| Cookie | `engram_session` — `httpOnly`, `secure` only when `NODE_ENV === 'production'`, `sameSite: 'lax'`, `path: '/'`, `maxAge` 2 592 000 s (30 d) |
| Token | 32 `crypto.getRandomValues` bytes hex-encoded (64 chars). **The raw token is never stored** — the DB primary key is `sha256(token)` hex |
| Validation | expired → DELETE the row, return nulls. Under 15 days remaining → UPDATE `expiresAt = now + 30d` |
| CSRF | **none.** Safety rests entirely on `SameSite=Lax` + the CORS allowlist. Splitting SPA and API across registrable domains would stop the cookie being sent |

Cookie options are defined once, at `auth.routes.ts:13-19`. Session timing constants live in `shared/constants.ts` (`SESSION.MAX_AGE_MS`, `SESSION.REFRESH_THRESHOLD_MS`) — **not** `ENV.SESSION_MAX_AGE_DAYS`/`ENV.SESSION_REFRESH_THRESHOLD_DAYS`, which are dead keys read nowhere.

Consequence to know: once a session enters the 15-day refresh window, **every authenticated request issues an UPDATE** on `sessions`. There is no throttling.

## Authorization

Always in the service, never the route.

```ts
// service signature: resource id first, then userId
export async function getById(id: string, userId: string) { … }
```

| Resource | Ownership check |
|---|---|
| decks, cards | denormalized `decks.user_id` — `and(eq(decks.id, id), eq(decks.userId, userId))`, or `innerJoin(decks, and(eq(cards.deckId, decks.id), eq(decks.userId, userId)))` |
| folders | traverse `folders.class_id → classes.user_id` (`verifyClassOwnership`) |
| classes | direct `eq(classes.userId, userId)` |

Not-yours always throws `NotFoundError('<Resource>')`. Never `ForbiddenError`, never 403, never an empty result — existence must not leak. Never add a new JOIN chain through folders to reach a deck's owner; that is what the denormalized column is for.

**Two known holes — do not copy them as patterns:** `GET /card-templates/:id` performs no ownership check at all (`card-templates.routes.ts:10` calls `getWithFields(id)` with no `userId`), and `kgService.deleteLink` verifies only the *source* card (`kg.service.ts:104`).

## Recipe: adding a module

1. `mkdir apps/api/src/modules/<kebab-name>/` and create `<name>.routes.ts` + `<name>.service.ts`. No controller/repository/DTO layers.
2. Routes file:

```ts
import { Elysia, t } from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as widgetsService from './widgets.service';

export const widgetsRoutes = new Elysia({ prefix: '/widgets' })
  .use(requireAuth)                                  // FIRST, unless you want public routes
  .get('/', ({ currentUser }) => widgetsService.list(currentUser.id))
  .post(
    '/',
    ({ currentUser, body }) => widgetsService.create(currentUser.id, body),
    { body: t.Object({ name: t.String({ minLength: 1 }) }) },
  );
```

   Handlers are one line of delegation. Never run a Drizzle query in a route handler — there are exactly two legacy exceptions, and `kg.routes.ts` + `study.routes.ts` are the only route files that import `db` at all: `POST /knowledge-graph/ai/dismiss` (`kg.routes.ts:85`) and `GET`/`PATCH /study/algorithm` (`study.routes.ts:216,226`). Do not copy them.

3. Validate with `t.Object` in the third argument: `t.String({ minLength: 1 })` for names, `t.String({ format: 'uuid' })` for ids, `t.Optional(...)` for PATCH fields, `t.Array(..., { minItems, maxItems })` for batches. Existing caps: cards batch create 100, batch delete 200, review-batch 100, interleaved decks 20.
4. Service takes `userId` explicitly, scopes every query, throws `AppError` subclasses. Import `db` from `../../db` and tables from `../../db/schema` (the barrel).
5. Register in `index.ts`: import at the top with the other route imports, add exactly one `.use(widgetsRoutes)` in the chain after `/health`.
6. Add `apps/api/__tests__/modules/<name>/<name>.service.test.ts` — see [testing.md](testing.md). Always assert the ownership-failure path with `.rejects.toThrow('<Resource> not found')`.
7. The endpoint becomes type-safe on the client automatically via `export type App`. Path segments become properties; dynamic segments become call syntax: `api.folders['by-class']({ classId }).post({...})`.

### Established response shapes

| Operation | Returns |
|---|---|
| POST / PATCH single | the entity row |
| DELETE | `{ success: true }` (card-templates and card-links use `{ deleted: true }`) |
| Batch | `{ created: n, … }` / `{ deleted: n }` / `{ reordered: n }` |
| List (paginated) | `{ items, total, limit, hasMore, nextCursor }` |

Return plain objects, never a `Response`. The only legitimate `set.headers` writes in a module are the CSV download headers at `import-export.routes.ts:91-93`.

### The reorder recipe

Reused verbatim in classes, folders and cards: fetch all sibling rows ordered by `sortOrder` → verify every incoming id is in that set (else `NotFoundError`) → build an index map → assign leftovers sequential orders starting at `ids.length` → run all updates inside `db.transaction` → return `{ reordered: ids.length }`.

Caveat: these transactions issue N parallel `UPDATE`s via `Promise.all` with no deterministic row order, which can deadlock under concurrent reorders of the same parent.

### Transactions

`db.transaction` is used in 9 places. Rules: use `tx`, not `db`, inside the callback. Any transaction that assigns `cards.sort_order` must first take a pessimistic lock — `SELECT id FROM decks WHERE id = ${deckId} FOR UPDATE` — to serialize concurrent inserts (`cards.service.ts:183,308`, `import-export.service.ts:168`, `ai.service.ts:289`).

Fire embeddings **after** the transaction commits, never inside it, and never awaited: `enqueueEmbedding(cardId)` for one card, `embedCardBatch(ids).catch(() => ids.forEach(enqueueEmbedding))` for bulk.

## Rate limiting

Two independent systems with different semantics.

**`elysia-rate-limit@4.5.0`** — IP-keyed, in-memory, per module, all with `duration: 60_000`, `scoping: 'scoped'`, a `x-forwarded-for` → `x-real-ip` → `requestIP()` generator, and a hand-written 429 JSON body:

| Scope | max / 60 s |
|---|---|
| `/auth/*` (all endpoints, including `/auth/me`) | 5 |
| import/export | 15 |
| `POST /ai/generate` (GETs skipped) | 20 |
| `/search` | 60 |
| `/study/*` | 180 |

**`checkAiRateLimit(userId)`** (`config/ai.ts`) — user-keyed, **30 requests per 1-hour fixed window** anchored on the first request, so 30 at 12:59 plus 30 at 13:01 both pass. Throws `TooManyRequestsError`. Single production call site: `ai.service.ts:127`.

Both are per-process and reset on restart. The IP limiter trusts a spoofable `x-forwarded-for` first, and users behind one NAT share a bucket. Note the `/auth` limit of 5/min covers `/auth/me`, which the web app polls — the frontend can rate-limit itself out of login.

## Configuration

`ENV` (`src/config/env.ts`) is a 14-key `as const` object. **`REQUIRED_VARS = ['DATABASE_URL']`** — that is the only validated variable, and it throws at *module import time*, before Elysia or the logger exist, so the failure surfaces as a raw stack trace.

| Key | Default |
|---|---|
| `DATABASE_URL` | none — **required** |
| `PORT` | `3001` |
| `NODE_ENV` | `'development'` |
| `FRONTEND_URL` | `'http://localhost:3002'` (email links only) |
| `ALLOWED_ORIGINS` | `['http://localhost:3002']` (comma-split, trimmed) |
| `SESSION_COOKIE_NAME` | `'engram_session'` (hardcoded) |
| `SESSION_MAX_AGE_DAYS` | `30` — **dead, never read** |
| `SESSION_REFRESH_THRESHOLD_DAYS` | `15` — **dead, never read** |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | `''` |
| `FEEDBACK_RECIPIENT` | a hardcoded personal address |
| `GEMINI_API_KEY` | `''` |
| `GEMINI_MODEL` | `'gemini-3-flash-preview'` |
| `GEMINI_EMBEDDING_MODEL` | `'gemini-embedding-001'` |

Two variables are **not** in `ENV`: `LOG_LEVEL`, read straight from `process.env` in `shared/logger.ts:20`, and `AVATARS_DIR`, read in `users.service.ts:16` (defaulting into `apps/web/public/ava_colect` — the API filesystem is coupled to the web workspace).

`GEMINI_API_KEY`, `GMAIL_USER` and `GMAIL_APP_PASSWORD` default to `''` and fail lazily at first use with a plain `Error` → opaque 500. There is no startup warning.

## Logging

One Pino instance (`shared/logger.ts`). Redacts 9 paths with `'[REDACTED]'`: `password`, `passwordHash`, `token`, `resetToken`, `*.password`, `*.passwordHash`, `*.token`, `req.headers.authorization`, `req.headers.cookie`. Dev pipes through a `pino-pretty` worker; production writes raw NDJSON.

Use `logger.child({ module: '<name>' })` per module and Pino's object-first signature — `logger.error({ ...fields }, 'message')`, never string interpolation. Never `console.*`. Put sensitive values under one of the redacted key names.

> **Do not trust logged status codes for 4xx.** `requestLoggerPlugin.onError` is `{ as: 'global' }` and registered *before* the app-level `onError`, so it reads `set.status ?? 500` before the status is assigned. A thrown `NotFoundError` is logged at `error` level with `status: 500`. Only Elysia `VALIDATION` errors log the correct 422. Never alert on these.

## Constants

Everything domain-magic lives in `src/shared/constants.ts` as `as const` objects: `REVIEW_ACTIONS`, `SM2`, `FIELD_TYPES` (5 values incl. `json_array`), `FIELD_SIDES`, `SESSION`, `SYSTEM_TEMPLATES`, `PASSWORD` (8–128), `STREAK` (365 / 90), `NOTIFICATIONS` (`MAX_DUE_DECKS` 50). Add new domain constants there rather than inlining literals.

Three copies of some constants exist across boundaries and must be kept in sync by hand: `apps/api/src/shared/constants.ts`, `packages/shared/src/index.ts` (inert), and `apps/web/src/constants/index.ts` — whose `AI_SOURCE_MIN_CHARS`/`AI_SOURCE_MAX_CHARS` (10 / 10 000) carry an explicit "must stay in sync with `ai.routes.ts`" contract.

## Background maintenance

| Task | Cadence | `unref()`'d? |
|---|---|---|
| `recoverOrphanedJobs()` then `cleanupExpiredJobs()` | once, fire-and-forget IIFE **after** `.listen()` | n/a |
| `cleanupExpiredJobs()` | hourly | yes |
| `cleanupOldReviewLogs()` | at startup + every 24 h | yes |
| AI rate-bucket sweep (`config/ai.ts:52`) | every 10 min | **no** — importing `config/ai` anywhere, including a test, holds the event loop open |

`skipAiJobMaintenance` is a one-way latch: a Postgres `42P01` error mentioning `ai_generation_jobs` — or a `42703` mentioning **both** `ai_generation_jobs` and `error_message` (`index.ts:118-123`) — permanently disables AI job maintenance **for the process lifetime**. Running `db:migrate` afterwards is not enough; restart the server.

## Other notes

- `apps/api/tsconfig.json` declares a `@/*` path alias that **zero files use**. All imports are relative; do not start using the alias piecemeal.
- `drizzle.config.ts` reads `process.env.DATABASE_URL!` directly without importing `ENV`, so drizzle-kit commands bypass the required-var check and fail with a confusing driver error instead.
- `shared/email.ts` HTML-escapes only `sendFeedbackEmail`'s message body. `subject`, `contactEmail` and the token URLs are interpolated raw — escape any new user-supplied value you add.
- `POST /feedback`, `sendVerificationEmail` and `resendVerification` are fire-and-forget: they return success even when SMTP is unconfigured or fails.
