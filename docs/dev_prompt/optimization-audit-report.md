# Engram Spira — Optimization Audit Report

> **Scope**: Backend (Supabase Postgres Best Practices) + Frontend (Web Interface Guidelines)  
> **Status**: Analysis only — no implementation changes made  
> **Date**: 2025

---

## Part 1: Supabase Postgres Best Practices

### 1.1 Schema & Data Types

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ✅ **UUID primary keys** — all tables use `uuid().primaryKey().defaultRandom()` | — | All schema files | Good — `uuid` is appropriate for distributed ID generation |
| ✅ **`timestamptz` used consistently** | — | All timestamp columns | Good — avoids timezone ambiguity |
| ⚠️ **`varchar` for enum-like columns** | Medium | `review_logs.rating`, `review_logs.state`, `ai_generation_jobs.status`, `card_links.linkType`, `card_concepts.concept`, `template_fields.fieldType/side` | These columns hold a small fixed set of values. Using `varchar` wastes storage and prevents DB-level validation. **Recommendation**: Use Postgres `enum` types or `CHECK` constraints to enforce valid values and reduce storage |
| ⚠️ **`varchar` without length for `concept`** | Low | `card-concepts.ts:12` | `concept` uses `varchar` which in Drizzle defaults to unbounded. Best practice says use `text` for truly variable-length strings. Currently functional, but `text` is semantically clearer when no max length is enforced |
| ⚠️ **`doublePrecision` for `easeFactor`** | Low | `study-progress.ts:14` | Floating-point types introduce rounding errors. If precision matters for spaced repetition scheduling, `numeric(5,4)` would be more accurate. If performance is prioritized over precision, current choice is acceptable |
| ✅ **`date` type for `studyDate`** | — | `study-daily-logs.ts:25` | Good — date-only column for calendar grouping |
| ✅ **`jsonb` for flexible data** | — | `card_field_values.value`, `ai_generation_jobs.generatedCards`, `template_fields.config` | Good — `jsonb` supports indexing and is the correct choice over `json` |

### 1.2 Indexes & Foreign Keys

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ✅ **All FK columns are indexed** | — | All schema files | Good — every `userId`, `deckId`, `cardId`, `classId`, `folderId`, `templateId` FK has an explicit index. This is critical since Postgres does NOT auto-index FKs |
| ✅ **Composite indexes for common query patterns** | — | `review_logs: (userId, cardId)`, `(userId, reviewedAt)`, `study_progress: (userId, nextReviewAt)`, `cards: (deckId, sortOrder)`, `ai_generation_jobs: (status, createdAt)` | Good — these match the WHERE/ORDER BY patterns in the service layer |
| ✅ **Unique constraints with implicit indexes** | — | `study_progress: (userId, cardId)`, `card_field_values: (cardId, templateFieldId)`, `study_daily_logs: (userId, studyDate)`, `card_links: (sourceCardId, targetCardId)` | Good — unique constraints serve as both data integrity and query indexes |
| ⚠️ **Missing partial index on `ai_generation_jobs.status`** | Medium | `ai-generation-jobs.ts` | The composite `(status, createdAt)` index is good, but a **partial index** like `WHERE status IN ('pending', 'processing')` would be smaller and faster for the common query "find active jobs". Active jobs are a tiny fraction of total rows |
| ⚠️ **Missing partial index for `password_reset_tokens.expiresAt`** | Low | `password-reset-tokens.ts` | Expired tokens are never queried. A partial index `WHERE expiresAt > now()` on the token hash would speed up lookups and stay small |
| ⚠️ **Redundant index on `study_daily_logs`** | Low | `study-daily-logs.ts:29-30` | The `unique('uq_user_study_date')` already creates an index on `(userId, studyDate)`. The additional `index('idx_sdl_user_date')` on the same columns is **fully redundant** — it only wastes write amplification and storage |

