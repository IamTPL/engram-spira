# AGENTS.md — engram-spira

Canonical agent instructions for this repository. Tool-agnostic; `CLAUDE.md` imports this file.

**Engram Spira** is an AI-powered spaced-repetition flashcard app: Bun workspaces monorepo, ElysiaJS + Drizzle + Postgres/pgvector API, SolidJS + Vite SPA, Google Gemini for card generation and embeddings.

---

## 1. Never trust the prose — verify the number

`README.md`, `docs/srs/`, `docs/project_report.md`, `docs/ui/design.md`, `docs/c4/`, `docs/erd/` and every file in `docs/dev_prompt/` were last updated 2026-03-21 or earlier and are **stale by 20+ commits**. They disagree with the code on module counts, table counts, test counts, Gemini model names, ports, algorithm constants and feature availability. Never cite a count from them. Re-derive it:

| Fact | Command | Truth today |
|---|---|---|
| API modules | `ls -d apps/api/src/modules/*/ \| wc -l` | **16** |
| Postgres tables | `grep -rho 'pgTable(' apps/api/src/db/schema/ \| wc -l` | **18** |
| HTTP routes | `grep -rhE '^\s*\.(get\|post\|put\|patch\|delete)\(' apps/api/src/modules/*/*.routes.ts \| wc -l` | **90** + `GET /health` = **91** |
| SQL migrations | `ls apps/api/src/db/migrations/*.sql \| wc -l` | **24** (`0000`–`0023`) |
| API tests | `cd apps/api && bun test` | **274** in 24 files — 271 pass / **3 fail** |
| Web tests | `cd apps/web && bun test` | **16** in 4 files, all pass |
| Web routes | `apps/web/src/app.tsx` | **13** `<Route>` |

Toolchain: Bun 1.3.10, TypeScript 5.9.3, Node 22.22.2. Ports: API 3001, Vite dev 3002, Vite preview 4173, Postgres **5435** (host) → 5432 (container), Structurizr 8080.

## 2. The red baseline — do not mistake it for your regression

Capture this before you change anything; it is pre-existing on `master`.

- **`bun run typecheck` FAILS (exit 2).** `@engram/api` is clean; `@engram/web` emits **22 errors in 7 files** (11× TS2339, 11× TS7053), all Eden Treaty path-inference failures. **CI's only job is typecheck, so CI is red.**
  - Root cause: `apps/api/src/modules/experience/experience.routes.ts` types every handler context as `any` and declares no Elysia `t` schemas, which collapses the exported `App` type to an index signature. Verified: commenting out `.use(experienceRoutes)` in `apps/api/src/index.ts:202` drops the count **22 → 2**. The fix is typed handlers + `t` schemas on the experience routes — **not** more `as any` in `apps/web`.
- **3 API tests fail.** Two (`checkAiRateLimit` in `__tests__/modules/ai/config-ai.test.ts`) are cross-file `mock.module` leakage from `__tests__/modules/knowledge-graph/kg.service.test.ts:4` — that file passes 4/4 in isolation; do not "fix" `config/ai.ts`. One (`experience.service.test.ts:780`) is real: `__tests__/helpers/fixtures.ts:110-113` hard-codes `2026-06-27/28/29`, now all in the past.

See [docs/agents/known-issues.md](docs/agents/known-issues.md) for the full list and which are safe to fix.

## 3. Non-negotiable rules

Violating any of these breaks the build, the types, the database, reactivity, or auth scoping.

**Errors & responses**

1. Throw an `AppError` subclass from `apps/api/src/shared/errors.ts`; never `set.status` for a failure and never return an `{ error }` object from a service. The single `onError` in `apps/api/src/index.ts:145` is the only place module code produces error status codes — the sole exceptions are `/health`'s own `503` (`index.ts:179`) and the five `elysia-rate-limit` plugins, which return a hand-built 429 `Response`. Available: `UnauthorizedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409, `PayloadTooLargeError` 413, `ValidationError` 422, `TooManyRequestsError` 429. No subclass produces 400.
2. Every error body stays exactly `{ error: string }`. `getApiError()` in `apps/web/src/api/client.ts` depends on that single-key shape.
3. `new NotFoundError('Deck')` takes a resource **noun** — the class appends `" not found"`.

**Auth & authorization**

4. Authorize inside the **service**, never the route: take `userId` as an explicit parameter and scope every query by it. Decks/cards use the denormalized `decks.user_id`; folders/classes traverse `folders.class_id → classes.user_id`.
5. For anything the caller does not own, throw `NotFoundError('<Resource>')` — never `ForbiddenError`, never 403, never an empty result. Existence must not leak.
6. `.use(requireAuth)` position is load-bearing: the derive is `{ as: 'scoped' }`, so **only routes chained after it are authenticated**. Adding a route above that line in `auth.routes.ts:148` or `users.routes.ts:21` silently ships an unauthenticated endpoint. `.guard()` is never used in this codebase.

