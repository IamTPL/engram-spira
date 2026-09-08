# FSRS-only scheduling — design

Date: 2026-09-08
Status: approved in brainstorming, awaiting written-spec review
Branch: `feat/fsrs-only` (from `fix/pgclient-codecs`)

## 1. Problem

The FSRS-only refactor landed half-wired. `GET /study/deck/:deckId` now reads
the canonical model (`fsrs_card_states`), but `POST /study/review-batch` and
both `reset-progress` routes still write the legacy model (`study_progress`,
`review_logs`). A card that was just graded stays "New" forever: the "Family"
deck reports 98 due cards no matter how many are reviewed. Fifteen other API
files (forecast, retention, recommendations, notifications, knowledge graph,
five experience BFF services) also still read the legacy tables, and the
Settings page still offers an SM-2/FSRS switch that no longer means anything on
the read side.

## 2. Decisions already taken

| Question | Decision |
|---|---|
| Real user data anywhere? | No. Only the local dev DB (4 users, 349 cards, 50 `study_progress`, 195 `review_logs`). One replay, then drop. |
| SM-2 | Removed entirely: `users.srs_algorithm`, `fsrs_user_params`, `GET/PATCH /study/algorithm`, `srs.engine.ts`, the legacy `calculateFsrsReview` path, the Settings card. Every user runs FSRS with default parameters. |
| Settings "Spaced repetition" card | Deleted. No replacement control. |
| Replay tooling (`fsrs-replay*`, ~2.5k lines) | Deleted after the one dev-DB replay, in the same commit as the drop migration. |
| Performance | First-class, cross-cutting goal and a permanent doctrine for future agents (`AGENTS.md` §0 + `docs/agents/performance.md`). |
| Read model | **SQL-native** (approach A below). |

## 3. Goals and non-goals

Goals

- Every review, reset and read goes through the canonical FSRS tables.
- Every aggregate (due counts, retention, forecast, at-risk) is one set-based
  SQL statement that uses an index; no per-card JavaScript loops.
- Legacy tables, columns, engines, endpoints and UI are gone; `grep` for them
  in `apps/api/src` and `apps/web/src` returns nothing.
- Existing user-facing behaviour (queue ordering, streaks, memory health,
  forecast) is preserved except where SM-2 concepts are removed.
- Measurable performance budgets exist and are enforced by tests.

Non-goals

- New study features or UI (no retention slider, no new charts).
- Optimising FSRS parameters per user (the `rotateParameters` surface stays
  callable but has no UI).
- Multi-environment / zero-downtime migration choreography.

## 4. Read-model approaches considered

**A. SQL-native (chosen).** Denormalise the two forgetting-curve constants
onto each parameter revision and compute retrievability in an `IMMUTABLE`
Postgres function. Every aggregate is one query. ts-fsrs remains the oracle in
tests. Risk: formula drift; mitigated by a property test comparing SQL to
ts-fsrs across thousands of inputs.

**B. JavaScript via the canonical loader.** Load state rows, compute with
`calculateCanonicalFsrsRetrievability`. One source of truth but O(cards) per
request for dashboards and insights. Rejected on performance.

**C. Cached retrievability column + refresh job.** Stale data, extra worker.
Rejected (YAGNI).

## 5. Data model

Canonical tables kept: `fsrs_parameter_revisions`, `fsrs_card_states`,
`fsrs_review_events`, `study_daily_logs`. Dropped: `study_progress`,
`review_logs`, `fsrs_user_params`, `fsrs_migration_runs`, `users.srs_algorithm`.

### 5.1 `fsrs_parameter_revisions` gains two immutable columns

| Column | Type | Value |
|---|---|---|
| `decay` | `double precision NOT NULL` | `-w[20]` |
| `factor` | `double precision NOT NULL` | `round(exp(ln(0.9) / decay) - 1, 8)` |

CHECK `chk_fsrs_parameter_revisions_curve`: `decay < 0 AND factor > 0`.
Computed in TypeScript (`fsrs-revision.ts`) when a revision is created, using
the same arithmetic and 8-decimal rounding as `ts-fsrs@5.4.1`
`computeDecayFactor`. Migration backfills existing rows from
`(parameters->'w'->>20)::double precision`.

### 5.2 Postgres function

```sql
CREATE OR REPLACE FUNCTION fsrs_retrievability(
  stability double precision,
  elapsed_seconds double precision,
  decay double precision,
  factor double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT round(
    power(1 + factor * (elapsed_seconds / 86400.0) / stability, decay)::numeric,
    8
  )::double precision
$$;
```

Mirrors `forgetting_curve` in ts-fsrs 5.4.1 exactly:
`round8(power(1 + factor * t / S, decay))` with `factor` already rounded to 8
decimals at revision creation.

### 5.3 Indexes

