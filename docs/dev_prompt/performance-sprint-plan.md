# Performance Sprint + FSRS Re-implementation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

---

## 📊 Sprint Progress (as of 2025-01-18) — ✅ ALL TASKS COMPLETE

| Chunk                                            | Tasks       | Status                               |
| ------------------------------------------------ | ----------- | ------------------------------------ |
| Chunk 1: Quick Wins                              | Tasks 1-4   | ✅ All done                          |
| Chunk 2: TanStack Study Pages                    | Tasks 5-7   | ✅ All done                          |
| Chunk 3: Deck View + Remaining Pages             | Tasks 8-9   | ✅ All done                          |
| Chunk 4: FSRS Backend                            | Tasks 10-12 | ✅ All done (migration 0019 applied) |
| Chunk 5: Frontend FSRS + Notifications + Sidebar | Tasks 13-15 | ✅ All done                          |
| Chunk 6: Export + Polish                         | Tasks 16-17 | ✅ All done                          |

### Post-sprint fixes applied

- `column "stability" does not exist` — root cause: migration `0019_add_fsrs_support.sql` was never applied. Created + applied.
- `allFoldersFetched` logout bug — module-level flag not reset on logout; fixed with `resetFolderCache()`.
- Scroll conflict on deck view — implemented Option 2 (inner VirtualList owns scroll, `noScroll` prop on PageShell).
- TypeScript errors: `Card.learning_steps`, `IPreview` indexing, `Resource` prop types, `examples` array, `No QueryClient set`.
- Sidebar TanStack migration (Task 15.2-3) — replaced manual `fetchClasses()` + `prefetchAllFolders()` with `createQuery`, derived `foldersByClass` via `createMemo`, optimistic updates via `queryClient.setQueryData`, logout cleanup via `queryClient.removeQueries`. Store slimmed to UI-only state.
- Confirmed `folder-view.tsx` and `docs.tsx` were already migrated to TanStack Query (Task 9.1 & 9.3).

### Known latent issues (low priority)

- `reviewCard()` single-review endpoint always uses SM-2. No frontend caller uses it (all use `/review-batch`), but it is inconsistent.

---

**Goal:** Fix 8 performance issues (debounce, VirtualList, waterfall, TanStack Query migration, export chunking, sidebar batch) and re-implement FSRS algorithm with ts-fsrs v5 alongside SM-2 toggle.

**Architecture:** Two parallel tracks — (1) Performance fixes applied incrementally page-by-page, (2) FSRS backend + frontend built on top of the migrated TanStack Query layer. TanStack Query replaces all `createResource` calls with `createQuery`/`createMutation`/`createInfiniteQuery`, enabling shared caching, background refresh, and automatic invalidation.

**Tech Stack:** SolidJS + @tanstack/solid-query (frontend), ElysiaJS + Drizzle ORM + PostgreSQL (backend), ts-fsrs v5 (FSRS algorithm)

**Spec:** `docs/dev_prompt/performance-sprint-spec.md`

---

## File Structure

### New Files

| File                                                   | Responsibility                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `apps/web/src/lib/create-debounced-signal.ts`          | SolidJS-idiomatic debounce utility                               |
| `apps/api/src/modules/study/fsrs.engine.ts`            | FSRS v5 calculator using ts-fsrs                                 |
| `apps/api/src/db/schema/fsrs-user-params.ts`           | Drizzle schema for fsrs_user_params table                        |
| `apps/api/src/db/migrations/XXXX_add_fsrs_support.sql` | Migration: FSRS columns + fsrs_user_params + users.srs_algorithm |

### Modified Files

| File                                                            | Changes                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/web/src/pages/deck-view/deck-header.tsx`                  | Search input → debounced signal                                  |
| `apps/web/src/pages/deck-view/deck-view-page.tsx`               | VirtualList integration, TanStack mutations                      |
| `apps/web/src/pages/deck-view/use-deck-data.ts`                 | createResource → createQuery/createInfiniteQuery, parallel fetch |
| `apps/web/src/lib/virtual-list.tsx`                             | Add CSS contain, adjust for deck-view usage                      |
| `apps/web/src/pages/study-mode.tsx`                             | createResource → createQuery, createMutation for reviews         |
| `apps/web/src/pages/dashboard.tsx`                              | createResource → createQuery                                     |
| `apps/web/src/pages/interleaved-study.tsx`                      | createResource → createQuery                                     |
| `apps/web/src/pages/folder-view.tsx`                            | createResource → createQuery                                     |
| `apps/web/src/pages/settings.tsx`                               | createResource → createQuery, algorithm toggle UI                |
| `apps/web/src/pages/docs.tsx`                                   | createResource → createQuery                                     |
| `apps/web/src/stores/notifications.store.ts`                    | Manual polling → createQuery with refetchInterval                |
| `apps/web/src/stores/sidebar.store.ts`                          | Lazy N+1 → batch fetch                                           |
| `apps/web/src/components/layout/sidebar/sidebar-context.tsx`    | Use TanStack for classes/folders                                 |
| `apps/api/src/modules/card-templates/card-templates.service.ts` | getWithFields: sequential → Promise.all                          |
| `apps/api/src/modules/import-export/import-export.service.ts`   | Export: chunked card processing                                  |
| `apps/api/src/modules/study/srs.engine.ts`                      | Add FSRS dispatcher alongside SM-2                               |
| `apps/api/src/modules/study/study.service.ts`                   | FSRS integration in reviewCardBatch                              |
| `apps/api/src/modules/study/study.routes.ts`                    | New FSRS endpoints                                               |
| `apps/api/src/modules/folders/folders.routes.ts`                | New batch endpoint                                               |
| `apps/api/src/modules/folders/folders.service.ts`               | New listByUser function                                          |
| `apps/api/src/db/schema/study-progress.ts`                      | Add nullable FSRS columns                                        |
| `apps/api/src/db/schema/users.ts`                               | Add srs_algorithm column                                         |
| `apps/api/src/db/schema/index.ts`                               | Export fsrs-user-params                                          |

---

## Chunk 1: Quick Performance Wins (Week 1, Day 1-2)

### Task 1: Search Debounce Utility

**Files:**

- Create: `apps/web/src/lib/create-debounced-signal.ts`
- Modify: `apps/web/src/pages/deck-view/deck-header.tsx`
- Modify: `apps/web/src/pages/deck-view/deck-view-page.tsx`

- [ ] **Step 1: Create `createDebouncedSignal` utility**

Create `apps/web/src/lib/create-debounced-signal.ts`:

```typescript
import { createSignal, createEffect, onCleanup } from 'solid-js';

