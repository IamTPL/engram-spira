# SRS and study subsystem — FSRS only

`apps/api/src/modules/study/` — 17 files, ~5 675 LOC, mounted at prefix `/study` (`index.ts:203`) behind
`requireAuth` and a 180 req/60 s per-IP rate limit. 17 endpoints; see [endpoints.md](endpoints.md).

**There is exactly one scheduler.** SM-2, the per-user algorithm switch, `study_progress`, `review_logs`,
`fsrs_user_params` and the replay tooling are all gone (migration `0029`, commit `3dea1fd`; code removal
`fa50447`). Every review goes through `fsrsLiveService.reviewBatch`; every count, forecast and retention
figure is derived in SQL from `fsrs_card_states` + `fsrs_parameter_revisions`. Performance rules, per-surface
budgets and the `EXPLAIN` gate live in [performance.md](performance.md) — this file describes the model.

| File | Role |
|---|---|
| `fsrs.engine.ts` | Pure `ts-fsrs` adapter: `scheduleFsrsReview` (`:136`), `normalizeFsrsParameters` (`:56`). No `db` import |
| `fsrs-live.domain.ts` | Pure write-path domain: request normalisation, idempotency comparison, `learning_cycle`/`sequence` derivation, study-date grouping |
| `fsrs-live.service.ts` | Thin service over the repository interface — `reviewBatch`, `reviewCard`, `resetCard`, `resetDeck`, `rotateParameters` |
| `fsrs-live.postgres.ts` | The only writer of `fsrs_card_states` / `fsrs_review_events`. One serializable transaction per call |
| `fsrs-read.postgres.ts` | Canonical read loader (`loadByCardIds`) — state + its parameter revision, order-preserving |
| `fsrs-deck-reads.postgres.ts` | Study-queue reads: `getDueCards`, `getDeckSchedule`, `enrichCards`, `getInterleavedDueCards`, `getTopDueDeckIds` |
| `fsrs-sql.ts` | Shared SQL fragment vocabulary every aggregate composes (54 lines; see below) |
| `fsrs-retention.ts` | Single-card retrievability in JS, for decorating an already-loaded queue card only |
| `fsrs-revision.ts` | Deterministic revision ids, canonical parameter hashing, forgetting-curve constants |
| `fsrs-canonical.ts` | Canonical JSON, SHA-256, UUIDv5 — the hashing primitives revisions are keyed on |
| `study.service.ts` | Streaks, activity, stats, dashboard snapshot; thin delegation for deck reads; exports `fsrsLiveService` |
| `forecast.service.ts` | `getForecast`, `getRetentionHeatmap`, `getAtRiskCards` — one statement each |
| `retention-overview.service.ts` | Memory-health overview: one aggregate statement |
| `retention-details.service.ts` | Memory-health details: outcome buckets + workload from `fsrs_review_events` |
| `recommendations.service.ts` | `getRelatedCards`, `getSmartGroups` |
| `study-cluster.ts` | `MAX_STUDY_CLUSTER_CARDS = 12` + the `?cardIds=` query parser |
| `study.routes.ts` | Router, TypeBox schemas, `x-timezone-offset` parsing, injectable `StudyRouteServices` |

Keep `fsrs.engine.ts`, `fsrs-live.domain.ts`, `fsrs-retention.ts`, `fsrs-revision.ts` and `fsrs-canonical.ts`
**pure** — no `db` import, no I/O. All persistence belongs in a `*.postgres.ts` repository.

## Tables owned

