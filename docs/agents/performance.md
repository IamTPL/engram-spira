# Performance

Rules, budgets and the measurement recipe for every change in this repo. `AGENTS.md` §0 states the
non-negotiables; this file is the long form. It does not repeat the rest of `AGENTS.md` — read
[../../AGENTS.md](../../AGENTS.md) §3 for the error, auth, database and SolidJS contracts, and
[srs-study.md](srs-study.md) for what FSRS itself does.

## 1. Why

Latency is the product. A spaced-repetition app is used in short, dense bursts: a grade must feel
instant, a dashboard must be readable before the user's attention moves on, and a deck with 10 000
cards has to behave like a deck with 10. That is the competitive edge over the incumbents, so
performance is a **hard requirement on every change, not a polish pass afterwards**. Concretely:
you may not merge a change without being able to say how many SQL statements and HTTP round trips it
adds or removes, and every new query must be proven — by a test, not by reasoning — to reach its
tables through an index.

## 2. Backend rules

### 2.1 One set-based statement per aggregate

An endpoint that answers a question about a *population* of cards answers it in one statement.
Roll-ups, per-row derivations and the top-N list all belong in the same query.

Reference implementations:

| Statement | Where | Shape |
|---|---|---|
| `dueDecksSql` | `apps/api/src/modules/notifications/notifications.service.ts:13` | one `GROUP BY` over `cards × decks × fsrs_card_states`, `LIMIT` bound from a constant |
| `retentionOverviewSql` | `apps/api/src/modules/study/retention-overview.service.ts:148` | the whole memory-health aggregate: `scored` CTE derives per-card status + retrievability, `attention` CTE ranks and limits, the outer `SELECT` returns counts, `AVG`, target retention and a `json_agg` list |
| `forecastSql` | `apps/api/src/modules/study/forecast.service.ts:80` | `generate_series(0, days-1)` × `LEFT JOIN LATERAL` over a `states` CTE — one statement for a 90-day horizon instead of 90 statements |
| `atRiskCardsSql` | `apps/api/src/modules/study/forecast.service.ts:193` | `scored` (with `COUNT(*) OVER ()` for the pre-`LIMIT` total) → `capped` (applies the `LIMIT`) → field aggregation, so a user with thousands of at-risk cards never pays a full `card_field_values` join to return 20 rows |
| `deckStudySummarySql` | `apps/api/src/modules/experience/deck-workspace.service.ts:184` | one pass over a deck's state feeds *both* the study and analytics sections of the deck workspace |
| `getInterleavedDueCards` | `apps/api/src/modules/study/fsrs-deck-reads.postgres.ts:246` | round-robin interleaving across N decks done in SQL: `unnest(... ) WITH ORDINALITY` for the caller's deck order, `ROW_NUMBER() OVER (PARTITION BY deck_id ...)`, `ORDER BY rn, deck_rank, id` |

The convention is an **exported builder**: `export function <name>Sql(userId, …, asOf): SQL` returns
the statement, and the service function around it does nothing but execute and map rows. The export
is what tests execute and `EXPLAIN` (§7); a statement inlined into a service body cannot be gated.
There are 13 such builders today (`grep -rn 'export function .*Sql(' apps/api/src`).

Shared fragment vocabulary: `apps/api/src/modules/study/fsrs-sql.ts` — `fsrsStateJoin` (:13, fixed
aliases `c` / `s` / `r`), `FSRS_NEW` / `FSRS_LEARNING` / `FSRS_REVIEW` (:21-23), `fsrsDue` (:25),
`fsrsDueLater` (:29), `fsrsTargetRetention` (:33), `fsrsRetrievability` (:37), `fsrsAtRisk` (:48).
Compose these instead of re-spelling the join — a new spelling is a new semantics bug (§5).

**Counter-example, still in the tree:** `getCommandCenter`
(`apps/api/src/modules/experience/command-center.service.ts:37-105`) resolves eight sections with
eight sequential `await`s. Its four FSRS statements are canonical, but the non-FSRS sections add
~5 more round trips (`loadRecent` runs 2 in parallel, `loadWeakAreas` → `getSmartGroups` 2,
`loadStreak` 1). That is the remaining budget debt on this surface, not a pattern to copy.

