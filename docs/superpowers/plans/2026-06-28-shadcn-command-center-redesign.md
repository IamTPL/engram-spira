# Shadcn-Solid Command Center Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full Engram Spira Command Center redesign using SolidJS, shadcn-solid style primitives, aggregate UX APIs, and a polished neutral power-user app shell.

**Architecture:** Implement this as phased, testable slices: UI/theme foundation, backend aggregate contracts, shell/command infrastructure, core workspaces, then supporting surfaces and QA. Keep UI primitives generic under `components/ui`, domain components under focused feature folders, and backend aggregate logic in new module services that compose existing services instead of duplicating business rules.

**Tech Stack:** Bun workspace, SolidJS, Solid Router, TanStack Solid Query, Tailwind CSS v4, Elysia, Drizzle, Bun test, shadcn-solid-compatible local components, lucide-solid.

---

## Source Spec

- Spec: `docs/superpowers/specs/2026-06-28-shadcn-command-center-redesign-design.md`
- Approved direction: SolidJS + shadcn-solid, shadcn default neutral, Command Center IA, full app polish.
- Relevant skills for execution: @superpowers:test-driven-development, @solid-js-best-practices, @superpowers:systematic-debugging, @superpowers:verification-before-completion.

## Scope Check

The spec is intentionally broad, so this plan is a master implementation plan with chunks. Each chunk must leave the app in a working state and can be implemented as one or more commits. Do not attempt to implement all chunks in one unreviewed edit.

Command convention: run commands from `/home/tplong/WorkSpace/engram_spira` unless a command block explicitly changes directory.

## File Structure

### Backend Files

- Create `apps/api/src/modules/experience/experience.types.ts`: shared aggregate response and command/create contract types.
- Create `apps/api/src/modules/experience/aggregate.helpers.ts`: aggregate envelope and section helper functions.
- Create `apps/api/src/modules/experience/command-center.service.ts`: command center aggregate composition.
- Create `apps/api/src/modules/experience/library-explorer.service.ts`: explorer aggregate composition.
- Create `apps/api/src/modules/experience/deck-workspace.service.ts`: deck workspace aggregate composition.
- Create `apps/api/src/modules/experience/insights-overview.service.ts`: insights aggregate composition.
- Create `apps/api/src/modules/experience/study-queue.service.ts`: study queue aggregate composition.
- Create `apps/api/src/modules/experience/experience.service.ts`: thin barrel that re-exports the focused experience services only.
- Create `apps/api/src/modules/experience/experience.routes.ts`: Elysia routes for aggregate endpoints.
- Create `apps/api/src/modules/experience/command-search.service.ts`: unified entity/action search.
- Create `apps/api/src/modules/experience/create-preview.service.ts`: create preview, commit, idempotency, merge behavior.
- Modify `apps/api/src/index.ts`: mount new `experienceRoutes`.
- Test `apps/api/__tests__/modules/experience/experience.service.test.ts`.
- Test `apps/api/__tests__/modules/experience/command-search.service.test.ts`.
- Test `apps/api/__tests__/modules/experience/create-preview.service.test.ts`.
- Modify `apps/api/__tests__/helpers/fixtures.ts`: add decks/cards/templates fixtures used by experience tests.

### Frontend UI Foundation Files

- Modify `apps/web/src/app.css`: replace old primary design tokens with shadcn default neutral tokens while preserving required utility classes.
- Modify existing `apps/web/src/components/ui/*.tsx`: align primitives with shadcn-solid behavior and class names.
- Create these additional primitives:
  - `apps/web/src/components/ui/label.tsx`
  - `apps/web/src/components/ui/select.tsx`
  - `apps/web/src/components/ui/checkbox.tsx`
  - `apps/web/src/components/ui/switch.tsx`
  - `apps/web/src/components/ui/separator.tsx`
  - `apps/web/src/components/ui/sheet.tsx`
  - `apps/web/src/components/ui/alert-dialog.tsx`
  - `apps/web/src/components/ui/command.tsx`
  - `apps/web/src/components/ui/table.tsx`
  - `apps/web/src/components/ui/scroll-area.tsx`
  - `apps/web/src/components/ui/sonner.tsx`
- Preserve `apps/web/src/lib/utils.ts`.

### Frontend Shell and Command Files

- Create `apps/web/src/components/app-shell/app-shell.tsx`: desktop/tablet/mobile layout owner.
- Create `apps/web/src/components/app-shell/task-rail.tsx`: task nav.
- Create `apps/web/src/components/app-shell/command-bar.tsx`: top command trigger and search input.
- Create `apps/web/src/components/app-shell/context-panel.tsx`: route panel host and sheet behavior.
- Create `apps/web/src/components/app-shell/library-explorer.tsx`: explorer tree using aggregate data.
- Create `apps/web/src/components/app-shell/mobile-bottom-nav.tsx`: mobile nav.
- Create `apps/web/src/components/app-shell/types.ts`: shell context and panel descriptor types.
- Create `apps/web/src/lib/command-actions.ts`: command action registry and initial action definitions.
- Create `apps/web/src/lib/experience-api.ts`: typed frontend wrappers for new aggregate endpoints.
- Modify `apps/web/src/app.tsx`: mount new shell around protected routes and replace global search/toast wiring.
- Modify `apps/web/src/components/layout/page-shell.tsx`: convert old shell wrapper into content-only compatibility wrapper after `AppShell` owns layout.

### Frontend Workspace Files

- Create `apps/web/src/pages/home-command-center.tsx`: new home route replacing dashboard behavior.
- Modify `apps/web/src/pages/dashboard.tsx`: route-compatible wrapper or redirect/export for Home.
- Create `apps/web/src/pages/study/study-workspace.tsx`.
- Create `apps/web/src/pages/study/study-session.tsx`.
- Create `apps/web/src/pages/library/library-workspace.tsx`.
- Create `apps/web/src/pages/deck-workspace/deck-workspace-page.tsx`.
- Create `apps/web/src/pages/create/create-workspace.tsx`.
- Create `apps/web/src/pages/insights/insights-workspace.tsx`.
- Migrate current deck helpers from `apps/web/src/pages/deck-view/*` into the deck workspace only when touched.
- Keep heavy visual components in `apps/web/src/components/deck-view/*` lazy-loaded behind deck tabs.

### Supporting Surface Files

- Modify `apps/web/src/pages/login.tsx`, `register.tsx`, `reset-password.tsx`, `verify-email.tsx`, `not-found.tsx`.
- Modify `apps/web/src/pages/settings.tsx`.
- Modify `apps/web/src/pages/docs.tsx`.
- Modify `apps/web/src/pages/feedback.tsx`.
- Modify `apps/web/src/components/focus/focus-drawer.tsx` only to integrate with Study/Command actions, preserving lazy loading.

---

## Chunk 1: UI Foundation and Neutral Theme

### Task 1: Establish shadcn-compatible primitive inventory

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/app.css`
- Modify: `apps/web/src/components/ui/alert.tsx`
- Modify: `apps/web/src/components/ui/badge.tsx`
- Modify: `apps/web/src/components/ui/button.tsx`
- Modify: `apps/web/src/components/ui/card.tsx`
- Modify: `apps/web/src/components/ui/dialog.tsx`
- Modify: `apps/web/src/components/ui/dropdown-menu.tsx`
- Modify: `apps/web/src/components/ui/empty-state.tsx`
- Modify: `apps/web/src/components/ui/input.tsx`
- Modify: `apps/web/src/components/ui/progress.tsx`
- Modify: `apps/web/src/components/ui/skeleton.tsx`
- Modify: `apps/web/src/components/ui/tabs.tsx`
- Modify: `apps/web/src/components/ui/textarea.tsx`
- Modify: `apps/web/src/components/ui/tooltip.tsx`
- Modify: `apps/web/src/components/ui/toaster.tsx`
- Modify: `apps/web/src/stores/toast.store.ts`
- Create: `apps/web/src/components/ui/label.tsx`
- Create: `apps/web/src/components/ui/select.tsx`
- Create: `apps/web/src/components/ui/checkbox.tsx`
- Create: `apps/web/src/components/ui/switch.tsx`
- Create: `apps/web/src/components/ui/separator.tsx`
- Create: `apps/web/src/components/ui/sheet.tsx`
- Create: `apps/web/src/components/ui/alert-dialog.tsx`
- Create: `apps/web/src/components/ui/command.tsx`
- Create: `apps/web/src/components/ui/table.tsx`
- Create: `apps/web/src/components/ui/scroll-area.tsx`
- Create: `apps/web/src/components/ui/sonner.tsx`

Primitive inventory:

| File | Action | Dependency/source | Required exports |
| --- | --- | --- | --- |
| `button.tsx` | align | local shadcn-style + `class-variance-authority` | `Button`, `buttonVariants`; preserve sizes `default`, `sm`, `lg`, `icon` and `loading` |
| `card.tsx` | align | local shadcn-style | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`; preserve existing `variant`/`interactive` props until call sites migrate |
| `input.tsx` | align | local shadcn-style | `Input` with transitional `iconLeft`/`iconRight` and `error` |
| `textarea.tsx` | align | local shadcn-style | `Textarea` |
| `alert.tsx` | align | local shadcn-style | `Alert`, `AlertTitle`, `AlertDescription` |
| `badge.tsx` | align | local shadcn-style | `Badge`, `badgeVariants`; preserve `muted`, `success`, and `warning` variants until call sites migrate |
| `progress.tsx` | align | local shadcn-style | `Progress` with semantic variants |
| `skeleton.tsx` | align | local shadcn-style | default `Skeleton` export with `shape`, `width`, and `height` props |
| `empty-state.tsx` | align | local shadcn-style | `EmptyState` |
| `dialog.tsx` | replace | `@kobalte/core` Dialog | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose` |
| `dropdown-menu.tsx` | replace | `@kobalte/core` DropdownMenu | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator`, `DropdownMenuLabel` |
| `tabs.tsx` | replace | `@kobalte/core` Tabs | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` |
| `tooltip.tsx` | replace | `@kobalte/core` Tooltip | `Tooltip`, `TooltipTrigger`, `TooltipContent` |
| `toaster.tsx` / `sonner.tsx` | replace | `solid-sonner` | default `Toaster`, named `Toaster`, `toast` bridge |
| `command.tsx` | create | `cmdk-solid` | `Command`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandEmpty` |
| `label.tsx` | create | local shadcn-style | `Label` |
| `select.tsx` | create | `@kobalte/core` Select | `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectLabel`, `SelectSeparator` |
| `checkbox.tsx` | create | `@kobalte/core` Checkbox | `Checkbox` |
| `switch.tsx` | create | `@kobalte/core` Switch | `Switch` |
| `sheet.tsx` | create | `@kobalte/core` Dialog | `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetFooter`, `SheetClose` |
| `alert-dialog.tsx` | create | `@kobalte/core` Dialog | `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogAction`, `AlertDialogCancel` |
| `table.tsx` | create | local shadcn-style | `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption` |
| `separator.tsx` | create | local shadcn-style | `Separator` |
| `scroll-area.tsx` | create | local shadcn-style | `ScrollArea` |