Replace two existing indexes so user-scoped aggregates are index-only and
deck-scoped joins hit a composite key:

```sql
DROP INDEX IF EXISTS idx_fsrs_card_states_due;
CREATE INDEX IF NOT EXISTS idx_fsrs_card_states_user_due
  ON fsrs_card_states (user_id, next_review_at)
  INCLUDE (card_id, state, stability, last_reviewed_at, parameter_revision_id);

DROP INDEX IF EXISTS idx_fsrs_card_states_card;
CREATE INDEX IF NOT EXISTS idx_fsrs_card_states_card_user
  ON fsrs_card_states (card_id, user_id);
```

`idx_fsrs_review_events_user_reviewed (user_id, reviewed_at)` already serves
"reviewed this week" and rating histograms. No `CONCURRENTLY` (migrations run
in one transaction).

### 5.4 Shared SQL fragments (`apps/api/src/modules/study/fsrs-sql.ts`)

One module exports the vocabulary every consumer uses, as postgres.js-safe
text fragments plus a typed helper for the `asOf` bind:

| Concept | SQL |
|---|---|
| New | `s.id IS NULL` |
| Due | `s.id IS NULL OR s.next_review_at <= $asOf` |
| Learning | `s.state IN ('learning','relearning')` |
| Review | `s.state = 'review'` |
| Retrievability | `fsrs_retrievability(s.stability, EXTRACT(EPOCH FROM ($asOf - s.last_reviewed_at)), r.decay, r.factor)` |
| At risk | `s.state = 'review' AND s.next_review_at > $asOf AND <retrievability> < (r.parameters->>'request_retention')::double precision` |

Rules: `asOf` is bound once per request from the route (never `NOW()` inside
fragments), joined revision alias is always `r`, state alias is always `s`.

## 6. Write path and API contract

### 6.1 `POST /study/review-batch`

Request (Elysia `t` schema, 1–100 items):

```json
{ "items": [ { "requestId": "uuid", "cardId": "uuid", "rating": "again|hard|good|easy",
               "reviewedAt": "ISO-8601 instant", "durationMs": 1234 } ] }
```

Route reads `tzOffset` from `x-timezone-offset` as today and calls
`fsrsLiveService.reviewBatch(userId, items, tzOffset)`. Response is the
existing `FsrsLiveReviewBatchResult`:

```json
{ "applied": 3, "duplicates": 0,
  "results": [ { "requestId", "cardId", "status": "applied|duplicate", "learningCycle",
                 "sequence", "state", "nextReviewAt", "stability", "difficulty", "scheduledDays" } ] }
```

Idempotency: same `requestId` + same payload → `duplicate`, no writes; same
`requestId` + different payload → 409 `ConflictError`. `reviewedAt` more than
5 minutes in the future or earlier than the card's `last_reviewed_at` → 422.

### 6.2 Removed endpoints

`POST /study/review`, `GET /study/algorithm`, `PATCH /study/algorithm`.

### 6.3 Reset

`POST /study/deck/:deckId/reset-progress` → `fsrsLiveService.resetDeck`;
`POST /study/card/:cardId/reset-progress` → `fsrsLiveService.resetCard`.
Events are immutable and kept; state rows are deleted; the next review opens
a new `learning_cycle`. Response `{ reset: <count> }` for both (card reset used to return `{ reset: true }`; the web client only checks `error`).

### 6.4 Interleaved

`POST /study/interleaved` and `GET /study/interleaved/auto` select due cards
from `fsrs_card_states` and round-robin across decks in SQL:

```sql
WITH due AS (
  SELECT c.id, c.deck_id, c.sort_order, s.next_review_at,
         ROW_NUMBER() OVER (PARTITION BY c.deck_id
                            ORDER BY s.next_review_at NULLS LAST, c.sort_order, c.id) AS rn
  FROM cards c JOIN decks d ON d.id = c.deck_id AND d.user_id = $1
  LEFT JOIN fsrs_card_states s ON s.card_id = c.id AND s.user_id = $1
  WHERE c.deck_id = ANY($2::uuid[]) AND (s.id IS NULL OR s.next_review_at <= $3)
)
SELECT id, COUNT(*) OVER () AS total FROM due ORDER BY rn, deck_id LIMIT $4;
```

`total` is the real due count (the old `limit * 2` cap is gone).

### 6.5 Service wiring

`study.service.ts` becomes a thin facade: `createStudyService({ deckReads,
live })` with defaults `createPostgresFsrsDeckReadRepository(pgClient)` and
`createPostgresFsrsLiveRepository(pgClient)`. Deleted from it: `reviewCard`,
`reviewCardBatch`, legacy `enrichCards`, legacy `getInterleavedDueCards` /
`getAutoInterleavedCards`, `resetDeckProgress`, `resetCardProgress`,
`toProgressSnapshot`, `upsertDailyLog`, all `studyProgress` / `reviewLogs` /
`fsrsUserParams` imports. Streak, activity, stats, dashboard snapshot stay
(they read `study_daily_logs`).

