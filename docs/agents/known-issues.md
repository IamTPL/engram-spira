# Known issues, red baseline and dead code

Everything here is **pre-existing on `master`**. Capture the baseline before you change anything so you can prove you did not add to it.

Each entry is tagged:

- **`do-not-fix-drive-by`** — real but out of scope for an unrelated task. Mention it, do not touch it.
- **`safe-to-fix`** — small and self-contained; fixing it as part of related work is fine.
- **`own-task`** — worth fixing, but big enough to need its own decision.

---

## The red baseline

### `bun run typecheck` fails — 22 errors, and CI is red

`@engram/api` typechecks clean (exit 0). `@engram/web` emits **22 errors across 7 files** — 11× `TS2339`, 11× `TS7053`, all Eden Treaty path-inference failures on route segments like `.me`, `.login`, `.register`, `.logout`, `.deck`, `['by-deck']`, `['by-folder']`, `['forgot-password']`, `['reset-password']`.

| File | Errors |
|---|---|
| `src/components/layout/sidebar/sidebar-context.tsx` | 5 |
| `src/stores/auth.store.ts` | 4 |
| `src/pages/deck-view/deck-view-page.tsx` | 4 |
| `src/pages/study-mode.tsx` | 3 |
| `src/pages/folder-view.tsx` | 3 |
| `src/pages/reset-password.tsx` | 2 |
| `src/pages/deck-view/use-deck-data.ts` | 1 |

**These are one root cause, not 22 bugs.** `apps/api/src/modules/experience/experience.routes.ts` types every handler context as `any` and declares no Elysia `t` schemas, which collapses the exported `App` type to an index signature and destroys inference everywhere downstream.

Verified experimentally: commenting out `.use(experienceRoutes)` at `apps/api/src/index.ts:202` drops the count from **22 to 2** (the remaining two being the now-missing `api.dashboard` / `api.command` paths in `dashboard.tsx` and `global-search.tsx`).

`.github/workflows/ci.yml`'s only job is `typecheck`, so **CI is red on master.** Note `bun run build` for `apps/web` still succeeds — Vite does not typecheck.

Two cheaper partial fixes exist: 5 of the 22 errors (23%) live in `components/layout/sidebar/sidebar-context.tsx`, which is **dead code** reachable only from the dead `components/layout/sidebar.tsx`; deleting the dead layout tree removes them without touching types.

→ **`own-task`.** The correct fix is `t` schemas + typed handler contexts on the experience routes. **Do not "fix" the web files by adding more `as any`** — that is how the current casts in `auth.store.ts:99` and `dashboard.tsx:172` got there.

### 3 API tests fail

`cd apps/api && bun test` → **271 pass / 3 fail** / 576 assertions / 274 tests / 24 files.

| Test | Cause | Verdict |
|---|---|---|
| `checkAiRateLimit > throws TooManyRequestsError after 30 requests` (`config-ai.test.ts:15`) | cross-file mock leak | not a real bug |
| `checkAiRateLimit > allows exactly 30 requests` (`config-ai.test.ts:34`) | cross-file mock leak | not a real bug |
| `study queue service > covers non-empty mixed queues with deterministic ordering, reason, and summary` (`experience.service.test.ts:780`) | rotten fixture | real |

**The mock leak.** Bun runs every discovered test file in one process and `mock.module` is registered process-globally. `__tests__/modules/knowledge-graph/kg.service.test.ts:4` stubs `checkAiRateLimit` as a no-op, and that registration survives into `config-ai.test.ts`, whose two rate-limit tests then see a function that never throws.

Proof of attribution — `kg.service.test.ts` is the culprit, **not** `ai.service.test.ts` (which registers a byte-similar stub):

```
bun test __tests__/modules/knowledge-graph/kg.service.test.ts __tests__/modules/ai/config-ai.test.ts  → 5 pass / 2 fail
bun test __tests__/modules/ai/ai.service.test.ts            __tests__/modules/ai/config-ai.test.ts  → 6 pass / 0 fail
bun test __tests__/modules/ai/config-ai.test.ts                                                     → 4 pass / 0 fail
```

**Do not "fix" `config/ai.ts` or `config-ai.test.ts`** — the implementation is correct. → **`do-not-fix-drive-by`** (the structural fix is to stop stubbing shared modules).