Four tables, all created by migration `0026` and hardened by `0027`/`0028`. Full column and constraint lists
in [database.md](database.md#tables).

**`fsrs_parameter_revisions`** — the parameter set a review was scheduled under, versioned. `(user_id, revision)`
is unique, and a partial unique index on `user_id WHERE retired_at IS NULL` enforces **at most one active
revision per user**. `parameters` is the validated `ts-fsrs` parameter object; `params_hash` is
`sha256Canonical(parameters)` (`fsrs-canonical.ts:108`) so an identical set is never duplicated. `decay` and
`factor` (added by `0028`) are the forgetting-curve constants derived from `w[20]`
(`decay = -w20`, `factor = exp(ln 0.9 / -w20) - 1`, rounded to 8 dp) — they exist so the SQL retrievability
function needs no jsonb parsing per row, and `chk_fsrs_parameter_revisions_curve` holds `decay < 0 AND factor > 0`.

**`fsrs_card_states`** — one row per `(user_id, card_id)`, the current schedule. **A card with no row is New**;
there is no `'new'` state value (`state IN ('learning','review','relearning')` is a CHECK). `stability > 0`
and `difficulty BETWEEN 1 AND 10` are enforced by the table, so the "state lost on zero stability" class of
bug is structurally impossible here. `state_version` is the per-card monotonic counter the write path uses as
the next event `sequence`; `learning_cycle` groups a card's events between resets.

**`fsrs_review_events`** — append-only, one row per applied review, with the full `before_*`/`after_*` state
snapshot pair. `uq (user_id, request_id)` is the **idempotency key**; `uq (user_id, card_id, learning_cycle, sequence)`
makes the per-card history a total order **within a learning cycle** (a progress reset opens a new cycle
and restarts `sequence`). `origin IN ('live','migration')` — `'migration'` rows are what the
one-time replay of the legacy SM-2 history wrote before `0029` dropped the source tables.

**`study_daily_logs`** — `(user_id, study_date date, cards_reviewed)` with `uq_user_study_date`. The only
source for streaks and the activity heatmap. Always upsert with `cards_reviewed + EXCLUDED.cards_reviewed`
(`fsrs-live.postgres.ts:447-454`); never read-then-write, so concurrent batches cannot lose counts.

## The write path

`POST /study/review-batch` → `services.reviewBatch` (`study.routes.ts:129`) → `fsrsLiveService.reviewBatch`
→ `applyReviewBatch` (`fsrs-live.postgres.ts:167-198`). The service is constructed once at module scope:

```ts
// study.service.ts:16-18
export const fsrsLiveService = createFsrsLiveService(
  createPostgresFsrsLiveRepository(pgClient),
);
```

`fsrs-live.service.ts:44-56` stamps `receivedAt` from its injectable `clock`, runs
`normalizeLiveReviewCommands` and hands the normalized commands to the repository. Nothing else may write
`fsrs_card_states` or `fsrs_review_events` (AGENTS.md §3 rule 12).

**Request contract.** Body is `{ items: [{ requestId, cardId, rating, reviewedAt, durationMs? }] }`,
1–100 items (`study.routes.ts:133`, and `MAX_BATCH_SIZE = 100` in `fsrs-live.domain.ts:4`). `requestId` and
`cardId` are UUIDs, lower-cased on the way in; `rating` is `again|hard|good|easy`; `reviewedAt` is an
ISO-8601 instant; `durationMs` is an integer 0…3 600 000.

**Response.** `{ applied, duplicates, results }` with one result per item, in request order:
`{ requestId, cardId, status: 'applied' | 'duplicate', learningCycle, sequence, state, nextReviewAt, stability, difficulty, scheduledDays }`.

**Validation, and which status you get:**

| Condition | Where | Result |
|---|---|---|
| Same `requestId`, same card + rating + live origin | `assertMatchingLiveReviewRequest` (`fsrs-live.domain.ts`) | `status: 'duplicate'`, the stored event replayed, nothing written. `reviewedAt`/`durationMs` are **not** compared: the server clamps `reviewedAt`, so a byte-identical retry can differ from what was persisted |
| Same `requestId`, different card or rating | same | `ConflictError` → **409** |
| `reviewedAt` after the server's `receivedAt` (client clock ahead) | `normalizeLiveReviewCommands` | **clamped to `receivedAt`**, applied |
| `reviewedAt` more than 7 days before `receivedAt` | same (`MAX_PAST_SKEW_MS`) | `ValidationError` → **422** |
| `reviewedAt` earlier than the card's `last_reviewed_at` (client clock behind; a 1-minute learning step graded from a slow machine) | `clampReviewChronology` | **clamped up to `last_reviewed_at`** (elapsed 0), applied — the grade is never lost |
| Duplicate `requestId` **within one batch** | `:145` | `ValidationError` → **422** |
| Card not owned by the caller | `requireOwnedCardsAfterLocks` (`fsrs-live.postgres.ts:711`) | `NotFoundError('Card')` → **404** |

**Transaction shape** (`applyReviewBatchTransaction`, `fsrs-live.postgres.ts:236-463`), all inside one
`isolation level serializable` block with `retrySerializable` (5 attempts on `40001`/`40P01`, `:1358`):

1. `lockUser` → `lockCards` → `lockDecks` → `requireOwnedCardsAfterLocks` — ownership is re-checked *after*
   the locks, so a concurrent deck move cannot slip a foreign card through.
2. `lockRequestEvents` resolves the whole batch's duplicates in **one** `request_id = ANY($2::uuid[]) … FOR UPDATE`.
3. `lockStates`, `loadMaximumLearningCycles`, `lockParameterRevisions` — one statement each for the whole batch.
4. Per new command: derive the position, pick the revision (the card's own for an existing state, the active
   one for a New card — created on demand by `createOrReactivateDefaultRevision`, `:890`), call the scheduler,
   `validateScheduledProjection`, then `insertEvent` + `upsertState`.
5. One `study_daily_logs` upsert per distinct local study date (`groupReviewsByStudyDate`, offset from the
   request header).

The per-event `insertEvent`/`upsertState` pair is the one deliberate loop in the codebase: bounded at 100 and
inside a single transaction, so it costs one round trip's latency. **Reads may not do this** — see
[performance.md](performance.md) §2.2.

**Position derivation** (`deriveNextReviewPosition`, `fsrs-live.domain.ts:283`): with a state row,
`learningCycle` is carried and `sequence = state_version + 1`. With no state row, `learningCycle` is
`max(prior learning_cycle) + 1` (1 if the card has no history at all) and `sequence = 1`. That is what makes a
reset open a fresh cycle without touching the immutable event log.

**Scheduling itself** is `scheduleFsrsReview` (`fsrs.engine.ts:136`), injected as
`options.schedule` so tests can substitute it (`fsrs-live.postgres.ts:163`). It wraps `ts-fsrs@5.4.1`, which
self-identifies as generation **FSRS-6**; the three version tags (`FSRS_ALGORITHM_VERSION`,
`FSRS_LIBRARY_VERSION`, `FSRS_POLICY_VERSION`, `:19-21`) are persisted on each revision. `input.current === null`
means New; otherwise the caller passes a full `ts-fsrs` `Card` reconstructed from the persisted row
(`cardFromState`, `fsrs-live.postgres.ts:1243`), so `last_review` is the **real** persisted instant and
`ts-fsrs` computes elapsed time itself — stability grows for review-state cards, and the scheduler's
`log.elapsed_days` is cross-checked against `after.elapsed_days` (`:395`).

`normalizeFsrsParameters` (`:56`) allow-lists exactly 7 keys, range-checks `request_retention` (0, 1] and
`maximum_interval` [1, 36500] for stored-revision identity, validates step strings against `/^[1-9]\d*[mhd]$/`, migrates 17- and 19-weight
vectors to the current 21, clamps every weight to the `ts-fsrs` `CLAMP_PARAMETERS` range, and throws
`ValidationError` on any violation. Nothing reaches `generatorParameters()` unvalidated. **Interval cap:** whatever a revision's `maximum_interval` says, `scheduleFsrsReview` clamps the scheduled interval to `FSRS_MAX_INTERVAL_DAYS = 365` after ts-fsrs runs (ts-fsrs only soft-caps: it still forces `hard < good < easy`, so Easy on a mature card would land on cap + 2 days). New revisions default to `maximum_interval: 365`. Policy defaults
(`:43-44`, `:172-182`): `learning_steps ['1m','15m']`, `relearning_steps ['10m']`, `enable_fuzz` **forced
false**.

**Parameter rotation** is `fsrsLiveService.rotateParameters` → `rotateParametersTransaction` (`:494`): it
retires the active revision and creates (or reactivates) the one matching the new canonical hash. **It has no
HTTP route** — there is no optimizer feature and no per-user parameter endpoint.

## The read path

Two layers, and every consumer statement is an exported builder.

**`fsrs-sql.ts` — the fragment vocabulary.** Aliases are fixed: `c` cards, `s` fsrs_card_states,
`r` fsrs_parameter_revisions. Compose these instead of re-spelling the join; a new spelling is a new
semantics bug.

| Fragment | Line | Meaning |
|---|---|---|
| `fsrsAsOf(asOf)` | `:9` | binds the instant as ISO text with an explicit `::timestamptz` cast |
| `fsrsStateJoin(userId)` | `:13` | `LEFT JOIN fsrs_card_states s` + `LEFT JOIN fsrs_parameter_revisions r` |
| `FSRS_NEW` | `:21` | `s.id IS NULL` |
| `FSRS_LEARNING` | `:22` | `s.state IN ('learning','relearning')` |
| `FSRS_REVIEW` | `:23` | `s.state = 'review'` |
| `fsrsDue(asOf)` | `:25` | `s.id IS NULL OR s.next_review_at <= asOf` |
| `fsrsDueLater(asOf)` | `:29` | `s.id IS NOT NULL AND s.next_review_at > asOf` |
| `fsrsTargetRetention()` | `:33` | `COALESCE((r.parameters->>'request_retention')::float8, 0.9)` |
| `fsrsRetrievability(asOf)` | `:37` | `NULL` for New, else `fsrs_retrievability(s.stability, EXTRACT(EPOCH FROM (asOf - s.last_reviewed_at)), r.decay, r.factor)` |
| `fsrsAtRisk(asOf)` | `:48` | `FSRS_REVIEW AND fsrsDueLater AND R < target` |

`fsrs_retrievability(stability, elapsed_seconds, decay, factor)` is a `LANGUAGE sql IMMUTABLE PARALLEL SAFE
STRICT` function installed by migration `0028_fsrs_curve_expand.sql:30`. `IMMUTABLE PARALLEL SAFE` is what
lets the planner hoist and parallelise it. Its agreement with `ts-fsrs` is pinned by an oracle test over
5 000 seeded random triples to 8 decimals (`__tests__/modules/study/fsrs-sql.postgres.test.ts:55`).

`asOf` is always a parameter, never `now()` inside a fragment — otherwise two counters in one response can
disagree about "now" and tests become time-dependent.

**Study-queue reads** (`fsrs-deck-reads.postgres.ts`):

- `getDueCards` (`:146`) — `requireOwnedDeck`, then a `Promise.all` of the deck's total count and
  `DUE_CARD_IDS_SQL` (`:126`, `LEFT JOIN fsrs_card_states … WHERE state.id IS NULL OR state.next_review_at <= $3`,
  ordered `cards.sort_order, cards.id`), then `enrichCards`. `?mode=all` swaps the due filter for a plain
  card list; `?cardIds=` takes the selected-cluster path (≤ 12 ids, `study-cluster.ts:3`).
- `enrichCards` (`:314`) — **exactly two statements for N cards**, issued in parallel (`:327`): one
  `cards.id = ANY($1::uuid[])` field join, one canonical FSRS read. Joined in memory by a `Map`. Fields are
  sorted by `sortOrder` then `templateFieldId`.
- `getInterleavedDueCards` (`:246`) — round-robin across N decks **in SQL**:
  `unnest($2::uuid[]) WITH ORDINALITY` preserves the caller's deck order as `deck_rank`,
  `ROW_NUMBER() OVER (PARTITION BY c.deck_id ORDER BY s.next_review_at NULLS LAST, c.sort_order, c.id)` gives
  the per-deck position, and `ORDER BY rn, deck_rank, id LIMIT $4` interleaves. `total` is
  `COUNT(*) OVER ()` — the **true** pre-limit due count. `limit` is clamped to `[1, 200]` (`:252`).
- `getTopDueDeckIds` (`:290`) — decks by due count, tie-broken by `d.created_at` then `c.deck_id`, `topN`
  clamped to `[1, 50]`. Feeds `GET /study/interleaved/auto`.
- `getDeckSchedule` (`:216`) — loads every card's canonical read, then buckets in JS
  (`scheduleFromReads`): `learnedCards` counts mature cards (`state = 'review'` **and** `stability >= LEARNED_STABILITY_DAYS = 21`) — one Easy on a New card lands in review with S ≈ 8 d and is *not* learned; anything due within 1 hour goes to
  `dueSoon`; day offsets are `max(1, round(diffMs / 86_400_000))`, so 23 h 59 m reads as "Tomorrow". Both the
  zero-card and non-empty paths return `dueSoon` (`:234` / `:477`).

**Canonical loader** (`fsrs-read.postgres.ts:65`): `loadByCardIds(userId, cardIds)` reads N states plus their
revisions in one statement with `unnest($2::uuid[]) WITH ORDINALITY`, preserving caller order, and validates
each row into a `CanonicalFsrsRead`.

**Aggregate consumers.** 13 exported `*Sql()` builders — `grep -rn 'export function .*Sql(' apps/api/src` —
each executed by a service that does nothing but `db.execute` and map rows: `notifications` (`dueDecksSql`,
`totalDueSql`), `experience` (`reviewQueueSql`, `dueDecksSummarySql`, `deckStudySummarySql`, `atRiskCardsSql`,
`reviewedThisWeekSql`, `libraryClassesSql`, `queueRowsSql`), `study` (`forecastSql`, `heatmapSql`,
`atRiskCardsSql`, `retentionOverviewSql`). The export is the contract: tests execute and `EXPLAIN` it
(`__tests__/modules/study/fsrs-consumers.postgres.test.ts`). A statement inlined into a service body cannot be
gated — do not add one.

Every raw statement goes through `src/db/pg-codecs.ts` because `pgClient` is drizzle-wrapped
(AGENTS.md §3 rule 27): `bindTimestamp` in, `timestampFromRow` out.

## Status vocabulary

There are five statuses, and every widget must spell them the same way. The SQL is the definition.

| Status | SQL | Notes |
|---|---|---|
| **New** | `s.id IS NULL` (`FSRS_NEW`) | No state row at all. There is no `'new'` value in `fsrs_card_states.state` |
| **Due** | `s.id IS NULL OR s.next_review_at <= asOf` (`fsrsDue`) | **Includes New.** A counter that means "due excluding new" must say `s.id IS NOT NULL AND s.next_review_at <= asOf` explicitly |
| **Learning** | `s.state IN ('learning','relearning')` (`FSRS_LEARNING`) | Relearning is folded in deliberately |
| **Review** | `s.state = 'review'` (`FSRS_REVIEW`) | Graduated |
| **At risk** | `FSRS_REVIEW AND fsrsDueLater AND R < target` (`fsrsAtRisk`) | Not yet due, but predicted recall has already fallen below **that card's own revision's** `request_retention` |

Three asymmetries that are **intentional or pending**, not bugs to tidy up in passing:

- **At risk is near-empty by construction.** FSRS picks the due date so recall lands *at* target, so almost
  nothing decays past target before becoming due. A zero at-risk count is correct behaviour. Whether the
  widget should instead show "approaching target" is an **open product decision** — do not loosen the
  predicate to make the number bigger. See [performance.md](performance.md) §5.
- **`forecastSql.atRiskCount` is a different quantity on purpose** (`forecast.service.ts:80`): a decay
  forecast over *every* card that has a state row — learning and already-due included — evaluated at each
  horizon day. It will not match the at-risk widgets.
- **`learningCount` is "learning AND not yet due" everywhere.** Both `reviewQueueSql`
  (`command-center.service.ts:122-126`) and `deckStudySummarySql` (`deck-workspace.service.ts:193-195`)
  spell it `s.state IN ('learning','relearning') AND s.next_review_at > asOf`. A learning card that is
  already due belongs to `dueCount`, not `learningCount` — the two counters are disjoint, so a widget may
  add them. `fsrs-consumers.postgres.test.ts` pins this with a deliberately due learning card in the
  scenario; do not re-widen either spelling to "all learning".

`GET /study/queue`'s `reason` is derived from the same vocabulary in JS (`study-queue.service.ts:157-175`):
`interleaved`/`at-risk` modes force their own reason, else `new` (no due date) → `due` → `learning`
(`state` is learning/relearning) → `at-risk` (`retentionEstimate < targetRetention`) → `manual`.

## Progress reset

`POST /study/deck/:deckId/reset-progress` and `POST /study/card/:cardId/reset-progress` both return
`{ reset: n }` — the number of `fsrs_card_states` rows deleted (`study.routes.ts:140-150`).

`resetCardsTransaction` (`fsrs-live.postgres.ts:465`) and `resetDeckTransaction` (`:607`) take the same locks
as a review, call `lockResetDependencies`, and then `DELETE FROM fsrs_card_states … RETURNING card_id`.
**`fsrs_review_events` is never deleted** — the history is immutable. The deck variant additionally re-reads
the deck's card list after locking and throws `ConflictError('Deck membership changed during reset')` if it
moved, so a concurrent card insert cannot leave a half-reset deck.

Consequences to keep in mind: the card immediately reads as **New** (no state row), `study_daily_logs` and
lifetime totals are untouched (so streaks and the activity heatmap are unaffected), and the card's next review
opens a **new `learning_cycle`** — `max(learning_cycle) + 1` over the surviving events — so the old cycle's
events stay queryable and distinguishable.

## Timezone handling

The only mechanism is the **`x-timezone-offset`** header, sent on every request by the web client from
`new Date().getTimezoneOffset()` and allow-listed in CORS (`index.ts:135`).

`getTimezoneOffsetMinutes` (`study.routes.ts:26-37`) requires `/^[+-]?\d+$/`, defaults to `0`, and clamps to
**`[-840, 720]`** — the real `Date.prototype.getTimezoneOffset()` range (−840 = UTC+14, +720 = UTC−12), so
UTC+13/+14 users (Kiritimati, Samoa DST, Chatham) are no longer clipped to UTC+12. Five handlers read it:
`/streak`, `/activity`, `/dashboard-snapshot`, `/review-batch` and `/retention-details`.
`retention-details.service.ts:100` re-clamps to the same bounds at the service boundary; keep the two in
step, or the narrower one silently undoes the other.

On the write path the offset only decides which `study_daily_logs.study_date` a review lands on
(`studyDateForReviewedAt`, `fsrs-live.domain.ts:252`), and the domain layer independently validates it as an
integer in `[-840, 720]` (`:493`) — **the same bounds and the same sign convention** as the route. There
never was a reversed convention: both sides take the JS `getTimezoneOffset()` sign and subtract it; the only
defect was the route's clamp range, fixed in the final review wave.

Streak/activity code calls `Date.prototype.setDate` on an offset-shifted instant, so **correctness depends on
the API process running with `TZ=UTC`** — and nothing sets it. Never call a bare `new Date()` in a service
expecting server-local day semantics (AGENTS.md §3 rule 13).

`command-center.service.ts:159` still calls `getUserStreak(userId)` with **no offset**, so `GET /study/streak`
and the command center's streak section can disagree for the same user on the same day. Fix that rather than
copying it.

## Streaks

`getUserStreak` (`study.service.ts:109-181`) scans `study_daily_logs` back `STREAK.ACTIVITY_MAX_DAYS = 365`
days, walks backwards from today — **or from yesterday if today has no log**, so missing today does not
immediately break the streak — then does a second ascending pass requiring `diffDays === 1` exactly for
`longestStreak`. `getUserActivity` (`:187`) clamps `days` to 365 (endpoint default
`ACTIVITY_DEFAULT_DAYS = 90`); `getDashboardSnapshot` (`:234`) hardcodes **91** days and resolves streak,
activity, stats and due decks in one `Promise.all`.

## Retention analytics

All of it is SQL over `fsrs_retrievability()`. There is no shared JS retention helper any more —
`computeRetention`, `retention-estimator.ts` and `experience/retention-sql.ts` were deleted (`8983764`,
`955a4e5`, `fa50447`). The single-card JS path `calculateCanonicalFsrsRetrievability`
(`fsrs-retention.ts:68`) exists **only** to decorate a card already loaded for the study queue; never loop it
over a deck or a user's population.

- **`getForecast`** (`forecast.service.ts:113`) — `days` clamped `[1,90]` and truncated to an integer, then
  one statement: `generate_series(0, days-1)` × `LEFT JOIN LATERAL` over a `states` CTE. At-risk uses the
  per-revision `request_retention`, not a hardcoded 0.8. Missing rows render as `avgRetention: 1`.
  It labels each day as `asOf + N` in **UTC** (`new Date(asOf + offset * 86_400_000).toISOString().slice(0,10)`)
  and does **not** read `x-timezone-offset`, so a user east of UTC sees the boundary shift — a deviation from
  spec §7 and pre-existing behaviour, not something this wave changed.
- **`getRetentionHeatmap`** (`heatmapSql`, `:147`) — per-card predicted recall for one deck, recall ascending.
  Ownership is folded into the join, so an unowned deck yields `{cards: []}` rather than a 404 — unlike every
  other deck-scoped read in the module.
- **`getAtRiskCards`** (`atRiskCardsSql`, `:193`) — `threshold` is optional; `null` means "use each card's own
  revision target". `scored` carries `COUNT(*) OVER ()` for the pre-`LIMIT` total, `capped` applies the
  `LIMIT` **before** the `card_field_values` join, so returning 20 rows never costs a full field aggregation.
- **`getRetentionOverview`** (memory health, `retention-overview.service.ts:87`) — two statements:
  `retentionOverviewSql` (`:148`) plus `getCardLabels`. The `scored` CTE derives per-card status
  (`new`/`due`/`at_risk`/`on_track`) and retrievability; `attention` ranks and caps at
  `MAX_STUDY_CLUSTER_CARDS = 12` with an ordering spelled **identically** in the CTE `LIMIT` and the
  `json_agg`. Response notes: `metric.kind` is always `'predicted_recall'`, `summary.unavailable` and
  `distribution.unavailable` are the literal `0`, and there is **no `algorithm` field** any more.
- **`getRetentionDetails`** (`retention-details.service.ts:86`) — outcome buckets and recent reviews from
  `fsrs_review_events`, workload from `fsrs_card_states`, all bucketed by the caller's local day.
- **`getSmartGroups`** (`recommendations.service.ts`) — groups `card_concepts`, `LIMIT topN` (default 5),
  ≤ 5 sample cards per concept, retention from `fsrsRetrievability`. Pairs are `DISTINCT`-ed because
  `card_concepts` has no uniqueness on `(card_id, concept)`. It has **no HTTP route**; only `experience` calls
  it. Nothing ever inserts into `card_concepts`, so it returns empty on a fresh database.
- **`getRelatedCards`** — explicit `card_links` neighbours first (either direction), then tops up with
  `searchByEmbedding` at similarity 0.5, inside a bare `try/catch` that swallows **all** embedding failures.

The dead `getCardRetentions()` in `recommendations.service.ts` (zero callers) was deleted in the final
review wave. The module's only remaining retention read is inside `getStudyRecommendations`.

## Magic-number index

| Where | Values |
|---|---|
| `study-cluster.ts:3` | `MAX_STUDY_CLUSTER_CARDS` = 12 (selected-card study, and the memory-health attention cap) |
| `fsrs-live.domain.ts:4-12` | batch cap 100, past skew bound 7 days (future is clamped to `receivedAt`), duration cap 1 h, tz `[-840, 720]` |
| `fsrs.engine.ts` | `FSRS_MAX_INTERVAL_DAYS` = 365 hard interval cap |
| `fsrs-deck-reads.postgres.ts` | `LEARNED_STABILITY_DAYS` = 21 (mature threshold for `learnedCards`) |
| `fsrs-live.postgres.ts:54-55` | 5 serializable attempts, retryable codes `40001`/`40P01` |
| `fsrs.engine.ts:43-44` | `['1m','15m']` learning, `['10m']` relearning; `enable_fuzz` forced false at `:180` |
| `fsrs-deck-reads.postgres.ts:22-23,252,293` | 1 h `dueSoon` window, interleave limit `[1,200]`, `topN` `[1,50]` |
| `study.service.ts:237` | 91-day dashboard activity window |
| `constants.ts:52-54` | `ACTIVITY_MAX_DAYS` 365, `ACTIVITY_DEFAULT_DAYS` 90 |
| `study.routes.ts:26-37,63-64` | tz clamp `[-840,720]`, 180 req/60 s |
| `forecast.service.ts:118` | forecast `days` clamped `[1,90]` |
| migration `0028:38` | the retrievability curve itself, rounded to 8 dp |

## Removed surfaces — do not reintroduce, and where the history lives

| Gone | Replaced by | History |
|---|---|---|
| `POST /study/review` | `POST /study/review-batch` with one item | `5b18b51`, `fa50447` |
| `GET` / `PATCH /study/algorithm`, `users.srs_algorithm` | nothing — there is one algorithm | `3dea1fd`, `df20988` (web Settings card) |
| `srs.engine.ts` (SM-2 + `dispatchReview`), the `SM2` constant block | `fsrs.engine.ts` only | `fa50447` |
| `calculateFsrsReview` (the legacy half of `fsrs.engine.ts`) | `scheduleFsrsReview` | `fa50447` |
| `study_progress`, `review_logs`, `fsrs_user_params`, `fsrs_migration_runs` | `fsrs_card_states`, `fsrs_review_events`, `fsrs_parameter_revisions` | `3dea1fd` (migration `0029`) |
| `retention-estimator.ts`, `experience/retention-sql.ts`, `shared/embedding-utils.computeRetention` | `fsrs_retrievability()` + `fsrs-sql.ts` | `955a4e5`, `8983764`, `fa50447` |
| `review-logs-cleanup.ts` (the 730-day pruner) and its `index.ts` interval | nothing — events are kept | `fa50447` |
| `fsrs-replay*.ts`, `scripts/fsrs-replay*.ts`, the `fsrs:replay` package script | one-time migration, already run | `912cd00` … `fa50447` |

The legacy history was replayed into `fsrs_review_events` / `fsrs_card_states` on the dev database **before**
`0029` dropped the source tables; the replay tooling was deleted in the same phase once it had served its
purpose. Re-derive the full sequence rather than trusting a count:
`git log --oneline fix/pgclient-codecs..HEAD`.

The two engine defects this document used to describe — state loss on a falsy `stability`, and
`elapsed_days` always 0 because `last_review` was `new Date()` — are structurally impossible on the live path:
`scheduleFsrsReview` branches on `input.current === null` rather than a truthy `stability`, a
`fsrs_card_states` row can never carry `stability = 0` (CHECK constraint), and the card handed to `ts-fsrs`
carries the real persisted `last_review`.

## Tests

`__tests__/modules/study/` — 19 files. The five `*.postgres.test.ts` files create a disposable database from
`TEST_POSTGRES_ADMIN_URL` (default `postgresql://postgres:postgrespassword@localhost:5435/postgres`), apply
every migration, and run through a `drizzle()`-wrapped client so the production codec shape is reproduced.
They need `docker compose up -d`. See [testing.md](testing.md).

| File | Covers |
|---|---|
| `fsrs.engine.test.ts` | `scheduleFsrsReview`, `normalizeFsrsParameters` (weight migration, clamping, step validation) |
| `fsrs-live.domain.test.ts` | normalisation, idempotency comparison, position derivation, study-date grouping |
| `fsrs-live.service.test.ts` | the service over a fake repository (injected clock) |
| `fsrs-live.postgres.test.ts` | the real writer: locks, idempotency, 409/422 paths, revision creation, daily-log roll-up |
| `fsrs-read.postgres.test.ts` | the canonical loader, order preservation, row validation |
| `fsrs-deck-reads.postgres.test.ts` | queue, schedule, enrichment, interleaving; a pinned `EXPLAIN (ANALYZE, BUFFERS)` plan over 300 seeded cards (`:508`) |
| `fsrs-consumers.postgres.test.ts` | **every** exported `*Sql()` builder, executed and `EXPLAIN`-gated (`explainUsesStateIndex`, `:275`) |
| `fsrs-sql.postgres.test.ts` | the 5 000-sample SQL ↔ `ts-fsrs` retrievability oracle |
| `fsrs-retention.test.ts`, `fsrs-revision.test.ts`, `fsrs-canonical.test.ts` | the pure helpers |
| `study.service.test.ts`, `study-write.routes.test.ts`, `retention-*.test.ts`, `forecast.service.test.ts`, `recommendations.service.test.ts`, `study-cluster.test.ts` | services and routes with injected loaders |

Schema and migration invariants live in `__tests__/db/fsrs-only.schema.test.ts` and
`fsrs-only.migration.test.ts` (FK-index coverage, CHECK constraints, idempotent re-application).

Test the engine and domain helpers with exact expected values; test repositories against real Postgres; test
services through their injectable loaders. Never `mock.module` `src/db`.

## External readers of these tables

`notifications.service.ts` (due decks + badge), `kg.service.ts:276-290` (graph retention overlay),
`recommendations.service.ts` (smart groups), and five `experience` services (`study-queue`, `command-center`,
`deck-workspace`, `library-explorer`, `insights-overview`). **All of them now compose `fsrs-sql.ts`** rather
than re-spelling the join, which is what keeps their definitions of "due" and "at risk" aligned. Add a new
reader the same way; see [experience-bff.md](experience-bff.md) for the BFF layer's own conventions.