**Database**

7. Never add `card_field_values.embedding` (or any vector column) to the Drizzle schema and never write vectors through Drizzle. Use raw `pgClient` tagged templates for writes and ``db.execute(sql`…`)`` for reads. Build literals from `number[]` as ``[${vec.join(',')}]``, bind them, cast `::vector`, and keep the dimension at exactly **768**.
8. Before `db:generate` / `db:push`: drizzle-kit's baseline is snapshot **0017** (16 tables, pre-FSRS). Generated SQL will duplicate `fsrs_user_params` / `dismissed_suggestions` / `users.email_*` / the `study_progress` FSRS columns, and re-emit `DROP INDEX "idx_sdl_user_date"` — without `IF EXISTS`, so it errors against an already-migrated database. Read and prune every generated statement by hand. **`db:push` is the dangerous one**: it diffs the *live* DB, so it also proposes dropping `card_field_values.embedding` and its HNSW index, and it never creates the `vector` extension or the 3 partial indexes. (`db:generate` does *not* touch `embedding` — snapshot 0017 predates that column, so drizzle-kit is blind to it.)
9. `db:reset` is **not** a database reset: `drizzle-kit drop` interactively deletes a migration *file* + its snapshot + its journal entry. Never run `db:push`/`db:reset` against data you care about. `db:migrate` is the default.
10. A new table goes in its own file under `apps/api/src/db/schema/` and **must** export both the table and its `<name>Relations` from `schema/index.ts` — `drizzle.config.ts` reads only that barrel, so an unexported table is invisible to drizzle-kit and gets dropped by push.
11. Hand-written migrations are named `NNNN_snake_case_purpose.sql` with a `_journal.json` entry whose `when` is **strictly greater** than the previous entry's. Migration `0015` violates this and is permanently skipped. Make every statement idempotent; never `CREATE INDEX CONCURRENTLY` (the whole batch runs in one transaction).

**Study / SRS**

12. Route all review scheduling through `dispatchReview()` and load `users.srs_algorithm` + `fsrs_user_params.params` the way `reviewCardBatch` does (`study.service.ts:313-356`). Write `study_progress` + `study_daily_logs` + `review_logs` in **one** `db.transaction`. When you add an FSRS field, add it to both `calculateFsrsReview`'s restore block and the `algorithm === 'fsrs'` conflict set, or batch upserts silently drop it.
13. Never compute a day boundary from a bare `new Date()` in a service. Read the offset once via `getTimezoneOffsetMinutes(headers)` in the routes file and pass it as a trailing `tzOffset = 0` parameter. The API process must run with `TZ=UTC`.

**Config**

14. Read config only through `ENV` (`apps/api/src/config/env.ts`). Adding a variable means **four** edits: `env.ts` (with an inline default), `apps/api/.env.example`, and **both** ENV mock blocks in `apps/api/__tests__/preload.ts`. Only `DATABASE_URL` is in `REQUIRED_VARS`. Frontend config is separate: `VITE_API_URL`.
15. Any custom request header a route reads must be added to `allowedHeaders` in the `cors()` call at `apps/api/src/index.ts:135` (currently `Content-Type`, `Authorization`, `x-timezone-offset`) or the browser preflight rejects it.
16. `.unref()` every `setInterval` in a long-lived module (see `index.ts:285,302`).

**Frontend (SolidJS)**

17. **Never destructure or alias props.** Type as `Component<Props>` and read `props.x`, or peel keys with `splitProps` when spreading. Zero files in `apps/web` destructure props today.
18. No React idioms: no `useState`/`useEffect`/`useMemo`/`useRef`, no `className`, no `htmlFor`, no `onChange` for text input (use `onInput`), no `key` prop, no early `return` to change rendering. Use `class`, `for`, `<Show>`/`<For>` (`<Index>` only for focus-stable inputs), and pair every listener/timer/observer with `onCleanup`.
19. Any reactive primitive created at **module scope** must be wrapped in `createRoot` (see `theme.store.ts:43`). A bare `createSignal` is fine; `createEffect`/`createQuery` is not.
20. Build new shell surfaces in `apps/web/src/components/app-shell/` — `app.tsx:69` renders it via `protect()`. `components/layout/{header,sidebar,mobile-nav}.tsx` and `layout/sidebar/*` have **zero importers**, own 5 of the 22 tsc errors, and must not gain features. Only `layout/page-shell.tsx` is live.
21. Style with Tailwind utilities and the semantic tokens in `apps/web/src/app.css` `@theme`. Never hardcode hex in a component; add a token plus its `.dark` override. There is no `tailwind.config.*` — `app.css` is the entire config and the only source of truth for design tokens (`docs/ui/design.md` is superseded).