**The fixture time bomb.** `__tests__/helpers/fixtures.ts:110-113` hard-codes `now = 2026-06-28`, `past = 2026-06-27`, `future = 2026-06-29`. Real time has passed 2026-06-29, so `study-queue.service.ts:159 isDue()` classifies the "future" rows as due and the queue returns `[card-due, card-learning, card-risk, card-new]` instead of `[card-due, card-new, card-learning, card-risk]`. → **`safe-to-fix`**: derive the dates from `Date.now()`.

---

## Confirmed defects

### Study / SRS

| Issue | Where | Verdict |
|---|---|---|
| **`POST /study/review` is SM-2-only.** Calls `calculateNextReview` directly, never reads `users.srs_algorithm` or `fsrs_user_params`, writes no FSRS columns. An FSRS user silently gets SM-2 scheduling. Masked because the web client only calls `/review-batch` | `study.service.ts:256` | `own-task` |
| **FSRS stability never grows for review-state cards.** `last_review` is hardcoded to `new Date()`, so ts-fsrs computes `elapsed_days = 0` every time. Measured: S=10 / 30 d elapsed / Good → stays 10.0, interval 11 d; correct continuation gives 53.56 / 54 d. `last_elapsed_days` therefore always persists as 0 | `fsrs.engine.ts:74` | `own-task` |
| **FSRS state lost on zero stability.** The restore is gated on `current?.stability` being *truthy*, so `stability = 0` or `NULL` rebuilds a brand-new card, discarding difficulty, state and learning steps | `fsrs.engine.ts:63` | `own-task` |
| **EASY has no upper ease-factor clamp** while AGAIN/HARD clamp to 1.3. Repeated Easy grades grow `ease_factor` without bound | `srs.engine.ts:122` | `safe-to-fix` |
| **HARD graduates a never-reviewed card** (`box_level` 0 → 1 via `Math.max(1, reps)`), contradicting the intuitive reading | `srs.engine.ts:86` | `do-not-fix-drive-by` |
| `review_logs.state` is derived from SM-2 columns with a hardcoded 21-day cutoff **even for FSRS users**, so the FSRS-native `fsrs_state` is never logged. A future optimizer trained on this column trains on SM-2 labels | `study.service.ts:252,389` | `own-task` |
| `getDeckSchedule`'s zero-card early return **omits `dueSoon`** while the non-empty path includes it; the web type declares it as `number`, so it is `undefined` at runtime for empty decks | `study.service.ts:513-518` | `safe-to-fix` |
| `getInterleavedDueCards` returns `total: dueRows.length`, capped at `limit * 2` — **not the real due count** | `study.service.ts:767,807` | `safe-to-fix` |
| The `x-timezone-offset` clamp `[-720, 840]` silently clips UTC+13/+14 users (Kiritimati, Samoa DST, Chatham) to UTC+12 | `study.routes.ts:20` | `safe-to-fix` |
| Streak math mixes UTC and server-local (`setDate` on a shifted instant), so it is **only correct under `TZ=UTC`** — and nothing sets `TZ` | `study.service.ts:584-700` | `own-task` |
| `fsrs_user_params.params` is passed into `generatorParameters()` **completely unvalidated**; malformed jsonb reaches ts-fsrs inside the review transaction | `srs.engine.ts:16` | `safe-to-fix` |
| `getRetentionHeatmap` returns `{cards: []}` instead of throwing for a foreign deck, unlike every other deck-scoped read | `forecast.service.ts:116-122` | `do-not-fix-drive-by` |

### Timezone divergence between `/study/streak` and the command center

`command-center.service.ts:151` calls `studyService.getUserStreak(userId)` with **no `tzOffset`**, while `GET /study/streak` passes the header-derived offset. The same user on the same day can get different `currentStreak`/`studiedToday` from the two endpoints. `grep -rn 'tzOffset' apps/api/src/modules/experience/` returns nothing — the whole experience layer ignores the header. Same applies to its forecast and heatmap windows. → **`safe-to-fix`** (thread the offset through), and **do not copy the omission** into new experience code.

### AI / embedding / search

