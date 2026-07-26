# The `experience` module — backend-for-frontend

`apps/api/src/modules/experience/` — 12 files, ~3 230 LOC, added 2026-06-28 (commits `f81a7f3` → `93552f5`) so the redesigned command-center UI can render a screen with **one** request instead of orchestrating many CRUD calls. Mounted **last** at `index.ts:202`.

It reads *across* the other modules — composing their services and issuing its own raw SQL. **Nothing in a CRUD module may import from `experience/`**; the dependency arrow points one way.

## How it differs from a CRUD module

| | CRUD module (e.g. `decks`) | `experience` |
|---|---|---|
| Route prefix | `new Elysia({ prefix: '/decks' })` | **none** — absolute paths |
| Validation | Elysia `t.Object` schemas | **hand-written parsers** + `asserts` guards |
| Handler context | fully typed | `({ currentUser, query }: any)` |
| Data access | Drizzle query builder | mostly ``db.execute(sql`…`)`` with camelCase aliases |
| Testability | db-mock helpers | every service takes an injectable `*Loaders` record |
| Response | resource object | `AggregateResponse` envelope (4 of 8 endpoints) |

> **The untyped handlers are not a free style choice.** They collapse the exported Eden `App` type to an index signature, which is why `bun run typecheck` is red. Verified: commenting out `.use(experienceRoutes)` drops web errors **22 → 2**. The fix is `t` schemas + typed handler contexts here — **not** more `as any` in `apps/web`.

## The aggregate envelope

```ts
type AggregateResponse<TData, TSections> = {
  data: TData;
  meta: { generatedAt: string; sections: TSections };
};
type AggregateSectionMeta =
  | { status: 'ok' }
  | { status: 'empty' }
  | { status: 'error'; message: string; retryable: boolean };
```

`aggregate.helpers.ts` is the only sanctioned way to build it:

- `resolveSection({ required: true, load, empty? })` — **rethrows** on failure, so the endpoint returns a normal `{ error }` body with an AppError status. Use only when the screen is meaningless without it.
- `resolveSection({ load, fallback, empty?, retryable? })` — swallows the failure, returns `fallback`, records `{status:'error', message, retryable}`. **Every optional section must supply a `fallback`** so the envelope stays renderable.
- `aggregateResponse(data, sections satisfies XSections)` — stamps `generatedAt` (at envelope-build time, after all sections resolve) and closes the section map. The `satisfies` is load-bearing: section keys are a closed union per endpoint declared in `experience.types.ts`, so a typo is a compile error.

Semantics the UI depends on: `{status:'empty'}` + `[]`/`0` means **computed and empty**; `{status:'error'}` + fallback means **failed, show a retry affordance**. A `0` is never a failure signal. Give every optional section an `empty` predicate so the two are distinguishable.

## Endpoints

| Endpoint | Wrapper | Notes |
|---|---|---|
| `GET /dashboard/command-center` | envelope | 8 sections. `reviewQueue`, `streak`, `dueDecks` are **required** — a streak or due-decks query failure 500s the whole dashboard. `recent`, `weakAreas`, `forecast`, `pendingSuggestions`, `notifications` optional. All 8 resolve **sequentially** (~10 serialised SQL round-trips), not with `Promise.all` |
| `GET /study/queue` | bare | 7 modes; `limit` clamped 1..200 (default 50) |
| `GET /library/explorer` | envelope | `classes` required, `recentDecks` optional (8 deck ids) |
| `GET /decks/:id/workspace` | envelope | `deck`+`cards` required (404 on missing deck), `study`/`analytics`/`counters` optional; page ≥ 1, pageSize 1..100 (50) |
| `GET /insights/overview` | envelope | all 5 optional: 14-day forecast, 8 smart groups, top-20 at-risk (CTE), 91-day heatmap, weekly review count |
| `GET /command/search` | bare | `q` required; 8/group, **20 default / 30 max**, shared descending budget |
| `POST /create/preview` | bare | manual/ai-paste/csv/json; 413 oversize; 15-min in-memory preview |
| `POST /create/commit` | bare | idempotency-keyed; 409 for every conflict class |

