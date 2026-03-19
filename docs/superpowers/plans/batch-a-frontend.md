# Batch A: Frontend Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Global Search (Cmd+K modal) + 3 Dashboard widgets (Forecast, At-Risk, Smart Groups) consuming existing backend APIs.

**Architecture:** SolidJS components using createQuery (TanStack), createDebouncedSignal, Portal-based modals. Pure CSS charts (no chart library). Lazy-loaded search modal for zero bundle cost until opened.

**Tech Stack:** SolidJS, TanStack Solid Query, lucide-solid icons, existing UI primitives (Badge, Progress, Input, Skeleton)

---

## Task 1: Search Store + Global Search Modal

**Files:**
- Create: `apps/web/src/stores/search.store.ts`
- Create: `apps/web/src/components/search/global-search.tsx`

- [ ] **Step 1: Create search store**

Simple open/close signal, same pattern as `focus.store.ts`.

```ts
// apps/web/src/stores/search.store.ts
import { createSignal } from 'solid-js';

const [searchOpen, setSearchOpen] = createSignal(false);
export { searchOpen };
export const openSearch = () => setSearchOpen(true);
export const closeSearch = () => setSearchOpen(false);
export const toggleSearch = () => setSearchOpen((v) => !v);
```

- [ ] **Step 2: Create GlobalSearch component**

Portal-based modal with debounced input, TanStack Query, keyboard navigation.

Key behaviors:
- Debounced input 300ms via `createDebouncedSignal`
- `createQuery` → `GET /search?q=...&limit=15`, staleTime 30s, enabled only when query length >= 2
- Results: card preview rows with deck name + similarity badge
- Click result → `navigate('/deck/:deckId')` + close
- Arrow keys navigate results, Enter selects
- Escape closes
- Empty state: "Search across all your cards"
- Loading: skeleton rows

---

## Task 2: Wire Search into Header + App

**Files:**
- Modify: `apps/web/src/components/layout/header.tsx` — add search button + Cmd+K shortcut
- Modify: `apps/web/src/app.tsx` — mount GlobalSearch (lazy)

- [ ] **Step 1: Add search button to header**

Add a `Search` icon button between the sidebar toggle and the notification bell. Show `Cmd+K` hint badge.

- [ ] **Step 2: Register global Cmd+K / Ctrl+K shortcut**

In header, register keydown listener for `Cmd+K` / `Ctrl+K` → `openSearch()`.

- [ ] **Step 3: Mount GlobalSearch in app.tsx**

Lazy-load and mount inside `Suspense`, similar to `FocusDrawer`.

- [ ] **Step 4: Verify**

Run `bunx tsc --noEmit` in apps/web. Visually verify search opens with Cmd+K.

---

## Task 3: Forecast Widget (Dashboard)

**Files:**
- Create: `apps/web/src/components/dashboard/forecast-widget.tsx`
- Modify: `apps/web/src/pages/dashboard.tsx` — integrate widget

- [ ] **Step 1: Create ForecastWidget component**

Key behaviors:
- `createQuery` → `GET /study/forecast?days=14`, staleTime 5min
- Pure CSS bar chart: each day = `<div>` with dynamic height based on `atRiskCount`
- Color gradient: green (0 at-risk) → amber → red (many at-risk)
- Today's at-risk count as summary text above chart
- Hover title tooltip: "Mar 25: 12 cards at risk"
- Loading: skeleton card
- Hidden when no data (no study progress yet)

- [ ] **Step 2: Integrate into dashboard**

Add after Activity Heatmap section, before Due Decks. Wrap in `<Show when={...}>` to hide when user has no studied cards.

- [ ] **Step 3: Verify**

Run `bunx tsc --noEmit`. Check dashboard renders without errors.

---

## Task 4: Smart Groups Widget (Dashboard)

**Files:**
- Create: `apps/web/src/components/dashboard/smart-groups-widget.tsx`
- Modify: `apps/web/src/pages/dashboard.tsx` — integrate widget

- [ ] **Step 1: Create SmartGroupsWidget component**

Key behaviors:
- `createQuery` → `GET /study/smart-groups?topN=5`, staleTime 5min
- Horizontal list of concept cards: concept name (bold), card count, avg retention as colored Progress bar
- Retention color: green (>80%) → amber (60-80%) → red (<60%)
- Hidden when no groups returned (no concepts extracted yet)
- Loading: skeleton pills

- [ ] **Step 2: Integrate into dashboard**

Add after Forecast widget, before Due Decks.

- [ ] **Step 3: Verify**

Run `bunx tsc --noEmit`. Final visual check.

---