Existing `components/ui` compatibility decisions:

- `array-input.tsx`: keep as a composite form helper for now; do not treat as a primitive. It may keep importing `Input` and `Button`.
- `spinner.tsx`: keep as a simple visual helper until replaced by skeleton/loading states later.
- `app-error-boundary.tsx`: keep as app infrastructure despite its current path; do not alter behavior in this chunk.

- [ ] **Step 1: Record current dependency baseline**

Run: `bun run --filter @engram/web typecheck`
Expected: current web typecheck result is known before changes. If it fails, record the existing failure and do not fix unrelated issues.

- [ ] **Step 2: Add required UI dependencies**

Add exactly these dependencies for the first shadcn-solid-compatible primitive pass:

```bash
bun add --cwd apps/web @kobalte/core cmdk-solid solid-sonner
```

Do not add React-only shadcn/ui packages. Do not add corvu unless a later implementation step explicitly replaces a Kobalte primitive with a corvu primitive and updates this plan.

Run: `bun install`
Expected: lockfile updates and install succeeds.

- [ ] **Step 3: Replace app theme tokens with neutral shadcn defaults**

Modify `apps/web/src/app.css`:
- Keep `@import 'tailwindcss'` and class-based dark mode.
- Replace pastel dominant tokens with these neutral semantic tokens:
  - light: `--color-background: #ffffff`, `--color-foreground: #09090b`, `--color-card: #ffffff`, `--color-card-foreground: #09090b`, `--color-popover: #ffffff`, `--color-popover-foreground: #09090b`, `--color-primary: #18181b`, `--color-primary-foreground: #fafafa`, `--color-secondary: #f4f4f5`, `--color-secondary-foreground: #18181b`, `--color-muted: #f4f4f5`, `--color-muted-foreground: #71717a`, `--color-accent: #f4f4f5`, `--color-accent-foreground: #18181b`, `--color-destructive: #ef4444`, `--color-destructive-foreground: #fafafa`, `--color-border: #e4e4e7`, `--color-input: #e4e4e7`, `--color-ring: #18181b`.
  - dark: `--color-background: #09090b`, `--color-foreground: #fafafa`, `--color-card: #09090b`, `--color-card-foreground: #fafafa`, `--color-popover: #09090b`, `--color-popover-foreground: #fafafa`, `--color-primary: #fafafa`, `--color-primary-foreground: #18181b`, `--color-secondary: #27272a`, `--color-secondary-foreground: #fafafa`, `--color-muted: #27272a`, `--color-muted-foreground: #a1a1aa`, `--color-accent: #27272a`, `--color-accent-foreground: #fafafa`, `--color-destructive: #7f1d1d`, `--color-destructive-foreground: #fafafa`, `--color-border: #27272a`, `--color-input: #27272a`, `--color-ring: #d4d4d8`.
  - radius: `--radius-sm: 0.125rem`, `--radius-md: 0.375rem`, `--radius-lg: 0.5rem`, `--radius-xl: 0.75rem`.
- Preserve app-specific utility classes only when still used by study/card interactions.
- Preserve compatibility tokens still used by current routes while shifting their values to neutral/status semantics: `--color-success`, `--color-success-foreground`, `--color-warning`, `--color-warning-foreground`, `--color-info`, `--color-info-foreground`, legacy `--color-palette-1` through `--color-palette-7`, animation duration variables, overlay/backdrop classes, safe-area/mobile nav variables, and layout width variables such as sidebar/content widths until old layouts are removed.
- Remove or demote `.btn-gradient` and `.bg-section-gradient` from primary UI usage.

- [ ] **Step 4: Align simple local primitives**

Keep existing import paths. Ensure:
- `Button` supports variants `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`.
- `Button` sizes `default`, `sm`, `lg`, and `icon` plus `loading` remain supported during migration.
- `Input iconLeft`, `iconRight`, and `error` remain supported before call sites are changed.
- `Card` remains generic and does not include domain styling, while preserving existing transitional `variant` and `interactive` props.
- `Alert` supports `default` and `destructive` variants with shadcn-style border/foreground classes.
- `Badge` supports `default`, `secondary`, `destructive`, `outline`, `muted`, `success`, and `warning`.
- `Progress` remains determinate and accepts semantic variants without app-domain labels, including status variants that map to preserved status tokens.
- `Skeleton` remains a generic pulse block, keeps default export, and preserves `shape`, `width`, and `height` props.
- `EmptyState` remains a generic composition helper with icon/title/description/action slots and no domain copy.

- [ ] **Step 5: Replace overlay primitives one file at a time**

Implement in this order:
1. `dialog.tsx` using Kobalte Dialog; verify Escape close and focus trap.
2. `alert-dialog.tsx` using Kobalte Dialog; verify destructive confirm/cancel keyboard flow.
3. `dropdown-menu.tsx` using Kobalte DropdownMenu; verify arrow-key item movement and preserve `DropdownMenuLabel`.
4. `tooltip.tsx` using Kobalte Tooltip; verify hover and focus trigger.
5. `sheet.tsx` using Kobalte Dialog with side-position classes; verify mobile-style close.
6. `sonner.tsx`, `toaster.tsx`, and `stores/toast.store.ts` bridge using `solid-sonner`.

Toast bridge requirements:
- Existing call sites that import `toast` from `@/stores/toast.store` continue to work.
- `toast.success`, `toast.error`, `toast.info`, and `toast.warning` delegate to `solid-sonner`.
- `Toaster` renders once at the app root through the existing toaster import path until `AppShell` owns it.
- No page-level call site is changed in this chunk unless typecheck proves it is required.

- [ ] **Step 6: Add missing form/data primitives one file at a time**

Implement:
1. `label.tsx`
2. `select.tsx` with the exact exports from the primitive inventory table.
3. `checkbox.tsx` with `checked`, `onChange`, disabled, and `class` support.
4. `switch.tsx` with `checked`, `onChange`, disabled, and `class` support.
5. `separator.tsx` with horizontal/vertical orientation support.
6. `command.tsx` with the exact exports from the primitive inventory table.
7. `table.tsx` with the exact exports from the primitive inventory table.
8. `scroll-area.tsx` with `ScrollArea`.
9. `tabs.tsx` using Kobalte Tabs with the exact exports from the primitive inventory table.

Each file must be generic, export named components, accept `class`, and use `cn()`.

- [ ] **Step 7: Verify primitive layer**

Run: `bun run --filter @engram/web typecheck`
Expected: PASS, or only documented pre-existing failures.

Run: `bun run --filter @engram/web build`
Expected: PASS.

- [ ] **Step 8: Verify primitive interactions and theme manually**

Run: `bun run --filter @engram/web dev`
Expected manual checks:
- light and dark modes use neutral shadcn-style background/card/border/input/ring tokens.
- primary buttons no longer depend on pastel gradient styling.
- dialogs and sheets trap focus, close with Escape, and restore focus to trigger.
- dropdowns open by keyboard and arrow through items.
- tooltips show on hover and focus.
- toast/sonner renders one success and one error toast.
- select opens by keyboard, arrow keys move items, Enter selects, Escape closes.
- checkbox and switch toggle by click and Space.
- tabs move by click and keyboard focus; active tab is visible.
- command input accepts typing, shows empty state, and keyboard selection works.
- table preserves header/body/cell spacing in light and dark mode.
- scroll area scrolls with keyboard and pointer without hiding focus rings.
- all primitive focus states are visibly neutral ring-styled on desktop and mobile widths.

- [ ] **Step 9: Commit**

```bash
git add apps/web/package.json bun.lock apps/web/src/app.css \
  apps/web/src/components/ui/alert.tsx \
  apps/web/src/components/ui/badge.tsx \
  apps/web/src/components/ui/button.tsx \
  apps/web/src/components/ui/card.tsx \
  apps/web/src/components/ui/dialog.tsx \
  apps/web/src/components/ui/dropdown-menu.tsx \
  apps/web/src/components/ui/empty-state.tsx \
  apps/web/src/components/ui/input.tsx \
  apps/web/src/components/ui/progress.tsx \
  apps/web/src/components/ui/skeleton.tsx \
  apps/web/src/components/ui/tabs.tsx \
  apps/web/src/components/ui/textarea.tsx \
  apps/web/src/components/ui/tooltip.tsx \
  apps/web/src/components/ui/toaster.tsx \
  apps/web/src/stores/toast.store.ts \
  apps/web/src/components/ui/label.tsx \
  apps/web/src/components/ui/select.tsx \
  apps/web/src/components/ui/checkbox.tsx \
  apps/web/src/components/ui/switch.tsx \
  apps/web/src/components/ui/separator.tsx \
  apps/web/src/components/ui/sheet.tsx \
  apps/web/src/components/ui/alert-dialog.tsx \
  apps/web/src/components/ui/command.tsx \
  apps/web/src/components/ui/table.tsx \
  apps/web/src/components/ui/scroll-area.tsx \
  apps/web/src/components/ui/sonner.tsx
git commit -m "feat(web): add shadcn neutral ui foundation"
```

### Task 2: Smoke-test existing routes after primitive replacement

**Files:**
- No planned file changes. This is a verification-only task after Task 1.

- [ ] **Step 1: Run the app**

If API-backed dynamic routes need data, run the documented local stack first:

```bash
docker compose up -d
bun run db:migrate
bun run db:seed
```

Run: `bun run --filter @engram/web dev`
Expected: Vite starts.

