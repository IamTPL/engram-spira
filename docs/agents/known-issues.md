# Known issues, red baseline and dead code

Everything here is **pre-existing on `master`**. Capture the baseline before you change anything so you can prove you did not add to it.

Each entry is tagged:

- **`do-not-fix-drive-by`** — real but out of scope for an unrelated task. Mention it, do not touch it.
- **`safe-to-fix`** — small and self-contained; fixing it as part of related work is fine.
- **`own-task`** — worth fixing, but big enough to need its own decision.

---

## The red baseline

**As of 2026-09-09 the baseline is green: `bun run typecheck` exits 0, `cd apps/api && bun test` is 691 pass / 0 fail across 77 files, and `cd apps/web && bun test` is 91 pass / 17 files.** The section is kept because the baseline has flipped red → green → red before. **Always re-run `bun run typecheck` and both `bun test` commands yourself** before trusting any number on this page.

The API count went *down* (748 → 691) because the FSRS-only migration deleted the SM-2 engine, the legacy retention estimators and the replay tooling along with their tests. A smaller number is not a dropped suite — check `git log` before assuming tests vanished.

### `bun run typecheck` — passes clean, CI is green

`.github/workflows/ci.yml`'s only job is `typecheck`. This section used to document a 22-error Eden Treaty path-inference collapse, root-caused to `apps/api/src/modules/experience/experience.routes.ts` typing every handler context as `any`. That file has since been refactored to an injectable-services pattern and the collapse no longer reproduces. If typecheck goes red again, re-diagnose from scratch rather than assuming the old root cause.

### API tests — 0 fail (was 3, all fixed 2026-09-08)

| Test | Cause | Fix |
|---|---|---|
| `study queue service > covers non-empty mixed queues…` (`experience.service.test.ts`) | `__tests__/helpers/fixtures.ts` hard-coded `now/past/future` calendar dates that real time overtook | fixture now derives the three instants from `Date.now()` ± 1 day |
| `PostgreSQL canonical FSRS live writer > reactivates a matching arbitrary-ID manual revision…` and `> uses active parameters for New…` (`fsrs-live.postgres.test.ts`) | tests seeded `fsrs_parameter_revisions` rows retired at the fixed `RECEIVED_AT` (2026-07-29) while `created_at`/`activated_at` took the column default `now()`; once the real clock passed 2026-07-29 the row violated `chk_fsrs_parameter_revisions_timestamps` | seeded revisions pin `created_at = activated_at = SEEDED_REVISION_AT` (one hour before `RECEIVED_AT`) |
| `0026 FSRS-only expansion migration > provides a supporting index for every foreign key` (`fsrs-only.migration.test.ts`) | ambiguous `table_name` in the test's own `information_schema` join | introspection rewritten against `pg_catalog` (`pg_constraint` / `pg_index`) |

**Postgres-backed suites need the dev container up** (`docker compose up -d`). 16 test files create a disposable database through `TEST_POSTGRES_ADMIN_URL` (default `postgresql://postgres:postgrespassword@localhost:5435/postgres`), apply every migration and drop it in `afterAll`: the five `modules/study/fsrs-*.postgres.test.ts` (`deck-reads`, `live`, `read`, `consumers`, `sql`), the four `__tests__/db/*` migration/schema suites, and the knowledge-graph + embedding `*.integration.test.ts` files. Re-derive the list with `grep -rln TEST_POSTGRES_ADMIN_URL apps/api/__tests__`. If the container is down they fail with connection errors — start it, do not "fix" the tests. (`fsrs-replay.postgres.test.ts` no longer exists; the replay tooling was deleted in `fa50447`.)

**The previously-documented mock leak is gone.** `__tests__/modules/knowledge-graph/kg.service.test.ts` no longer stubs `checkAiRateLimit` via `mock.module`. Do not go looking for it.

---

## Confirmed defects

### Study / SRS