| Issue | Where | Verdict |
|---|---|---|
| **Two flatteners produce different vectors for the same card.** `backfillEmbeddings` rebuilds card text inline instead of calling `getCardText`, and its branch set **omits arrays**, so a `json_array` field embeds as `["a","b"]` in backfill but `a b` via `getCardText` | `embedding.service.ts:222-233` | `own-task` |
| `backfillEmbeddings` `break`s the **entire** loop on the first batch error or an empty batch — one card with empty text ends the whole backfill, and the route already returned `{started:true}` | `embedding.service.ts:266-275` | `safe-to-fix` |
| **Re-embedding never clears the old vector**, and `storeEmbedding` targets an unordered `.limit(1)` row, so a card can end up with two non-NULL embeddings — after which backfill permanently skips it | `embedding.service.ts:162` | `own-task` |
| The `searchByEmbedding` threshold filters **in JS after the SQL `LIMIT`**, so it can only shrink the top-N window. `limit=20, threshold=0.9` can return 0 rows even when 100 rows exceed 0.9 | `embedding.service.ts:331` | `own-task` |
| `textSearch` uses `DISTINCT … LIMIT n` with **no `ORDER BY`** — the ILIKE fallback has no deterministic ranking; the same query can return different rows. It also hard-codes `similarity: 1.0`, so clients cannot tell a semantic match from a substring match | `search.service.ts:99-124` | `safe-to-fix` |
| `getEmbeddingStatus` counts `DISTINCT card_id` **globally**, not per user, despite sitting behind `requireAuth` | `embedding.service.ts:345` | `safe-to-fix` |
| `cleanupExpiredJobs`'s docstring claims it deletes `failed` jobs. It does not — the SQL is a single UPDATE, so failed rows accumulate forever | `ai.service.ts:451` | `safe-to-fix` (fix the comment or the behaviour) |
| The `AbortController` in `processJobInBackground` is decorative — only `{ timeout }` reaches the SDK; the signal is polled between chunks only | `ai.service.ts:161-186` | `do-not-fix-drive-by` |
| Vocab Title-Casing uses `/\b\w/g`, so `don't` → `Don'T`, `e-mail` → `E-Mail` | `ai.service.ts:207` | `safe-to-fix` |
| `generateRateLimit` is `.use()`d on the whole `aiRoutes` instance, so its 20/min budget covers `/save`, `/check-duplicates` and `/deck-duplicates` too — **not** "only the expensive generate endpoint" as its comment claims | `ai.routes.ts:14` | `safe-to-fix` (fix the comment) |
| `checkDuplicatesByText` skips the `isEmbeddingAvailable()` gate that `checkDuplicatesByCardId` uses, so it raises a raw Postgres error instead of the friendly 422 | `duplicate-detection.service.ts:88` | `safe-to-fix` |
| `scanDeckDuplicates`: returns `{pairs:[]}` (not 404) for a missing/foreign deck; always empty when the template has neither `word` nor `term`; emits O(k²) pairs with no cap; `String(jsonbValue)` yields `[object Object]`, collapsing all such cards into one bogus group | `duplicate-detection.service.ts:105-188` | `do-not-fix-drive-by` |
| `command-search` and `create-preview` load **all** matching rows per user with no SQL `LIMIT` and rank in JS — unbounded per-user scans | `command-search.service.ts`, `create-preview.service.ts` | `own-task` |
| The `setInterval` bucket sweeper in `config/ai.ts:52` is **not** `.unref()`'d, unlike the two in `index.ts` — importing `config/ai` anywhere, including a test, holds the event loop open | `config/ai.ts:52` | `safe-to-fix` |

### Experience / create-commit