Routes are built by `createExperienceRoutes(services, authPlugin)` — a factory whose defaults are the real services and `requireAuth`. It exists purely so route tests can inject fakes. The singleton `experienceRoutes` is what `index.ts` mounts.

`experience.service.ts` is a 7-line barrel re-exporting only the 5 aggregate services + helpers + types. It **deliberately omits** `command-search.service` and `create-preview.service` — import `searchCommands`, `createPreview`, `commitCreatePreview` from their own files.

## Conventions for this layer

1. Put every new **cross-resource read** here, never in a CRUD module.
2. Wrap multi-widget payloads with `aggregateResponse` + `resolveSection`. Never hand-assemble a `{ data, meta }` literal.
3. Every service takes an injectable loaders/services record as its **last** parameter, defaulting to the exported `default*Loaders`. Adding a data dependency means adding it to that record, **not** importing `db` inside the business function. This is why the whole module needs no DB mock in tests.
4. Scope every SQL read to the caller: `decks.user_id = ${userId}`, `classes.user_id = ${userId}`, `sp.user_id = ${userId}`.
5. Reuse `retentionEstimateSelectSql()`, `atRiskRetentionFilterSql()` and `AT_RISK_RETENTION_THRESHOLD` from `retention-sql.ts`. Do not re-inline the decay formula or the literal `0.8`.
6. **Keep the table-alias contract**: those fragments reference `sp.*` unqualified and only compile inside a query that aliases `study_progress` as `sp`. When aggregating, `GROUP BY sp.stability, sp.interval_days, sp.ease_factor, sp.last_reviewed_at` or Postgres rejects the statement.
7. Validate query strings and bodies with explicit hand-written parsers in `experience.routes.ts` (`parseOptionalNumber` / `stringOrUndefined` pattern) **and** re-validate in the service, because these routes carry no `t` schema.
8. Convert every timestamp to an ISO string at the service boundary with the local `toIso` helper. The wire contract is `string | null`, never `Date`.
9. Cap every list-shaped payload with a literal SQL `LIMIT` and clamp caller limits with `Math.min(Math.max(...))` before they reach SQL.
10. Escape `%`/`_` before any LIKE/ILIKE (`likePattern()`, `command-search.service.ts:514`).
11. Update `__tests__/modules/experience/*.test.ts` in the same commit as any contract change — the routes test asserts the **exact set and order** of `meta.sections` keys.

## Retention SQL

`retention-sql.ts` is the shared definition of "at risk": `AT_RISK_RETENTION_THRESHOLD = 0.8`, and an estimate of

```
exp(-days_since_review / GREATEST(COALESCE(stability, interval_days * ease/2.5, 1), 1))
```

Note the denominator is a **`COALESCE` fallback chain**, not a max over three terms: when `stability` is non-null the interval/ease term is never consulted, so `stability = 0.5` yields a denominator of 1, not `interval*ease/2.5`. Clamped to ≤ 1 with a −50 exponent floor, and **NULL when `last_reviewed_at` is NULL**. `atRiskRetentionFilterSql()` adds "progress exists AND not yet due AND previously reviewed AND estimate < 0.8" — cards the scheduler thinks are fine but the model thinks are forgotten.

## Study queue

7 modes: `due`, `deck`, `folder`, `class`, `smart-group`, `interleaved`, `at-risk`.

`StudyQueueQuery` is a discriminated union with `never`-typed scope exclusions, so `{mode:'due', deckId}` is a compile error; the route parser drops non-matching scope ids per mode. Scope ownership is validated by `ensureDeck`/`ensureFolder`/`ensureClass`/`ensureSmartGroup`, each throwing `NotFoundError` (404); a **missing** scope id throws `ValidationError` (422). Non-UUID ids short-circuit to 404 via a local regex.

