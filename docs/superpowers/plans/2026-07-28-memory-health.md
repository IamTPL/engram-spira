# Memory Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the opaque Retention map with an algorithm-correct, action-first Memory Health overview and lazy-loaded learning details.

**Architecture:** A pure retention estimator owns FSRS semantics. An overview service loads minimal owned-deck state, scores it in O(n), and returns only aggregates plus 12 attention cards. A separate bounded details service reads observed review history and upcoming workload only after the user expands the panel.

**Tech Stack:** Bun, TypeScript, ElysiaJS, TypeBox, Drizzle/PostgreSQL, `ts-fsrs`, SolidJS, TanStack Solid Query, Tailwind semantic tokens.

## Global Constraints

- Work directly in the current workspace because the user explicitly approved it.
- Do not create commits.
- Follow strict TDD: every production behavior starts with a failing test that is run and observed.
- Preserve the legacy `/study/retention-heatmap` route.
- Do not add a migration, Redis, snapshots, materialized views, or another datastore.
- FSRS uses `forgetting_curve` with normalized parameters; SM-2 never claims a recall probability.
- Automatic review clusters contain due cards only and are capped at 12.
- Every service accepts and scopes by `userId`; an unowned deck throws `NotFoundError('Deck')`.
- Solid components never destructure or alias props and use reactive control-flow primitives.
- Reuse existing Tailwind semantic tokens and UI primitives; add no frontend dependency.
- Baseline before changes: typecheck passes; API tests have 556 pass and one pre-existing experience ordering failure; web tests have 78 pass.

---

### Task 1: Algorithm-correct retention estimator

**Files:**
- Create: `apps/api/src/modules/study/retention-estimator.ts`
- Test: `apps/api/__tests__/modules/study/retention-estimator.test.ts`

**Interfaces:**
- Consumes: `generatorParameters`, `forgetting_curve`, `FSRSParameters` from `ts-fsrs`.
- Produces:

```ts
export type RetentionAlgorithm = 'sm2' | 'fsrs';
export type RetentionStatus =
  | 'new'
  | 'due'
  | 'at_risk'
  | 'on_track'
  | 'unavailable';

export interface RetentionContext {
  algorithm: RetentionAlgorithm;
  targetRetention: number | null;
  fsrsWeights: readonly number[] | null;
}

export interface RetentionProgressInput {
  lastReviewedAt: Date | null;
  nextReviewAt: Date | null;
  stability: number | null;
}

export interface RetentionAssessment {
  status: RetentionStatus;
  retention: number | null;
}

export function createRetentionContext(
  algorithm: RetentionAlgorithm,
  rawFsrsParams: unknown,
): RetentionContext;

export function assessRetention(
  context: RetentionContext,
  progress: RetentionProgressInput | null,
  asOf: Date,
): RetentionAssessment;
```

- [ ] **Step 1: Write failing estimator tests**

Add tests proving:

```ts
const asOf = new Date('2026-07-28T00:00:00.000Z');

expect(
  assessRetention(fsrsContext, {
    lastReviewedAt: new Date('2026-07-18T00:00:00.000Z'),
    nextReviewAt: new Date('2026-08-01T00:00:00.000Z'),
    stability: 10,
  }, asOf).retention,
).toBeCloseTo(0.9, 10);
```

Also cover elapsed zero, future `lastReviewedAt`, 17/19/21 weight arrays,
invalid stability, due precedence, new cards, at-risk threshold, and SM-2
ignoring populated stability.

- [ ] **Step 2: Run the estimator test and observe RED**

Run:

```bash
cd apps/api && bun test __tests__/modules/study/retention-estimator.test.ts
```

Expected: FAIL because `retention-estimator.ts` does not exist.

- [ ] **Step 3: Implement the minimum estimator**

Normalize an object-like params value with `generatorParameters`, retain only
`w` and `request_retention`, clamp elapsed days to zero, call
`forgetting_curve`, and return the disjoint status priority from the design.
For SM-2, return `retention: null` and classify only `new`, `due`, or
`on_track`.

- [ ] **Step 4: Run the estimator test and observe GREEN**

Run the same command. Expected: all estimator tests pass.

### Task 2: Memory Health overview service

**Files:**
- Create: `apps/api/src/modules/study/retention-overview.service.ts`
- Test: `apps/api/__tests__/modules/study/retention-overview.service.test.ts`

**Interfaces:**
- Consumes: `createRetentionContext`, `assessRetention`, `getCardLabels`,
  `MAX_STUDY_CLUSTER_CARDS`, Drizzle `db`.
- Produces:

```ts
export interface RetentionOverviewLoaders {
  loadContext(userId: string, deckId: string): Promise<{
    algorithm: 'sm2' | 'fsrs';
    fsrsParams: unknown;
  } | null>;
  loadCards(userId: string, deckId: string): Promise<RetentionOverviewCardRow[]>;
  loadLabels(cardIds: string[]): Promise<Map<string, string>>;
}

export function getRetentionOverview(
  userId: string,
  deckId: string,
  loaders?: RetentionOverviewLoaders,
  asOf?: Date,
): Promise<RetentionOverviewResponse>;
```

- [ ] **Step 1: Write failing overview tests**

Use injected loaders to assert:

- context and cards start before either promise resolves;
- new cards are included;
- all summary buckets are disjoint;
- FSRS average excludes unavailable/new values;
- SM-2 average and target are null;
- due cards sort before at-risk cards;
- attention and review IDs cap at 12;
- at-risk IDs never appear in `reviewCardIds`;
- labels load only for selected attention IDs;
- missing context throws `NotFoundError('Deck')`;
- equal values use `sortOrder` then `cardId`.

- [ ] **Step 2: Run the overview test and observe RED**

```bash
cd apps/api && bun test __tests__/modules/study/retention-overview.service.test.ts
```

Expected: FAIL because the overview service does not exist.

- [ ] **Step 3: Implement overview aggregation and default loaders**

Run context and card loaders with `Promise.all`. Scope both SQL reads through
`decks.user_id`. Project only card ID, sort order, last/next review, and
stability. Perform one in-memory scoring pass, select attention, then bulk
load labels for those IDs only. Fallback labels use `Card ${sortOrder + 1}`.

- [ ] **Step 4: Run the overview test and observe GREEN**

Run the same command. Expected: all overview tests pass.

### Task 3: Bounded retention details service

**Files:**
- Create: `apps/api/src/modules/study/retention-details.service.ts`
- Test: `apps/api/__tests__/modules/study/retention-details.service.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RetentionDetailsLoaders {
  loadOwnedDeck(userId: string, deckId: string): Promise<boolean>;
  loadOutcomes(
    userId: string,
    deckId: string,
    from: Date,
    asOf: Date,
    tzOffset: number,
  ): Promise<RetentionOutcomeRow[]>;
  loadWorkload(
    userId: string,
    deckId: string,
    asOf: Date,
    tzOffset: number,
  ): Promise<RetentionWorkloadRow[]>;
  loadRecentReviews(
    userId: string,
    deckId: string,
  ): Promise<RetentionRecentReviewRow[]>;
}

export function getRetentionDetails(
  userId: string,
  deckId: string,
  days: number,
  tzOffset?: number,
  loaders?: RetentionDetailsLoaders,
  asOf?: Date,
): Promise<RetentionDetailsResponse>;
```

- [ ] **Step 1: Write failing details tests**

Assert range clamping to 7-90 days, four loaders starting in one parallel
wave, ownership 404, rating totals, `recalled = hard + good + easy`, null
rate for no reviews, stable daily ordering, a full 14-day workload including
zero-count days, recent timeline capped at 20, valid rating filtering, and
ISO serialization.

- [ ] **Step 2: Run the details test and observe RED**

```bash
cd apps/api && bun test __tests__/modules/study/retention-details.service.test.ts
```

Expected: FAIL because the details service does not exist.

- [ ] **Step 3: Implement default bounded SQL loaders**

Use parameterized Drizzle SQL. Every query joins `cards` and `decks` and
filters both `userId` and `deckId`. Group dates in the caller timezone using
the validated offset. Limit recent rows to 20 before label enrichment.
Generate missing workload dates in the service rather than issuing one query
per date.

- [ ] **Step 4: Run the details test and observe GREEN**

Run the same command. Expected: all details tests pass.

### Task 4: Authenticated API routes

**Files:**
- Modify: `apps/api/src/modules/study/study.routes.ts`
- Create: `apps/api/__tests__/modules/study/retention.routes.test.ts`

**Interfaces:**
- Consumes: `getRetentionOverview`, `getRetentionDetails`,
  `getTimezoneOffsetMinutes`.
- Produces:
  - `GET /study/retention-overview`
  - `GET /study/retention-details`

- [ ] **Step 1: Write failing route tests**

Build a small authenticated Elysia app with injected session auth and assert:

- unauthenticated requests return 401;
- invalid deck UUID returns 422;
- `days=6` and `days=91` return 422;
- valid overview delegates the authenticated user ID;
- valid details passes the timezone offset and default 30-day range.

- [ ] **Step 2: Run the route test and observe RED**

```bash
cd apps/api && bun test __tests__/modules/study/retention.routes.test.ts
```

Expected: FAIL because the new routes are absent.

- [ ] **Step 3: Add typed routes after `requireAuth`**

Add TypeBox query schemas without annotating handler context as `any`. Keep
the existing route chain intact so Eden Treaty inference remains specific.

- [ ] **Step 4: Run route and focused backend tests**

