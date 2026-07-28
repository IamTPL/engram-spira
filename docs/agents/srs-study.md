# SRS and study subsystem

`apps/api/src/modules/study/` — 7 files, ~2 070 LOC, mounted at prefix `/study` (`index.ts:193`) behind `requireAuth` and a 180 req/60 s per-IP rate limit. 18 endpoints; see [endpoints.md](endpoints.md).

| File | Role |
|---|---|
| `srs.engine.ts` | Pure SM-2 (`calculateNextReview`) + `dispatchReview()` router |
| `fsrs.engine.ts` | `ts-fsrs` adapter (`calculateFsrsReview`) |
| `study.service.ts` | All persistence: queue, reviews, daily logs, streak, schedule, interleaved, reset |
| `forecast.service.ts` | `getForecast`, `getRetentionHeatmap`, `getAtRiskCards` |
| `recommendations.service.ts` | `getRelatedCards`, `getSmartGroups` |
| `review-logs-cleanup.ts` | 730-day pruner |
| `study.routes.ts` | Router, TypeBox schemas, `x-timezone-offset` parsing |

Keep both engines **pure** — no `db` import, no I/O. They take a partial state object and return a plain result. All DB access belongs in `study.service.ts`.

## Algorithm selection

| Concern | Where |
|---|---|
| Stored preference | `users.srs_algorithm varchar(10) NOT NULL DEFAULT 'sm2'` |
| Read/write | `GET` / `PATCH /study/algorithm` |
| Dispatch | `dispatchReview()` (`srs.engine.ts:11-28`) — called **only** from `reviewCardBatch` (`study.service.ts:393`) |
| Per-user FSRS overrides | `fsrs_user_params.params` jsonb, selected at `study.service.ts:319-323`, merged at `fsrs.engine.ts:56` |

`dispatchReview` returns a discriminated union `{type:'sm2', result}` | `{type:'fsrs', result}`. Anything not exactly `'fsrs'` falls through to SM-2.

> **`POST /study/review` ignores the preference.** It calls `calculateNextReview` directly (`study.service.ts:256`) and writes no FSRS columns, so an FSRS user gets SM-2 scheduling. Only `/study/review-batch` is algorithm-aware. The web client only ever calls review-batch (`study-mode.tsx:118`), which masks the bug.

> **`fsrs_user_params` is never written** by any endpoint, service or job — the only reference is that one SELECT. There is no optimizer feature; rows can appear only via manual SQL. The jsonb is passed into `generatorParameters()` **unvalidated**, so malformed params make ts-fsrs throw — but before the review transaction opens (`dispatchReview` runs in the item loop at `study.service.ts:393`; the transaction only starts at `:470`), so the request fails with nothing written.

## SM-2 engine

Constants in `shared/constants.ts:13-26`. Defaults: `ef` 2.5, `interval` 1, `reps` (`boxLevel`) 0.

| Rating | boxLevel | easeFactor | intervalDays | nextReviewAt |
|---|---|---|---|---|
| `again` (L69-79) | → 0 | `max(1.3, ef − 0.20)`, 2 dp | → 0 | `now + 10 min` |
| `hard` (L82-98) | `max(1, reps)` — **a new card graduates** | `max(1.3, ef − 0.15)`, 2 dp | `newReps ≤ 1 ? 1 : max(interval+1, round(interval × 1.2))` | `now + interval d` |
| `good` (L101-117) | `reps + 1` | **unchanged** | `1` at rep 1, `6` at rep 2, else `round(interval × ef)` | `now + interval d` |
| `easy` (L120-138) | `reps + 1` | `ef + 0.15` — **no upper clamp**, 2 dp | `4` at rep 1, `round(6 × 1.3) = 8` at rep 2, else `round(interval × newEf × 1.3)` | `now + interval d` |

Worked example, all Good at ef 2.5: 1 d → 6 d → 15 d → 38 d.

Constant inventory: `DEFAULT_EASE_FACTOR` 2.5 · `MIN_EASE_FACTOR` 1.3 · deltas −0.2 / −0.15 / 0 / +0.15 · `EASY_INTERVAL_BONUS` 1.3 · `FIRST_INTERVAL_DAYS` 1 · `SECOND_INTERVAL_DAYS` 6 · `AGAIN_RELEARN_MINUTES` 10.