### 2.2 No queries inside a loop

Reads must be batched by id, never issued per row.

- `enrichCards` (`apps/api/src/modules/study/fsrs-deck-reads.postgres.ts:314`) is the batch pattern:
  exactly **two** statements for N cards, issued in parallel via `Promise.all` (:327) — one
  `WHERE cards.id = ANY($1::uuid[])` field join, one canonical FSRS read — then joined in memory by
  a `Map`.
- `loadByCardIds` (`apps/api/src/modules/study/fsrs-read.postgres.ts:69`) reads N card states in one
  statement with `unnest($2::uuid[]) WITH ORDINALITY`, which also preserves the caller's order.
- Batch idempotency is one lookup, not N: `lockRequestEvents`
  (`apps/api/src/modules/study/fsrs-live.postgres.ts:760`) resolves the whole batch's duplicates with
  `request_id = ANY($2::uuid[]) … FOR UPDATE`.

Two deliberate exceptions, both write paths:

- `applyReviewBatchTransaction` (`fsrs-live.postgres.ts:351-431`) issues `insertEvent` +
  `upsertState` per event, plus one upsert per distinct study date (`:445`). It is bounded (`MAX_BATCH_SIZE =
  100`, `fsrs-live.domain.ts:4`) and all of it runs inside **one** serializable transaction, so it
  costs one round trip's worth of latency, not N. Reads may not do this.
- Bulk updates are chunked, not per row: card reorder writes `REORDER_UPDATE_BATCH_SIZE` rows per
  statement from a `VALUES` list (`apps/api/src/modules/cards/cards.service.ts:416-440`;
  `REORDER_UPDATE_BATCH_SIZE = 1_000`, `apps/api/src/shared/reorder.ts:6`).

### 2.3 Every `WHERE` / `JOIN` / `ORDER BY` column is indexed — and proven

Migration `0028_fsrs_curve_expand.sql:45,51` installs the two access paths every canonical statement
is expected to use:

```sql
CREATE INDEX IF NOT EXISTS "idx_fsrs_card_states_user_due"
  ON "fsrs_card_states" ("user_id", "next_review_at")
  INCLUDE ("card_id", "state", "stability", "last_reviewed_at", "parameter_revision_id");
CREATE INDEX IF NOT EXISTS "idx_fsrs_card_states_card_user"
  ON "fsrs_card_states" ("card_id", "user_id");
```

A new statement is not done until an `EXPLAIN` test asserts it uses one of them (§7). A new index
goes in a hand-written migration under `AGENTS.md` §3 rule 11: idempotent statements, no
`CREATE INDEX CONCURRENTLY` (the batch runs in one transaction).

### 2.4 Bind `asOf` once; no clock inside a fragment

Every canonical read takes `asOf: Date` and binds it through `fsrsAsOf`
(`fsrs-sql.ts:9`) as ISO text with an explicit `::timestamptz` cast. Never write `now()` /
`CURRENT_TIMESTAMP` into a read fragment: it makes the result unrepeatable, makes tests
time-dependent, and lets two counters inside one response disagree about "now". (`now()` on the
write side — `updated_at = now()` in the knowledge-graph repositories — is fine.) The ISO-text
binding is not stylistic: the client is drizzle-wrapped, so a bound `Date` throws
(`AGENTS.md` §3 rule 27).

Services take `asOf = new Date()` as a defaulted trailing parameter so tests can pin it; day
boundaries still come from `getTimezoneOffsetMinutes(headers)` in the routes file
(`AGENTS.md` §3 rule 13).

### 2.5 Retention comes from `fsrs_retrievability()`

`0028_fsrs_curve_expand.sql:30` defines

```sql
CREATE OR REPLACE FUNCTION fsrs_retrievability(
  stability double precision, elapsed_seconds double precision,
  decay double precision, factor double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ … $$;
```

`IMMUTABLE PARALLEL SAFE` is what lets the planner hoist it, use it in an index-friendly expression
and parallelise the aggregate. `fsrs-sql.ts:37` is the only wrapper; every widget, forecast and
overview goes through it. Its agreement with the TypeScript engine is pinned by an oracle test:
`apps/api/__tests__/modules/study/fsrs-sql.postgres.test.ts:55` compares SQL against `ts-fsrs` on
5 000 seeded random `(w20, stability, elapsed)` triples to 8 decimals.