```bash
cd apps/api && bun test \
  __tests__/modules/study/retention-estimator.test.ts \
  __tests__/modules/study/retention-overview.service.test.ts \
  __tests__/modules/study/retention-details.service.test.ts \
  __tests__/modules/study/retention.routes.test.ts
```

Expected: all focused Memory Health tests pass.

### Task 5: Frontend state contract

**Files:**
- Create: `apps/web/src/components/deck-view/memory-health-state.ts`
- Create: `apps/web/src/components/deck-view/memory-health-state.test.ts`

**Interfaces:**
- Produces:

```ts
export const memoryHealthKeys = {
  all: ['memory-health'] as const,
  deck(deckId: string): readonly unknown[],
  overview(deckId: string, userId: string): readonly unknown[],
  details(deckId: string, userId: string, days: number): readonly unknown[],
};

export function buildMemoryHealthStudyUrl(
  deckId: string,
  reviewCardIds: string[],
): string;

export function getMemoryHealthPresentation(
  overview: MemoryHealthOverview,
): MemoryHealthPresentation;
```

- [ ] **Step 1: Write failing state tests**

Assert canonical key hierarchy, URL encoding and 12-ID cap, due-only CTA copy,
new-card fallback CTA, no-action caught-up state, FSRS versus SM-2 metric
copy, and count/distribution labels.

- [ ] **Step 2: Run the state test and observe RED**

```bash
cd apps/web && bun test src/components/deck-view/memory-health-state.test.ts
```

Expected: FAIL because the state module does not exist.

- [ ] **Step 3: Implement pure state helpers**

Keep all branchable copy and URL construction outside JSX. Do not mutate
response arrays or sets.

- [ ] **Step 4: Run the state test and observe GREEN**

Run the same command. Expected: all state tests pass.

### Task 6: Memory Health SolidJS surface and invalidation

**Files:**
- Create: `apps/web/src/components/deck-view/memory-health.tsx`
- Modify: `apps/web/src/pages/deck-view/deck-view-page.tsx`
- Modify: `apps/web/src/pages/deck-view/use-deck-data.ts`
- Modify: `apps/web/src/pages/study-mode.tsx`
- Delete: `apps/web/src/components/deck-view/retention-heatmap.tsx`

**Interfaces:**
- Consumes: new API routes, `memoryHealthKeys`, existing `Button`, `Badge`,
  `Alert`, and `Skeleton`.

- [ ] **Step 1: Add a failing static contract test where branch logic exists**

Extend `memory-health-state.test.ts` to assert the details-enabled predicate
is false while collapsed and true while expanded, and that invalidating the
deck prefix covers both overview and details key shapes.

- [ ] **Step 2: Run the test and observe RED**

Run the focused web test. Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement the Solid component**

Create overview and details queries with option accessors. Keep loaded data
during background refresh. Use `<Show>` and `<For>`, never destructure props,
and use a disclosure button with `aria-expanded` and `aria-controls`.
Render:

- summary and algorithm-aware explanation;
- semantic status counts and distribution;
- five attention rows;
- due-only review CTA;
- outcomes, 14-day workload, recent timeline, model explanation;
- loading, error/retry, empty, and refreshing states.

- [ ] **Step 4: Swap the lazy import and add canonical invalidations**

Replace `RetentionHeatmap` with `MemoryHealth` in Deck View. Invalidate
`memoryHealthKeys.deck(deckId)` after review batches, reset progress, and
`refetchCards`.

- [ ] **Step 5: Run focused web tests and typecheck**

```bash
cd apps/web && bun test src/components/deck-view/memory-health-state.test.ts
cd ../.. && bun run typecheck
```

Expected: focused tests pass and typecheck exits 0.

### Task 7: Verification and independent review

**Files:**
- Review all files changed by Tasks 1-6.

- [ ] **Step 1: Run repository verification**

```bash
bun run typecheck
cd apps/api && bun test
cd ../web && bun test
```

Expected:

- typecheck exits 0;
- no new API failures beyond the one baseline experience ordering failure;
- all web tests pass.

- [ ] **Step 2: Run performance-shape checks**

Confirm through tests and response construction that:

- label loading receives at most 12 IDs;
- recent review rows cap at 20;
- details range caps at 90;
- browser payload never contains all deck cards;
- there is no per-card database query.

- [ ] **Step 3: Request independent code review**

Have a read-only reviewer inspect the full uncommitted diff for:

- spec compliance;
- FSRS correctness;
- ownership scope;
- Solid reactivity;
- accessibility;
- query/payload bounds;
- regressions against the recorded baseline.

- [ ] **Step 4: Fix important findings through another TDD cycle**

For every confirmed behavior defect, add a failing regression test, observe
RED, implement the minimal fix, and rerun the focused and repository suites.