Two literals are **not** in the constants object — the `1.2` HARD growth factor (`srs.engine.ts:90`) and the `4`-day first-EASY interval (`srs.engine.ts:126`). They are pre-existing violations, not a precedent: put new tuning numbers in `SM2`. `SM2.GOOD_EF_DELTA` (0) is never read by the engine — the `good` branch just returns `easeFactor: ef` unchanged — and its only reference anywhere is an assertion in `__tests__/shared/constants.test.ts:39`. An unknown action throws a plain `Error`, not an `AppError`.

## FSRS engine

Wraps `ts-fsrs@5.4.1` (bumped from `5.2.3`; `f.repeat(card, now)[rating]` became `f.next(card, now, rating)` — same semantics, new call shape), which self-identifies as FSRS generation **FSRS-6** — despite the `FSRS v5` comments in the code and tests. Ratings map to `Rating.Again|Hard|Good|Easy` = 1|2|3|4. Three version-tag constants now live at the top of the file: `FSRS_ALGORITHM_VERSION = 'FSRS-6'`, `FSRS_LIBRARY_VERSION = 'ts-fsrs@5.4.1'`, `FSRS_POLICY_VERSION = 'engram-fsrs-v1'` — currently read only by the dormant code below, not by `calculateFsrsReview`.

### A second, unwired engine surface: `scheduleFsrsReview` / `normalizeFsrsParameters`