The single-card JS path (`calculateCanonicalFsrsRetrievability`,
`apps/api/src/modules/study/fsrs-retention.ts:68`) exists only to decorate a card already loaded for
the study queue. **Never loop it over a deck or a user's population** — that is an aggregate, and
aggregates belong in SQL.

### 2.6 Every list has a `LIMIT`; responses carry only what the UI renders

Bound from a named constant or a validated query parameter, never unbounded: `NOTIFICATIONS.MAX_DUE_DECKS`
= 50 (`apps/api/src/shared/constants.ts:60`), `AT_RISK_CARD_LIMIT` = 20
(`insights-overview.service.ts:19`), `LIMIT 10` in `dueDecksSummarySql`
(`command-center.service.ts:167`), `MAX_STUDY_CLUSTER_CARDS` = 12 for selected-card studies (`study-cluster.ts:3`), and
`Math.max(1, Math.min(200, …))` for interleaved practice (`fsrs-deck-reads.postgres.ts:252`).
Compute totals with `COUNT(*) OVER ()` inside the limited query instead of adding a second
statement, and apply the `LIMIT` **before** joining anything wide (the `capped` CTE, §2.1).

### 2.7 Raw SQL goes through `pg-codecs`

`bindTimestamp` (`apps/api/src/db/pg-codecs.ts:55`), `bindJson` (:63) with the `$n::text::jsonb`
placeholder, `timestampFromRow` (:28) on the way out. Full rationale in `AGENTS.md` §3 rule 27.

## 3. Frontend rules

- **Independent queries run in parallel.** Separate `createQuery` calls for independent data; never
  chain a request that does not depend on the previous response. Where a component must fan out
  imperatively, use `Promise.all` / `Promise.allSettled`
  (`apps/web/src/components/deck-view/knowledge-graph-review.tsx:297`).
- **Prefetch on intent.** `prefetchStudyDeck` (`apps/web/src/lib/prefetch-study.ts:5`) warms the
  exact key the study page reads first, fired from `onPointerEnter` **and** `onFocus` so keyboard
  users get it too (`apps/web/src/pages/dashboard.tsx:535-536`,
  `apps/web/src/pages/deck-view/deck-header.tsx:177-178`). Its `queryFn` must **throw** on failure
  rather than cache a null, or TanStack seeds a fake "all caught up" state.
- **Optimistic `setQueryData` over broad `invalidateQueries`.** After a review batch, subtract the
  reviewed count from the cached due list with `applyReviewedCards`
  (`apps/web/src/pages/study-review-state.ts:53`; used at `study-mode.tsx:163` and
  `interleaved-study.tsx:150`). Invalidate only the keys that really changed
  (`schedule`, `memoryHealthKeys.deck`) and **never** the in-flight `studyData` key — mid-session
  refetch swaps the card array and fires a premature "Session Complete" (`study-mode.tsx:158-160`).
- **Send each grade immediately, never block the UI on it.** `flushPendingReviews` (`study-mode.tsx`,
  `interleaved-study.tsx`) posts every grade as soon as it is made — the idempotent `requestId` makes
  a retry safe, so buffering buys nothing and risks losing grades — tracks in-flight requests and
  `await`s them (`settleReviews`) before the batch-end refetch, and flushes with
  `fetch: { keepalive: true }` on `pagehide` and on unmount so closing the tab cannot drop a review.
- **`requestId` per grade, generated once.** `buildReviewItem`
  (`apps/web/src/pages/study-review-state.ts:23`) mints it at grade time, not per attempt, so a
  retry is idempotent server-side and the client can retry freely (`retry` at `study-mode.tsx:155`).
- **Deliberate `staleTime` / `refetchOnWindowFocus`.** Defaults are 5 min stale / refetch on focus
  (`apps/web/src/lib/query-client.ts:6-9`). In-session study data pins
  `refetchOnWindowFocus: false` + `staleTime: 5_000` (`study-mode.tsx`, `interleaved-study.tsx`,
  `lib/prefetch-study.ts`) and is **removed from the cache on exit** (`queryClient.removeQueries` in
  `onCleanup`) and invalidated by every card mutation (`use-deck-data.ts` `refetchCards`,
  `duplicate-scanner.tsx`), so 'Back to deck' → 'Study' always fetches the current due list while a
  hover prefetch a few seconds earlier is still reused. Pick a number per query and say why; do not
  inherit the default by accident for data that must not move mid-session.