Run in a second terminal: `bun run --filter @engram/api dev`
Expected: API starts on the configured local API port, default `http://localhost:3001`.

Create or locate smoke data before visiting dynamic routes:
- login as `test@example.com` / `password123`.
- if the account has no usable data, create a class named `Smoke Class`, folder `Smoke Folder`, deck `Smoke Deck` using the Basic Q&A system template, and one card with question/answer values.
- record the real `folderId` from `/folder/:folderId`, `deckId` from `/deck/:deckId`, and reuse that deck id for `/study/:deckId`.

- [ ] **Step 2: Verify route smoke behavior manually**

Expected:
- unauthenticated `/` redirects to `/login`.
- `/login` and `/register` render outside any new shell.
- `/reset-password?token=bad-token` renders invalid token state without crashing.
- `/verify-email?token=bad-token` renders invalid token state without crashing.
- route announcer still updates on navigation.
- app error boundary still catches a thrown route error. Concrete method: make a temporary uncommitted local edit to throw `new Error('smoke boundary')` inside `apps/web/src/pages/not-found.tsx`, visit an unknown route, verify the fallback, then undo the edit before Step 3.
- toaster still renders success/error toasts.
- login with seeded `test@example.com` / `password123` succeeds.
- authenticated `/` renders current dashboard content.
- create or use seeded class/folder/deck/card data so `/folder/:folderId`, `/deck/:deckId`, `/study/:deckId`, and `/study/interleaved` are all visited with real ids.
- authenticated `/settings`, `/feedback`, and `/docs` render.
- unknown route renders not found.

- [ ] **Step 3: Run typecheck**

Run: `git diff --exit-code apps/web/src/pages/not-found.tsx`
Expected: PASS, proving the temporary error-boundary edit was undone.

Run: `bun run --filter @engram/web typecheck`
Expected: PASS.

- [ ] **Step 4: Handle route-smoke failures**

This task is verification-only. If smoke fails, stop and create a small fix task that names the exact file(s) to change, reruns Step 2 and Step 3, and commits only those files. Do not make unplanned route fixes inside this verification task.


---

## Chunk 2: Experience API Contracts

### Task 3: Add shared experience types and aggregate envelope tests

**Files:**
- Create: `apps/api/src/modules/experience/experience.types.ts`
- Create: `apps/api/src/modules/experience/aggregate.helpers.ts`
- Create: `apps/api/src/modules/experience/experience.service.ts`
- Create: `apps/api/__tests__/modules/experience/experience.service.test.ts`

- [ ] **Step 1: Write type/shape tests for aggregate envelope helpers**

In `experience.service.test.ts`, add tests for:
- section status `ok`, `empty`, `error`.
- required section failure throws instead of returning fake zero data.
- optional section failure returns data with matching `meta.sections[key].status === 'error'`.

- [ ] **Step 2: Run the failing test**

Run: `cd apps/api && bun test __tests__/modules/experience/experience.service.test.ts`
Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement `experience.types.ts`**

Add the spec contracts:
- `SectionStatus`
- `AggregateResponse<TData>`
- `CommandActionRef`
- `CommandResult`
- `CommandCenterResponse`
- `StudyQueueQuery`
- `StudyQueueResponse`
- `CommandSearchQuery`
- `CommandSearchResponse`
- `LibraryExplorerResponse`
- `DeckWorkspaceQuery`
- `DeckWorkspaceResponse`
- `ManualCreatePayload`
- `AiPasteCreatePayload`
- `CsvCreatePayload`
- `JsonCreatePayload`
- `CreatePreviewRequest`
- `CreatePreviewRecord`
- `CreatePreviewResponse`
- `CreateCommitRequest`
- `CreateCommitResponse`
- `InsightsOverviewResponse`

`InsightsOverviewResponse.trends` success shape must be `{ reviewedThisWeek: number; retentionDelta: number | null }`. Optional trends-section failure uses `data.trends = null`.

- [ ] **Step 4: Add minimal aggregate helpers and barrel exports**

In `aggregate.helpers.ts`, export helpers:
- `okSection()`
- `emptySection()`
- `errorSection(message, retryable)`
- `aggregateResponse(data, sections)`

In `experience.service.ts`, re-export the helper module and later focused service modules only. Do not put endpoint aggregate implementation in this barrel.

- [ ] **Step 5: Run tests**

Run: `cd apps/api && bun test __tests__/modules/experience/experience.service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/experience apps/api/__tests__/modules/experience
git commit -m "feat(api): add experience aggregate contracts"
```

### Task 4: Implement command center, explorer, deck workspace, insights, and study queue services

**Files:**
- Create: `apps/api/src/modules/experience/command-center.service.ts`
- Create: `apps/api/src/modules/experience/library-explorer.service.ts`
- Create: `apps/api/src/modules/experience/deck-workspace.service.ts`
- Create: `apps/api/src/modules/experience/insights-overview.service.ts`
- Create: `apps/api/src/modules/experience/study-queue.service.ts`
- Modify: `apps/api/src/modules/experience/experience.service.ts`
- Create: `apps/api/src/modules/experience/experience.routes.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/__tests__/modules/experience/experience.service.test.ts`
- Test: `apps/api/__tests__/modules/experience/experience.routes.test.ts`
- Modify: `apps/api/__tests__/helpers/fixtures.ts`

- [ ] **Step 1: Add failing service tests**

Add tests for:
- `getCommandCenter(userId)` returns aggregate envelope and nullable `pendingSuggestions` on optional failure.
- `getCommandCenter(userId)` returns exact section keys: `reviewQueue`, `streak`, `dueDecks`, `recent`, `weakAreas`, `forecast`, `pendingSuggestions`, `notifications`.
- `getCommandCenter(userId)` returns empty arrays and `empty` section statuses for a new user with no decks/cards.
- `getLibraryExplorer(userId)` treats count failure as required failure.
- `getLibraryExplorer(userId)` returns exact section keys: `classes`, `recentDecks`.
- `getLibraryExplorer(userId)` returns `recentDeckIds: []` and `meta.sections.recentDecks.status === 'error'` when only recent-deck lookup fails.
- `getLibraryExplorer(userId)` returns empty classes with `classes: empty` for a new user.
- `getDeckWorkspace(userId, deckId, query)` returns paginated card data and nullable counters.
- `getDeckWorkspace(userId, deckId, query)` returns exact section keys: `deck`, `cards`, `study`, `analytics`, `counters`.
- `getDeckWorkspace(userId, missingDeckId, query)` rejects missing or unauthorized deck.
- `getInsightsOverview(userId)` returns aggregate envelope with stable section keys.
- `getInsightsOverview(userId)` returns exact section keys: `forecast`, `weakAreas`, `atRiskCards`, `heatmap`, `trends`.
- `getStudyQueue(userId, query)` rejects missing `deckId`, `folderId`, `classId`, or `smartGroupId` for scoped modes.
- `getStudyQueue(userId, query)` rejects nonexistent and unauthorized deck, folder, class, and smart-group scopes.
- `getStudyQueue(userId, query)` covers empty due, deck, folder, class, smart group, interleaved, and at-risk queues.
- `getStudyQueue(userId, query)` covers non-empty mixed queues and asserts card ordering, per-card `reason`, and summary counts across due/new/learning/at-risk/interleaved data.

Required/optional section matrix to assert in tests:

| Endpoint service | Section key | Required? | Failure behavior |
| --- | --- | --- | --- |
| `getCommandCenter` | `reviewQueue` | yes | throw; route returns `500 { error }` |
| `getCommandCenter` | `streak` | yes | throw; route returns `500 { error }` |
| `getCommandCenter` | `dueDecks` | yes | throw; route returns `500 { error }` |
| `getCommandCenter` | `recent` | no | `data.recent = { decks: [], cards: [] }`, `meta.sections.recent.status = 'error'` |
| `getCommandCenter` | `weakAreas` | no | `data.weakAreas = []`, `meta.sections.weakAreas.status = 'error'` |
| `getCommandCenter` | `forecast` | no | `data.forecast = null`, `meta.sections.forecast.status = 'error'` |
| `getCommandCenter` | `pendingSuggestions` | no | `data.pendingSuggestions = null`, `meta.sections.pendingSuggestions.status = 'error'` |
| `getCommandCenter` | `notifications` | no | `data.notifications = []`, `meta.sections.notifications.status = 'error'` |
| `getLibraryExplorer` | `classes` | yes | throw; route returns `500 { error }` |
| `getLibraryExplorer` | `recentDecks` | no | `data.recentDeckIds = []`, `meta.sections.recentDecks.status = 'error'` |
| `getDeckWorkspace` | `deck` | yes | missing/unauthorized route returns `404 { error: 'Deck not found' }` |
| `getDeckWorkspace` | `cards` | yes | throw; route returns `500 { error }` |
| `getDeckWorkspace` | `study` | no | `data.study = null`, `meta.sections.study.status = 'error'` |
| `getDeckWorkspace` | `analytics` | no | `data.analytics = null`, `meta.sections.analytics.status = 'error'` |
| `getDeckWorkspace` | `counters` | no | `data.counters = null`, `meta.sections.counters.status = 'error'` |
| `getInsightsOverview` | `forecast` | no | `data.forecast = null`, `meta.sections.forecast.status = 'error'` |
| `getInsightsOverview` | `weakAreas` | no | `data.weakAreas = []`, `meta.sections.weakAreas.status = 'error'` |
| `getInsightsOverview` | `atRiskCards` | no | `data.atRiskCards = []`, `meta.sections.atRiskCards.status = 'error'` |
| `getInsightsOverview` | `heatmap` | no | `data.heatmap = null`, `meta.sections.heatmap.status = 'error'` |
| `getInsightsOverview` | `trends` | no | `data.trends = null`, `meta.sections.trends.status = 'error'` |

Study queue validation matrix to assert:

| Mode | Required params | Missing behavior | Nonexistent/unauthorized behavior |
| --- | --- | --- | --- |
| `due` | none | not applicable | not applicable |
| `deck` | `deckId` | `422 { error: 'deckId is required' }` | `404 { error: 'Deck not found' }` |
| `folder` | `folderId` | `422 { error: 'folderId is required' }` | `404 { error: 'Folder not found' }` |
| `class` | `classId` | `422 { error: 'classId is required' }` | `404 { error: 'Class not found' }` |
| `smart-group` | `smartGroupId` | `422 { error: 'smartGroupId is required' }` | `404 { error: 'Smart group not found' }` |
| `interleaved` | none | not applicable | not applicable |
| `at-risk` | optional `deckId` | not applicable | invalid `deckId` returns `404 { error: 'Deck not found' }` |

