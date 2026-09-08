# Memory Health Design

**Date:** 2026-07-28

**Status:** Approved for implementation

## Product decision

Replace the current Retention map with a balanced Memory Health surface:

- the default view is action-first;
- detailed learning analytics load only when requested;
- the study scheduler remains authoritative;
- historical claims use observed review logs, not reconstructed retention snapshots.

The feature is an explanation and planning layer. It is not a second
scheduling engine.

## User questions

Memory Health answers:

1. What needs review now?
2. How much of this deck has been reviewed?
3. What learning workload is coming next?
4. What has happened in recent reviews?

## Correctness model

### FSRS

- Normalize stored parameters with `generatorParameters`.
- Calculate retrievability with `forgetting_curve(normalized.w, elapsedDays, stability)`.
- Clamp negative elapsed time to zero.
- Return no estimate when stability is missing, non-finite, or non-positive.
- Use the normalized FSRS `request_retention` as the at-risk target.
- A valid FSRS estimate must satisfy `R(0) = 1` and `R(stability) = 0.9`.

### SM-2

SM-2 does not define a calibrated recall probability. Do not display an
average recall percentage for SM-2 users and do not use stale FSRS stability
after an algorithm switch.

SM-2 cards use scheduling status only:

- due when `nextReviewAt <= asOf`;
- on-track when the review date is in the future;
- new when there is no completed review.

### Disjoint status

Each card has exactly one status:

```text
new | due | at_risk | on_track | unavailable
```

Priority:

1. `new`: no progress or no `lastReviewedAt`;
2. `due`: reviewed and `nextReviewAt <= asOf`;
3. `unavailable`: FSRS is active but the reviewed card has no valid estimate;
4. `at_risk`: FSRS estimate is below the active target before the due date;
5. `on_track`: all remaining reviewed cards.

The invariant is:

```text
total = new + due + atRisk + onTrack + unavailable
reviewed = due + atRisk + onTrack + unavailable
```

## Public API

Both routes are registered after `.use(requireAuth)`, use TypeBox query
schemas, delegate to services, and pass `currentUser.id`.

### Overview

```http
GET /study/retention-overview?deckId=<uuid>
```

```ts
interface RetentionOverviewResponse {
  asOf: string;
  algorithm: 'fsrs' | 'sm2';
  metric: {
    kind: 'predicted_recall' | 'schedule_status';
    average: number | null;
    target: number | null;
  };
  summary: {
    total: number;
    reviewed: number;
    new: number;
    due: number;
    atRisk: number;
    onTrack: number;
    unavailable: number;
  };
  distribution: {
    new: number;
    due: number;
    atRisk: number;
    onTrack: number;
    unavailable: number;
  };
  attentionTotal: number;
  attention: Array<{
    cardId: string;
    label: string;
    status: 'due' | 'at_risk';
    retention: number | null;
    lastReviewedAt: string | null;
    nextReviewAt: string;
  }>;
  reviewCardIds: string[];
}
```

`attention` contains at most 12 cards. Due cards sort first by due date,
then deck order and card ID. At-risk cards sort after due cards by ascending
retrievability, due date, deck order, and card ID.

`reviewCardIds` contains only due cards and is capped at 12. At-risk cards
that are not due are never auto-added to a study session.

### Details

```http
GET /study/retention-details?deckId=<uuid>&days=30
```

`days` defaults to 30 and is constrained to 7-90.

```ts
interface RetentionDetailsResponse {
  asOf: string;
  rangeDays: number;
  outcomes: {
    total: number;
    recalled: number;
    recallRate: number | null;
    again: number;
    hard: number;
    good: number;
    easy: number;
  };
  dailyOutcomes: Array<{
    date: string;
    total: number;
    recalled: number;
  }>;
  workload: Array<{
    date: string;
    count: number;
  }>;
  recentReviews: Array<{
    id: string;
    cardId: string;
    label: string;
    rating: 'again' | 'hard' | 'good' | 'easy';
    reviewedAt: string;
    elapsedDays: number;
    scheduledDays: number;
  }>;
}
```

