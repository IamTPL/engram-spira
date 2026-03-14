# Performance Big Refactor — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triệt để tối ưu performance cho toàn bộ frontend web app, loại bỏ lag trên PC yếu, đảm bảo Solid.js best practices và maintainability.

**Architecture:** Split monolithic components thành focused modules, lazy-load heavy dependencies (Three.js), add virtual scrolling cho long lists, optimize Solid.js reactivity patterns, reduce CSS animation jank.

**Tech Stack:** Solid.js 1.9, TanStack Solid Query, Vite 7, TailwindCSS 4, Three.js (lazy), Elysia Eden

---

## Audit Summary — Performance Issues Found

### CRITICAL
1. **`deck-view.tsx` — 1612 lines monolithic** — ~30 signals, CRUD + AI + drag-drop + bulk select + search all in one file
2. **No card list virtualization** — Decks can have hundreds of cards, all rendered at once → main lag source on weak PCs
3. **Three.js (~500KB) eagerly loaded** — `dodecahedron-dice.tsx` imports `three` at top level, loaded even when reward popup is never opened
4. **`app.tsx` inline wrapper functions** — `component={() => (<ProtectedRoute>...)}` creates new functions every render, breaks lazy loading benefits

### HIGH
5. **Focus drawer Portal always in DOM** — Drawer panel Portal rendered always (even when closed), including event listeners
6. **Duplicate notification polling** — Both `header.tsx` and `sidebar-footer.tsx` independently poll `/notifications/due-decks` every 5 min → double network traffic
7. **Header polling ignores tab visibility** — Polls even when browser tab is inactive → wasted battery/CPU
8. **CSS animations on weak PCs** — `animate-pulse`, `transition-all`, `hover:scale` cause layout thrashing and jank
9. **`app.tsx` eager imports** — `LoginPage`, `RegisterPage`, `DashboardPage` imported eagerly instead of lazy

### MEDIUM
10. **Solid.js anti-patterns:**
    - IIFE inside JSX in `focus-drawer.tsx` line 215 `{(() => { ... })()}`
    - Functions recreated inside `<For>` callback in `deck-view.tsx` (getField, hasValue, getExamples)
    - String concatenation for conditional classes instead of `classList`
    - `settings.tsx` uses `.map()` instead of `<For>` (minor since static array)
11. **`sidebar.store.ts` — Set/Object copies on every toggle** — `new Set(expandedClasses())` creates O(n) copies
12. **Missing `Suspense` boundaries** — No `<Suspense>` for lazy-loaded pages → no loading fallback during code splitting

---

## Phase 1: Critical Performance Fixes

### Task 1: Split `deck-view.tsx` into focused modules

**Files:**
- Modify: `apps/web/src/pages/deck-view.tsx` (keep as orchestrator, ~200 lines)
- Create: `apps/web/src/pages/deck-view/index.tsx` (re-export)
- Create: `apps/web/src/pages/deck-view/deck-view-page.tsx` (main orchestrator)
- Create: `apps/web/src/pages/deck-view/card-list.tsx` (card rendering + virtual scroll)
- Create: `apps/web/src/pages/deck-view/card-item.tsx` (single card row)
- Create: `apps/web/src/pages/deck-view/add-card-form.tsx`
- Create: `apps/web/src/pages/deck-view/edit-card-form.tsx`
- Create: `apps/web/src/pages/deck-view/ai-generate-modal.tsx`
- Create: `apps/web/src/pages/deck-view/bulk-actions-bar.tsx`
- Create: `apps/web/src/pages/deck-view/deck-header.tsx`
- Create: `apps/web/src/pages/deck-view/use-deck-data.ts` (data fetching hook)
- Create: `apps/web/src/pages/deck-view/use-card-drag.ts` (drag-drop logic)
- Create: `apps/web/src/pages/deck-view/types.ts` (shared interfaces)

**Rationale:** The 1612-line monolith is the #1 source of complexity and poor performance. Splitting into focused modules allows:
- Better code splitting (AI modal can be lazy-loaded)
- Smaller reactive scopes (fewer signals per component = fewer unnecessary re-evaluations)
- Easier maintenance and testing

- [ ] Step 1: Create `types.ts` with shared interfaces (TemplateField, CardField, CardItem)
- [ ] Step 2: Create `use-deck-data.ts` extracting data fetching logic
- [ ] Step 3: Create `deck-header.tsx` extracting header + actions row
- [ ] Step 4: Create `card-item.tsx` extracting single card rendering
- [ ] Step 5: Create `card-list.tsx` with virtual scrolling (see Task 2)
- [ ] Step 6: Create `add-card-form.tsx` extracting add card form
- [ ] Step 7: Create `edit-card-form.tsx` extracting edit card form
- [ ] Step 8: Create `ai-generate-modal.tsx` as lazy-loaded component
- [ ] Step 9: Create `bulk-actions-bar.tsx` extracting bulk selection UI
- [ ] Step 10: Create `use-card-drag.ts` extracting drag-drop logic
- [ ] Step 11: Rewrite `deck-view-page.tsx` as thin orchestrator (~200 lines)
- [ ] Step 12: Update lazy import in `app.tsx`
- [ ] Step 13: Verify typecheck passes

### Task 2: Add virtual scrolling for card lists

**Files:**
- Create: `apps/web/src/lib/virtual-list.tsx` (lightweight virtual scroll component)
- Modify: `apps/web/src/pages/deck-view/card-list.tsx` (integrate virtual scroll)

**Rationale:** A deck with 200+ cards renders ALL DOM nodes. Virtual scrolling renders only visible items (~15-20), dramatically reducing DOM nodes and memory.