### 1.3 Query Patterns & Data Access

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ⚠️ **OFFSET-based pagination** | **High** | `cards.service.ts:33-36` | `listByDeck` uses `.offset(offset)` which has **O(n) performance on deep pages** — Postgres must scan and discard all skipped rows. **Recommendation**: Switch to **cursor-based pagination** using `sortOrder` as the cursor (e.g., `WHERE sort_order > :lastSeen ORDER BY sort_order LIMIT :limit`). The `(deckId, sortOrder)` composite index already exists and would support this efficiently |
| ✅ **N+1 prevention — parallel batch loading** | — | `cards.service.ts`, `study.service.ts:enrichCards` | Good — field values and progress are loaded in batch queries alongside cards, not in loops |
| ✅ **Upsert with `onConflictDoUpdate`** | — | `study.service.ts:upsertDailyLog`, `cards.service.ts:update` | Good — single-statement upserts avoid race conditions and reduce round trips |
| ✅ **`SELECT ... FOR UPDATE` for serialization** | — | `import-export.service.ts:148`, `cards.service.ts:create`, `ai.service.ts:saveGeneratedCards` | Good — explicit row-level locks to serialize sort order assignment |
| ⚠️ **Sequential card insertion in import loop** | Medium | `import-export.service.ts:156-180` | Cards are inserted one-by-one inside a `for` loop within a transaction. For large imports, this creates many individual INSERT statements. **Recommendation**: Batch inserts using `db.insert(cards).values([...allCards])` followed by a batch insert for field values. This would reduce N insert operations to 2 |
| ⚠️ **Transaction scope in `reorder` operations** | Low | `folders.service.ts:91-104`, `classes.service.ts:73-86` | The reorder transaction updates all items sequentially with `Promise.all`. While the transaction scope is correctly short, if the list grows large, this could hold locks on many rows. Consider a single `UPDATE ... FROM (VALUES ...)` CTE for batch reorder |

### 1.4 Connection & Prepared Statements

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ✅ **Connection pooling configured** | — | `db/index.ts:7-11` | `max`, `idle_timeout`, `connect_timeout` are explicitly configured |
| ✅ **Prepared statements enabled** | — | `db/index.ts:13` | `prepare: true` — Drizzle will use prepared statements for repeated queries, reducing parse overhead |

### 1.5 Concurrency & Locking

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ✅ **Short transactions** | — | All services | Transactions contain only DB operations, no external API calls or I/O inside them |
| ✅ **`CHECK` constraint for self-link prevention** | — | `card-links.ts:37` | Good — enforced at DB level rather than application level |

---

## Part 2: Web Interface Guidelines

### 2.1 Accessibility

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ⚠️ **Minimal ARIA usage** | **High** | Entire frontend | Only 2 files use any `aria-*` attributes. Key missing areas: modal dialogs (AI modal, password modal, confirm discard) lack `role="dialog"`, `aria-modal="true"`, `aria-labelledby`. Drag-and-drop in `deck-view.tsx` lacks `aria-grabbed`, `aria-dropeffect`. Loading states lack `aria-live="polite"` regions |
| ⚠️ **Icon-only buttons missing accessible labels** | **High** | `deck-view.tsx:970`, `sidebar.tsx:46-51`, `study-controls.tsx` | Many icon-only buttons rely on `title` attribute instead of `aria-label`. Screen readers may not announce `title`. Some icon buttons have neither (e.g., checkbox toggle buttons in `deck-view.tsx:976-988`). **Recommendation**: Add `aria-label` to all icon-only buttons |
| ⚠️ **Labels not associated with inputs** | Medium | `settings.tsx:417-425`, `deck-view.tsx:1266-1268` | Several `<label>` elements are not programmatically linked to their inputs via `for`/`id` attributes. In the settings password modal and AI modal, labels are siblings of inputs but lack `for` attributes. Screen readers won't announce these labels when the input is focused |
| ⚠️ **Error messages not associated with inputs** | Medium | `login.tsx:62`, `register.tsx:61` | Error messages are displayed as general `<div>` elements, not linked to the specific form field via `aria-describedby`. Users relying on screen readers won't know which field has the error |
| ⚠️ **No skip-to-content link** | Low | `index.html` / layout | No mechanism for keyboard users to skip past the sidebar navigation to main content |
| ✅ **Keyboard shortcuts for study controls** | — | `study-mode.tsx`, `interleaved-study.tsx` | Good — `Space` to flip, `1-4` for review actions |

### 2.2 Focus States

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ✅ **Global `:focus-visible` style** | — | `app.css:283-287` | Good — 2px solid ring with offset applied globally |
| ✅ **`focus-visible:ring` on interactive components** | — | `button.tsx:6`, `input.tsx:11`, deck cards in `folder-view.tsx:316` | Good — Tailwind `focus-visible:ring-1` classes used consistently |
| ⚠️ **`outline-none` without replacement on some elements** | Medium | `sidebar-class-item.tsx:95`, `sidebar-folder-item.tsx:84`, `focus-drawer.tsx:313` | These inline rename inputs use `outline-none` (removes browser focus indicator) but rely only on a border color change. The border change may be insufficient contrast for accessibility. Ensure `focus-visible` ring is added |
| ⚠️ **Hover-only action buttons** | Medium | `deck-view.tsx:1087` | Card action buttons (edit, delete) are `opacity-0 group-hover:opacity-100`. These are **invisible to keyboard users** who tab through the page. **Recommendation**: Add `focus-within:opacity-100` to the parent group so the buttons become visible when focused via keyboard |