`recalled` means a rating other than `again`. It is an observed result, not a
retention prediction.

## Query architecture

### Overview

Wave one runs in parallel:

- owned deck plus user algorithm and FSRS parameters;
- minimally projected card and progress rows, scoped by user and deck.

The API scores rows in one O(n) pass, builds the summary, and selects the
top 12 attention cards. Wave two bulk-loads labels for those cards only.
The browser never receives every card row.

### Details

Details load only while the disclosure is expanded. Three bounded reads run
in parallel:

- rating and daily aggregates for the selected range;
- the 20 most recent review events with deterministic labels;
- a 14-day scheduled workload aggregate.

Every query is scoped by both `userId` and `deckId`.

### Index and infrastructure decision

Use the existing indexes:

- `cards(deck_id, sort_order)`;
- `study_progress(user_id, card_id)`;
- `study_progress(user_id, next_review_at)`;
- `review_logs(user_id, reviewed_at)`;
- `review_logs(user_id, card_id)`;
- `card_field_values(card_id)`.

Do not add a migration, Redis, a materialized view, a snapshot worker, or a
new datastore in this version.

## Frontend

Replace `RetentionHeatmap` with `MemoryHealth`.

### Default view

- plain-language title and model-aware explanation;
- reviewed, new, due, and at-risk counts;
- a non-interactive status distribution;
- up to five attention rows;
- primary CTA:
  - due cards: `Review N now` or `Review first 12`;
  - no due cards but new cards: `Start studying`;
  - otherwise no forced CTA;
- `View details` disclosure.

### Expanded view

- review result summary for the selected range;
- 14-day workload chart;
- recent review timeline;
- algorithm explanation;
- contextual loading, error, empty, and refreshing states.

The details query is disabled until the disclosure is open.

### Accessibility

- no interactive 16px retention cells;
- minimum 44px touch target for actions;
- no hover-only information;
- status is always conveyed by text as well as color;
- semantic `dl`, `ol`, headings, and `aria-expanded`;
- background refresh preserves loaded content and exposes a polite status;
- no animation required; reduced-motion behavior is naturally respected.

### Query keys and invalidation

Use one key factory:

```ts
memoryHealthKeys.all
memoryHealthKeys.deck(deckId)
memoryHealthKeys.overview(deckId, userId)
memoryHealthKeys.details(deckId, userId, days)
```

Invalidate the deck prefix after:

- successful review batches;
- reset progress;
- card create, edit, delete, or bulk delete.

Overview stale time is 60 seconds. Details stale time is 5 minutes.

## Performance acceptance

- no query count grows with deck card count;
- overview payload contains summary plus at most 12 cards;
- recent review timeline is capped at 20 rows;
- history range is capped at 90 days;
- target overview p95 is below 150ms;
- target details p95 is below 250ms;
- target payload per endpoint is below 15KB.

## Testing

### Backend

- exact FSRS values for default and legacy weight lengths;
- `R(0) = 1` and `R(stability) = 0.9`;
- invalid FSRS stability returns unavailable;
- SM-2 ignores stale stability and exposes no recall average;
- status boundaries and disjoint totals;
- deterministic attention ordering and 12-card cap;
- only due cards enter `reviewCardIds`;
- all cards, including new cards, are counted;
- unowned deck returns `NotFoundError('Deck')`;
- details aggregates, date range, timeline limit, and timezone grouping;
- routes require auth and validate UUID/day bounds.

### Frontend

- canonical query keys;
- study URL construction and due-only review list;
- model-aware headline and CTA derivation;
- distribution normalization;
- details query stays disabled until expanded;
- empty, error, and partial-data states remain actionable.

## Rollout boundary

Keep the legacy `/study/retention-heatmap` endpoint for compatibility during
this iteration. The Deck Analytics UI switches to Memory Health. Deprecating
legacy forecast and duplicated retention formulas is a separate migration
after the new surface is verified.