/**
 * Returns [debouncedValue, setValue, immediateValue].
 * - `debouncedValue` updates after `delayMs` of inactivity.
 * - `immediateValue` updates immediately (for controlled inputs).
 */
export function createDebouncedSignal<T>(initialValue: T, delayMs: number) {
  const [value, setValue] = createSignal<T>(initialValue);
  const [debounced, setDebounced] = createSignal<T>(initialValue);
  let timer: ReturnType<typeof setTimeout>;

  createEffect(() => {
    const v = value();
    clearTimeout(timer);
    timer = setTimeout(() => setDebounced(() => v), delayMs);
  });

  onCleanup(() => clearTimeout(timer));

  return [debounced, setValue, value] as const;
}
```

- [ ] **Step 2: Wire debounce into deck-view-page.tsx**

In `apps/web/src/pages/deck-view/deck-view-page.tsx`, replace the search signal:

```typescript
// BEFORE
const [searchQuery, setSearchQuery] = createSignal('');

// AFTER
import { createDebouncedSignal } from '@/lib/create-debounced-signal';
const [searchQuery, setSearchQuery, immediateSearchQuery] =
  createDebouncedSignal('', 250);
```

Pass `immediateSearchQuery` to DeckHeader for input display, `searchQuery` for filtering.

- [ ] **Step 3: Update deck-header.tsx to use immediate value for display**

In `apps/web/src/pages/deck-view/deck-header.tsx`, the search input should use the immediate value for the controlled input:

```typescript
// Props change: add immediateSearchQuery
interface DeckHeaderProps {
  // ... existing
  searchQuery: () => string;        // debounced (for filtering)
  immediateSearchQuery: () => string; // immediate (for input display)
  setSearchQuery: (v: string) => void;
}

// Input uses immediateSearchQuery for display
<Input
  value={props.immediateSearchQuery()}
  onInput={(e) => props.setSearchQuery(e.currentTarget.value)}
/>
```

- [ ] **Step 4: Test manually** — type quickly in search, verify no jank on 50+ cards

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/create-debounced-signal.ts apps/web/src/pages/deck-view/
git commit -m "perf: add search debounce (250ms) to deck-view"
```

---

### Task 2: card-templates getWithFields → Promise.all

**Files:**

- Modify: `apps/api/src/modules/card-templates/card-templates.service.ts`

- [ ] **Step 1: Refactor getWithFields to parallel**

In `apps/api/src/modules/card-templates/card-templates.service.ts`, find `getWithFields`:

```typescript
// BEFORE (sequential)
export async function getWithFields(templateId: string) {
  const template = await db.select()...;
  if (!template) throw new NotFoundError('Template');
  const fields = await db.select()...;
  return { ...template, fields };
}

// AFTER (parallel)
export async function getWithFields(templateId: string) {
  const [templateRows, fields] = await Promise.all([
    db.select().from(cardTemplates).where(eq(cardTemplates.id, templateId)).limit(1),
    db.select().from(templateFields).where(eq(templateFields.templateId, templateId)).orderBy(templateFields.sortOrder),
  ]);
  const template = templateRows[0];
  if (!template) throw new NotFoundError('Template');
  return { ...template, fields };
}
```

- [ ] **Step 2: Test** — verify card template loading still works (create/edit card flow)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/card-templates/card-templates.service.ts
git commit -m "perf: parallelize getWithFields queries"
```

---

### Task 3: Waterfall Fix in use-deck-data.ts

**Files:**

- Modify: `apps/web/src/pages/deck-view/use-deck-data.ts`

- [ ] **Step 1: Make cards fetch independent of deck**

Currently: `deck → template → cards` (sequential).
Fix: `deck` and `cards` fetch in parallel (both only need `params.deckId`), template waits for deck.

In `apps/web/src/pages/deck-view/use-deck-data.ts`:

```typescript
// Cards resource should depend only on deckId (not on deck() result)
const [cards] = createResource(
  () => params.deckId, // NOT () => deck()?.id
  async (deckId) => {
    const { data } = await api.cards['by-deck']({ deckId }).get({
      query: { limit: 50 },
    });
    return data;
  },
);