The FSRS-only migration removed nine entries that used to live here: the SM-2-only `POST /study/review`, "stability never grows", "state lost on zero stability", the EASY ease-factor clamp, the HARD-graduates-a-new-card quirk, the SM-2-derived `review_logs.state` label, `getDeckSchedule`'s missing `dueSoon`, `getInterleavedDueCards`'s capped `total`, and unvalidated `fsrs_user_params`. **The code they described is gone** (`3dea1fd`, `fa50447`) — do not re-file them from an older copy of this page. See [srs-study.md](srs-study.md#removed-surfaces--do-not-reintroduce-and-where-the-history-lives).

| Issue | Where | Verdict |
|---|---|---|
| **Fixed 2026-09-08 — kept for context.** `GET /study/deck/:deckId` (due mode) returned 500 for every deck: `fsrs-deck-reads.postgres.ts` bound a JS `Date` into `$3::timestamptz` through the shared `pgClient`, whose timestamp serializer `drizzle()` had replaced with an identity function. A second latent defect in the same family (timestamp columns read back as text) would have surfaced as soon as any `fsrs_card_states` row existed. Both fixed via `src/db/pg-codecs.ts`; see AGENTS.md §3 rule 27 | `fsrs-deck-reads.postgres.ts`, `fsrs-read.postgres.ts`, `fsrs-live.postgres.ts` | resolved |
| **"At risk" is near-empty by construction under FSRS.** `fsrsAtRisk` (`fsrs-sql.ts:48`) is `state='review' AND next_review_at > asOf AND R < that card's own request_retention`. FSRS picks the due date so recall lands *at* target, so almost nothing decays past target before becoming due — every at-risk widget therefore reads ~0 on a healthy deck. That is **correct behaviour, not a bug**. Whether the widget should instead show "approaching target" (a wider band, or a rank rather than a threshold) is an open **product** decision; do not loosen the predicate to make the number bigger | `fsrs-sql.ts:48`, consumed by `command-center.service.ts:127`, `deck-workspace.service.ts:196`, `insights-overview.service.ts:126`, `study-queue.service.ts:288`, `retention-overview.service.ts:161` (and inlined equivalently in `forecast.service.ts:211`) | `own-task` (product decision first) |
| `kg-embedding.service.ts:106` binds a JS array into `unnest(${cardIds}::uuid[])` through drizzle's `sql`, which serialises it as a **row constructor** `($1, $2, …)` — Postgres rejects that with `42846 cannot cast type record to uuid[]` as soon as `loadCardEmbeddingStates` is called with a non-empty list. Same latent bug Task 14 hit and worked around in `recommendations.service.ts:193-196` by expanding into `ANY(ARRAY[…]::text[])`; apply the identical fix here | `kg-embedding.service.ts:106` | `safe-to-fix` |
| **Fixed 2026-09-09 — kept for context.** The `x-timezone-offset` clamp was `[-720, 840]`, which clipped UTC+13/+14 users (Kiritimati, Samoa DST, Chatham) to UTC+12. It is now `[-840, 720]` — the real `getTimezoneOffset()` range, matching `fsrs-live.domain.ts:7-8`. There never was a "reversed sign convention": both sides take the JS sign and subtract it. `retention-details.service.ts:100` re-clamps at the service boundary and was widened to the same bounds in the same commit — keep the two in step | `study.routes.ts:26-37`, `retention-details.service.ts:100` | resolved |
| Streak math mixes UTC and server-local (`setDate` on an offset-shifted instant), so it is **only correct under `TZ=UTC`** — and nothing sets `TZ` | `study.service.ts:109-181` | `own-task` |
| `getRetentionHeatmap` returns `{cards: []}` instead of throwing for a foreign deck, unlike every other deck-scoped read. Ownership is folded into the join, so there is no cheap 404 to add without a second statement | `forecast.service.ts:147-160` | `do-not-fix-drive-by` |

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
| **Fixed 2026-09-09 — kept for context.** The dashboard queries `['experience-command-center', userId]` while the shell invalidated `['command-center']`, so `invalidate: ['command-center']` refreshed nothing. The `QueryInvalidationKey` union member, `experienceQueryKeys.commandCenter()` and `command-actions.ts`'s `invalidates` entries are now all `'experience-command-center'`, which prefix-matches the dashboard key. The remaining `'command-center'` string literals in `apps/web/src` are Eden **HTTP path** accessors (`api.dashboard['command-center'].get()`) and must stay | `dashboard.tsx:189`, `experience-api.ts:48`, `app-shell/types.ts:19`, `command-actions.ts:188-198` | resolved |

### Auth / security

| Issue | Where | Verdict |
|---|---|---|
| **`GET /card-templates/:id` has no ownership check** — any authenticated user can read any other user's template and its fields | `card-templates.routes.ts:10` | `own-task` |
| **`kgService.deleteLink` verifies only the source card** — a user owning the source can delete a link whose target belongs to someone else | `kg.service.ts:104` | `safe-to-fix` |
| **Fixed — kept as a rule.** Two route handlers used to query the DB inline (`POST /knowledge-graph/ai/dismiss` and the `/study/algorithm` pair). Both are gone: the algorithm endpoints were deleted with SM-2, and `kg.routes.ts` now delegates to its service. `grep -ln '\bdb\b' apps/api/src/modules/*/*.routes.ts` returns **nothing** — keep it that way; the only handler that touches Postgres directly is `GET /health` | all `*.routes.ts` | resolved |
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
| drizzle-kit's snapshot baseline is **`0017`** (now **12** migrations stale), so `db:generate` emits duplicate DDL — re-`CREATE TABLE`s for `dismissed_suggestions` and `fsrs_user_params`, re-`ADD COLUMN`s for the five FSRS and four email-verification columns, and a redundant `DROP INDEX "idx_sdl_user_date"` with no `IF EXISTS`. **It is now stale in both directions:** snapshot `0017` predates the 12 tables added after it *and* still contains `study_progress`, `review_logs` and `fsrs_user_params`, which migration `0029` deliberately **dropped** — so drizzle-kit will propose re-creating them, and `db:push` (which diffs the live DB) would actually do it. It emits **nothing** for `card_field_values.embedding` — absent from both the snapshot and the TS schema, so generate is blind to it; only `db:push` proposes dropping it. It also knows nothing about the `fsrs_retrievability()` function. `0013` dropping `fsrs_user_params` + 4 columns is the precedent for what generate *can* destroy | `meta/` | `own-task` |
| `card_field_values.template_field_id` has no standalone index, so deleting a `template_fields` row scans the table. Same for the `dismissed_suggestions` card columns | `schema/cards.ts` | `safe-to-fix` |
| `prepare: true` on the postgres.js client means named prepared statements — **incompatible with PgBouncer / transaction-mode poolers** | `db/index.ts:6-11` | `own-task` |
| No Drizzle `logger` is configured, so there is **no SQL logging** in dev | `db/index.ts:13` | `safe-to-fix` |
| **Obsolete since `0029`.** The `real`-vs-`double precision` drift on `study_progress`'s FSRS columns across `0009 → 0013 → 0019` no longer matters — the table is dropped. `fsrs_card_states.stability`/`.difficulty` and `fsrs_parameter_revisions.decay`/`.factor` are `double precision` from birth, on every database | migrations | resolved |

### Frontend

| Issue | Where | Verdict |
|---|---|---|
| Command actions return routes that **do not exist** (`/study?…`, `/library?…`, `/create?…`, `/insights`) and work only because `AppShell.resolveAvailableRoute()` rewrites them — **dropping the query string**, so `study.startQueue` with `mode:'at-risk'` loses the mode | `command-actions.ts:148-177` | `own-task` |
| `#main-content` exists only inside AppShell, so the `index.html` skip link and `RouteAnnouncer`'s focus call are **no-ops** on `/reset-password`, `/verify-email`, `/login`, `/register` and the 404 route | `app-shell.tsx:399` | `safe-to-fix` |
| `index.html`'s pre-JS loading shell hardcodes the **retired** palette and switches on `@media (prefers-color-scheme: dark)` while the app is class-based, so light-OS + dark-app users get a light flash | `apps/web/index.html` | `safe-to-fix` |
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
| `apps/web/src/components/layout/header.tsx`, `mobile-nav.tsx`, `sidebar.tsx` + the 6 files in `layout/sidebar/` | Zero importers. They used to own 5 of the 22 tsc errors; typecheck is green now, so they are dead but not red. Only `layout/page-shell.tsx` is live |
| `apps/web/src/stores/sidebar.store.ts` | Imported only by the dead layout files |
| `apps/web/src/lib/use-focus-trap.ts` | No callers — Kobalte overlays already trap focus |
| `apps/web/src/components/dashboard/smart-groups-widget.tsx` | Calls `GET /study/smart-groups`, **which does not exist** — and the component is never mounted |
| `apps/web/src/pages/home/` | Empty directory, leftover from the redesign plan |
| `packages/shared` | 11 exports, **zero importers**, `node_modules/@engram/` empty |
| `cytoscape-fcose` | Installed and typed, imported nowhere |
| root dependency `web@^0.0.2` | Unrelated 2012 Node HTTP library, zero imports |
| `skills-lock.json` phantom entries | `scripts/skills-update.ts` (`bun run skills:update`) only ever *adds or updates* a lock entry for a skill directory it finds on disk — it never deletes one. 7 entries (`enhance-prompt`, `design-md`, `supabase-postgres-best-practices`, `brainstorming`, `systematic-debugging`, `writing-plans`, `executing-plans`) reference `.agents/skills/<name>/` directories that no longer exist; running the script does not clean them up. Don't trust a lock entry as proof a skill exists — check the directory. See [tooling-ci.md](tooling-ci.md) |
| `scripts/tsconfig.json` | Orphaned — nothing references it, nothing typechecks `scripts/` |
| `duplicate-detection.service.ts` imports of `getCardLabels`, `cosineSimilarity` | Never called |
| `external-mocks.ts` `mockNodemailer`, `mockGeminiAI`, `mockEnv` | Zero call sites; `mockGeminiAI` is also broken |
| `ENV.SESSION_MAX_AGE_DAYS`, `ENV.SESSION_REFRESH_THRESHOLD_DAYS` | Read nowhere — live values are in `shared/constants.ts` |
| `apps/web/vite.config.ts` `/api` proxy (both `server` and `preview`) | Dead config — the Eden client uses an absolute URL |
| `apps/api/tsconfig.json` `@/*` path alias | Zero files use it |
| `requiredParams` on all 14 command-action definitions | Declared everywhere, read nowhere |
| `card_concepts` inserts | Nothing ever inserts — smart groups and study-queue concept modes return empty on a fresh DB |
| `fsrsLiveService.rotateParameters` | Fully implemented and tested, but **no HTTP route reaches it** — there is no parameter-optimizer feature and no per-user parameter endpoint. Not dead in the deletable sense: it is the only sanctioned way to write `fsrs_parameter_revisions`, so leave it |

## Features documented but not implemented

- **Prerequisite chains.** `docs/project_report.md:116` and `docs/c4/workspace.dsl:45` describe "BFS traversal, max depth 10". The string `prerequisite` appears nowhere in `apps/api/src` or `apps/web/src` — only as an unused constant in the inert `packages/shared`.
- **`/analytics` and `/search` routes.** `docs/c4/workspace.dsl:23-24,114-115` declares both. Neither exists; analytics live inside deck-view and dashboard widgets, and search is a command-palette modal.
- **FSRS parameter optimization.** `fsrsLiveService.rotateParameters` exists and works, but nothing calls it: no endpoint, no job, no UI. `fsrs_parameter_revisions.source` already allows `'optimized'`, so the data model is ready and the feature is not.
- **Experience plan Chunk 4 Tasks 10–14 and Chunk 5 Tasks 15–16** — no `/study` queue, `/library`, `/create` or `/insights` routes exist. See [experience-bff.md](experience-bff.md).