- [ ] **Step 2: Run failing tests**

Run: `cd apps/api && bun test __tests__/modules/experience/experience.service.test.ts`
Expected: FAIL for missing functions.

- [ ] **Step 3: Implement focused services by composing existing modules**

Use existing services where possible:
- study forecast/recommendations/study service for review/forecast/smart groups.
- classes/folders/decks/cards services or direct DB queries consistent with existing service style.
- notifications service for notifications.
- duplicate/AI counters should be optional sections.

Put endpoint logic in the focused service files from this task's file list. Keep `experience.service.ts` as a barrel export only.

Update `apps/api/__tests__/helpers/fixtures.ts` with minimal experience fixtures for two users, at least one class, folder, deck, template, due card, new card, learning card, at-risk card, and recent deck/card timestamps. Use those fixtures for ownership and ranking tests instead of ad hoc test setup inside each test.

Do not duplicate SRS algorithms or card CRUD rules.

- [ ] **Step 4: Add failing route-level tests**

In `experience.routes.test.ts`, cover exact route status/body expectations before implementing routes:
- unauthenticated aggregate endpoints return `401` and `{ error: 'Unauthorized' }`.
- `GET /dashboard/command-center` success returns `200` with `{ data, meta: { sections } }` and exact command-center section keys.
- `GET /study/queue?mode=deck` without `deckId` returns `422 { error: 'deckId is required' }`.
- `GET /study/queue?mode=folder` without `folderId` returns `422 { error: 'folderId is required' }`.
- `GET /study/queue?mode=class` without `classId` returns `422 { error: 'classId is required' }`.
- `GET /study/queue?mode=smart-group` without `smartGroupId` returns `422 { error: 'smartGroupId is required' }`.
- `GET /study/queue?mode=deck&deckId=missing` returns `404 { error: 'Deck not found' }`; repeat with another user's deck id.
- `GET /study/queue?mode=folder&folderId=missing` returns `404 { error: 'Folder not found' }`.
- `GET /study/queue?mode=class&classId=missing` returns `404 { error: 'Class not found' }`; repeat with another user's class id.
- `GET /study/queue?mode=smart-group&smartGroupId=missing` returns `404 { error: 'Smart group not found' }`; repeat with another user's smart group id if smart groups are persisted, otherwise assert generated smart-group ownership through its source deck/folder.
- `GET /study/queue?mode=at-risk&deckId=missing` returns `404 { error: 'Deck not found' }`.
- `GET /library/explorer` success returns `200` with `data.classes` and `meta.sections.classes`.
- `GET /decks/:id/workspace` missing/unauthorized deck returns `404 { error: 'Deck not found' }`.
- `GET /decks/:id/workspace` success returns `200` with exact deck workspace section keys.
- `GET /insights/overview` success returns `200` with exact insights section keys.
- injected required service failure returns `500 { error: string }` and never a partial aggregate envelope.

Run: `cd apps/api && bun test __tests__/modules/experience/experience.routes.test.ts`
Expected: FAIL because routes are not mounted yet.

- [ ] **Step 5: Add Elysia routes**

Create authenticated routes:
- `GET /dashboard/command-center`
- `GET /study/queue`
- `GET /library/explorer`
- `GET /decks/:id/workspace`
- `GET /insights/overview`

Mount in `apps/api/src/index.ts` using `.use(experienceRoutes)`.

- [ ] **Step 6: Run targeted tests**

Run: `cd apps/api && bun test __tests__/modules/experience/experience.service.test.ts __tests__/modules/experience/experience.routes.test.ts`
Expected: PASS.

- [ ] **Step 7: Run broader API tests**

Run: `cd apps/api && bun test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/experience apps/api/src/index.ts apps/api/__tests__/modules/experience/experience.service.test.ts apps/api/__tests__/modules/experience/experience.routes.test.ts apps/api/__tests__/helpers/fixtures.ts
git commit -m "feat(api): add command center aggregate endpoints"
```

### Task 5: Implement command search and create preview/commit contracts

**Files:**
- Create: `apps/api/src/modules/experience/command-search.service.ts`
- Create: `apps/api/src/modules/experience/create-preview.service.ts`
- Modify: `apps/api/src/modules/experience/experience.routes.ts`
- Test: `apps/api/__tests__/modules/experience/command-search.service.test.ts`
- Test: `apps/api/__tests__/modules/experience/create-preview.service.test.ts`
- Test: `apps/api/__tests__/modules/experience/experience.routes.test.ts`
- Modify: `apps/api/__tests__/helpers/fixtures.ts`

- [ ] **Step 1: Add failing command search tests**

Cover:
- exact title ranking before fuzzy matches.
- recently opened decks/cards rank before older equally-matching decks/cards.
- entity matches rank before docs/settings results for non-action queries.
- route-aware actions before global actions.
- scope filtering limits deck/card results to the requested class/folder/deck scope.
- default limit is applied when `limit` is omitted.
- disabled action includes disabled reason.
- query limit max 30 total and 8 per group.

- [ ] **Step 2: Add failing create preview tests**

Cover:
- manual payload validation.
- AI paste size/requested count limits.
- CSV/JSON size and row limits.
- preview record stores normalized card fields and duplicate candidates.
- merge fill-only semantics.
- required `idempotencyKey` validation.
- idempotent commit replay returns the original success result before and after preview expiry when the first commit already succeeded.
- same key different payload returns conflict error.
- same preview with different key after success returns conflict error.
- target deck ownership failure returns `{ error: 'Deck not found' }`.
- invalid template for target deck returns `{ error: 'Template not valid for target deck' }`.
- commit rejects missing required fields that were not normalized into the stored preview.
- expired preview returns `{ error: 'Preview expired' }`.
- expired preview without a matching successful idempotency replay returns `{ error: 'Preview expired' }`.
- commit with unknown `clientId` returns `{ error: 'Unknown preview record' }`.
- merge resolution without `mergeTargetCardId` returns `{ error: 'Merge target is required' }`.
- invalid merge target returns `{ error: 'Merge target not found' }`.
- unauthorized merge target returns `{ error: 'Merge target not found' }`.
- same-user `mergeTargetCardId` from a different deck is rejected with `{ error: 'Merge target not found' }`.
- merge conflict reports the conflicting field names.
- trimmed equal-value merge is a no-op, not a conflict.
- omitted commit fields use stored preview fields instead of trusting client resubmission.

- [ ] **Step 3: Run failing tests**

Run:
```bash
cd apps/api
bun test __tests__/modules/experience/command-search.service.test.ts __tests__/modules/experience/create-preview.service.test.ts
```
Expected: FAIL for missing modules/functions.

- [ ] **Step 4: Implement command search service**

Search cards, decks, folders, classes, docs/settings/action definitions. Return `CommandSearchResponse` with grouped results. Keep action execution frontend-local; API search only returns `CommandActionRef`.

- [ ] **Step 5: Implement create preview service**

Implement in-memory preview store first if no persistence table exists. Store:
- preview id
- user id
- target deck/template
- request fingerprint
- normalized cards
- duplicate candidates
- default resolutions
- expiresAt
- consumed/idempotency records

- [ ] **Step 6: Implement commit semantics**

Implement create/skip/merge rules exactly from the spec. Merge is fill-only and preserves study progress, links, concepts, and review logs.

- [ ] **Step 7: Add failing command/create route-level tests**

Extend `experience.routes.test.ts` before implementing routes:
- unauthenticated `GET /command/search`, `POST /create/preview`, and `POST /create/commit` return `401 { error: 'Unauthorized' }`.
- authenticated `GET /command/search?q=deck&limit=10` returns `200` with grouped `CommandSearchResponse`.
- `GET /command/search?q=&limit=10` returns `422 { error: 'Query is required' }`.
- `GET /command/search?q=deck&limit=100` returns `422 { error: 'Limit must be between 1 and 30' }`.
- authenticated `POST /create/preview` returns `200` with `previewId`, `expiresAt`, `cards`, `duplicateCandidates`, and `summary`.
- oversized AI/CSV/JSON preview payloads return `413 { error: string }`.
- missing or invalid create/commit payload fields return `422 { error: string }`.
- authenticated `POST /create/commit` returns `200` with `createdCardIds`, `skippedClientIds`, and `mergedCardIds`.
- expired preview, idempotency conflict, unknown `clientId`, invalid merge target, and merge conflict return `409 { error: string }`.
- missing `mergeTargetCardId` returns `422 { error: 'Merge target is required' }`.

Run: `cd apps/api && bun test __tests__/modules/experience/experience.routes.test.ts`
Expected: FAIL because command/create routes are not mounted yet.

- [ ] **Step 8: Add routes**

Add:
- `GET /command/search`
- `POST /create/preview`
- `POST /create/commit`

- [ ] **Step 9: Run tests**

Run:
```bash
cd apps/api
bun test __tests__/modules/experience/command-search.service.test.ts __tests__/modules/experience/create-preview.service.test.ts __tests__/modules/experience/experience.routes.test.ts
bun test
```
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/experience apps/api/__tests__/modules/experience apps/api/__tests__/helpers/fixtures.ts
git commit -m "feat(api): add command search and create preview"
```

---

## Chunk 3: App Shell, Command Actions, and Explorer

### Task 6: Add frontend experience API wrappers and command action registry

**Files:**
- Create: `apps/web/src/lib/experience-api.ts`
- Create: `apps/web/src/lib/command-actions.ts`
- Create: `apps/web/src/components/app-shell/types.ts`

- [ ] **Step 1: Define frontend types matching backend contracts**

Create local types or import inferred Eden types if available. Keep the same names as backend contract shapes for readability.

In `apps/web/src/components/app-shell/types.ts`, define:

```ts
import type { JSX, Accessor } from 'solid-js';

export type ContextPanelDescriptor = {
  id: string;
  title: string;
  content: () => JSX.Element;
  actions?: CommandActionRef[];
  empty?: boolean;
};