// Template depends on deck (needs cardTemplateId)
const [template] = createResource(
  () => deck()?.cardTemplateId,
  async (templateId) => {
    const { data } = await api['card-templates'][templateId].get();
    return data;
  },
);
```

This makes deck + cards parallel, template sequential after deck. Net savings: ~200ms.

- [ ] **Step 2: Test** — verify deck-view page loads correctly

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/deck-view/use-deck-data.ts
git commit -m "perf: parallelize deck + cards fetch in use-deck-data"
```

---

### Task 4: VirtualList Integration in Deck View

**Files:**

- Modify: `apps/web/src/lib/virtual-list.tsx`
- Modify: `apps/web/src/pages/deck-view/deck-view-page.tsx`

- [ ] **Step 1: Add CSS `contain` to VirtualList**

In `apps/web/src/lib/virtual-list.tsx`, add `contain: strict` to the container for layout isolation:

```typescript
// Add to the outer container style
style={{ height: '100%', overflow: 'auto', contain: 'strict' }}
```

- [ ] **Step 2: Replace progressive rendering with VirtualList in deck-view-page.tsx**

Remove the `visibleLimit`, `setVisibleLimit`, IntersectionObserver, and progressive rendering logic. Replace with:

```typescript
import { VirtualList } from '@/lib/virtual-list';

// In the card list section, replace <For each={visibleCards()}>
<VirtualList
  items={filteredCards()}
  estimatedRowHeight={120}
  overscan={5}
  containerHeight={600}
>
  {(card, index) => (
    <CardItem
      card={card}
      index={index()}
      // ... existing props
    />
  )}
</VirtualList>
```