| Issue | Where | Verdict |
|---|---|---|
| **The commit write loop is not transactional.** A failure partway through leaves cards created while the idempotency record stays `succeeded: false` — every retry with the same key gets 409 `Commit already attempted`, a different key gets 409 `Preview already committed`. **The client is permanently wedged** | `create-preview.service.ts:315-337` | `own-task` |
| **Previews live in a process-local `Map` with no TTL sweeper** — invisible to a second API instance, lost on restart, and expired records leak memory forever | `create-preview.service.ts:103-112` | `own-task` |
| **`ai-paste` calls no AI at all** — it splits lines into `{Front: line, Back: ''}` and ignores the validated `mode` | `create-preview.service.ts:529-549` | `own-task` |
| The CSV parser is `line.split(delimiter)` with **no quote handling**, so a quoted field containing the delimiter corrupts the row | `create-preview.service.ts:606-608` | `safe-to-fix` |
| `toFieldValues` filters out empty strings, so combined with fill-only merge, **a merge can never clear a field** | `create-preview.service.ts` | `do-not-fix-drive-by` |
| `DeckWorkspaceQuery.sort` is parsed and validated but **never read** — changing it silently changes the query key and refetches identical data | `deck-workspace.service.ts` | `safe-to-fix` |
| Stubs reported as `{status:'ok'}` so the UI cannot tell "none" from "not implemented": `pendingSuggestions`, deck-workspace `counters`, `trends.retentionDelta` | `command-center.service.ts:266`, `deck-workspace.service.ts:234` | `own-task` |
| `updatedAt` in every experience payload is actually `created_at` — `decks` and `cards` have no `updated_at` column. Search "recency" is creation order | `command-center.service.ts:197,213` | `own-task` |
| `dueCount` is defined **differently** in command-center `reviewQueue` (excludes new) vs `dueDecks` / library-explorer (includes new) vs deck-workspace. The numbers do not add up across widgets | see [experience-bff.md](experience-bff.md) | `own-task` |
| Backend-emitted action ids (`create-card`, `start-study`, `study.queue`, `study.smart-group`) **do not exist** in the web registry, so `commandActionRunner` cannot run any server-supplied action. `dashboard.tsx` and `global-search.tsx` each hand-roll their own id switch. Param names mismatch too (`smartGroupId` vs `groupId`) | `command-actions.ts` | `own-task` |
| The dashboard queries `['experience-command-center', userId]` while the shell invalidates `['command-center']`, so **`invalidate: ['command-center']` refreshes nothing on the dashboard** | `dashboard.tsx:170` vs `app-shell.tsx:115` | `safe-to-fix` |

### Auth / security

| Issue | Where | Verdict |
|---|---|---|
| **`GET /card-templates/:id` has no ownership check** — any authenticated user can read any other user's template and its fields | `card-templates.routes.ts:10` | `own-task` |
| **`kgService.deleteLink` verifies only the source card** — a user owning the source can delete a link whose target belongs to someone else | `kg.service.ts:104` | `safe-to-fix` |
| `POST /knowledge-graph/ai/dismiss` writes to the DB **directly in the route handler** — one of only two places in the API that does (the other is `GET`/`PATCH /study/algorithm` at `study.routes.ts:215-231`). `kg.routes.ts` and `study.routes.ts` are the only route files that import `db` at all. Do not copy them | `kg.routes.ts:85`, `study.routes.ts:216,226` | `safe-to-fix` |
| **No CSRF protection anywhere.** Safety rests entirely on `SameSite=Lax` + the CORS allowlist. Splitting SPA and API across registrable domains would stop the cookie being sent | `auth.routes.ts:14-18` | `own-task` |
| The four security headers are set in `onAfterHandle`, which Elysia **skips when a handler throws** — every 4xx/5xx response is unhardened. No CSP, no HSTS anywhere | `index.ts:138-144` | `own-task` |
| `sendFeedbackEmail` escapes only the message body; `subject` and `contactEmail` are interpolated into HTML **unescaped**, and `subject` is `t.String()` with no length bound | `shared/email.ts:62-99` | `safe-to-fix` |
| `cards.service.searchByDeck` does **not** escape `%`/`_` in its ILIKE pattern (`kg.searchCardsForLinking` and `search.textSearch` do) | `cards.service.ts:123` | `safe-to-fix` |
| The `/auth` rate limit is 5 req/min per IP across **all** `/auth` endpoints including `/auth/me`, which the web app polls — the frontend can rate-limit itself out of login | `auth.routes.ts:22` | `safe-to-fix` |
| Every authenticated request inside the 15-day refresh window issues an `UPDATE` on `sessions`, with no throttling — a write hotspot under load | `session.utils.ts:88-92` | `own-task` |
| `skipAiJobMaintenance` is a **one-way latch**: one `42P01`/`42703` error disables AI job maintenance for the whole process lifetime. `db:migrate` afterwards is not enough — restart | `index.ts:215,240,264` | `do-not-fix-drive-by` |
| Logged status codes for 4xx are wrong — the request logger's `onError` runs before the app's and reads `set.status ?? 500`, so a 404 logs as `status: 500` at `error` level. Never alert on these | `logger.plugin.ts:102-131` | `safe-to-fix` |
| `cards.routes.ts` validates no path or query params; `cursor`/`limit` are bare `Number(...)` coercions, so a non-numeric cursor becomes `NaN` | `cards.routes.ts:7-19` | `safe-to-fix` |
| The reorder transactions issue N parallel `UPDATE`s with no deterministic row order — can deadlock under concurrent reorders of the same parent | classes/folders/cards `.service.ts` | `own-task` |