export type AppShellContextValue = {
  setContextPanel: (descriptor: ContextPanelDescriptor | null) => void;
  contextPanel: Accessor<ContextPanelDescriptor | null>;
  openContextPanel: () => void;
  closeContextPanel: () => void;
  actionContext: Accessor<CommandActionContext>;
  setActionContext: (patch: Partial<CommandActionContext>) => void;
  clearActionContext: (keys?: Array<keyof CommandActionContext>) => void;
};
```

Also define frontend copies of these command/action types from the spec:

```ts
export type CommandActionRef = {
  id: string;
  label: string;
  params?: Record<string, string | number | boolean | null>;
};

export type CommandActionContext = {
  route: string;
  currentUserId: string;
  selectedDeckId?: string;
  selectedCardId?: string;
  selectedFolderId?: string;
  selectedClassId?: string;
};

export type CommandActionResult =
  | { status: 'success'; message?: string; navigateTo?: string; invalidate?: QueryInvalidationKey[] }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> }
  | { status: 'confirm'; title: string; description: string; confirmLabel: string; destructive?: boolean; onConfirmAction: CommandActionRef };

export type CommandActionDefinition<TParams extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  label: string;
  keywords: string[];
  requiredParams: Array<keyof TParams>;
  validateParams: (params: Record<string, unknown>, context: CommandActionContext) => TParams | CommandActionResult;
  run: (params: TParams, context: CommandActionContext) => Promise<CommandActionResult> | CommandActionResult;
};

export type QueryInvalidationKey =
  | 'command-center'
  | 'library-explorer'
  | 'study-queue'
  | 'deck-workspace'
  | 'insights-overview'
  | 'command-search';
```

Also define `AggregateResponse<TData>` and query key names from the spec.

- [ ] **Step 2: Implement API wrapper functions**

Add functions:
- `getCommandCenter()`
- `getLibraryExplorer()`
- `getStudyQueue(query)`
- `searchCommands(query)`
- `getDeckWorkspace(deckId, query)`
- `createPreview(request)`
- `createCommit(request)`
- `getInsightsOverview()`

Wrapper requirements:
- unwrap direct responses unchanged.
- return aggregate envelopes with `data` and `meta.sections` intact.
- normalize `{ error: string }` failures into thrown `Error` objects with the server message.
- expose query-key helpers for `command-center`, `library-explorer`, `command-search`, `study-queue`, `deck-workspace`, and `insights-overview`.

- [ ] **Step 3: Implement command registry**

Add registry for initial action IDs from spec. Each action validates params and returns `success`, `error`, or `confirm`. Map invalidation keys to TanStack Query keys.

Initial registry actions are exactly:

| Action id | Required params | Behavior | Invalidation |
| --- | --- | --- | --- |
| `navigate.home` | none | Navigate to `/`. | none |
| `navigate.study` | optional `mode`, `deckId` | Navigate/open Study workspace. | none |
| `navigate.library` | optional `classId`, `folderId`, `deckId`, `view` | Navigate/open Library scope. | none |
| `navigate.create` | optional `targetDeckId`, `source` | Navigate/open Create workspace. | none |
| `navigate.insights` | none | Navigate to Insights. | none |
| `study.startQueue` | `mode`; optional scope id | Start a queue using `/study/queue`. | `study-queue`, `command-center` |
| `deck.create` | `folderId`, `name`, `templateId` | Create deck after validation; map action `templateId` to the existing deck API `cardTemplateId` field. | `library-explorer`, `command-center` |
| `deck.delete.confirm` | `deckId` | Return confirmation result only. | none |
| `deck.delete` | `deckId` | Delete deck after confirmation. | `library-explorer`, `command-center` |
| `card.createManual` | `deckId`, `templateId` | Open manual create form. | none |
| `create.openAiPaste` | optional `targetDeckId` | Open AI paste create flow. | none |
| `create.importCsv` | optional `targetDeckId` | Open CSV import flow. | none |
| `insight.studyAtRisk` | optional `deckId` or `groupId` | If `deckId` exists, navigate to `/study?mode=at-risk&deckId=...`; if `groupId` exists, navigate to `/study?mode=smart-group&smartGroupId=...`. | `study-queue`, `command-center` |
| `settings.open` | optional `section` | Navigate/open Settings section. | none |

Explorer-only rename/reorder actions are not part of this registry in this chunk; they remain local explorer mutations unless a later spec update adds registry IDs.

- [ ] **Step 4: Verify**

Run: `bun run --filter @engram/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/experience-api.ts apps/web/src/lib/command-actions.ts apps/web/src/components/app-shell/types.ts
git commit -m "feat(web): add experience api and command actions"
```

### Task 7: Build AppShell, command bar, task rail, context panel, and mobile nav

**Files:**
- Create: `apps/web/src/components/app-shell/app-shell.tsx`
- Create: `apps/web/src/components/app-shell/task-rail.tsx`
- Create: `apps/web/src/components/app-shell/command-bar.tsx`
- Create: `apps/web/src/components/app-shell/context-panel.tsx`
- Create: `apps/web/src/components/app-shell/mobile-bottom-nav.tsx`
- Modify: `apps/web/src/components/layout/page-shell.tsx`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Build shell layout without changing page content**

`AppShell` owns:
- desktop grid
- explorer slot
- main slot
- context panel slot
- mobile bottom nav
- sheet open/collapse state
- desktop explorer collapse state and width resize handle.
- desktop context panel collapse state and width resize handle.
- width persistence keys: `engram.shell.explorerWidth`, `engram.shell.contextWidth`, `engram.shell.explorerCollapsed`, `engram.shell.contextCollapsed`.
- width bounds: explorer `240px` to `420px`; context panel `280px` to `460px`.
- `AppShellContext.Provider` with `setContextPanel`, `contextPanel`, `openContextPanel`, `closeContextPanel`, `actionContext`, `setActionContext`, and `clearActionContext`.
- `useRegisterContextPanel(descriptorAccessor)` helper that route pages can call in `createEffect` and clean up on route change.
- `useRegisterActionContext(contextAccessor, keys)` helper that route pages and explorer selections can call in `createEffect` to publish selected deck/card/folder/class ids for command actions.
- `useRegisterActionContext` cleanup clears only the keys it registered when the route, selected entity, or component owner changes, so command actions never receive stale selected ids.

- [ ] **Step 2: Implement task rail**

Add Home, Study, Library, Create, Insights, Settings. Use lucide icons and accessible labels/tooltips.

- [ ] **Step 3: Implement command bar**

Use `Command` primitive and command search wrapper.

Required behavior:
- Cmd+K and Ctrl+K open the command menu.
- On mobile, command menu opens full-screen.
- Search passes `q`, `currentRoute`, and optional scope to `searchCommands()`.
- Action dispatch receives `actionContext()` merged with the current route and current user id.
- Results show groups, subtitles, disabled reasons, and keyboard active state.
- Selecting a result with `href` navigates.
- Selecting a result with `action` dispatches through `command-actions.ts`.
- `confirm` action results open `AlertDialog`; confirm dispatches `onConfirmAction`.
- Pending action disables repeated submission for the same action/params.
- On mobile, successful navigation or action navigation closes the command menu, explorer sheet, and context sheet unless the result explicitly opens a detail/context panel.
- After menu/sheet close, focus returns to the command trigger or the control that opened the sheet.

- [ ] **Step 4: Implement context panel host**

Render `contextPanel()` from `AppShellContextValue`. Route pages register descriptors through `useRegisterContextPanel`. The host must not refetch route aggregate data; panel content receives data through the descriptor closure from the workspace that already owns the query.

Route changes clear the descriptor before the next route registers one. If no route-specific descriptor is registered, render a default panel with review queue/action suggestions.

If `descriptor.actions` exists, render those actions as buttons/list items in the panel footer and dispatch them through `command-actions.ts`. Handle `success`, `error`, and `confirm` results exactly like `CommandBar`.

Use one shared command-result handler for `CommandBar` and `ContextPanel` so confirmation, toast messages, query invalidation, pending state, mobile sheet close behavior, and focus restoration cannot drift.

- [ ] **Step 5: Wrap protected routes**

Modify `apps/web/src/app.tsx` so protected route pages render inside `AppShell`. Keep guest routes outside shell. Preserve `RouteAnnouncer`, `AppErrorBoundary`, and lazy `FocusDrawer`.

Modify `apps/web/src/components/layout/page-shell.tsx` so it no longer renders old `Sidebar` or old `MobileNav` when protected routes are inside `AppShell`. It should become a content-only compatibility wrapper preserving `maxWidth`, `noScroll`, `id="main-content"` semantics, and spacing until individual pages are redesigned. Do not delete `components/layout/sidebar.tsx` or `components/layout/mobile-nav.tsx` in this task; leave unused cleanup for a later explicit removal.

Remove the lazy `GlobalSearch` mount from `app.tsx` after `CommandBar` owns Cmd/Ctrl+K. Verify there is only one command/search keyboard handler.

- [ ] **Step 6: Verify responsive and command behavior manually**

Run: `bun run --filter @engram/web dev`
Expected manual checks:
- desktop `>=1280px`: command bar, task rail, explorer slot, main, and context panel are visible.
- tablet `768px - 1279px`: explorer and context panel collapse to triggers/sheets.
- mobile `<768px`: bottom nav is visible and command menu opens full-screen.
- desktop explorer and context panel can be collapsed and resized by pointer.
- resize handles clamp to the configured min/max widths.
- resize handles have keyboard-accessible controls or adjacent collapse buttons with labels/tooltips.
- collapsed desktop state persists across route changes.
- tablet/mobile explorer and context sheets trap focus, close with Escape, and open/close by keyboard and pointer.
- mobile command/context/explorer sheets close after navigation actions and restore focus to their trigger.
- Cmd+K and Ctrl+K open one command menu.
- disabled command result cannot execute and shows reason.
- confirm result opens `AlertDialog`; cancel closes; confirm dispatches action.
- navigate action changes routes.
- success action shows message and invalidates mapped query keys.
- error action displays compact error.
- guest routes remain unshelled.

- [ ] **Step 7: Verify build**

Run:
```bash
bun run --filter @engram/web typecheck
bun run --filter @engram/web build
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/app-shell apps/web/src/components/layout/page-shell.tsx apps/web/src/app.tsx
git commit -m "feat(web): add command center app shell"
```

### Task 8: Build LibraryExplorer against aggregate API

**Files:**
- Create: `apps/web/src/components/app-shell/library-explorer.tsx`
- Modify: `apps/web/src/components/app-shell/app-shell.tsx`

- [ ] **Step 1: Render explorer tree**

Use `getLibraryExplorer()` query. Render classes, folders, decks, counts, due counts, and recent markers.

- [ ] **Step 2: Add actions**

Wire actions as follows:
- `deck.create`, `navigate.create`, and `create.importCsv` use the command action registry.
- `deck.create` is dispatched only after a local create-deck dialog collects `folderId`, `name`, and `templateId`; template options come from existing template data used by current folder create-deck flow; validation blocks submit until all required params are present.
- empty-state "Generate" uses `create.openAiPaste`.
- rename class/folder/deck uses local explorer mutation and invalidates `library-explorer`.
- reorder class/folder uses existing local explorer mutation with optimistic update and rollback on error.
- deck reorder is not implemented in this chunk because decks do not have a current reorder endpoint or explorer order contract; card reorder remains in the deck workspace.
- delete deck may use `deck.delete.confirm` / `deck.delete`; delete class/folder uses local alert dialog until registry IDs are added.
- explorer selection calls `useRegisterActionContext` with the selected `classId`, `folderId`, or `deckId`.

- [ ] **Step 3: Add loading, empty, and error states**

Use skeletons for loading. Empty explorer offers create/import/generate actions. Error state offers retry.

- [ ] **Step 4: Verify explorer behavior**

Manual expected:
- loading skeleton renders before data.
- empty state offers create/import/generate.
- required explorer error shows route-level retry.
- optional `recentDeckIds` failure shows no fake recent marker.
- rename/reorder/delete mutations update explorer or show rollback/error.
- explorer sheet opens/closes on tablet/mobile.

- [ ] **Step 5: Verify build**

Run:
```bash
bun run --filter @engram/web typecheck
bun run --filter @engram/web build
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/app-shell/library-explorer.tsx apps/web/src/components/app-shell/app-shell.tsx
git commit -m "feat(web): add aggregate library explorer"
```

---

## Chunk 4: Core Workspaces

### Task 9: Implement Home / Command Center

**Files:**
- Create: `apps/web/src/pages/home-command-center.tsx`
- Create: `apps/web/src/pages/home/review-queue-card.tsx`
- Create: `apps/web/src/pages/home/due-decks-table.tsx`
- Create: `apps/web/src/pages/home/recent-work-list.tsx`
- Create: `apps/web/src/pages/home/insight-preview-card.tsx`
- Create: `apps/web/src/pages/home/home-context-panel.tsx`
- Modify: `apps/web/src/pages/dashboard.tsx`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Replace dashboard content with Home workspace**

Use `createQuery` with `getCommandCenter()` and cache key `['command-center']`.

Component structure:
- `HomeCommandCenterPage`: owns query, page header, primary actions, and context panel registration.
- `ReviewQueueCard`: renders due/new/learning/at-risk counts and actions `study.startQueue` for due and interleaved review.
- `DueDecksTable`: renders due decks and start-deck-study action.
- `RecentWorkList`: renders recent decks/cards and resume links.
- `InsightPreviewCard`: renders weak areas, forecast, streak/activity summary, pending suggestions, and notifications.
- `HomeContextPanel`: renders review queue, next actions, notifications, and recent work using the already-loaded query data.

Required primary actions:
- start due review: dispatch `study.startQueue` with `{ mode: 'due' }`.
- start interleaved review: dispatch `study.startQueue` with `{ mode: 'interleaved' }`.
- create cards: dispatch `navigate.create` with `{ source: 'manual' }`.
- generate cards: dispatch `create.openAiPaste` with optional `targetDeckId` when launched from a deck-specific row.
- import content: dispatch `create.importCsv` for CSV and `navigate.create` with `{ source: 'json' }` for JSON.
- open weak area: dispatch `weakArea.action` from the API response; if only an id is available, map it to `insight.studyAtRisk` with `groupId`.
- resume recent deck: navigate by href to `/deck/:deckId`; resume recent card uses `/deck/:deckId?cardId=:cardId`.

Required content:
- review queue summary.
- streak/activity summary.
- due decks.
- recent decks/cards.
- weak areas.
- forecast preview.
- pending suggestions.
- notifications.

- [ ] **Step 2: Add context panel descriptor**

Register:

```ts
useRegisterContextPanel(() => ({
  id: 'home',
  title: 'Next actions',
  content: () => <HomeContextPanel data={commandCenterQuery.data} />,
}));
```

- [ ] **Step 3: Add states**

Add loading skeletons, actionable empty states, optional section errors from `meta.sections`, and route-level error for required data.

- [ ] **Step 4: Verify Home manually**

Expected:
- due review and interleaved review actions dispatch through the registry.
- create cards action opens manual Create flow.
- generate cards action opens AI paste Create flow.
- import content action opens CSV/JSON Create flow.
- resume recent deck navigates to the correct deck workspace.
- weak area action dispatches `insight.studyAtRisk`.
- `pendingSuggestions === null` renders unavailable state, not zero.
- `meta.sections.notifications.status === 'empty'` renders a quiet empty notification state.

- [ ] **Step 5: Verify build**

Run:
```bash
bun run --filter @engram/web typecheck
bun run --filter @engram/web build
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/home-command-center.tsx apps/web/src/pages/home apps/web/src/pages/dashboard.tsx apps/web/src/app.tsx
git commit -m "feat(web): redesign home command center"
```

### Task 10: Implement Study workspace

**Files:**
- Create: `apps/web/src/pages/study/study-workspace.tsx`
- Create: `apps/web/src/pages/study/study-session.tsx`
- Create: `apps/web/src/pages/study/study-queue-picker.tsx`
- Create: `apps/web/src/pages/study/study-context-panel.tsx`
- Modify: `apps/web/src/pages/study-mode.tsx`
- Modify: `apps/web/src/pages/interleaved-study.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/components/flashcard/flashcard.tsx`
- Modify: `apps/web/src/components/flashcard/study-controls.tsx`
- Modify: `apps/web/src/components/focus/focus-drawer.tsx`
- Modify: `apps/web/src/lib/command-actions.ts`

- [ ] **Step 1: Add queue entry UI**

`StudyWorkspace` owns queue query state:

```ts
type StudyQueueSelection =
  | { mode: 'due' }
  | { mode: 'deck'; deckId: string }
  | { mode: 'folder'; folderId: string }
  | { mode: 'class'; classId: string }
  | { mode: 'smart-group'; smartGroupId: string }
  | { mode: 'interleaved' }
  | { mode: 'at-risk'; deckId?: string };