**Important:** Keep the `fetchMore` logic from `use-deck-data.ts` — trigger it when VirtualList scrolls near the end (using the VirtualList's scroll handler or a sentinel at the bottom of the virtual list).

- [ ] **Step 3: Add infinite scroll trigger to VirtualList**

Modify VirtualList to accept an `onReachEnd` callback that fires when the user scrolls near the bottom:

```typescript
// In VirtualList props
onReachEnd?: () => void;

// In scroll handler, when endIndex >= items.length - overscan
if (props.onReachEnd && endIndex >= props.items.length - props.overscan) {
  props.onReachEnd();
}
```

Wire `onReachEnd` to `fetchMore` from `use-deck-data.ts`.

- [ ] **Step 4: Remove old progressive rendering code**

Remove from `deck-view-page.tsx`:

- `visibleLimit` / `setVisibleLimit` signals
- `visibleCards` memo
- `sentinelRef` and IntersectionObserver setup
- `BATCH_SIZE` constant

- [ ] **Step 5: Test** — load a deck with 100+ cards, verify smooth scrolling and infinite load

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/virtual-list.tsx apps/web/src/pages/deck-view/deck-view-page.tsx
git commit -m "perf: integrate VirtualList in deck-view, replace progressive rendering"
```

---

## Chunk 2: TanStack Query Migration — Study Pages (Week 1, Day 3-5)

### Task 5: Migrate study-mode.tsx to TanStack Query

**Files:**

- Modify: `apps/web/src/pages/study-mode.tsx`

- [ ] **Step 1: Replace deck createResource with createQuery**

```typescript
import { createQuery, createMutation } from '@tanstack/solid-query';
import { queryClient } from '@/lib/query-client';

// BEFORE (line 53-59)
const [deck] = createResource(() => params.deckId, async (deckId) => { ... });

// AFTER
const deckQuery = createQuery(() => ({
  queryKey: ['deck', params.deckId],
  queryFn: async () => {
    const { data } = await (api.decks as any)[params.deckId].get();
    return (data as { id: string; name: string }) ?? null;
  },
  enabled: !!params.deckId,
}));
```

- [ ] **Step 2: Replace studyData createResource with createQuery**

```typescript
// BEFORE (line 61-90)
const [studyData, { refetch }] = createResource(...);

// AFTER
const studyQuery = createQuery(() => ({
  queryKey: ['studyData', params.deckId, studyMode()],
  queryFn: async () => {
    const { data, error } = await (api.study.deck as any)[params.deckId].get({
      query: studyMode() === 'all' ? { mode: 'all' } : {},
    });
    if (error || !data) {
      setStudyError('Failed to load study cards. Please go back and try again.');
      return null;
    }
    setStudyError(null);
    return data as { cards: any[]; total: number; due: number };
  },
  enabled: !!params.deckId,
}));
```

- [ ] **Step 3: Replace schedule createResource with createQuery**

```typescript
// BEFORE (line 93-110)
const [schedule] = createResource(...);

// AFTER
const scheduleQuery = createQuery(() => ({
  queryKey: ['schedule', params.deckId],
  queryFn: async () => {
    const { data } = await (api.study.deck as any)[params.deckId].schedule.get();
    return data as { totalCards: number; learnedCards: number; upcoming: any[]; dueSoon: number; nextReviewDate: string | null } | null;
  },
  enabled: !!params.deckId && studyQuery.data?.due === 0 && studyMode() === 'due',
}));
```

- [ ] **Step 4: Create reviewBatch mutation**

```typescript
const reviewBatchMutation = createMutation(() => ({
  mutationFn: async (items: { cardId: string; action: ReviewAction }[]) => {
    const { error } = await (api.study as any)['review-batch'].post({ items });
    if (error) throw new Error(getApiError(error));
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['studyData', params.deckId] });
    queryClient.invalidateQueries({ queryKey: ['schedule', params.deckId] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  },
}));
```

- [ ] **Step 5: Update flushPendingReviews to use mutation**

Replace the manual API call with:

```typescript
const flushPendingReviews = async (force = false) => {
  const pending = pendingReviews();
  if (pending.length === 0) return;
  if (!force && pending.length < 8) return;
  await reviewBatchMutation.mutateAsync(pending);
  setPendingReviews((prev) => prev.slice(pending.length));
};
```

- [ ] **Step 6: Update all `refetch()` calls to use `queryClient.invalidateQueries`**

Replace `refetch()` in `handleRestart`, `handleContinue`, `handleResetProgress`, and the auto-refetch in `handleReview` with:

```typescript
queryClient.invalidateQueries({ queryKey: ['studyData', params.deckId] });
```

- [ ] **Step 7: Update template references**

Replace all `deck()` → `deckQuery.data`, `studyData()` → `studyQuery.data`, `schedule()` → `scheduleQuery.data`, `studyData.loading` → `studyQuery.isLoading` throughout the component.

- [ ] **Step 8: Remove `createResource` import if no longer used**

- [ ] **Step 9: Test** — complete a full study session (flip, review Again/Hard/Good/Easy, complete session, restart)

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/study-mode.tsx
git commit -m "refactor: migrate study-mode to TanStack Query"
```

---

### Task 6: Migrate dashboard.tsx to TanStack Query

**Files:**

- Modify: `apps/web/src/pages/dashboard.tsx`

- [ ] **Step 1: Replace createResource with createQuery**

```typescript
import { createQuery } from '@tanstack/solid-query';

// BEFORE (line 163-174)
const [dashboard] = createResource(() => currentUser()?.id, async () => { ... });

// AFTER
const dashboardQuery = createQuery(() => ({
  queryKey: ['dashboard', currentUser()?.id],
  queryFn: async () => {
    const { data } = await (api.study as any)['dashboard-snapshot'].get();
    return (data ?? null) as { streak: StreakData; activity: ActivityRow[]; stats: StatsData; dueDecks: DueDeck[] } | null;
  },
  enabled: !!currentUser()?.id,
}));
```

- [ ] **Step 2: Update all references**

Replace `dashboard()` → `dashboardQuery.data`, `dashboard.loading` → `dashboardQuery.isLoading` throughout.

- [ ] **Step 3: Remove `createResource` import**

- [ ] **Step 4: Test** — verify dashboard loads, shows streak/heatmap/due decks

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/dashboard.tsx
git commit -m "refactor: migrate dashboard to TanStack Query"
```

---

### Task 7: Migrate interleaved-study.tsx to TanStack Query

**Files:**

- Modify: `apps/web/src/pages/interleaved-study.tsx`

- [ ] **Step 1: Replace createResource with createQuery**

Follow the same pattern as study-mode. Replace the study data resource with a `createQuery`.

- [ ] **Step 2: Update all references and remove createResource import**

- [ ] **Step 3: Test** — start an interleaved study session

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/interleaved-study.tsx
git commit -m "refactor: migrate interleaved-study to TanStack Query"
```

---

## Chunk 3: TanStack Query Migration — Deck View + Remaining Pages (Week 2, Day 1-2)

### Task 8: Migrate use-deck-data.ts to TanStack Query (with createInfiniteQuery)

**Files:**

- Modify: `apps/web/src/pages/deck-view/use-deck-data.ts`
- Modify: `apps/web/src/pages/deck-view/deck-view-page.tsx`

This is the most complex migration because it involves:

- 3 `createResource` → `createQuery` + `createInfiniteQuery`
- Cursor-based pagination with `createInfiniteQuery`
- 11 manual `refetchCards()` replaced with `invalidateQueries`

- [ ] **Step 1: Rewrite use-deck-data.ts with TanStack Query**

```typescript
import { createQuery, createInfiniteQuery } from '@tanstack/solid-query';
import { queryClient } from '@/lib/query-client';

export function useDeckData() {
  const params = useParams<{ deckId: string }>();

  // Deck query
  const deckQuery = createQuery(() => ({
    queryKey: ['deck', params.deckId],
    queryFn: async () => {
      const { data } = await (api.decks as any)[params.deckId].get();
      return data as DeckData | null;
    },
    enabled: !!params.deckId,
  }));

  // Template query (depends on deck)
  const templateQuery = createQuery(() => ({
    queryKey: ['template', deckQuery.data?.cardTemplateId],
    queryFn: async () => {
      const { data } = await (api['card-templates'] as any)[
        deckQuery.data!.cardTemplateId
      ].get();
      return data as TemplateData | null;
    },
    enabled: !!deckQuery.data?.cardTemplateId,
  }));

  // Cards with infinite query for pagination
  const cardsQuery = createInfiniteQuery(() => ({
    queryKey: ['cards', params.deckId],
    queryFn: async ({ pageParam }) => {
      const query: Record<string, string> = { limit: '50' };
      if (pageParam) query.cursor = pageParam;
      const { data } = await api.cards['by-deck']({
        deckId: params.deckId,
      }).get({ query });
      return data as {
        cards: CardData[];
        nextCursor: string | null;
        totalCount: number;
      };
    },
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: !!params.deckId,
  }));

  // Flatten all pages into a single array
  const allCards = () =>
    cardsQuery.data?.pages.flatMap((p) => p?.cards ?? []) ?? [];
  const totalCount = () => cardsQuery.data?.pages[0]?.totalCount ?? 0;
  const hasMore = () => cardsQuery.hasNextPage;
  const fetchMore = () => {
    if (cardsQuery.hasNextPage) cardsQuery.fetchNextPage();
  };

  // Invalidation helper (replaces 11 refetchCards calls)
  const invalidateCards = () =>
    queryClient.invalidateQueries({ queryKey: ['cards', params.deckId] });

  return {
    deck: deckQuery,
    template: templateQuery,
    cards: allCards,
    totalCount,
    hasMore,
    fetchMore,
    cardsLoading: () => cardsQuery.isLoading,
    fetchingMore: () => cardsQuery.isFetchingNextPage,
    invalidateCards,
  };
}
```

- [ ] **Step 2: Update deck-view-page.tsx to use new hook API**

Replace all `localCards()` → `cards()`, `refetchCards()` → `invalidateCards()`, etc.

Remove:

- `localCards`, `setLocalCards` signals
- `totalCount`, `setTotalCount` signals
- `nextCursor`, `setNextCursor` signals
- `hasMore`, `setHasMore` signals
- `fetchingMore`, `setFetchingMore` signals
- `fetchMore` function
- Manual `batch()` updates after pagination

- [ ] **Step 3: Update all mutation handlers in deck-view-page.tsx**

Every place that calls `refetchCards()` (add card, edit card, delete card, bulk delete, reorder, AI generate save) should call `invalidateCards()` instead.

- [ ] **Step 4: Wire VirtualList `onReachEnd` to `fetchMore`**

```typescript
<VirtualList
  items={filteredCards()}
  onReachEnd={() => { if (hasMore()) fetchMore(); }}
  // ...
/>
```

- [ ] **Step 5: Test** — add card, edit card, delete card, bulk operations, search, infinite scroll, AI generate

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/deck-view/
git commit -m "refactor: migrate deck-view to TanStack Query with createInfiniteQuery"
```

---

### Task 9: Migrate folder-view.tsx, settings.tsx, docs.tsx

**Files:**

- Modify: `apps/web/src/pages/folder-view.tsx`
- Modify: `apps/web/src/pages/settings.tsx`
- Modify: `apps/web/src/pages/docs.tsx`

- [ ] **Step 1: Migrate folder-view.tsx** — 3 createResource → 3 createQuery (folder details, decks, templates)

- [ ] **Step 2: Migrate settings.tsx** — 1 createResource → 1 createQuery (avatar collection)

- [ ] **Step 3: Migrate docs.tsx** — 2 createResource → 2 createQuery (SVG diagrams, SRS markdown)

- [ ] **Step 4: Test each page**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/folder-view.tsx apps/web/src/pages/settings.tsx apps/web/src/pages/docs.tsx
git commit -m "refactor: migrate folder-view, settings, docs to TanStack Query"
```

---

## Chunk 4: FSRS Backend (Week 2, Day 3-5)

### Task 10: Schema Migration for FSRS

**Files:**

- Modify: `apps/api/src/db/schema/study-progress.ts`
- Modify: `apps/api/src/db/schema/users.ts`
- Create: `apps/api/src/db/schema/fsrs-user-params.ts`
- Modify: `apps/api/src/db/schema/index.ts`

- [ ] **Step 1: Add FSRS columns to study_progress schema**

In `apps/api/src/db/schema/study-progress.ts`, add nullable columns:

```typescript
stability: real('stability'),
difficulty: real('difficulty'),
fsrsState: varchar('fsrs_state', { length: 15 }).default('new'),
lastElapsedDays: real('last_elapsed_days').default(0),
```

All nullable so SM-2 users are unaffected.

- [ ] **Step 2: Add srs_algorithm to users schema**

In `apps/api/src/db/schema/users.ts`:

```typescript
srsAlgorithm: varchar('srs_algorithm', { length: 10 }).notNull().default('sm2'),
```

- [ ] **Step 3: Create fsrs_user_params schema**

Create `apps/api/src/db/schema/fsrs-user-params.ts`:

```typescript
import { pgTable, uuid, jsonb, timestamp, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

export const fsrsUserParams = pgTable(
  'fsrs_user_params',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    params: jsonb('params').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique('uq_fsrs_user_params_user').on(table.userId)],
);

export const fsrsUserParamsRelations = relations(fsrsUserParams, ({ one }) => ({
  user: one(users, { fields: [fsrsUserParams.userId], references: [users.id] }),
}));
```

- [ ] **Step 4: Export from schema/index.ts**

- [ ] **Step 5: Generate Drizzle migration**

```bash
cd apps/api && bunx drizzle-kit generate
```

- [ ] **Step 6: Apply migration**

```bash
cd apps/api && bunx drizzle-kit migrate
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schema/ apps/api/drizzle/
git commit -m "feat: add FSRS schema (study_progress columns + fsrs_user_params + users.srs_algorithm)"
```

---

### Task 11: FSRS Engine Implementation

**Files:**

- Create: `apps/api/src/modules/study/fsrs.engine.ts`
- Modify: `apps/api/src/modules/study/srs.engine.ts`

- [ ] **Step 1: Install ts-fsrs**

```bash
cd apps/api && bun add ts-fsrs
```

- [ ] **Step 2: Create FSRS engine wrapper**

Create `apps/api/src/modules/study/fsrs.engine.ts`:

```typescript
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
  type FSRSParameters,
} from 'ts-fsrs';
import type { ReviewAction } from '../../shared/constants';

const RATING_MAP: Record<ReviewAction, Rating> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export interface FsrsState {
  stability: number;
  difficulty: number;
  fsrsState: string;
  lastElapsedDays: number;
}

export interface FsrsResult {
  nextReviewAt: Date;
  stability: number;
  difficulty: number;
  fsrsState: string;
  lastElapsedDays: number;
  intervalDays: number;
}

export function calculateFsrsReview(
  action: ReviewAction,
  current: Partial<FsrsState> | null,
  params?: Partial<FSRSParameters>,
): FsrsResult {
  const f = fsrs(params ? generatorParameters(params) : generatorParameters());

  // Build card state from current progress or empty
  const card: Card = current?.stability
    ? {
        due: new Date(),
        stability: current.stability,
        difficulty: current.difficulty ?? 0,
        elapsed_days: current.lastElapsedDays ?? 0,
        scheduled_days: 0,
        reps: 0,
        lapses: 0,
        state: mapStateFromString(current.fsrsState ?? 'new'),
        last_review: new Date(),
      }
    : createEmptyCard();

  const now = new Date();
  const scheduling = f.repeat(card, now);
  const result = scheduling[RATING_MAP[action]];

  return {
    nextReviewAt: result.card.due, // Date — precise, no integer truncation
    stability: result.card.stability,
    difficulty: result.card.difficulty,
    fsrsState: mapStateToString(result.card.state),
    lastElapsedDays: result.card.elapsed_days,
    intervalDays: Math.ceil(result.card.scheduled_days), // for display only
  };
}

function mapStateFromString(state: string): number {
  switch (state) {
    case 'new':
      return 0;
    case 'learning':
      return 1;
    case 'review':
      return 2;
    case 'relearning':
      return 3;
    default:
      return 0;
  }
}

function mapStateToString(state: number): string {
  switch (state) {
    case 0:
      return 'new';
    case 1:
      return 'learning';
    case 2:
      return 'review';
    case 3:
      return 'relearning';
    default:
      return 'new';
  }
}
```

- [ ] **Step 3: Add algorithm dispatch to srs.engine.ts**

Modify `apps/api/src/modules/study/srs.engine.ts` — add a dispatcher:

```typescript
import {
  calculateFsrsReview,
  type FsrsState,
  type FsrsResult,
} from './fsrs.engine';

export type SrsAlgorithm = 'sm2' | 'fsrs';

export function dispatchReview(
  algorithm: SrsAlgorithm,
  action: ReviewAction,
  sm2State: Partial<SrsState>,
  fsrsState: Partial<FsrsState> | null,
  fsrsParams?: any,
) {
  if (algorithm === 'fsrs') {
    return {
      type: 'fsrs' as const,
      result: calculateFsrsReview(action, fsrsState, fsrsParams),
    };
  }
  return {
    type: 'sm2' as const,
    result: calculateNextReview(action, sm2State),
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/study/fsrs.engine.ts apps/api/src/modules/study/srs.engine.ts
git commit -m "feat: implement FSRS v5 engine with ts-fsrs + algorithm dispatcher"
```

---

### Task 12: Integrate FSRS into Study Service + Routes

**Files:**

- Modify: `apps/api/src/modules/study/study.service.ts`
- Modify: `apps/api/src/modules/study/study.routes.ts`
- Modify: `apps/api/src/modules/users/users.service.ts` (or create if needed)

- [ ] **Step 1: Update reviewCardBatch to support FSRS**

In `study.service.ts`, modify `reviewCardBatch`:

1. Fetch user's `srsAlgorithm` from users table
2. If FSRS, also fetch `fsrsUserParams`
3. Use `dispatchReview()` instead of `calculateNextReview()`
4. Upsert FSRS columns alongside SM-2 columns

```typescript
// At the start of reviewCardBatch:
const [user] = await db
  .select({ srsAlgorithm: users.srsAlgorithm })
  .from(users)
  .where(eq(users.id, userId))
  .limit(1);
const algorithm = (user?.srsAlgorithm ?? 'sm2') as SrsAlgorithm;

let fsrsParams = undefined;
if (algorithm === 'fsrs') {
  const [params] = await db
    .select({ params: fsrsUserParams.params })
    .from(fsrsUserParams)
    .where(eq(fsrsUserParams.userId, userId))
    .limit(1);
  fsrsParams = params?.params;
}
```

- [ ] **Step 2: Add PATCH /study/algorithm endpoint**

```typescript
.patch('/algorithm', async ({ body, userId }) => {
  const { algorithm } = body; // 'sm2' | 'fsrs'
  await db.update(users).set({ srsAlgorithm: algorithm }).where(eq(users.id, userId));
  return { algorithm };
}, {
  body: t.Object({ algorithm: t.Union([t.Literal('sm2'), t.Literal('fsrs')]) }),
})
```

- [ ] **Step 3: Add POST /study/fsrs/optimize endpoint**

```typescript
.post('/fsrs/optimize', async ({ userId }) => {
  // Fetch review logs for this user
  const logs = await db.select().from(reviewLogs)
    .where(eq(reviewLogs.userId, userId))
    .orderBy(reviewLogs.reviewedAt);

  if (logs.length < 100) {
    return { optimized: false, reason: 'Need at least 100 reviews for optimization' };
  }

  // Convert to ts-fsrs format and optimize
  const f = fsrs();
  // ... convert logs to FSRSHistory format
  // const params = f.optimizeParameters(history);
  // Upsert into fsrs_user_params

  return { optimized: true, reviewCount: logs.length };
})
```

- [ ] **Step 4: Test** — review cards with SM-2 (default), switch to FSRS, review again

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/study/
git commit -m "feat: integrate FSRS into study service + add algorithm endpoints"
```

---

## Chunk 5: FSRS Frontend + Notifications + Sidebar (Week 3)

### Task 13: FSRS Settings UI

**Files:**

- Modify: `apps/web/src/pages/settings.tsx`

- [ ] **Step 1: Add algorithm toggle section**

Add a new section in settings page:

```tsx
<div class="rounded-xl border bg-card p-5">
  <h3 class="text-sm font-semibold mb-3">Spaced Repetition Algorithm</h3>
  <div class="space-y-3">
    <label class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-accent">
      <input
        type="radio"
        name="algorithm"
        value="sm2"
        checked={algorithmQuery.data === 'sm2'}
        onChange={() => switchAlgorithm('sm2')}
      />
      <div>
        <p class="text-sm font-medium">SM-2 (Classic)</p>
        <p class="text-xs text-muted-foreground">
          Simple and reliable. Used by Anki for decades.
        </p>
      </div>
    </label>
    <label class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-accent">
      <input
        type="radio"
        name="algorithm"
        value="fsrs"
        checked={algorithmQuery.data === 'fsrs'}
        onChange={() => switchAlgorithm('fsrs')}
      />
      <div>
        <p class="text-sm font-medium">FSRS v5 (Modern)</p>
        <p class="text-xs text-muted-foreground">
          Adapts to your memory patterns. Requires 100+ reviews for
          personalization.
        </p>
      </div>
    </label>
  </div>
</div>
```

- [ ] **Step 2: Add algorithm query and mutation**

```typescript
const algorithmQuery = createQuery(() => ({
  queryKey: ['user', 'algorithm'],
  queryFn: async () => {
    /* fetch from user profile or dedicated endpoint */
  },
  staleTime: Infinity,
}));

const switchMutation = createMutation(() => ({
  mutationFn: async (algo: 'sm2' | 'fsrs') => {
    await api.study.algorithm.patch({ algorithm: algo });
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['user', 'algorithm'] });
    queryClient.invalidateQueries({ queryKey: ['studyData'] });
  },
}));
```

- [ ] **Step 3: Test** — toggle algorithm, verify setting persists

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/settings.tsx
git commit -m "feat: add FSRS algorithm toggle in settings"
```