### 2.3 Animation & Motion

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ⚠️ **No `prefers-reduced-motion` support** | **High** | `app.css`, all components | Zero occurrences of `prefers-reduced-motion` in the entire codebase. Users who prefer reduced motion will still see: flashcard 3D flip animations, fade-in/slide-in/scale-in animations, confetti animations, hover scale transforms. **Recommendation**: Add `@media (prefers-reduced-motion: reduce)` to disable or simplify animations |
| ⚠️ **`transition: all` overuse** | Medium | `app.css:364`, ~15 component occurrences | `transition-all` animates **every CSS property** including layout properties (width, height, padding), which can trigger expensive layout recalculations. **Recommendation**: Replace with specific properties like `transition-colors`, `transition-opacity`, `transition-transform` |
| ✅ **Animation durations are short** | — | `app.css` | All animations are 200-300ms, within the recommended 100-500ms range |
| ✅ **CSS-based animations (not JS)** | — | All keyframes in `app.css` | Good — GPU-compositable transforms and opacity used |

### 2.4 Forms & Inputs

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ⚠️ **No `autocomplete` attributes** | **High** | `login.tsx`, `register.tsx`, `reset-password.tsx`, `settings.tsx` | Password and email fields lack `autocomplete` attributes (`autocomplete="email"`, `autocomplete="current-password"`, `autocomplete="new-password"`). This prevents browsers and password managers from auto-filling correctly. Required by WCAG and a major UX friction point |
| ⚠️ **Form error handling — no field-level validation** | Medium | `register.tsx:27-34` | Password validation only happens on submit. No real-time feedback as the user types (e.g., password strength meter, character count). The "at least 8 characters" message only appears after submission |
| ✅ **Disabled state on submit buttons during loading** | — | All forms | Good — `disabled={loading()}` prevents double submission |
| ✅ **Input `required` attributes present** | — | `login.tsx`, `register.tsx`, `reset-password.tsx` | Good — HTML5 `required` for browser-native validation |

### 2.5 Dark Mode & Theming

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ✅ **Complete dark mode design system** | — | `app.css:131-201` | Thorough — separate token values for all surfaces, borders, text, palette colors, shadows |
| ✅ **`color-scheme: dark` set** | — | `app.css:194` | Good — informs browser UI (scrollbars, form controls) about the active color scheme |
| ✅ **System theme detection + listener** | — | `theme.store.ts` | Good — detects `prefers-color-scheme`, watches for runtime changes, supports light/dark/system |
| ⚠️ **Hard-coded light-mode colors in dark mode** | Medium | `folder-view.tsx:327-332`, `settings.tsx:75-78`, `feedback.tsx:123` | Several elements use `text-slate-800`, `text-slate-700`, `text-slate-600`, `bg-white/25` hard-coded. In dark mode with dark backgrounds, these will display correctly on **pastel gradient cards** but if the gradient is ever removed, the text would be invisible. `AvatarDisplay` fallback uses inline `background: linear-gradient(...)` with light colors — safe but not theme-token-aware |
| ⚠️ **Missing `<meta name="theme-color">`** | Low | `index.html` | No `theme-color` meta tag. Mobile browsers (especially Safari) use this to tint the browser chrome. **Recommendation**: Add `<meta name="theme-color" content="#f7fbff" media="(prefers-color-scheme: light)">` and a dark variant |

### 2.6 Typography & Content

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ✅ **Inter variable font with OpenType features** | — | `app.css:235-236` | Good — `cv02`, `cv03`, `cv04`, `cv11` features enabled |
| ✅ **`tabular-nums` for numeric displays** | — | `dashboard.tsx:244`, `focus-drawer.tsx:200` | Good — prevents layout shift for counters and timers |
| ⚠️ **Missing `tabular-nums` on other numeric displays** | Low | `study-mode.tsx:progress`, `interleaved-study.tsx:145`, `deck-view.tsx:992` | Card counts and progress indicators don't use `tabular-nums` — numbers changing width can cause micro layout shifts |
| ✅ **Text rendering optimizations** | — | `app.css:223-225` | Good — `antialiased`, `optimizeLegibility` enabled |
| ✅ **System font stack fallback** | — | `app.css:11` | Good — `'Inter', system-ui, -apple-system, sans-serif` |

### 2.7 Performance & Loading

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ✅ **Font preconnect** | — | `index.html:9-10` | Good — `preconnect` to both `fonts.googleapis.com` and `fonts.gstatic.com` |
| ⚠️ **No `font-display: swap` control** | Low | `index.html:12` | The Google Fonts URL uses `display=swap` — this is correct and handled by Google's CSS. No issue |
| ⚠️ **No skeleton/loading states for some pages** | Medium | `settings.tsx`, `feedback.tsx`, `study-mode.tsx` | `folder-view.tsx` has skeleton loading states (animated pulse placeholders), but other pages show nothing or just "Loading..." text while data fetches. **Recommendation**: Add consistent skeleton states for perceived performance |
| ✅ **`createResource` for data fetching** | — | All pages | Good — SolidJS `createResource` provides built-in loading/error states |
| ⚠️ **No `overscroll-behavior` containment** | Low | `app.css` | Scrollable containers (sidebar, modal bodies, card lists) don't set `overscroll-behavior: contain`. This means scrolling to the end of a modal can accidentally scroll the page behind it |