**Cross-boundary coupling**

22. `apps/web/src/api/client.ts:2` imports `App` from `../../../api/src/index` and `apps/web/src/lib/experience-api.ts` imports `experience.types.ts` by relative path. Do not move/rename `apps/api/src/index.ts`, do not delete `export type App`, and do not move `experience.types.ts` — each breaks the web typecheck with no API-side error.
23. `.gitignore` ignores exactly `/skills` (root-anchored — the vendored `ui-ux-pro-max` clone) and `docs/superpowers/`. **`.agents/skills/` is intentionally trackable**: that is where project skill packs (`elysiajs`, `solid-js-best-practices`) live, versioned via `scripts/skills-update.ts` / `skills-lock.json` — run `bun run skills:update` after adding or editing one. Do not widen `/skills` back into a bare `skills` pattern; that previously hid `.agents/skills/` too (see git history). Confirm any new path with `git check-ignore -v <path>` before writing a doc.

**Testing**

24. Run API tests **only** from `apps/api` (`cd apps/api && bun test`). `bunfig.toml`'s preload is CWD-relative; a root run silently drops 15 tests with `Missing required environment variable: DATABASE_URL`. Web tests: `cd apps/web && bun test` — no `test` script exists in `apps/web`.
25. Put every `mock.module` at file top **before** the subject import. Never `mock.module` a shared app module (`src/config/ai`, `src/db`) — Bun's registry is process-global and this already breaks `config-ai.test.ts`. Prefer the injectable-loaders pattern the `experience` module uses over the DB mock for new code.
26. Never bake an absolute date into a fixture whose past/future-ness matters — derive from `Date.now()`.

## 4. Before you claim done

Run all three and compare against the §2 baseline. CI runs **only** `bun run typecheck` — no tests, no lint, no build, no migrations.

```bash
bun run typecheck          # expect: api clean, web 22 errors in 7 files
cd apps/api && bun test    # expect: 271 pass / 3 fail
cd apps/web && bun test    # expect: 16 pass
```

Both tsconfigs typecheck their test files, so a type error in a test breaks CI.

There is **no linter, formatter, or git hook** in this repo. Match surrounding style by eye: 2-space indent, single quotes, semicolons, trailing commas in multiline literals. Do not add eslint/prettier/biome as a drive-by change.

## 5. Local setup

```bash
bun install
docker compose up -d                      # starts ONLY `db` (structurizr is behind --profile docs)
cp apps/api/.env.example apps/api/.env    # then fix GEMINI_EMBEDDING_MODEL — see below
bun run db:migrate && bun run db:seed
bun run dev                               # api :3001, web :3002, + browser-extension watcher
```

Seeded login: `test@example.com` / `password123`. `apps/api/.env.example:17` sets `GEMINI_EMBEDDING_MODEL=gemini-embedding-2-preview`, but the code default is **`gemini-embedding-001`** — copying the example silently switches models. `DATABASE_URL` is validated for *presence* only, so the API boots against a dead database and then floods `CONNECT_TIMEOUT localhost:5435`.

## 6. Where to read next

Load only what your task touches. Each file is self-contained.

| Task | File |
|---|---|
| Orientation, monorepo map, request lifecycle | [docs/agents/orientation.md](docs/agents/orientation.md) |
| Adding/changing an API module, error & auth contracts | [docs/agents/api-conventions.md](docs/agents/api-conventions.md) |
| Finding an endpoint's exact shape | [docs/agents/endpoints.md](docs/agents/endpoints.md) |
| Schema, migrations, pgvector | [docs/agents/database.md](docs/agents/database.md) |
| SM-2 / FSRS, review, streaks, retention | [docs/agents/srs-study.md](docs/agents/srs-study.md) |
| Gemini generation, embeddings, search, knowledge graph | [docs/agents/ai-search.md](docs/agents/ai-search.md) |
| Command-center aggregate (BFF) layer | [docs/agents/experience-bff.md](docs/agents/experience-bff.md) |
| SolidJS, app shell, stores, design tokens | [docs/agents/frontend.md](docs/agents/frontend.md) |
| Writing tests, mocking strategy | [docs/agents/testing.md](docs/agents/testing.md) |
| Scripts, CI, env vars, docs pipeline | [docs/agents/tooling-ci.md](docs/agents/tooling-ci.md) |
| Known defects, red baseline, dead code | [docs/agents/known-issues.md](docs/agents/known-issues.md) |

Index and stale-doc blacklist: [docs/agents/README.md](docs/agents/README.md).