---

### Task 14: Migrate Notification Store to TanStack Query

**Files:**

- Modify: `apps/web/src/stores/notifications.store.ts`

- [ ] **Step 1: Rewrite with createQuery**

```typescript
import { createQuery } from '@tanstack/solid-query';
import { api } from '@/api/client';
import { currentUser } from './auth.store';

// TanStack Query handles caching, polling, and Suspense avoidance
export function createNotificationsQuery() {
  return createQuery(() => ({
    queryKey: ['notifications', 'dueDecks', currentUser()?.id],
    queryFn: async () => {
      const { data } = await (api.notifications as any)['due-decks'].get();
      return (data ?? []) as DueDeckNotification[];
    },
    enabled: !!currentUser()?.id,
    refetchInterval: 5 * 60 * 1000, // 5 min polling
    refetchIntervalInBackground: false, // pause when tab hidden
  }));
}

// Derived helpers
export const totalDue = (decks: DueDeckNotification[]) =>
  decks.reduce((sum, d) => sum + d.dueCount, 0);
```

**Note:** The notification store currently uses `createRoot` to avoid Suspense. With TanStack Query, we can use `suspense: false` (default) and the query won't trigger Suspense boundaries.

- [ ] **Step 2: Update components that import from notifications.store.ts**

Find and update all consumers to use the new query-based API.