Ordering is two-stage: SQL orders by `COALESCE(next_review_at, NOW())`, `sort_order`, `id`; then JS re-sorts by reason rank (`due` 0, `new` 1, `learning` 2, `at-risk` 3, `interleaved` 4, `manual` 5), then `sortOrder`, then `id`, then slices to `limit`.

Caveats: in modes `due`/`deck`/`folder`/`class` the SQL already filters to due-or-new, so `reason` can only ever be `'due'` or `'new'` — the `learning` and `manual` reasons are **unreachable** through those modes. Only `smart-group` can reach them: `interleaved` also has no due filter, but it forces every reason to `'interleaved'`, so `summary.due/new/learning/atRisk` are all 0 while `total > 0`.

## `dueCount` means different things in different endpoints

Do not assume the numbers add up across widgets:

| Place | Definition |
|---|---|
| command-center `reviewQueue.dueCount` | `sp.id IS NOT NULL AND next_review_at <= NOW()` — **excludes new cards** |
| command-center `dueDecks`, library-explorer | `sp.id IS NULL OR next_review_at <= NOW()` — **includes new** |
| deck-workspace `study.dueCount` | excludes new; its `learningCount` **omits** the `next_review_at > NOW()` guard that command center applies |
| command-center `learningCount` | `box_level = 0 AND next_review_at > NOW()` |

`reviewQueue.nextAction` is hard-coded to `{ id: 'study.queue', label: 'Study queue' }` when any work exists, else null.

Hard limits baked into command-center SQL: dueDecks 10, recent decks 5, recent cards 5, weak areas `getSmartGroups(userId, 5)`, forecast `getForecast(userId, 7)`.

## Command search

`DEFAULT_LIMIT 20`, `MAX_LIMIT 30`, `GROUP_LIMIT 8`. Groups are filled in the fixed order **actions → cards → decks → folders → classes → docs → settings** against a **shared descending budget**, so later groups can come back empty purely because earlier ones consumed the total.

Relevance is a hand-rolled score: exact 1000, prefix 850, substring 700, subsequence `500 − lenDiff`, 0 = filtered out; ties break on routeScore, recency, title, id. Actions/docs/settings are hard-coded arrays; `settings` results appear only when scope is undefined or `'all'`.

It loads **all** matching cards/decks/folders/classes from Postgres and ranks them in JS with no SQL `LIMIT` — an unbounded per-user scan.

## Create preview → commit

Limits: `PREVIEW_TTL_MS` 15 min · `MAX_AI_TEXT_CHARS` 10 000 · `MAX_AI_REQUESTED_COUNT` 30 · `MAX_IMPORT_BYTES` 1 000 000 · `MAX_IMPORT_ROWS` 500. Oversize → `PayloadTooLargeError` (413).

1. **`POST /create/preview`** verifies deck ownership, requires `request.templateId === deck.cardTemplateId` (422 otherwise), parses rows per source, normalises fields in template `sortOrder`, computes required-field errors and substring duplicate candidates against **every card in the deck**, and stores a record under a fresh `previewId`. `clientId`s are positional (`preview-card-<index+1>`); `defaultResolution` is `'merge'` when any duplicate candidate was found, else `'create'`. For source `'manual'` an invalid row **throws** `ValidationError` instead of returning rows with `validationErrors`.
2. **`POST /create/commit`** carries `previewId` + `idempotencyKey` + per-card resolutions. Checks run in this order: unknown/foreign preview → 409 `Preview expired`; idempotency replay (same key + fingerprint, succeeded) → replay stored result; same key different fingerprint → 409 `Idempotency key conflict`; same key not-yet-succeeded → 409 `Commit already attempted`; different key after consumption → 409 `Preview already committed`; **expiry is checked LAST**, deliberately, so a successful commit replays forever even past the TTL. Fingerprints are `JSON.stringify` of a recursively key-sorted copy.
3. **Resolutions**: `create` inserts via `cards.service.create` one card at a time (per-card transaction + deck lock + embedding enqueue; `createBatch` is *not* used); `skip` writes nothing; `merge` is **fill-only** — non-empty incoming values write only into *empty* target fields, equal trimmed values are no-ops, and any differing non-empty target field throws `ConflictError('Merge conflict: <fields>')`. Merge targets must be in the same deck, else 409 `Merge target not found`.