Errors: only existing `AppError` subclasses; no new codes.

## 7. Consumer migration map

Every row is one SQL statement built from §5.4 fragments, bound through
`pg-codecs`, taking `asOf` from the route. Response contracts unchanged unless
stated.

| Consumer | Change |
|---|---|
| `notifications.getDueDecks` | one `GROUP BY d.id` with `COUNT(*) FILTER (WHERE <due>)`, `HAVING > 0` |
| `experience/command-center` | counts query and top-10-decks query re-pointed to state; `learningCount` = `<learning>` |
| `experience/deck-workspace` | the two queries merge into one returning `dueCount, newCount, avgRetention, atRiskCount, total` |
| `experience/insights-overview` | weak cards ordered by `<retrievability>` ascending; `reviewedThisWeek` from `fsrs_review_events` where `origin = 'live'` |
| `experience/library-explorer` | join swapped to state; grouping unchanged |
| `experience/study-queue` | reason from fragments; `at-risk` uses the revision's `request_retention`; order `due → new → learning → at-risk` preserved |
| `experience/retention-sql.ts` | **deleted**; callers use the retrievability fragment |
| `study/retention-estimator.ts` | **deleted** |
| `study/retention-overview.service` | `algorithm` removed from response; buckets `new/due/at_risk/on_track` computed in one grouped query |
| `study/retention-details.service` | rating histogram, elapsed/scheduled from `fsrs_review_events` (`rating`, `elapsed_days`, `before_scheduled_days`); due-by-date from state; tz logic unchanged |
| `study/forecast.service` | each of the three functions is one query: `GROUP BY` local date (tz offset applied in SQL) + `AVG(<retrievability>)`; SM-2 fields removed |
| `study/recommendations.service` | weakness = `1 - <retrievability>`; New cards scored separately; SM-2 fields removed |
| `knowledge-graph/kg.service` | same as recommendations |
| `knowledge-graph/kg-neighborhood.repository` | join swapped to state; exposes `state`, `nextReviewAt` |
| `study/review-logs-cleanup.ts` + its interval in `index.ts` | **deleted** (events are immutable, never pruned) |

Shared types (`experience.types.ts`): `algorithm` removed from the memory
health overview; `retentionEstimate` is always FSRS retrievability in `[0, 1]`
or `null` for New cards. The web typecheck will pinpoint every consumer.

## 8. Legacy removal and migration

Order is mandatory; each step is a green commit.

1. **Phase 1** — write path + due reads on canonical. Run
   `bun run fsrs:replay --all-users` dry-run on the dev DB, inspect the
   manifest (users, reviews, progress rows, anomalies), then `--apply` with both
   checksums. Expected: 50 `fsrs_card_states`, 195 `fsrs_review_events` with
   `origin = 'migration'`, "Family" reports 88 due instead of 98. Numbers are
   shown to the owner before any drop.
2. **Phase 2** — consumers migrated. Legacy tables still exist but
   `grep -rn "study_progress\|review_logs\|fsrs_user_params\|srs_algorithm" apps/api/src`
   returns only schema files and replay code.
3. **Phase 3** — migration `0028_fsrs_only_finalize.sql`, hand-written,
   idempotent, journal `when` greater than 0027:
   - add `decay`, `factor`; backfill; `SET NOT NULL`; CHECK;
   - `CREATE OR REPLACE FUNCTION fsrs_retrievability`;
   - swap the two indexes (§5.3);
   - `DROP TABLE IF EXISTS study_progress, review_logs, fsrs_user_params, fsrs_migration_runs`;
   - `ALTER TABLE users DROP COLUMN IF EXISTS srs_algorithm`.
   `fsrs-only.migration.test.ts` extended: tables gone, function exists and is
   `IMMUTABLE`, new columns `NOT NULL`, new indexes present.
4. **Same commit as 3** — delete: `srs.engine.ts`; legacy half of
   `fsrs.engine.ts` (`calculateFsrsReview`, `dispatchReview` glue; keep
   `scheduleFsrsReview`, `normalizeFsrsParameters`, provenance constants);
   `retention-estimator.ts`; `retention-sql.ts`; `review-logs-cleanup.ts`;
   `fsrs-replay-planner.ts`, `fsrs-replay.postgres.ts`, `fsrs-replay.service.ts`,
   `scripts/fsrs-replay.ts`, `scripts/fsrs-replay-cli.ts`, the `fsrs:replay`
   package script; schema files `study-progress.ts`, `review-logs.ts`,
   `fsrs-user-params.ts`, `fsrs-migration-runs.ts` and their exports in
   `schema/index.ts`; the matching tests; legacy parts of
   `__tests__/helpers/fixtures.ts`.

