# Relationship Suggestions Select All Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit tri-state `Select all` control to both relationship-review surfaces while preserving the separate `Accept selected (N)` confirmation action.

**Architecture:** Put list-selection derivation in one framework-independent helper that consumes the current item IDs and selected ID set. Both the legacy suggestions panel and the KG v2 review panel use that helper, so partial, complete, and stale selections behave identically.

**Tech Stack:** TypeScript, SolidJS 1.9, Kobalte Checkbox, Bun test.

## Global Constraints

- Suggestions remain unselected after detection or a new KG run.
- Partial selection activates the indeterminate state.
- Activating unchecked or indeterminate selects every current item.
- Activating checked clears the selection.
- Acceptance remains a separate explicit action.
- Controls are disabled while a single or batch acceptance is in flight.
- Mobile touch targets are at least 44px.
- Do not commit.

---

### Task 1: Shared bulk-selection state

**Files:**
- Create: `apps/web/src/components/deck-view/suggestion-selection.ts`
- Create: `apps/web/src/components/deck-view/suggestion-selection.test.ts`

**Interfaces:**
- Produces: `type BulkSelectionState = 'none' | 'partial' | 'all'`
- Produces: `getBulkSelectionState(itemIds: string[], selectedIds: Set<string>): BulkSelectionState`
- Produces: `toggleAllSelection(itemIds: string[], selectedIds: Set<string>): Set<string>`

- [x] **Step 1: Write the failing tests**

Cover these exact behaviors with real helper calls:

```ts
expect(getBulkSelectionState([], new Set())).toBe('none');
expect(getBulkSelectionState(['a', 'b'], new Set(['a']))).toBe('partial');
expect(getBulkSelectionState(['a', 'b'], new Set(['a', 'b']))).toBe('all');
expect(getBulkSelectionState(['a'], new Set(['stale']))).toBe('none');
expect(toggleAllSelection(['a', 'b'], new Set(['a']))).toEqual(
  new Set(['a', 'b']),
);
expect(toggleAllSelection(['a', 'b'], new Set(['a', 'b']))).toEqual(
  new Set(),
);
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd apps/web && bun test src/components/deck-view/suggestion-selection.test.ts
```

Expected: failure because `suggestion-selection.ts` does not exist.

- [x] **Step 3: Implement the minimal pure helpers**

Deduplicate `itemIds`, count only selected IDs that still occur in the
current list, and return a fresh set from `toggleAllSelection`.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
cd apps/web && bun test src/components/deck-view/suggestion-selection.test.ts
```

Expected: all tests pass.

### Task 2: Wire the master control into both review surfaces

**Files:**
- Modify: `apps/web/src/components/deck-view/ai-suggestions.tsx`
- Modify: `apps/web/src/components/deck-view/knowledge-graph-review.tsx`

**Interfaces:**
- Consumes: `getBulkSelectionState` and `toggleAllSelection`
- Produces: one Kobalte-based master Checkbox per visible suggestion list

- [x] **Step 1: Derive current IDs and master state reactively**

The legacy panel maps each current suggestion through `suggestionKey`.
The KG v2 panel maps each current page item to `item.id`.

- [x] **Step 2: Render the master checkbox**

Pass:

```tsx
checked={selectionState() === 'all'}
indeterminate={selectionState() === 'partial'}
onChange={() => setSelectedIds((current) =>
  toggleAllSelection(currentItemIds(), current)
)}
```

Use visible text `Select all` unless state is `all`, then use
`Clear selection`. Give the control a dynamic `aria-label`, preserve the
selected count in `Accept selected (N)`, and use `min-h-11` on mobile.

- [x] **Step 3: Preserve in-flight safety**

Disable the master control during single acceptance, batch acceptance, and
legacy detection. Do not change detection, acceptance, or dismissal API
behavior.

- [x] **Step 4: Run web verification**

Run:

```bash
cd apps/web && bun test
cd apps/web && bunx tsc --noEmit
```

Expected: all web tests pass and TypeScript exits 0.

- [ ] **Step 5: Browser-check desktop and mobile (blocked by local `GET /decks` 500)**

Verify:

- zero selected shows unchecked `Select all`;
- selecting one row shows indeterminate `Select all`;
- activating it selects every visible suggestion;
- activating checked `Clear selection` clears all;
- `Accept selected (N)` reflects the exact count;
- no document-level overflow or blank page returns at desktop or 390px width.