### Create/commit caveats

- **Previews live in a module-level in-memory `Map`** — not Redis, not Postgres. They vanish on restart, are invisible to a second API instance, and expired records are **never evicted** (memory leak). `createInMemoryPreviewStore().clear()` exists for tests. `previewId` alone is not a capability — ownership is re-checked, but reports 409 `Preview expired` rather than 404/403.
- **The commit write loop is not transactional.** Planning errors roll back the consumed flag, but a failure partway through the loop leaves cards created while the idempotency record stays `succeeded: false` — every retry with the same key gets 409 `Commit already attempted` and a different key gets 409 `Preview already committed`. **The client is wedged.**
- **`ai-paste` calls no AI at all.** `parseAiPaste` splits the pasted text on newlines and emits `{ Front: line, Back: '' }` repeated `requestedCount` times; `mode: 'vocabulary' | 'qa'` is validated then ignored. The Gemini pipeline in `modules/ai` is not wired in.
- The CSV parser is `line.split(delimiter)` with **no quote handling**, so any quoted field containing the delimiter corrupts the row. `hasHeader: false` treats the `fieldMapping` value as a numeric column index; `hasHeader: true` treats it as a header name.
- `toFieldValues` filters out empty-string values, so a field the user deliberately blanked is simply not written — combined with fill-only merge, **merges can never clear a field**.

## Stubs reported as `ok`

Because these report `{status:'ok'}`, the UI cannot tell "none" from "not implemented":

- `pendingSuggestions` → `{duplicates: 0, aiSuggestions: 0}` — and real duplicate/AI-suggestion data *does* exist in the `ai` and `knowledge-graph` modules
- deck-workspace `counters` → `{graphLinks: 0, duplicates: 0, aiSuggestions: 0}`
- insights `trends.retentionDelta` → always `null`
- `notifications` are synthesised from `notificationsService.getDueDecks`: id `due:<deckId>`, `createdAt` = request time, `body` always null, `href` = `/study?deckId=…`. There is no persisted notifications table.

Also: **`updatedAt` is a lie.** `decks` and `cards` have no `updated_at` column, so every `updatedAt` in these payloads is actually `created_at`. Search "recency" ranking is therefore creation order, not last-opened order.

`DeckWorkspaceQuery.sort` is parsed and validated (`experience.routes.ts:126-133`) but **never read** by the service — cards always come back ordered by `c.sort_order ASC, c.id ASC`. Changing `sort` silently changes the query key and refetches identical data.

## Caching

**There is none server-side** — no memoization, no `Cache-Control`. The only server state is the preview `Map`. All freshness lives in TanStack Query on the web side: global `staleTime` 5 min / `gcTime` 30 min / `retry` 1 / refetch on focus, with per-query overrides (library explorer 60 s, command center 30 s, command search 15 s).

## How the web app consumes it

Three consumers, only one using the intended path:

| Consumer | Endpoint | Path | Query key |
|---|---|---|---|
| `components/app-shell/library-explorer.tsx` | `/library/explorer` | `experienceApi.getLibraryExplorer` | `experienceQueryKeys.libraryExplorer()` |
| `pages/dashboard.tsx` | `/dashboard/command-center` | `(api.dashboard as any)['command-center'].get()` | `['experience-command-center', userId]` |
| `components/search/global-search.tsx` | `/command/search` | `(api.command as any).search.get()` | `['command-search', q, pathname]` |

> **The dashboard's query key diverges.** `AppShell` invalidates `experienceQueryKeys.commandCenter()` = `['command-center']`, but the dashboard queries `['experience-command-center', userId]` — and since TanStack Query matches by key *prefix*, those two share no prefix, so every action declaring `invalidate: ['command-center']` **refreshes nothing on the dashboard**.
>
> Global search does **not** have that problem — `['command-search']` *is* a prefix of `['command-search', q, pathname]`, so invalidation would reach it. Its gap is different: no action bundle ever declares `'command-search'`, so that branch never fires.