- [ ] **Step 3: Remove old polling/visibility logic**

Remove `startPolling`, `stopPolling`, `handleVisibilityChange`, `pollTimer` — TanStack handles all of this.

- [ ] **Step 4: Test** — verify notification badge updates, pauses when tab hidden

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/notifications.store.ts
git commit -m "refactor: migrate notifications to TanStack Query (replace manual polling)"
```

---

### Task 15: Sidebar Batch Endpoint + TanStack Migration

**Files:**

- Modify: `apps/api/src/modules/folders/folders.service.ts`
- Modify: `apps/api/src/modules/folders/folders.routes.ts`
- Modify: `apps/web/src/stores/sidebar.store.ts`
- Modify: `apps/web/src/components/layout/sidebar/sidebar-context.tsx`

- [ ] **Step 1: Add batch endpoint — GET /folders/by-user**

In `folders.service.ts`:

```typescript
export async function listByUser(userId: string) {
  const allFolders = await db
    .select({
      id: folders.id,
      name: folders.name,
      classId: folders.classId,
      sortOrder: folders.sortOrder,
    })
    .from(folders)
    .innerJoin(classes, eq(folders.classId, classes.id))
    .where(eq(classes.userId, userId))
    .orderBy(folders.classId, folders.sortOrder);

  // Group by classId
  const grouped: Record<string, typeof allFolders> = {};
  for (const f of allFolders) {
    (grouped[f.classId] ??= []).push(f);
  }
  return grouped;
}
```

In `folders.routes.ts`:

```typescript
.get('/by-user', async ({ userId }) => {
  return foldersService.listByUser(userId);
})
```

- [ ] **Step 2: Migrate sidebar-context.tsx to use TanStack queries**

Replace `fetchClasses` manual function with `createQuery`:

```typescript
const classesQuery = createQuery(() => ({
  queryKey: ['classes'],
  queryFn: async () => {
    const { data } = await api.classes.get();
    return (data ?? []) as ClassItem[];
  },
  enabled: !!currentUser()?.id,
}));