### Database

| Issue | Where | Verdict |
|---|---|---|
| **Migration `0015` is permanently skipped** — its journal `when` (1741564800000) is lower than `0014`'s (1772769352081), and Drizzle applies a migration only when `lastDbMigration.created_at < folderMillis`. Harmless only because `0022` re-adds the column with `IF NOT EXISTS` | `meta/_journal.json:110-121` | `do-not-fix-drive-by` |
| drizzle-kit's snapshot baseline is **`0017`** (6 migrations stale), so `db:generate` emits duplicate DDL — re-`CREATE TABLE`s for `dismissed_suggestions` and `fsrs_user_params`, re-`ADD COLUMN`s for the five FSRS and four email-verification columns, and a redundant `DROP INDEX "idx_sdl_user_date"` with no `IF EXISTS`. It emits **nothing** for `card_field_values.embedding` — that column is absent from both the snapshot and the TS schema, so generate is blind to it; only `db:push`, which diffs the live DB, proposes dropping it. `0013` dropping `fsrs_user_params` + 4 columns is the precedent for what generate *can* destroy | `meta/` | `own-task` |
| `card_field_values.template_field_id` has no standalone index, so deleting a `template_fields` row scans the table. Same for the `dismissed_suggestions` card columns | `schema/cards.ts` | `safe-to-fix` |
| `prepare: true` on the postgres.js client means named prepared statements — **incompatible with PgBouncer / transaction-mode poolers** | `db/index.ts:6-11` | `own-task` |
| No Drizzle `logger` is configured, so there is **no SQL logging** in dev | `db/index.ts:13` | `safe-to-fix` |
| Long-lived DBs that survived `0009 → 0013 → 0019` have `real` FSRS columns; `0009` used `double precision`. Do not assume float8 | migrations | `do-not-fix-drive-by` |

### Frontend

| Issue | Where | Verdict |
|---|---|---|
| Command actions return routes that **do not exist** (`/study?…`, `/library?…`, `/create?…`, `/insights`) and work only because `AppShell.resolveAvailableRoute()` rewrites them — **dropping the query string**, so `study.startQueue` with `mode:'at-risk'` loses the mode | `command-actions.ts:148-177` | `own-task` |
| `#main-content` exists only inside AppShell, so the `index.html` skip link and `RouteAnnouncer`'s focus call are **no-ops** on `/reset-password`, `/verify-email`, `/login`, `/register` and the 404 route | `app-shell.tsx:399` | `safe-to-fix` |
| `index.html`'s pre-JS loading shell hardcodes the **retired** palette and switches on `@media (prefers-color-scheme: dark)` while the app is class-based, so light-OS + dark-app users get a light flash. It also hard-depends on Google Fonts | `apps/web/index.html` | `safe-to-fix` |
| `theme.store` registers a `matchMedia` listener at module scope with **no cleanup** (leaks in tests); `focus.store` **runs side effects at import time**, mutating localStorage | `theme.store.ts:56`, `focus.store.ts:278-301` | `do-not-fix-drive-by` |
| `TaskRail` and `MobileBottomNav` duplicate the same 6-item nav byte-for-byte — any change must be made twice or the navs diverge | `task-rail.tsx:31`, `mobile-bottom-nav.tsx:29` | `safe-to-fix` |
| `app.css:113-114` still define `--sidebar-width` / `--sidebar-collapsed-width`, vestigial since the app-shell explorer uses its own 296 px / 240–420 bounds | `app.css` | `safe-to-fix` |
| `index.tsx:2` imports `solid-devtools` as an **unguarded** runtime side effect (not behind `import.meta.env.DEV`) | `index.tsx:2` | `safe-to-fix` |
| `apps/web` imports root-hoisted `three` / `three-stdlib` without declaring them — resolves only via workspace hoisting | `dodecahedron-dice.tsx:2-3` | `safe-to-fix` |
| `pages/docs.tsx` feeds two `innerHTML=` sinks with runtime-fetched content, guarded only by hand-rolled `sanitizeHtml`/`sanitizeSvg`. Any new doc surface must reuse them | `docs.tsx:371,503` | `do-not-fix-drive-by` |