- [ ] Step 1: Create `virtual-list.tsx` — a generic Solid.js virtual list component using IntersectionObserver + dynamic row heights
- [ ] Step 2: Integrate into `card-list.tsx` — wrap `<For>` with virtual list
- [ ] Step 3: Test with large card list (200+ cards)

### Task 3: Lazy-load Three.js and reward system

**Files:**
- Modify: `apps/web/src/components/focus/reward-popup.tsx` — lazy load CubeDice
- Modify: `apps/web/src/components/focus/dodecahedron-dice.tsx` — keep as-is (will be lazy loaded)
- Modify: `apps/web/src/components/focus/focus-drawer.tsx` — conditional Portal render

**Rationale:** Three.js is ~500KB gzipped. It should only load when the user actually completes a focus session and sees the reward popup.

- [ ] Step 1: In `reward-popup.tsx`, use `lazy(() => import('./dodecahedron-dice'))` for CubeDice
- [ ] Step 2: Wrap lazy CubeDice in `<Suspense>` with spinner fallback
- [ ] Step 3: In `focus-drawer.tsx`, wrap the always-rendered Portal content with `<Show when={isDrawerOpen()}>` to avoid rendering hidden DOM
- [ ] Step 4: Verify Three.js is no longer in initial bundle (check network tab)

### Task 4: Fix `app.tsx` route optimization

**Files:**
- Modify: `apps/web/src/app.tsx`

**Rationale:** Inline `component={() => ...}` wrappers create new component functions on every navigation, defeating Solid's one-time component execution model. Eager imports of auth pages increase initial bundle.

- [ ] Step 1: Make LoginPage, RegisterPage, DashboardPage lazy
- [ ] Step 2: Create proper ProtectedRoute and GuestRoute as layout components (not inline wrappers)
- [ ] Step 3: Add `<Suspense>` boundary around Router with LoadingScreen fallback
- [ ] Step 4: Verify route transitions still work correctly

---

## Phase 2: High Priority Fixes

### Task 5: Deduplicate notification polling + add visibility API

**Files:**
- Create: `apps/web/src/stores/notifications.store.ts` (single source of truth)
- Modify: `apps/web/src/components/layout/header.tsx` (consume store)
- Modify: `apps/web/src/components/layout/sidebar/sidebar-footer.tsx` (consume store)

**Rationale:** Both header and sidebar-footer independently fetch due-decks every 5 minutes. Consolidating into a single store halves network traffic and uses Page Visibility API to pause polling when tab is hidden.

- [ ] Step 1: Create `notifications.store.ts` with shared due-decks resource + visibility-aware polling
- [ ] Step 2: Refactor `header.tsx` to consume from store (remove local resource + timer)
- [ ] Step 3: Refactor `sidebar-footer.tsx` to consume from store (remove local resource + timer)
- [ ] Step 4: Add `document.addEventListener('visibilitychange', ...)` to pause/resume polling

### Task 6: Reduce CSS animation jank

**Files:**
- Modify: `apps/web/src/app.css`

**Rationale:** On weak PCs, CSS animations cause significant jank. Key fixes:
- Add `@media (prefers-reduced-motion: reduce)` to disable/simplify animations
- Replace `transition-all` with specific properties (`transition-colors`, `transition-opacity`)
- Add `will-change` hints only during active animations, not permanently
- Replace `animate-pulse` with lighter alternatives where possible

- [ ] Step 1: Add `prefers-reduced-motion` media query that disables non-essential animations
- [ ] Step 2: Audit and replace `transition-all` usages across components
- [ ] Step 3: Verify no visible regression in animations on normal PCs

---

## Phase 3: Medium Priority — Solid.js Pattern Fixes

### Task 7: Fix Solid.js anti-patterns across codebase

**Files:**
- Modify: `apps/web/src/components/focus/focus-drawer.tsx` (IIFE → extracted component)
- Modify: `apps/web/src/pages/deck-view/card-item.tsx` (memoize field helpers)
- Modify: `apps/web/src/pages/settings.tsx` (.map → <For>)
- Modify: Various files (string concat → classList where beneficial)

- [ ] Step 1: In `focus-drawer.tsx`, extract IIFE (line 215) into a `DurationStepper` component
- [ ] Step 2: In `card-item.tsx`, move getField/hasValue/getExamples outside the For callback as memoized helpers
- [ ] Step 3: In `settings.tsx`, replace THEME_OPTIONS.map() with <For> (minor, static data)
- [ ] Step 4: Add `classList` usage where conditional classes are computed with string template literals (targeted, not exhaustive)

### Task 8: Add Suspense boundaries for lazy pages

**Files:**
- Modify: `apps/web/src/app.tsx`

- [ ] Step 1: Wrap Router with `<Suspense fallback={<LoadingScreen />}>`
- [ ] Step 2: Verify all lazy-loaded pages show loading state during code split load

### Task 9: Optimize sidebar store immutable copies

**Files:**
- Modify: `apps/web/src/stores/sidebar.store.ts`

**Rationale:** Every `toggleClass` creates `new Set()` copy. For small sets this is negligible, but the pattern can be improved.

- [ ] Step 1: Replace Set-based expandedClasses with a plain object `Record<string, boolean>` for O(1) toggle without full copy
- [ ] Step 2: Verify sidebar expand/collapse still works

---

## Phase 4: Verification

### Task 10: Full verification

- [ ] Step 1: Run `bun run typecheck` — must pass with zero errors
- [ ] Step 2: Run dev server, test all pages manually
- [ ] Step 3: Check browser DevTools Network tab — verify Three.js lazy loaded
- [ ] Step 4: Check bundle size with `npx vite-bundle-visualizer` (optional)
- [ ] Step 5: Test on throttled CPU (Chrome DevTools → Performance → CPU 4x slowdown)