```

`StudyQueuePicker` renders all modes and calls `getStudyQueue(selection)`.

Route/query contract:
- canonical route is `/study`.
- query params: `mode=due|deck|folder|class|smart-group|interleaved|at-risk`, plus `deckId`, `folderId`, `classId`, or `smartGroupId` when required by the mode.
- `insight.studyAtRisk({ groupId })` maps to `mode=smart-group&smartGroupId=groupId`; `insight.studyAtRisk({ deckId })` maps to `mode=at-risk&deckId=deckId`.
- `/study/:deckId` remains route-compatible by rendering `StudyWorkspace` with `{ mode: 'deck', deckId }`.
- `/study/interleaved` remains route-compatible by rendering `StudyWorkspace` with `{ mode: 'interleaved' }`.
- route matching must define `/study/interleaved` before `/study/:deckId` so `interleaved` is never treated as a deck id.
- `navigate.study` and `study.startQueue` build this canonical route instead of inventing another study URL shape.

- [ ] **Step 2: Preserve card review behavior**

Keep existing flip/rating shortcuts:
- `Space` flips.
- `1` Again.
- `2` Hard.
- `3` Good.
- `4` Easy.

Keep existing study review mutation behavior and SRS engine outputs. Do not rewrite FSRS/SM-2 rules.

- [ ] **Step 3: Add Study context panel**

`StudyContextPanel` receives current queue/card from `StudyWorkspace` state and shows queue, card context, related cards, shortcuts, and SRS metadata without refetching the queue aggregate.

- [ ] **Step 4: Integrate FocusDrawer**

Add action id `study.openFocus` to `apps/web/src/lib/command-actions.ts`:
- Required params: none.
- Behavior: open the existing `FocusDrawer` from Study without starting a queue.
- Invalidation: none.

Add a Study button and Study context-panel action that dispatch `study.openFocus`. Keep FocusDrawer lazy mounted so Three.js reward code is not loaded on initial shell render. Do not add backend command-search metadata in this task; Task 15 performs the metadata sweep for docs/help/feedback and route-limited utility actions.

- [ ] **Step 5: Verify Study manually**

Expected:
- due, deck, folder, class, smart group, interleaved, and at-risk queues load or show empty states.
- `/study/:deckId` opens deck queue.
- `/study/interleaved` opens interleaved queue.
- `Space`, `1`, `2`, `3`, `4` still work.
- rating a card still calls the existing review mutation and advances the queue.
- FocusDrawer opens from Study/command action and Three.js code remains lazy-loaded until needed.

- [ ] **Step 6: Verify build**

Run:
```bash
bun run --filter @engram/web typecheck
bun run --filter @engram/web build
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/study apps/web/src/pages/study-mode.tsx apps/web/src/pages/interleaved-study.tsx apps/web/src/app.tsx apps/web/src/components/flashcard apps/web/src/components/focus/focus-drawer.tsx apps/web/src/lib/command-actions.ts
git commit -m "feat(web): redesign study workspace"
```

### Task 11: Implement Library workspace

**Files:**
- Create: `apps/web/src/pages/library/library-workspace.tsx`
- Create: `apps/web/src/pages/library/library-toolbar.tsx`
- Create: `apps/web/src/pages/library/library-table.tsx`
- Create: `apps/web/src/pages/library/library-context-panel.tsx`
- Modify: `apps/web/src/pages/folder-view.tsx`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Implement Library scoped views and route compatibility**

Support class, folder, deck, and card-list states. Include neutral card/table hybrid styling.

Route/query contract:
- canonical route is `/library`.
- query params: `classId`, `folderId`, `deckId`, `view=classes|folders|decks|cards`.
- `/folder/:folderId` remains route-compatible by rendering `LibraryWorkspace` with folder scope.
- `navigate.library` builds `/library` with the appropriate query params.

Data-source contract:
- class/folder/deck tree and counts use `getLibraryExplorer()` with cache key `['library-explorer']`.
- folder and class scoped lists derive from the explorer response first; if the existing endpoint has fresher folder detail behavior, use that endpoint and invalidate `['library-explorer']` after mutations.
- deck/card-list state uses `getDeckWorkspace(deckId, { cardPage, cardPageSize, cardSearch, sort })` with cache key `['deck-workspace', deckId, cardPage, cardPageSize, cardSearch, sort]`.
- required explorer errors show a route-level retry; optional recent-deck errors hide recent markers instead of fabricating data.

- [ ] **Step 2: Implement Library toolbar**

Toolbar supports filter, sort, create, import, export, and bulk actions. Destructive actions use `AlertDialog`. Preserve existing CSV/JSON export reachability where current backend endpoints support it.

- [ ] **Step 3: Preserve existing folder actions**

Preserve create deck, search/filter, delete deck, and template selection from current `folder-view.tsx`. Verify create-deck still allows selecting the template before submit.

- [ ] **Step 4: Add Library context panel**

Show selected class/folder/deck summary, create/import actions, filters, and empty-state recommendations.

- [ ] **Step 5: Verify Library manually**

Expected:
- class, folder, deck, and card-list states render.
- folder route still works.
- filter/sort/create/import/bulk toolbar works.
- CSV/JSON export remains reachable from scoped Library views.
- create deck template selection still works.
- empty library offers create/import/generate actions.
- destructive actions require confirmation.

- [ ] **Step 6: Verify build**

Run:
```bash
bun run --filter @engram/web typecheck
bun run --filter @engram/web build
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/library apps/web/src/pages/folder-view.tsx apps/web/src/app.tsx
git commit -m "feat(web): redesign library workspace"
```

### Task 12: Implement Deck/Card workspace

**Files:**
- Create: `apps/web/src/pages/deck-workspace/deck-workspace-page.tsx`
- Create: `apps/web/src/pages/deck-workspace/deck-tabs.tsx`
- Create: `apps/web/src/pages/deck-workspace/card-editor-drawer.tsx`
- Create: `apps/web/src/pages/deck-workspace/deck-context-panel.tsx`
- Modify: `apps/web/src/pages/deck-view/index.tsx`
- Modify: `apps/web/src/pages/deck-view/deck-view-page.tsx`
- Modify: `apps/web/src/pages/deck-view/card-item.tsx`
- Modify: `apps/web/src/pages/deck-view/add-card-form.tsx`
- Modify: `apps/web/src/pages/deck-view/edit-card-form.tsx`
- Modify: `apps/web/src/pages/deck-view/bulk-actions-bar.tsx`
- Modify: `apps/web/src/components/deck-view/graph-view.tsx`
- Modify: `apps/web/src/components/deck-view/retention-heatmap.tsx`
- Modify: `apps/web/src/components/deck-view/duplicate-scanner.tsx`
- Modify: `apps/web/src/components/deck-view/ai-suggestions.tsx`

- [ ] **Step 1: Implement Deck workspace query**

Use `getDeckWorkspace(deckId, query)` with cache key `['deck-workspace', deckId, cardPage, cardPageSize, cardSearch, sort]`.

Route/query contract:
- `/deck/:deckId` renders the workspace normally.
- optional `cardId` query selects the matching card, opens or scrolls to it in the Cards tab, and publishes `selectedCardId` via `useRegisterActionContext`.
- if `cardId` does not exist in the current page, fetch/search enough data to show a not-found selected-card state without crashing.

- [ ] **Step 2: Implement tabs**

Tabs: Cards, Study, Graph, Duplicates, AI Suggestions, Analytics. Cards tab is default.

- [ ] **Step 3: Move card create/edit into drawer**

`CardEditorDrawer` handles create and edit. The old inline add/edit forms become drawer content or thin wrappers.

- [ ] **Step 4: Lazy-load heavy tab content**

Graph, retention heatmap, duplicate scanner, and AI suggestions must load only when their tab opens. Use Solid `lazy()` or dynamic conditional imports.

- [ ] **Step 5: Add Deck context panel**

Show deck actions, selected card metadata, duplicate/AI/graph counters, and contextual study action. If `counters === null`, show unavailable state instead of zero.

- [ ] **Step 6: Verify Deck manually**

Expected:
- `/deck/:deckId` renders deck workspace.
- card create/edit opens drawer/dialog.
- bulk actions still work.
- Graph/heatmap/duplicates/AI tabs are not loaded until opened.
- counters unavailable state handles `null`.

- [ ] **Step 7: Verify build**

Run:
```bash
bun run --filter @engram/web typecheck
bun run --filter @engram/web build
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/deck-workspace apps/web/src/pages/deck-view/index.tsx apps/web/src/pages/deck-view/deck-view-page.tsx apps/web/src/pages/deck-view/card-item.tsx apps/web/src/pages/deck-view/add-card-form.tsx apps/web/src/pages/deck-view/edit-card-form.tsx apps/web/src/pages/deck-view/bulk-actions-bar.tsx apps/web/src/components/deck-view/graph-view.tsx apps/web/src/components/deck-view/retention-heatmap.tsx apps/web/src/components/deck-view/duplicate-scanner.tsx apps/web/src/components/deck-view/ai-suggestions.tsx
git commit -m "feat(web): redesign deck workspace"
```

### Task 13: Implement Create workspace

**Files:**
- Create: `apps/web/src/pages/create/create-workspace.tsx`
- Create: `apps/web/src/pages/create/create-source-selector.tsx`
- Create: `apps/web/src/pages/create/create-preview-table.tsx`
- Create: `apps/web/src/pages/create/create-context-panel.tsx`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Build Create source selector**

Add `/create` route. Sources: manual, AI paste, CSV, JSON, and template-based manual creation. Use target deck/template selection and `createPreview()`.

Route/query contract:
- `/create` defaults to manual source.
- `source=manual|ai-paste|csv|json` preselects the source.
- `targetDeckId` preselects the deck when the user owns it; invalid or unauthorized target decks show a recoverable target-selection error.

- [ ] **Step 2: Build preview/review table**

Show validation errors, CSV/JSON field mapping, duplicate candidates, merge target selector, resolution select create/skip/merge, and commit readiness.

- [ ] **Step 3: Build commit flow**

Call `createCommit()` with idempotency key. Handle success, expired preview, idempotency conflicts, merge conflicts, and validation errors.

On successful commit, invalidate `deck-workspace`, `library-explorer`, `command-center`, `insights-overview`, and `command-search` query keys through the helpers from `experience-api.ts`.

- [ ] **Step 4: Add Create context panel**

Show preview summary, invalid rows, duplicate count, selected target deck/template, and commit readiness.

- [ ] **Step 5: Verify Create manually**

Expected:
- `/create` route renders.
- manual, AI paste, CSV, JSON, and template-based source paths can produce preview or validation errors.
- duplicate merge target can be selected.
- merge resolution without `mergeTargetCardId` shows a validation error before commit.
- invalid or unauthorized merge target shows a conflict/error state.
- merge target must belong to the same target deck.
- fill-only merge never overwrites existing non-empty target fields.
- equal-after-trim values are treated as no-op, not conflict.
- omitted fields use stored preview values.
- idempotent replay after preview expiry returns the original successful result.
- commit handles success, expired preview, idempotency conflict, and merge conflict.

- [ ] **Step 6: Verify build**

Run:
```bash
bun run --filter @engram/web typecheck
bun run --filter @engram/web build
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/create apps/web/src/app.tsx
git commit -m "feat(web): add create workspace"
```

### Task 14: Implement Insights workspace

**Files:**
- Create: `apps/web/src/pages/insights/insights-workspace.tsx`
- Create: `apps/web/src/pages/insights/insight-card.tsx`
- Create: `apps/web/src/pages/insights/insights-context-panel.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/components/dashboard/forecast-widget.tsx`
- Modify: `apps/web/src/components/dashboard/smart-groups-widget.tsx`

- [ ] **Step 1: Add Insights route**

Add `/insights` route and wire `navigate.insights`.

- [ ] **Step 2: Render insights overview**

Use `getInsightsOverview()` and render forecast, weak areas, at-risk cards, heatmap summary, and trends. Smart group and deck/card health labels must be derived from returned `weakAreas`, `atRiskCards`, and `trends`; do not add new backend fields in this task unless Chunk 2's contract is deliberately updated first.

- [ ] **Step 3: Add insight actions**

Each insight has a direct action:
- study at-risk: dispatch `insight.studyAtRisk` with `deckId` or `groupId`.
- open group: dispatch `navigate.study` with `{ mode: 'smart-group', smartGroupId }` or use href `/study?mode=smart-group&smartGroupId=:id`.
- generate remediation cards: dispatch `create.openAiPaste` with `targetDeckId` when available, otherwise `navigate.create` with `{ source: 'ai-paste' }`.
- inspect related cards: navigate to `/deck/:deckId?cardId=:cardId`; do not rely on `navigate.library` unless `view: 'cards'` is supported by the action contract from Chunk 3.
- open deck: navigate by href to `/deck/:deckId`.

- [ ] **Step 4: Add Insights context panel**

Show selected insight explanation and direct study/create actions.

- [ ] **Step 5: Verify Insights manually**

Expected:
- `/insights` route renders.
- `navigate.insights` command opens route.
- each insight action dispatches or navigates.
- optional section failures render unavailable states.

- [ ] **Step 6: Verify build**

Run:
```bash
bun run --filter @engram/web typecheck
bun run --filter @engram/web build
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/insights apps/web/src/app.tsx apps/web/src/components/dashboard/forecast-widget.tsx apps/web/src/components/dashboard/smart-groups-widget.tsx
git commit -m "feat(web): add insights workspace"
```

---

## Chunk 5: Supporting Surfaces and Full QA

### Task 15: Redesign auth, settings, docs, feedback, and status pages

**Files:**
- Modify: `apps/web/src/pages/login.tsx`
- Modify: `apps/web/src/pages/register.tsx`
- Modify: `apps/web/src/pages/reset-password.tsx`
- Modify: `apps/web/src/pages/verify-email.tsx`
- Modify: `apps/web/src/pages/not-found.tsx`
- Create: `apps/web/src/pages/auth/auth-status-layout.tsx`
- Modify: `apps/web/src/pages/settings.tsx`
- Create: `apps/web/src/pages/settings/settings-section.tsx`
- Modify: `apps/web/src/pages/docs.tsx`
- Create: `apps/web/src/pages/docs/docs-content.tsx`
- Modify: `apps/web/src/pages/feedback.tsx`
- Create: `apps/web/src/pages/feedback/feedback-form.tsx`
- Modify: `apps/web/src/lib/command-actions.ts`
- Modify: `apps/api/src/modules/experience/command-search.service.ts`
- Test: `apps/api/__tests__/modules/experience/command-search.service.test.ts`
- Test: `apps/api/__tests__/modules/experience/experience.routes.test.ts`

- [ ] **Step 1: Redesign auth/status layouts**

Use neutral shadcn forms/status cards. Preserve:
- guest redirects from `/login` and `/register` to `/` when authenticated.
- protected redirect from `/` to `/login` when unauthenticated.
- login/register loading and error states.
- register password strength and confirm-password validation.
- reset token query behavior, success state, invalid/expired error state.
- verify token query behavior, success state, already-verified state, invalid/expired error state, and resend path where current API supports it.
- not-found status layout with primary actions to Home, Library, and Study.
- shared auth/status layout belongs in `apps/web/src/pages/auth/auth-status-layout.tsx`; keep individual page files focused on page-specific state and submit behavior.

- [ ] **Step 2: Redesign settings**

Use tabs/sections: profile, appearance, study algorithm, notifications, account/security.

Preserve:
- profile display name/avatar update behavior.
- inline validation and toast confirmation for profile updates.
- SM-2/FSRS selection behavior.
- light/dark/system theme behavior.
- account/security actions such as password change/logout where currently present.
- shared settings section/card composition belongs in `apps/web/src/pages/settings/settings-section.tsx` to keep `settings.tsx` from growing further.

- [ ] **Step 3: Redesign docs**

Keep markdown rendering, improve tables, reading width, command accessibility, and shell compatibility. Move markdown/content rendering helpers to `apps/web/src/pages/docs/docs-content.tsx`.

Add docs reachability in both places:
- Frontend `command-actions.ts`: add `docs.open` with optional `section`; behavior navigates to `/docs` with section hash/query if provided.
- Backend `command-search.service.ts`: include docs results and `docs.open` action metadata when query matches docs/help/keyboard/reference terms.

- [ ] **Step 4: Redesign feedback**

Use shadcn form with type/message validation, submit loading, success, and error states. Move reusable form body to `apps/web/src/pages/feedback/feedback-form.tsx`.

Preserve existing feedback payload behavior:
- `type` is selected by the user or preselected by `feedback.open`.
- `subject` is required and sent to the API.
- `message` is required and sent to the API.
- `contactEmail` remains optional and is sent only when provided.

Add feedback reachability in both places:
- Frontend `command-actions.ts`: add `feedback.open` with optional `type`; behavior navigates to `/feedback` and preselects the type when supported by the page.
- Backend `command-search.service.ts`: include feedback results and `feedback.open` action metadata when query matches feedback/bug/request/contact terms.
- Link feedback from settings/help areas.

Add route-limited utility reachability:
- Backend `command-search.service.ts`: include `study.openFocus` metadata only when `currentRoute` is `/study` or starts with `/study/`; hide it on non-study routes rather than returning a disabled result.

- [ ] **Step 5: Add command metadata tests**

Extend `command-search.service.test.ts` and `experience.routes.test.ts`:
- search `docs` returns a docs result or `docs.open` action with href/action data leading to `/docs`.
- search `help` returns docs/help metadata.
- search `keyboard` returns docs/help metadata.
- search `reference` returns docs/help metadata.
- search `feedback` returns `feedback.open` metadata leading to `/feedback`.
- search `bug` returns feedback metadata.
- search `request` returns feedback metadata.
- search `contact` returns feedback metadata.
- search `focus` on `/study`, `/study/:deckId`, and `/study/interleaved` returns `study.openFocus`; search `focus` on `/library` does not return it.
- disabled metadata still includes disabled reason for actions intentionally returned but not executable in the current context, such as deck deletion without a selected deck.

- [ ] **Step 6: Run supporting-surface tests**

Run:
```bash
cd /home/tplong/WorkSpace/engram_spira/apps/api
bun test __tests__/modules/experience/command-search.service.test.ts __tests__/modules/experience/experience.routes.test.ts
```
Expected: PASS.

Run:
```bash
cd /home/tplong/WorkSpace/engram_spira
bun run --filter @engram/web typecheck
```
Expected: PASS.

- [ ] **Step 7: Verify supporting surfaces manually**

Expected:
- guest/protected redirects still work.
- reset password handles missing, invalid, expired, and valid token states.
- verify email handles missing, invalid, expired, already verified, success, and resend-supported states.
- settings profile update shows inline validation and toast confirmation.
- settings theme and study algorithm controls persist.
- docs open from navigation and command search.
- feedback opens from route, command search, and settings/help; submit loading/success/error states render.
- unknown route renders Home, Library, and Study primary actions.

- [ ] **Step 8: Verify build**

Run:
```bash
cd /home/tplong/WorkSpace/engram_spira
bun run --filter @engram/web typecheck
bun run --filter @engram/web build
```
Manual expected: all current routes in spec route inventory render.

- [ ] **Step 9: Commit**

```bash
cd /home/tplong/WorkSpace/engram_spira
git add apps/web/src/pages/login.tsx apps/web/src/pages/register.tsx apps/web/src/pages/reset-password.tsx apps/web/src/pages/verify-email.tsx apps/web/src/pages/not-found.tsx apps/web/src/pages/auth/auth-status-layout.tsx apps/web/src/pages/settings.tsx apps/web/src/pages/settings/settings-section.tsx apps/web/src/pages/docs.tsx apps/web/src/pages/docs/docs-content.tsx apps/web/src/pages/feedback.tsx apps/web/src/pages/feedback/feedback-form.tsx apps/web/src/lib/command-actions.ts apps/api/src/modules/experience/command-search.service.ts apps/api/__tests__/modules/experience/command-search.service.test.ts apps/api/__tests__/modules/experience/experience.routes.test.ts
git commit -m "feat(web): polish supporting routes"
```

### Task 16: Full verification pass

**Files:**
- Modify only files required by defects found during verification.

- [ ] **Step 1: Run full typecheck**

Run: `cd /home/tplong/WorkSpace/engram_spira && bun run typecheck`
Expected: PASS.

- [ ] **Step 2: Run backend tests**

Run: `cd /home/tplong/WorkSpace/engram_spira && (cd apps/api && bun test)`
Expected: PASS.

- [ ] **Step 3: Run production web build**

Run: `cd /home/tplong/WorkSpace/engram_spira && bun run --filter @engram/web build`
Expected: PASS.

- [ ] **Step 4: Start dev servers**

Run: `cd /home/tplong/WorkSpace/engram_spira && bun run dev`
Expected: API and web dev servers start. Use another port only if existing port is occupied.

- [ ] **Step 5: Manual route walkthrough**

Verify:
- `/login`
- `/register`
- `/reset-password`
- `/verify-email`
- `/`
- `/library`
- `/folder/:folderId`
- `/deck/:deckId`
- `/study`
- `/study/:deckId`
- `/study/interleaved`
- `/create`
- `/insights`
- `/settings`
- `/feedback`
- `/docs`
- unknown route

- [ ] **Step 6: Manual UX checklist**

Verify:
- desktop `>=1280px` shell: command bar, task rail, explorer, main, context panel.
- tablet `768px - 1279px`: collapsed explorer/panel behavior.
- mobile `<768px`: bottom nav, full-screen command, explorer sheet, context sheet.
- dialog/sheet focus and Escape close.
- keyboard command menu.
- no text overlap in buttons/cards/panels.
- graph/heatmap tabs lazy-load without blank canvas.
- light/dark neutral theme.
- performance review for shell, study, library, graph, and docs:
  - shell initial render does not eagerly load graph/Three.js/docs markdown-heavy chunks.
  - study flip/rating feels immediate and does not re-render the whole shell.
  - library explorer tree interaction does not visibly stall with seeded data.
  - graph/heatmap load only after tab activation.
  - docs route does not block shell navigation while markdown loads.
  - concrete lazy-load check: inspect production build output or browser Network panel and confirm graph/heatmap, Three.js focus code, and markdown-heavy docs chunks are not loaded on initial authenticated Home render.

- [ ] **Step 7: Fix verification defects**

For each defect:
1. Reproduce.
2. Apply smallest scoped fix.
3. Re-run the failing check.
4. Re-run the relevant suite for the touched layer:
   - frontend file changed: `cd /home/tplong/WorkSpace/engram_spira && bun run --filter @engram/web typecheck && bun run --filter @engram/web build`.
   - API file changed: `cd /home/tplong/WorkSpace/engram_spira && (cd apps/api && bun test)`.
   - shared contract changed: run both frontend typecheck/build and API tests from `/home/tplong/WorkSpace/engram_spira`.
5. Do not refactor unrelated code.

- [ ] **Step 8: Re-run final automation after fixes**

Run these again even when Step 7 only fixed one narrow defect:
```bash
cd /home/tplong/WorkSpace/engram_spira
bun run typecheck
(cd apps/api && bun test)
bun run --filter @engram/web build
```
Expected: PASS.

- [ ] **Step 9: Final commit**

If final verification required no fixes, mark this step complete without a commit. If fixes were made, first run `cd /home/tplong/WorkSpace/engram_spira`, then run `git status --short`, then stage only the exact files changed by Step 7 verification fixes with a non-wildcard command such as `git add apps/web/src/components/app-shell/app-shell.tsx`. Do not use `git add .`.

```bash
cd /home/tplong/WorkSpace/engram_spira
git status --short
git commit -m "chore: verify command center redesign"
```

## Execution Notes

- Use a fresh subagent per task when executing with subagents.
- Each worker must be told that other workers may be editing the codebase and must not revert unrelated changes.
- Do not delete current features unless the spec explicitly replaces their presentation.
- If a task reveals a missing backend contract, update the spec or this plan before continuing implementation.
- Keep commits frequent; do not wait until the full redesign is done.