`fsrs.engine.ts` gained ~280 lines of a second, stricter adapter alongside the original `calculateFsrsReview` (below) — **not a replacement for it; nothing calls the new functions outside their own test file.** `grep -rl 'scheduleFsrsReview\|normalizeFsrsParameters' apps/api/src` outside `fsrs.engine.ts` itself returns nothing; `study.service.ts` was not touched by the commit that added this. It exists to eventually feed the shadow `fsrs_*` tables — see [database.md](database.md#tables).

- `normalizeFsrsParameters(value?: unknown): FSRSParameters` — allowlists exactly 7 keys, range-checks `request_retention`/`maximum_interval`, validates step-string format (`/^[1-9]\d*[mhd]$/`), and **migrates FSRS weight vectors between generations**: 17 weights (pre-4.5) → pads short-term + decay and re-derives 3 of the original weights via the documented FSRS-4.5→5 formula; 19 weights (5-without-short-term) → appends 2; 21 weights (current) → passed through. Clamps every weight to `CLAMP_PARAMETERS(W17_W18_Ceiling, ...)`'s per-index range from `ts-fsrs`. Throws `ValidationError` (not a plain `Error`) on any violation — unlike `calculateFsrsReview`, whose `params` argument is spread into `generatorParameters()` completely unvalidated.
- `scheduleFsrsReview({current, rating, reviewedAt, parameters}): {before, after, log}` — takes a full `ts-fsrs` `Card` (not the app's partial `FsrsState`), validates it (`due`/`last_review` are real Dates, `last_review <= reviewedAt`, state is one of Learning/Review/Relearning, stability/difficulty/counters are in-range) via `validateAndCloneCard`, then calls `fsrs(...).next(...)` and returns cloned before/after cards plus the library's own `ReviewLog`.

**If this ever gets wired up, it structurally avoids both defects below** — worth knowing before "fixing" the live path by copying from here. `scheduleFsrsReview` gates on `input.current === null` (not truthy `stability`), and a real `fsrs_card_states` row can never carry `stability = 0` (the table's own CHECK constraint forbids it), so defect 1 cannot occur through this path. It also threads the caller-supplied `Card.last_review` straight into `ts-fsrs`'s own elapsed-time computation instead of hardcoding `new Date()`, so stability would grow correctly for review-state cards — *provided* whatever eventually calls this reconstructs `last_review` from real persisted history rather than the current moment. Neither claim has been exercised end-to-end; there is no caller yet.

Module defaults (`fsrs.engine.ts:50-53`): `learning_steps: ['1m','15m']`, `relearning_steps: ['10m']`. Everything else is inherited from the library: `request_retention` 0.9, `maximum_interval` 36500, `enable_fuzz` false, `enable_short_term` true. (The library's own default `learning_steps` would be `['1m','10m']`.) Per-user params are shallow-merged **over** these defaults, so a user key wins.

State strings ↔ ts-fsrs `State`: `new`=0, `learning`=1, `review`=2, `relearning`=3; unknown → 0.

Card reconstruction (`L63-76`) restores `stability`, `difficulty`, `state` and — critically — `learning_steps`, without which Good can never graduate a Learning card (that is what migration `0020` fixed).

`intervalDays` on the FSRS path is `Math.ceil(scheduled_days)` and is **display-only**; always schedule from `nextReviewAt`.

### Two confirmed engine defects (in the live path, `calculateFsrsReview` — unchanged by the `ts-fsrs` 5.4.1 bump or the new dormant surface above; only the line numbers moved, from the ~280 lines inserted above this function)

1. **State loss on zero stability.** The restore is gated on `current?.stability` being *truthy* (`fsrs.engine.ts:366`), so a persisted `stability` of `0` or `NULL` silently rebuilds a brand-new card via `createEmptyCard()`, discarding difficulty, state and learning steps.
2. **Elapsed time is always zero.** `last_review` is hardcoded to `new Date()` (`fsrs.engine.ts:377`), so ts-fsrs computes `elapsed_days = 0` on every review and **stability never grows for review-state cards**. Measured with S=10, D=5, 30 days elapsed, Good: this code returns stability 10.0 / interval 11 d; a correctly-carried card returns stability 53.56 / interval 54 d. `last_elapsed_days` therefore always persists as 0, and the `current.lastElapsedDays` passed at `L371` is discarded by the library.

## Tables owned

**`study_progress`** — one row per (user, card).

| Column | Owner |
|---|---|
| `box_level` int d`0` | SM-2 (repetition count) |
| `ease_factor` float8 d`2.5` | SM-2 |
| `interval_days` int d`1` | SM-2 (FSRS writes it as display metadata) |
| `next_review_at` timestamptz NOT NULL | **shared — the scheduling source of truth** |
| `last_reviewed_at` timestamptz | shared |
| `stability` real / `difficulty` real | FSRS |
| `fsrs_state` varchar(15) d`'new'` | FSRS |
| `last_elapsed_days` real d`0` | FSRS (always 0 in practice) |
| `fsrs_learning_steps` int d`0` | FSRS |

On an FSRS review, `box_level` and `ease_factor` are **carried over unchanged** (`study.service.ts:418-419`), freezing at whatever the last SM-2 review left. The `ON CONFLICT` set includes FSRS columns only when `algorithm === 'fsrs'`.

**`review_logs`** — append-only. `state` is derived from **SM-2 columns only**, with a hardcoded 21-day cutoff (`study.service.ts:247-254, 384-391`), even for FSRS users: no progress → `new`; `box_level = 0` → `relearning`; previous `interval_days < 21` → `learning`; else `review`. The FSRS-native `fsrs_state` is never logged, so a future optimizer trained on `review_logs.state` would train on SM-2-derived labels. `scheduled_days` is the **previous** `interval_days`; `elapsed_days` is `round((now − last_reviewed_at)/86400000)` clamped ≥ 0. `review_duration_ms` exists but **no endpoint ever writes it** — treat it as always NULL.

**`study_daily_logs`** — `(user_id, study_date date, cards_reviewed)` with `uq_user_study_date`. Always go through `upsertDailyLog()`; never read-then-write. It increments with the raw SQL `study_daily_logs.cards_reviewed + ${count}` on conflict, so concurrent batches cannot lose counts.

**`fsrs_user_params`** — read-only in app code (see above).

**Not owned by anything above**: `fsrs_parameter_revisions`, `fsrs_card_states`, `fsrs_review_events`, `fsrs_migration_runs` exist (migration `0026`) but are written and read by **nothing** in `apps/api/src` outside their own schema/test files — a dormant shadow model, not a fifth table this module manages. Full definitions in [database.md](database.md#tables).

## Review path

Both `reviewCard` and `reviewCardBatch` wrap progress upsert + daily log + review log in **one** `db.transaction`. Progress is upserted with `.onConflictDoUpdate({ target: [studyProgress.userId, studyProgress.cardId] })` — the unique constraint is `uq_user_card_progress`.

`reviewCardBatch` loads `srsAlgorithm` and FSRS params in parallel with the card rows (falling back to `'sm2'` when the user row is missing), skips any `cardId` not returned by the ownership-joined query, and returns `{reviewed}` counting only accepted items.

**When you add an FSRS field**, add it to *both* `calculateFsrsReview`'s restore block *and* the `algorithm === 'fsrs'` conflict set — otherwise batch upserts silently drop it.

## Queue building

Due filter is pure SQL, never JavaScript: `LEFT JOIN study_progress ON (card_id, user_id)` then `WHERE study_progress.id IS NULL OR next_review_at <= now`, ordered by `cards.sort_order` (`study.service.ts:172-193`). `?mode=all` skips the filter.

`enrichCards()` fans out three parallel queries (cards, field values joined to template_fields, progress) and attaches `fields` (sorted by `sortOrder`) plus `progress`.

**Interleaved** (`study.service.ts:733-809`): over-fetches `limit * 2` rows ordered by `COALESCE(next_review_at, NOW() + interval '1 hour') ASC` (so new cards sort after overdue), buckets by deck, round-robins to `limit`, then re-sorts the enriched result back into interleaved order. `total` is the over-fetch count, **not** the true due total. `GET /study/interleaved/auto` first picks the top-N decks (default 5) by due count.

**`getDeckSchedule`**: `learnedCards` = `box_level > 0 OR fsrs_state = 'review'`; cards due within 1 hour go to `dueSoon` rather than a day bucket; day offsets use `max(1, round(diffMs / 86400000))`, so 23 h 59 m reads as "Tomorrow". The `totalCards === 0` early return **omits `dueSoon`** while the non-empty path includes it — the web type declares it as `number`, so it is `undefined` at runtime for empty decks.

## Timezone handling

The only mechanism is the **`x-timezone-offset`** request header, sent on every request by the web client from `new Date().getTimezoneOffset()` and allow-listed in CORS (`index.ts:135`).

`getTimezoneOffsetMinutes()` (`study.routes.ts:15-21`) parses it with `parseInt`, defaults to `0` on missing/NaN, and clamps to **`[-720, 840]`**. Since `getTimezoneOffset()` returns −840 for UTC+14, users in UTC+13/+14 (Kiritimati, Samoa DST, Chatham) are silently clipped to UTC+12.

Services take a trailing `tzOffset = 0` parameter and compute the local day as `new Date(Date.now() - tzOffset * 60000).toISOString().slice(0, 10)`.

> Because streak/activity code then calls `Date.prototype.setDate` on that shifted instant, **correctness depends on the API process running with `TZ=UTC`** — and nothing sets it. Never call a bare `new Date()` in a service expecting server-local day semantics.

Only 5 handlers consume the offset: `/streak`, `/activity`, `/dashboard-snapshot`, `/review`, `/review-batch`. **The `experience` layer ignores it entirely** — `command-center.service.ts:151` calls `getUserStreak(userId)` with no offset, so `GET /study/streak` and the command center's streak section can report different values for the same user on the same day. Fix that rather than copying it.

## Streaks

`getUserStreak` (`study.service.ts:584-656`) scans `study_daily_logs` back `STREAK.ACTIVITY_MAX_DAYS = 365` days, walks backwards from today — **or from yesterday if today has no log**, so missing today does not immediately break the streak — then does a second ascending pass requiring `diffDays === 1` exactly for `longestStreak`. `getUserActivity` clamps `days` to 365 (endpoint default `ACTIVITY_DEFAULT_DAYS` = 90); `getDashboardSnapshot` hardcodes **91** days.

## Retention analytics

Shared formula — `computeRetention()` in `shared/embedding-utils.ts:114-125`. Do not re-derive it inline:

```
S = stability > 0 ? stability : max(1, intervalDays × easeFactor / 2.5)
R = exp(-daysSinceReview / S)
```

Note it is **not** pure FSRS stability: SM-2 users with no stability get the approximation.

- **`getForecast`** — clamps `days` to `[1,90]`, loops day × card in memory over *all* the user's progress rows, skips never-reviewed cards, counts at-risk when `R < 0.8` (hardcoded), rounds `avgRetention` to 3 dp, returns `1` when nothing has been reviewed.
- **`getRetentionHeatmap`** — per-deck, sorted retention ascending. Returns `{cards: []}` instead of throwing for a deck the user does not own (unlike the rest of the module).
- **`getAtRiskCards`** — default threshold 0.8, limit 20. Considers only rows with `next_review_at > NOW()` **and** a non-null `last_reviewed_at` — i.e. "silently decaying" cards the scheduler thinks are fine. `total` is counted before slicing.
- **`getSmartGroups`** (`recommendations.service.ts:168-259`) — groups `card_concepts` with raw SQL, `LIMIT topN` (default 5), keeps ≤ 5 samples per concept, and **duplicates the retention formula inline** (fold it into `computeRetention`, do not copy it). It has **no HTTP route**; only the `experience` module calls it. Because nothing ever inserts into `card_concepts`, it returns empty on a fresh database.
- **`getRelatedCards`** — explicit `card_links` neighbours first (either direction), then tops up with `searchByEmbedding` at similarity 0.5, inside a bare `try/catch` that swallows **all** embedding failures.

`recommendations.service.ts` also contains dead code that looks live: `getCardRetentions()` (line 306) is never called, and `getCardLabels` / `cardConcepts` are imported but unused.

## Retention window for `review_logs`

`cleanupOldReviewLogs()` deletes rows older than `RETENTION_DAYS = 730` in batches of `BATCH_SIZE = 5000` using a CTE with `FOR UPDATE SKIP LOCKED`, yielding `100 ms` between batches. Runs once at startup and every 24 h on an `unref()`'d interval.

## Progress reset

`resetDeckProgress` (raw CTE `DELETE … RETURNING 1` → `{reset: n}`) and `resetCardProgress` (`{reset: true}`) delete **only** `study_progress`. `review_logs` and `study_daily_logs` survive, so streaks, lifetime totals and analytics are unaffected — and cards reappear as "new" while their history still trains analytics.

## Switching algorithms mid-history

Everything a batch writes is keyed on `algorithm` at the top of `reviewCardBatch`. A user who flips sm2 → fsrs keeps stale `box_level`/`ease_factor`; a user who flips fsrs → sm2 keeps stale `stability`/`difficulty` that `forecast.service` will still prefer, because `computeRetention` uses `stability` whenever it is > 0.

## Magic-number index

| Where | Values |
|---|---|
| `constants.ts:14-25` | the 10 SM-2 constants above |
| `srs.engine.ts:90,126` | `1.2` hard growth, `4` d first easy |
| `study.service.ts:252,389` | 21-day learning/review cutoff |
| `study.service.ts:258,398` | `2.5` hardcoded EF fallback |
| `study.service.ts:534,549` | 1 h `dueSoon` window |
| `study.service.ts:712` | 91-day dashboard activity |
| `study.service.ts:767` | interleave over-fetch `limit * 2` |
| `forecast.service.ts:89,171` | `0.8` at-risk cutoff |
| `recommendations.service.ts:117,226` | `0.5` semantic threshold, 5 samples/concept |
| `fsrs.engine.ts:51-52` | `['1m','15m']`, `['10m']` |
| `review-logs-cleanup.ts:5-7` | 730 d, 5000 rows, 100 ms |
| `study.routes.ts:20,27-28` | tz clamp `[-720,840]`, 180 req/60 s |

## Tests

`__tests__/modules/study/` now has **9 files, 100 tests, all passing** — more than this doc used to describe. The 4 files this doc covers: `srs.engine.test.ts` (26 — pins exact integer intervals), `fsrs.engine.test.ts` (22, up from 15 — the added cases exercise `scheduleFsrsReview`/`normalizeFsrsParameters` above; the original `calculateFsrsReview` cases are still **loose range assertions only, no interval is pinned**), `study.service.test.ts` (15, up from 12), `forecast.service.test.ts` (7, unchanged). No tests exist for `recommendations.service.ts`, `review-logs-cleanup.ts` or `study.routes.ts`.

The other 5 files — `retention-details.service.test.ts` (8), `retention-estimator.test.ts` (8), `retention-overview.service.test.ts` (6), `retention.routes.test.ts` (5), `study-cluster.test.ts` (3) — test a **retention/clustering subsystem this doc does not cover at all** (predates the changes described above; likely shipped with the memory-health-overview work). Do not assume the file list above is exhaustive for `modules/study/`; re-derive with `ls apps/api/__tests__/modules/study/`. Documenting that subsystem is its own task.

Test engine changes with exact expected integers (`expect(result.intervalDays).toBe(8)`); test services with the db-mock helpers. See [testing.md](testing.md).

## External readers of these tables

`notifications.service.ts` (due decks + badge), `kg.service.ts:186-196` (graph retention overlay), and five `experience` services (`study-queue`, `command-center`, `deck-workspace`, `library-explorer`, `insights-overview`) which query `study_progress`, `study_daily_logs` and `review_logs` with **raw SQL rather than reusing study-module functions** — so semantics can and do diverge. See [experience-bff.md](experience-bff.md).