---

## Dead code

Verified as having **zero importers** or being otherwise unreachable. Deleting any of it is `own-task` — but never add features to it.

| What | Note |
|---|---|
| `apps/web/src/components/layout/header.tsx`, `mobile-nav.tsx`, `sidebar.tsx` + the 6 files in `layout/sidebar/` | Zero importers. Own **5 of the 22 tsc errors**. Only `layout/page-shell.tsx` is live |
| `apps/web/src/stores/sidebar.store.ts` | Imported only by the dead layout files |
| `apps/web/src/lib/use-focus-trap.ts` | No callers — Kobalte overlays already trap focus |
| `apps/web/src/components/dashboard/smart-groups-widget.tsx` | Calls `GET /study/smart-groups`, **which does not exist** — and the component is never mounted |
| `apps/web/src/pages/home/` | Empty directory, leftover from the redesign plan |
| `packages/shared` | 11 exports, **zero importers**, `node_modules/@engram/` empty |
| `cytoscape-fcose` | Installed and typed, imported nowhere |
| root dependency `web@^0.0.2` | Unrelated 2012 Node HTTP library, zero imports |
| `skills-lock.json` phantom entries | `scripts/skills-update.ts` (`bun run skills:update`) only ever *adds or updates* a lock entry for a skill directory it finds on disk — it never deletes one. 7 entries (`enhance-prompt`, `design-md`, `supabase-postgres-best-practices`, `brainstorming`, `systematic-debugging`, `writing-plans`, `executing-plans`) reference `.agents/skills/<name>/` directories that no longer exist; running the script does not clean them up. Don't trust a lock entry as proof a skill exists — check the directory. See [tooling-ci.md](tooling-ci.md) |
| `scripts/tsconfig.json` | Orphaned — nothing references it, nothing typechecks `scripts/` |
| `recommendations.service.ts` `getCardRetentions()`, plus its unused `getCardLabels` / `cardConcepts` imports | Never called |
| `duplicate-detection.service.ts` imports of `getCardLabels`, `cosineSimilarity` | Never called |
| `external-mocks.ts` `mockNodemailer`, `mockGeminiAI`, `mockEnv` | Zero call sites; `mockGeminiAI` is also broken |
| `ENV.SESSION_MAX_AGE_DAYS`, `ENV.SESSION_REFRESH_THRESHOLD_DAYS` | Read nowhere — live values are in `shared/constants.ts` |
| `SM2.GOOD_EF_DELTA` | Never read by production code — `srs.engine.ts`'s `good` branch leaves `easeFactor` unchanged. Its only reference is an assertion in `constants.test.ts:39`, so deleting it breaks a passing test |
| `apps/web/vite.config.ts` `/api` proxy (both `server` and `preview`) | Dead config — the Eden client uses an absolute URL |
| `apps/api/tsconfig.json` `@/*` path alias | Zero files use it |
| `requiredParams` on all 14 command-action definitions | Declared everywhere, read nowhere |
| `review_logs.review_duration_ms` | No endpoint ever writes it |
| `card_concepts` inserts | Nothing ever inserts — smart groups and study-queue concept modes return empty on a fresh DB |
| `fsrs_user_params` writes | Nothing ever writes — there is no optimizer feature |

## Features documented but not implemented

- **Prerequisite chains.** `docs/project_report.md:116` and `docs/c4/workspace.dsl:45` describe "BFS traversal, max depth 10". The string `prerequisite` appears nowhere in `apps/api/src` or `apps/web/src` — only as an unused constant in the inert `packages/shared`.
- **`/analytics` and `/search` routes.** `docs/c4/workspace.dsl:23-24,114-115` declares both. Neither exists; analytics live inside deck-view and dashboard widgets, and search is a command-palette modal.
- **FSRS parameter optimization.** Mentioned only in a schema comment (`review-logs.ts:19`). No endpoint, service or job writes `fsrs_user_params`.
- **Experience plan Chunk 4 Tasks 10–14 and Chunk 5 Tasks 15–16** — no `/study` queue, `/library`, `/create` or `/insights` routes exist. See [experience-bff.md](experience-bff.md).