const allFoldersQuery = createQuery(() => ({
  queryKey: ['folders', 'all'],
  queryFn: async () => {
    const { data } = await api.folders['by-user'].get();
    return data as Record<string, FolderItem[]>;
  },
  enabled: !!currentUser()?.id,
}));
```

- [ ] **Step 3: Update sidebar.store.ts**

Simplify to only handle UI state (expanded/collapsed), remove data fetching logic.

- [ ] **Step 4: Test** — expand/collapse classes, create/delete folders, verify data loads

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/folders/ apps/web/src/stores/sidebar.store.ts apps/web/src/components/layout/sidebar/
git commit -m "perf: add batch folders endpoint + migrate sidebar to TanStack Query"
```

---

## Chunk 6: Export Streaming + Polish (Week 4)

### Task 16: Chunked Export Processing

**Files:**

- Modify: `apps/api/src/modules/import-export/import-export.service.ts`

- [ ] **Step 1: Refactor exportCSV to use chunked card fetching**

```typescript
const EXPORT_CHUNK_SIZE = 500;

export async function exportCSV(deckId: string, userId: string) {
  const deck = await getDeckWithTemplate(deckId, userId);
  const fields = await getTemplateFields(deck.cardTemplateId);
  const header = fields.map((f) => escapeCSVField(f.name)).join(',');

  const rows: string[] = [header];
  let cursor: string | undefined;
  let totalCards = 0;

  do {
    // Fetch cards in chunks
    const cardChunk = await db
      .select({ id: cards.id, sortOrder: cards.sortOrder })
      .from(cards)
      .where(
        cursor
          ? and(eq(cards.deckId, deckId), gt(cards.sortOrder, parseInt(cursor)))
          : eq(cards.deckId, deckId),
      )
      .orderBy(cards.sortOrder)
      .limit(EXPORT_CHUNK_SIZE);

    if (cardChunk.length === 0) break;
    totalCards += cardChunk.length;

    const cardIds = cardChunk.map((c) => c.id);
    const fieldValues = await db
      .select({
        cardId: cardFieldValues.cardId,
        templateFieldId: cardFieldValues.templateFieldId,
        value: cardFieldValues.value,
      })
      .from(cardFieldValues)
      .where(inArray(cardFieldValues.cardId, cardIds));

    const byCard = new Map<string, Map<string, unknown>>();
    for (const fv of fieldValues) {
      if (!byCard.has(fv.cardId)) byCard.set(fv.cardId, new Map());
      byCard.get(fv.cardId)!.set(fv.templateFieldId, fv.value);
    }

    for (const card of cardChunk) {
      const fieldMap = byCard.get(card.id) ?? new Map();
      rows.push(
        fields
          .map((f) => escapeCSVField(String(fieldMap.get(f.id) ?? '')))
          .join(','),
      );
    }

    cursor = String(cardChunk[cardChunk.length - 1].sortOrder);
  } while (true);

  return {
    csv: rows.join('\n') + '\n',
    deckName: deck.name,
    cardCount: totalCards,
  };
}
```

