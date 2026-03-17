# Performance Sprint + FSRS Re-implementation — Design Spec

> **Approach**: Interleaved by Module (Option B)
> **Duration**: 4 weeks
> **Scope**: 8/9 performance issues + FSRS algorithm re-implementation

---

## 1. Bối cảnh

### Performance Audit Findings (9 issues)

| #   | Issue                                            | Severity | File(s)                                  | Fix                                                 |
| --- | ------------------------------------------------ | -------- | ---------------------------------------- | --------------------------------------------------- |
| P1  | Search card không debounce                       | 🟠       | `deck-header.tsx`                        | `createDebouncedSignal` utility, 250ms              |
| P2  | VirtualList đã viết nhưng không dùng             | 🟠       | `deck-view-page.tsx`, `virtual-list.tsx` | Integrate VirtualList, replace progressive render   |
| P3  | Waterfall requests use-deck-data                 | 🟠       | `use-deck-data.ts`                       | Parallel fetch cards + deck, template after deck    |
| P4  | getWithFields sequential queries                 | 🟡       | `card-templates.service.ts`              | Promise.all                                         |
| P5  | TanStack Query configured but unused (0/9 pages) | 🟠       | All pages                                | Migrate createResource → createQuery/createMutation |
| P6  | Sidebar folders N+1                              | 🟡       | `sidebar.store.ts`, sidebar-context      | Batch endpoint + TanStack cache                     |
| P7  | No cache sharing between pages                   | 🟠       | All pages                                | Solved by P5 (TanStack migration)                   |
| P8  | Export CSV/JSON no streaming                     | 🟡       | `import-export.service.ts`               | Chunked processing (500 cards/chunk)                |
| P9  | review_logs unbounded growth                     | 🟡       | `review-logs.ts`                         | ⏸️ DEFERRED — not urgent at current scale           |

### Feature: FSRS Re-implementation

**Root cause of previous failure**: `intervalDays` is integer, FSRS returns float → truncation → learning cards got 0-day intervals.

**Fix**: Use `card.due` Date object directly from ts-fsrs v5, never convert to integer days for scheduling.

---

## 2. Architecture Decisions

### 2.1 TanStack Query Migration Pattern

Every `createResource` call converts to `createQuery`:

```typescript
// Before
const [data] = createResource(() => userId(), fetchFn);

// After
const query = createQuery(() => ({
  queryKey: ['resource-name', userId()],
  queryFn: fetchFn,
  enabled: !!userId(),
}));
```

Mutations use `createMutation` with cache invalidation:

```typescript
const mutation = createMutation(() => ({
  mutationFn: (payload) => api.endpoint.post(payload),
  onSuccess: () =>
    queryClient.invalidateQueries({ queryKey: ['affected-resource'] }),
}));
```

Pagination uses `createInfiniteQuery`:

```typescript
const cardsQuery = createInfiniteQuery(() => ({
  queryKey: ['cards', deckId],
  queryFn: ({ pageParam }) => fetchCards(deckId, pageParam),
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  initialPageParam: undefined,
}));
```

### 2.2 FSRS Algorithm Toggle

- User preference: `srs_algorithm: 'sm2' | 'fsrs'` stored in user settings
- Default: `sm2` (zero breaking changes for existing users)
- Backend dispatches to correct algorithm in `calculateNextReview()`
- Schema adds nullable FSRS columns to `study_progress` + new `fsrs_user_params` table
- Parameter optimization: requires ≥100 review_logs, uses ts-fsrs `optimizeParameters()`

### 2.3 Debounce Utility

SolidJS-idiomatic `createDebouncedSignal`:

```typescript
function createDebouncedSignal<T>(initialValue: T, delayMs: number) {
  const [value, setValue] = createSignal(initialValue);
  const [debouncedValue, setDebouncedValue] = createSignal(initialValue);
  let timer: ReturnType<typeof setTimeout>;

  createEffect(() => {
    const v = value();
    clearTimeout(timer);
    timer = setTimeout(() => setDebouncedValue(() => v), delayMs);
  });

  onCleanup(() => clearTimeout(timer));
  return [debouncedValue, setValue, value] as const;
}
```

### 2.4 VirtualList Enhancement

Current `virtual-list.tsx` uses fixed `estimatedRowHeight`. For variable-height card items:

- Use conservative estimate (120px) + CSS `contain: content`
- VirtualList replaces progressive rendering pattern entirely
- IntersectionObserver for infinite scroll triggers `fetchNextPage()` on createInfiniteQuery