- **`createRoot` for module-scope reactivity** (`apps/web/src/stores/theme.store.ts:43`,
  `stores/notifications.store.ts:15`) — `AGENTS.md` §3 rule 19. Without it the primitive leaks and
  re-subscribes.
- **Virtualise lists over ~200 rows.** `apps/web/src/lib/virtual-list.tsx` renders viewport +
  overscan against a fixed row height. It currently has **zero importers**
  (`grep -rn 'virtual-list' apps/web/src`) — the first long list that ships is expected to use it
  rather than `<For>` over everything.

## 4. Budgets

A **statement** is one SQL round trip. Statements issued together in a `Promise.all` count as one
*step*: the budgets below are per sequential step, because that is what the user waits for.

| Surface | Budget | What ships today |
|---|---|---|
| `GET /study/deck/:deckId` | ≤ 3 steps | ownership (`requireOwnedDeck`, `fsrs-deck-reads.postgres.ts:482`) → `Promise.all` of the total count and `DUE_CARD_IDS_SQL` (`:126`) → `enrichCards` (2 parallel) = 5 statements in 3 steps |
| `POST /study/review-batch` | 1 serializable transaction | `fsrsLiveService.reviewBatch` → `applyReviewBatch` (`fsrs-live.postgres.ts:167-176`), ≤ 100 events, retried on serialization failure |
| `POST /study/interleaved`, `/interleaved/auto` | 2 statements (ids + enrichment) | `getInterleavedDueCards` (`:246`) + `enrichCards`; `auto` adds `getTopDueDeckIds` (`:290`) |
| `GET /dashboard/command-center` | ≤ 4 statements over canonical FSRS state | exactly 4: `reviewQueueSql`, `dueDecksSummarySql`, `forecastSql`, `dueDecksSql`. The non-FSRS sections still add ~5 (see §2.1) |
| `GET /study/retention-overview` (memory health) | 2 statements | `retentionOverviewSql` + `getCardLabels` (`retention-overview.service.ts:236-241`) |
| Deck workspace study/analytics summary | 1 statement | `deckStudySummarySql` (`deck-workspace.service.ts:184`) |
| `GET /notifications/due-decks` | 1 statement | `dueDecksSql` (`notifications.service.ts:13`) |
| `GET /study/forecast`, `/retention-heatmap`, `/at-risk-cards` | 1 statement each | `forecastSql`, `heatmapSql`, `atRiskCardsSql` |

One statement is not one unit of work: `forecastSql` is O(days × states) `fsrs_retrievability()`
evaluations per request — the `LEFT JOIN LATERAL` re-evaluates the curve for every state row on every
horizon day, so a 90-day horizon over 10 000 cards is 900 000 calls in one query. `fsrs_retrievability`
is `IMMUTABLE PARALLEL SAFE` and the arithmetic is cheap, so this is fine at current scale; if the
forecast endpoint ever shows up in the request log as slow, start here (narrow the `states` CTE, or
bucket by `last_reviewed_at`) rather than adding statements.

Exceeding a budget is a decision, not an accident: record it in the commit body with the reason.

## 5. Semantics you must not silently change

Performance work rewrites statements, and a rewritten statement is where these definitions get lost.

- **"At risk" in the widgets** = `state = 'review' AND next_review_at > asOf AND R < request_retention
  of that card's revision` (`fsrsAtRisk`, `fsrs-sql.ts:48`) — a card not yet due whose predicted
  recall has already decayed past its own target. Under FSRS this population is small **by
  construction** (the scheduler picks the due date so recall lands *at* target), so near-zero
  at-risk counts are correct behaviour, not a bug. Whether the widget should instead show
  "approaching target" is an **open product decision** — do not "fix" the number by loosening the
  predicate.
- **`forecastSql.atRiskCount` is a different quantity on purpose** (`forecast.service.ts:80`): a
  decay forecast over *every* card that has a state row — learning and already-due cards included —
  evaluated at each horizon day. It will not match the at-risk widgets, and it should not.