drizzle-kit is never run (AGENTS.md rule 8); the hand-written migration is
the only path. Before the drop, `pg_dump --data-only` of the three legacy
tables is written to the session scratchpad as an uncommitted safety net.

## 9. Frontend

- `pages/study-review-state.ts` exports a pure `buildReviewItem(cardId, rating,
  shownAt, now)` → `{ requestId: crypto.randomUUID(), cardId, rating,
  reviewedAt: now.toISOString(), durationMs }`; unit-tested. Used by
  `study-mode.tsx` and `interleaved-study.tsx`.
- Batch flush threshold stays 8. The `onCleanup` flush uses `fetch` with
  `keepalive: true`. Review mutation `retry: 2` (safe because of `requestId`);
  a 409 is surfaced as a toast and not retried.
- After a successful batch: `queryClient.setQueryData` decrements the deck's
  due count in `['deck', id]`, `['notifications']`, `['dashboard']`; only
  `memoryHealthKeys.deck(id)` is invalidated.
- `studyData` query sets `refetchOnWindowFocus: false`.
- Intent prefetch: the Study entry points (`deck-header.tsx`, dashboard due
  list) call `queryClient.prefetchQuery` for `['studyData', deckId, 'due', '']`
  on `pointerenter` / `focus`.
- Deleted: the Settings "Spaced repetition" card and its two queries; every
  SM-2 branch and string in `memory-health.tsx` / `memory-health-state.ts`;
  the SM-2 comment in `study-mode.tsx`. `progress` in `study-mode.tsx` is
  typed as the API's `FsrsProgress`.
- No new UI.

## 10. Performance doctrine

`AGENTS.md` gets a new top section **§0 Performance first** (short, mandatory,
links to `docs/agents/performance.md`). Rules, each checkable:

Backend
- One SQL statement per aggregate; never query inside a loop.
- Every new column in `WHERE` / `JOIN` / `ORDER BY` is backed by an index and
  proven by an `EXPLAIN` test under a forced plan (template:
  `fsrs-deck-reads.postgres.test.ts`); no `Seq Scan` on `fsrs_card_states`.
- `asOf` bound once per request; every list has a `LIMIT`; retention only via
  `fsrs_retrievability`; raw SQL only through `pg-codecs`.

Frontend
- Independent queries run in parallel (no waterfalls); prefetch on intent;
  optimistic `setQueryData` instead of broad `invalidateQueries`; deliberate
  `staleTime`; no reactive primitives at module scope outside `createRoot`;
  lists above 200 rows are virtualised.

Process
- A change touching a query attaches `EXPLAIN (ANALYZE, BUFFERS)` before/after
  to the PR description; round-trip counts before/after go in the commit body.

Budgets (`docs/agents/performance.md`)

| Surface | Budget |
|---|---|
| `GET /study/deck/:id` | ≤ 3 SQL statements |
| `POST /study/review-batch` | 1 transaction |
| command center | ≤ 4 SQL statements |
| memory health overview | 1 SQL statement |
| deck workspace summary | 1 SQL statement |

## 11. Testing

- Postgres suite per repository, each with a `drizzle()`-wrapped client.
- Property test: 5 000 random `(w[20] ∈ [0.1, 0.8], S ∈ [0.01, 3650], t ∈ [0, 3650] days)`
  comparing `fsrs_retrievability` to ts-fsrs `forgetting_curve`; exact equality
  after 8-decimal rounding, falling back to `1e-8` tolerance only if Postgres
  `power` differs at the boundary (documented if so).
- `EXPLAIN` tests for every new due/aggregate query.
- Migration test for `0028`.
- Web: unit tests for `buildReviewItem`; existing state-helper tests; both
  typechecks.
- Manual smoke, the owner's scenario: grade 3 cards Easy in "Family", go
  back, due count drops from 88 to 85.

## 12. Rollout

Branch `feat/fsrs-only` from `fix/pgclient-codecs`. Five commits, one per
phase (write path + replay; consumers; drop + deletions; frontend; docs +
doctrine). Every commit passes `bun run typecheck`, `cd apps/api && bun test`
(dev Postgres up), `cd apps/web && bun test`. Pause after phase 1 for the
owner to confirm replay numbers. Owner fast-forwards `master`.

## 13. Risks

| Risk | Mitigation |
|---|---|
| SQL retrievability drifts from ts-fsrs | property test (§11); ts-fsrs stays the oracle |
| Drop is irreversible | replay verified and numbers reviewed first; scratchpad `pg_dump` |
| Hidden legacy readers | `grep` gate in phase 2 plus web/api typecheck after schema deletion |
| Replay anomalies (progress without logs) | manifest shows counts; `--allow-progress-without-logs` only after review |
| `pgClient` codec traps in new SQL | everything goes through `pg-codecs`; drizzle-wrapped client in every Postgres test |