- [ ] **Step 2: Apply same pattern to exportJSON**

- [ ] **Step 3: Test** — export a deck with 100+ cards, verify CSV/JSON output is correct

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/import-export/import-export.service.ts
git commit -m "perf: chunked export processing (500 cards/chunk)"
```

---

### Task 17: Integration Testing + Cleanup

- [ ] **Step 1: Verify all TanStack migrations work**

Test each page:

- Dashboard: loads, shows cached data on re-visit
- Study mode: review flow, countdown timer, restart
- Interleaved study: session flow
- Deck view: add/edit/delete/bulk/reorder/search/AI generate/infinite scroll
- Folder view: deck listing, template display
- Settings: avatar, algorithm toggle
- Docs: SVG + markdown loading

- [ ] **Step 2: Verify cache sharing**

Test navigation flow:

- Dashboard → Study → Dashboard (should show cached data instantly)
- Deck view → Study → Deck view (should show cached cards)
- After reviewing cards, dashboard due count should update

- [ ] **Step 3: Verify FSRS algorithm**

Test FSRS:

- Switch to FSRS in settings
- Review cards — verify next review dates are reasonable
- Switch back to SM-2 — verify it still works
- Check review_logs are recorded for both algorithms

- [ ] **Step 4: Remove dead code**

- Remove unused `createResource` imports across all migrated files
- Remove old `refetchCards` patterns
- Remove old polling logic from notifications store
- Remove progressive rendering code from deck-view if replaced by VirtualList

- [ ] **Step 5: Update feature_roadmap_plan.md**

Mark completed items:

- TanStack Query migration: ✅
- FSRS re-implementation: ✅
- Performance issues P1-P8: ✅

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: integration testing + cleanup after performance sprint"
```

---

## Verification Checklist

After all tasks complete, verify:

- [ ] All 9 pages use `createQuery`/`createMutation` (zero `createResource` remaining)
- [ ] Search in deck-view is debounced (type fast, no jank)
- [ ] VirtualList renders only visible cards (inspect DOM: ~20 nodes, not 500)
- [ ] Deck view loads deck + cards in parallel (network tab: 2 concurrent requests)
- [ ] FSRS toggle works in settings
- [ ] FSRS scheduling produces reasonable intervals (not 0-day)
- [ ] SM-2 users unaffected (default behavior unchanged)
- [ ] Export handles 1000+ cards without memory issues
- [ ] Sidebar loads all folders in 1 request
- [ ] Cache sharing: navigate between pages without full refetch