### 2.5 Export Chunking

Process cards in chunks of 500 to limit memory:

```
loop: getCardChunk(deckId, 500, cursor) → format → append
```

For Elysia: return complete string (sufficient for 10K card ceiling). Streaming response deferred until needed.

---

## 3. Week-by-Week Plan

### Week 1: Quick Perf Wins + TanStack (study + dashboard)

**Day 1-2: Quick wins**

- P1: createDebouncedSignal + integrate in deck-header.tsx
- P2: VirtualList integration in deck-view-page.tsx
- P3: Parallel fetch in use-deck-data.ts
- P4: Promise.all in card-templates.service.ts getWithFields

**Day 3-5: TanStack migration (3 pages)**

- study-mode.tsx: 3 createResource → 3 createQuery + reviewMutation
- dashboard.tsx: 1 createResource → 1 createQuery
- interleaved-study.tsx: 1 createResource → 1 createQuery

### Week 2: TanStack (deck-view + others) + FSRS Backend

**Day 1-2: TanStack migration (4 pages)**

- use-deck-data.ts: createInfiniteQuery for cards, createQuery for deck/template
- deck-view-page.tsx: replace 11 refetchCards() with invalidateQueries
- folder-view.tsx: 3 createResource → 3 createQuery
- settings.tsx: 1 createResource → 1 createQuery
- docs.tsx: 2 createResource → 2 createQuery

**Day 3-5: FSRS Backend**

- Migration: add FSRS columns to study_progress, create fsrs_user_params
- Update schema/types in Drizzle
- Install ts-fsrs v5
- Implement FSRS calculator alongside SM-2
- Algorithm dispatch based on user preference
- New endpoints: PATCH /study/algorithm, POST /study/fsrs/optimize
- Unit tests for FSRS scheduling (especially learning card intervals)

### Week 3: FSRS Frontend + Remaining Migrations

**Day 1-3: FSRS Frontend**

- Settings page: algorithm toggle UI with explanation
- Study mode: display scheduled intervals on review buttons
- Algorithm indicator badge in study header
- Optimization trigger (manual button + auto on enable)

**Day 3-4: Notification store migration**

- notifications.store.ts: createSignal → createQuery with refetchInterval

**Day 4-5: Sidebar optimization (P6)**

- New backend endpoint: GET /folders/by-user (batch)
- Sidebar: TanStack query for classes + all folders
- Remove N+1 lazy loading pattern

### Week 4: Export Streaming + Polish

**Day 1-2: Export chunking (P8)**

- Refactor exportCSV/exportJSON to use chunked card fetching
- Keep existing API contract (single response)

**Day 3-5: Integration testing + polish**

- Verify all TanStack migrations (load, mutate, invalidate)
- FSRS algorithm verification with test data
- Performance regression measurements
- Remove dead createResource imports
- Update feature_roadmap_plan.md with completion status

---

## 4. Schema Changes

```sql
-- Migration: add FSRS support
ALTER TABLE study_progress ADD COLUMN stability real;
ALTER TABLE study_progress ADD COLUMN difficulty real;
ALTER TABLE study_progress ADD COLUMN fsrs_state varchar(15) DEFAULT 'new';
ALTER TABLE study_progress ADD COLUMN last_elapsed_days real DEFAULT 0;

CREATE TABLE fsrs_user_params (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  params jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- User preferences (algorithm choice)
ALTER TABLE users ADD COLUMN srs_algorithm varchar(10) NOT NULL DEFAULT 'sm2';
```

## 5. New API Endpoints

| Method | Path                   | Purpose                             |
| ------ | ---------------------- | ----------------------------------- |
| PATCH  | `/study/algorithm`     | Switch SRS algorithm preference     |
| POST   | `/study/fsrs/optimize` | Trigger FSRS parameter optimization |
| GET    | `/folders/by-user`     | Batch fetch all folders for sidebar |

## 6. Dependencies

| Package   | Version | Purpose                          |
| --------- | ------- | -------------------------------- |
| `ts-fsrs` | `^5.x`  | FSRS v5 algorithm implementation |

No other new dependencies needed. TanStack Query already installed.

## 7. Risk Mitigation

- **FSRS regression**: Algorithm toggle defaults to SM-2, FSRS is opt-in
- **TanStack migration**: Page-by-page, each independently testable
- **VirtualList accuracy**: Conservative row height estimate + CSS contain
- **Export memory**: Chunked processing limits peak memory to ~500 cards worth