`experience-api.ts` also exports `getStudyQueue`, `getDeckWorkspace`, `getInsightsOverview`, `createPreview`, `createCommit` and `searchCommands` — **none of which any component calls yet.** Its client is typed `any` because Eden inference is unusable for these routes, and it imports `experience.types.ts` **by relative path across the workspace boundary**, so moving that file breaks the web build.

### Action-id mismatch

Backend-emitted ids and the frontend registry **do not overlap at all**:

- `/command/search` emits `create-card`, `create-deck`, `start-study`, `import-cards`
- command center emits `study.queue` (`reviewQueue.nextAction`) and `study.smart-group` (`weakAreas[].action`)
- the registry knows `navigate.*`, `study.startQueue`, `deck.create`, `deck.delete`, `card.createManual`, `create.openAiPaste`, `create.importCsv`, `insight.studyAtRisk`, `settings.open` (14 ids)

`commandActionRunner.run` on any server-supplied id returns `{status:'error', message:'Unknown action: …'}`, which is why `dashboard.tsx` and `global-search.tsx` each hand-roll their own id switch. Param names mismatch too: backend `weakAreas` emit `params.smartGroupId` while `insight.studyAtRisk` reads `params.groupId`.

**When you add a backend action id, add the identical id and param names to `commandActionOrder`/definitions in `apps/web/src/lib/command-actions.ts` and to the id assertion in `command-actions.test.ts:15`, in the same change.**

## Unfinished plan work

`docs/superpowers/plans/2026-06-28-shadcn-command-center-redesign.md` Chunk 4 Tasks 10–14 and Chunk 5 Tasks 15–16 are **not implemented**: there are no `/study` (queue), `/library`, `/create` or `/insights` routes in `app.tsx`, and none of `pages/study/`, `pages/library/`, `pages/create/`, `pages/insights/` exist. `apps/web/src/pages/home/` is an empty leftover directory. **Every checkbox in that plan is still unchecked even for the nine tasks that shipped — use `git log`, not the plan, for progress.**

Where the shipped code **deviates from its own design spec** (`docs/superpowers/specs/…-design.md`) — the spec is wrong, the code is right:

| Spec says | Code does |
|---|---|
| AI paste ≤ 30 000 chars, ≤ 50 cards; CSV/JSON ≤ 1 000 rows | 10 000 chars, 30 cards, 500 rows (only the 1 MB byte cap matches) |
| Previews expire after 60 min; expiry → validation error | 15 min; `ConflictError` → **409**, not 422 |
| `forecast`, `study`, `analytics`, `heatmap`, `trends` non-nullable | all five are `| null` (optional sections with null fallbacks) |
| `CommandSearchQuery` = q/scope/currentRoute/limit | also adds `classId`, `folderId`, `deckId` |
| 30 results total by default | 20 default, 30 max |
| Only identity/scope sections required | `streak` and `dueDecks` are required too |
| `run(params, context)` | shipped registry adds a third `runtime` arg; `requiredParams` is declared on all 14 definitions and **read nowhere** |
| Commit invalidates 5 caches | no web code calls `createCommit`; invalidation bundles exist only for study-queue and deck mutations |

## Tests

4 files / 76 tests (`command-search` 10, `create-preview` 24, `experience.routes` 17, `experience.service` 25) — currently **75 pass / 1 fail**. The failure is a fixture time bomb, not a service regression: `__tests__/helpers/fixtures.ts:110-113` hard-codes `past=2026-06-27` / `future=2026-06-29`, both now in the past, so `isDue()` reclassifies the "future" rows as due and the queue order comes back `[card-due, card-learning, card-risk, card-new]` instead of `[card-due, card-new, card-learning, card-risk]`. Fix by deriving fixture dates from `Date.now()`.