- **`learningCount` is uniformly "learning AND not yet due".** Both `reviewQueueSql`
  (`command-center.service.ts:122-126`) and `deckStudySummarySql`
  (`deck-workspace.service.ts:193-195`) now spell it
  `s.state IN ('learning','relearning') AND s.next_review_at > asOf`. A learning card that is
  already due is counted by `dueCount` only, so the two counters are disjoint and a widget may add
  them. `fsrs-consumers.postgres.test.ts` seeds a deliberately due learning card to pin exactly
  this; do not re-widen either spelling to "all learning" inside a performance rewrite.

## 6. Process

A change that touches a query carries its own evidence:

1. **`EXPLAIN (ANALYZE, BUFFERS)` before and after** in the PR description (or the commit body when
   there is no PR), against a realistically seeded database — not a 3-row fixture.
2. **Round-trip count before → after** stated in the commit body, e.g.
   `study/deck: 7 statements → 5 (3 steps)`.
3. **An `EXPLAIN` gate test** for every new or rewritten statement (§7), added in the same commit.
4. If a budget in §4 moves, update this file in the same commit.

## 7. How to measure

**The `EXPLAIN` gate.** `explainUsesStateIndex`
(`apps/api/__tests__/modules/study/fsrs-consumers.postgres.test.ts:275`) is the template: render the
builder to SQL + params with `PgDialect().sqlToQuery`, open a transaction, force the planner off
sequential scans, and assert the plan text.

```ts
async function explainUsesStateIndex(statement: SQL) {
  const { sql: text, params } = dialect.sqlToQuery(statement);
  await raw.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL enable_seqscan = off');
    const rows = await transaction.unsafe<Record<string, string>[]>(
      `EXPLAIN (FORMAT TEXT) ${text}`,
      params as never[],
    );
    const plan = rows.map((row) => Object.values(row)[0]).join('\n');
    expect(plan).toMatch(STATE_INDEXES);
    expect(plan).not.toContain('Seq Scan on fsrs_card_states');
  });
}
```

`STATE_INDEXES` is `/idx_fsrs_card_states_(card_user|user_due)/u` (`:56`) — either composite is
accepted because the chosen path depends on the shape of the statement. Know its limits: it is
**scale-dependent** (at a few hundred analysed rows the planner may switch to a full scan of the
narrower `idx_fsrs_card_states_parameter_revision` for the same predicate — still index access) and
`enable_seqscan = off` only *discourages* seq scans. So the gate proves "no seq-scan regression on
`fsrs_card_states`", not "this exact plan forever". For a stronger claim, seed real volume and pin
the plan the way `fsrs-deck-reads.postgres.test.ts:508` does: 300 cards with state rows,
`enable_seqscan/hashjoin/mergejoin/bitmapscan/material` all off, `EXPLAIN (ANALYZE, BUFFERS)`, then
assert both `idx_cards_deck_sort_order` and `idx_fsrs_card_states_card_user` appear.

**Running the statement builders.** `fsrs-consumers.postgres.test.ts` creates a disposable database,
applies every migration, and — critically — wraps *the same* `postgres()` client with `drizzle()`
(`:295-298`), which is the production shape (`AGENTS.md` §3 rule 27). A test that opens its own
un-wrapped client will not reproduce the codec behaviour. These suites need the dev Postgres up
(`docker compose up -d`; admin URL from `TEST_POSTGRES_ADMIN_URL`, default
`postgresql://postgres:postgrespassword@localhost:5435/postgres`).

**Counting statements.** For a given endpoint, count the `db.execute(` / `sql.unsafe(` /
`db.select(` call sites on its path (`grep -n 'db.execute(\|sql.unsafe(\|db.transaction(' <file>`)
and note which are inside a `Promise.all`. Injectable-loader modules (`experience`, retention) make
this cheap: the loader interface *is* the statement list.

**Timing a request.** `requestLoggerPlugin`
(`apps/api/src/plugins/logger.plugin.ts:51,80`) logs `method · path · status · duration (ms) · ip`
for every request in dev, `Completed 200 in 12.34ms`. Watch it while clicking through the UI; a
surface that got slower shows up there before any user reports it.