### 2.8 Touch & Mobile

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ✅ **`safe-area-inset-bottom` support** | — | `app.css:413-415` | Good — `.safe-area-pb` utility handles iOS notch/home indicator |
| ✅ **Mobile nav + drawer pattern** | — | `sidebar.tsx` | Good — responsive sidebar with mobile drawer overlay |
| ⚠️ **No `touch-action` on drag-drop** | Medium | `deck-view.tsx:952-959` | Card drag-and-drop uses HTML5 drag events but doesn't set `touch-action: none` on draggable elements. On mobile, browser scroll can interfere with drag gestures |
| ⚠️ **Small touch targets** | Low | `deck-view.tsx:976-988`, various `h-8 w-8` icon buttons | Some interactive elements are 32×32px. Apple HIG recommends minimum 44×44px for touch targets. The `min-w-25` on study control buttons is good |

### 2.9 Navigation & State

| Finding | Severity | Location | Detail |
|---------|----------|----------|--------|
| ✅ **SPA routing with `@solidjs/router`** | — | All pages | Good — client-side navigation without full page reloads |
| ⚠️ **No focus management on route change** | Medium | `app.tsx` (router) | After navigation, focus remains on the element that triggered the navigation. **Recommendation**: Move focus to the main content heading or use `autofocus` on the first meaningful element after route change |
| ⚠️ **Modal focus trap missing** | Medium | `deck-view.tsx:1193-1527`, `settings.tsx:406-477` | Modals allow backdrop click to close but don't trap focus within the modal. Tab key can move focus to elements behind the modal overlay. **Recommendation**: Implement focus trapping (first→last→first cycle) and restore focus on close |

---

## Summary — Priority Matrix

### 🔴 High Priority (should fix)

1. **OFFSET pagination** → cursor-based (`cards.service.ts`)
2. **Missing `prefers-reduced-motion`** → add media query to disable/simplify animations
3. **Missing `autocomplete` attributes** on auth forms
4. **Minimal ARIA attributes** → add `role`, `aria-modal`, `aria-label`, `aria-live`
5. **Icon-only buttons** → add `aria-label` on all icon buttons

### 🟡 Medium Priority (recommended)

6. **Partial indexes** for `ai_generation_jobs.status` and `password_reset_tokens`
7. **Sequential card import** → batch INSERT
8. **`transition-all` overuse** → use specific transition properties
9. **Labels not linked to inputs** → add `for`/`id` pairs
10. **Hover-only buttons invisible to keyboard** → add `focus-within:opacity-100`
11. **Modal focus trapping** missing
12. **Skeleton loading states** inconsistent across pages
13. **Hard-coded light colors** on gradient cards in dark mode
14. **`overscroll-behavior: contain`** on scrollable modals/containers
15. **`touch-action: none`** on draggable elements

### 🟢 Low Priority (nice to have)

16. **Redundant index** on `study_daily_logs` — remove duplicate
17. **`<meta name="theme-color">`** tag for mobile browsers
18. **`tabular-nums`** on remaining numeric displays
19. **`varchar` → enum/CHECK** for status-like columns
20. **Skip-to-content link** for keyboard navigation
21. **Small touch targets** (32px → 44px minimum)

---

## What's Already Done Well ✅

### Backend
- **All FK columns indexed** — no missing FK indexes
- **Composite indexes** match actual query patterns
- **Prepared statements** enabled
- **Connection pooling** configured
- **Short transactions** — no external calls inside transactions
- **N+1 query prevention** — batch loading used consistently
- **`onConflictDoUpdate` upserts** — efficient single-statement operations
- **Row-level locking** (`FOR UPDATE`) for concurrent write safety
- **`timestamptz` throughout** — no timezone bugs
- **`jsonb`** for flexible structured data

### Frontend
- **Complete dark mode** with proper `color-scheme` and system detection
- **Focus-visible rings** globally configured
- **Font optimization** (preconnect, variable font, OpenType features)
- **Safe area support** for mobile devices
- **Keyboard shortcuts** in study mode
- **Responsive design** with mobile drawer pattern
- **Short, GPU-compositable animations**
- **Consistent design token system** (CSS custom properties)
- **`tabular-nums`** on key numeric displays
