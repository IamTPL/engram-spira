# Shadcn-Solid Command Center Redesign Design

Date: 2026-06-28
Status: Draft for review
Project: Engram Spira

## Summary

Refactor the full Engram Spira web experience into a polished shadcn-solid
power-user learning workspace.

This is an experience-first redesign, not a visual-only component migration.
The app will keep SolidJS and adopt shadcn-solid primitives while redesigning
the information architecture around a Command Center shell: global command
search, task navigation, library explorer, route workspace, and a persistent
context/action panel.

The visual direction is shadcn default: neutral/zinc surfaces, restrained
interaction states, professional density, and minimal brand color. The existing
pastel gradients and playful card motif should no longer define primary UI
surfaces.

## Approved Decisions

- Framework: keep SolidJS.
- UI system: use shadcn-solid, not React shadcn/ui.
- Visual direction: shadcn default neutral style.
- UX scope: broad redesign, not a visual-only migration.
- Product posture: full polish across the whole web app.
- IA model: Command Center, with a visible library explorer retained for
  class/folder/deck navigation.
- Backend scope: API changes are allowed when they improve UX, performance, or
  data loading clarity.
- Implementation strategy: experience-first redesign with architecture
  guardrails, avoiding a framework rewrite or speculative business-logic
  changes.

## Goals

- Make Engram Spira feel like a polished power-user learning workspace.
- Make global search and command execution the fastest route to common work.
- Keep library structure accessible without making the entire app revolve
  around the tree.
- Surface next useful actions through a context-aware right panel.
- Consolidate current scattered page actions into predictable command, toolbar,
  drawer, sheet, tab, and context-panel patterns.
- Replace hand-rolled UI primitives with accessible shadcn-solid primitives
  where appropriate.
- Add experience-oriented aggregate API endpoints so frontend pages do not need
  to orchestrate many sequential requests.
- Preserve existing core capabilities: SRS study, FSRS/SM-2 settings, deck/card
  management, AI generation, semantic search, knowledge graph, duplicate
  detection, import/export, docs, feedback, auth, and focus features.

## Non-Goals

- Do not migrate the frontend to React.
- Do not rewrite backend business rules unless required by the new experience
  contracts.
- Do not introduce a marketing landing page.
- Do not keep old pastel/gradient visuals as the main design language.
- Do not add unrelated product features beyond what the redesign needs.
- Do not remove existing major capabilities during the redesign.

## Current Project Context

The repo is a Bun workspace. The web app is in `apps/web` and uses SolidJS,
Solid Router, TanStack Solid Query, Tailwind CSS v4, `class-variance-authority`,
`clsx`, `tailwind-merge`, and `lucide-solid`.

The current UI already has local shadcn-like primitives under
`apps/web/src/components/ui`, including button, card, input, textarea, alert,
badge, dialog, dropdown-menu, empty-state, progress, skeleton, tabs, toaster,
and tooltip. Many are hand-rolled and should be replaced or aligned with
shadcn-solid equivalents.

The current design system is documented in `docs/ui/design.md`. It describes a
calm productivity theme with blue/pastel palette, gradient CTAs, large rounded
cards, and custom motion utilities. The redesign intentionally moves away from
that dominant visual language toward shadcn default neutral styling.

## UX Architecture

The redesigned app shell has five persistent regions on desktop:

1. Top command bar.
2. Left task rail.
3. Secondary library explorer.
4. Main workspace.
5. Right context/action panel.

### Top Command Bar

The command bar is the fastest path through the product. It supports:

- Searching cards, decks, folders, classes, docs, and settings.
- Running app actions such as start review, create deck, import CSV, generate
  cards, open duplicate scanner, open graph, or change study mode.
- Keyboard-first access through a command menu.
- Route-aware suggestions, such as actions for the current deck or selected
  card.

### Left Task Rail

The left rail is task-oriented rather than object-oriented:

- Home
- Study
- Library
- Create
- Insights
- Settings

It stays compact on desktop and maps to bottom navigation on mobile.

### Library Explorer

The explorer remains visible because users manage classes, folders, and decks.
It shows:

- Class/folder/deck hierarchy.
- Counts and due counts.
- Recent markers.
- Lightweight filters or saved views.
- Rename/reorder/create/delete actions through shadcn dropdowns, dialogs, and
  inline controls.

The explorer should not own every workflow. It selects scope; main pages and
context panels perform work.

### Main Workspace

The main workspace renders route-specific content. Each page should have one
primary job and a clear toolbar. Secondary or route-context actions move to the
command menu or context panel.

### Right Context/Action Panel

The panel changes based on route and selected object. It can show:

- Review queue summary.
- Current deck actions.
- Selected card metadata.
- AI suggestions.
- Duplicate warnings.
- Graph insights.
- Recent work.
- Empty-state recommendations.
- Error/retry states for contextual data.

On mobile this becomes a sheet/drawer.

## Page-By-Page Redesign

### Home / Command Center

Home becomes a cockpit instead of a passive dashboard.

Primary content:

- Review queue summary.
- Due decks.
- Continue where you left off.
- Recent decks/cards.
- Streak and activity summary.
- Weak areas.
- Forecast preview.
- Pending suggestions.
- Notifications.

Primary actions:

- Start due review.
- Start interleaved review.
- Create/generate cards.
- Import content.
- Open weak area.
- Resume recent deck.

Existing forecast and smart group widgets should become polished insight cards
using shadcn `Card`, `Tabs`, `Progress`, and related primitives.

### Study Workspace

Study becomes a queue-driven workspace.

Entry modes:

- Due review.
- Deck-specific study.
- Folder/class study.
- Smart group.
- Interleaved study.
- At-risk cards.

During study:

- Main area shows the card and rating controls.
- Right panel shows card context, related cards, source deck, progress,
  shortcuts, and SRS metadata.
- Focus mode becomes an action/panel within Study instead of feeling like a
  separate product surface.
- Keyboard shortcuts remain first-class.

### Library Workspace

Library is for browsing, organizing, filtering, and managing knowledge.

Main states:

- Class view.
- Folder view.
- Deck list/grid/table.
- Card list for selected scope.

Required patterns:

- Toolbar with filter, sort, create, import, bulk actions.
- Neutral shadcn card/table hybrid instead of colorful deck cards.
- Empty states that offer create/import/generate actions.
- Confirm destructive actions with dialog/alert-dialog patterns.

### Deck / Card Workspace

Deck pages become full workspaces with tabs:

- Cards
- Study
- Graph
- Duplicates
- AI Suggestions
- Analytics

Card create/edit should use drawers or dialogs, not large inline forms that
push layout around. Bulk actions belong in a selection toolbar or command menu.

Graph, retention heatmap, duplicate scanner, and AI suggestions remain, but
they should load lazily through tabs or panel sections so the deck page stays
fast.

### Create Workspace

Create consolidates manual, AI, import, template, and duplicate workflows.

Source options:

- Manual card.
- Paste text for AI generation.
- CSV import.
- JSON import/export where currently supported.
- Template-based creation.

Flow:

1. Choose source and target deck.
2. Configure template or generation mode.
3. Preview generated/imported cards.
4. Review duplicates or validation issues.
5. Commit selected cards.

This workspace should use shadcn forms, tables, dialogs, sheets, and progress
states.

### Insights Workspace

Insights consolidates analytics and recommendations.

Content:

- Forecast.
- Retention heatmap.
- Weak areas.
- Smart groups.
- At-risk cards.
- Study progress trends.
- Deck/card health summaries.

Every insight should have a direct action: study now, open group, generate
remediation cards, inspect related cards, or open deck.

### Settings

Settings uses shadcn tabs/forms:

- Profile.
- Appearance.
- Study algorithm.
- Notifications.
- Account/security.

Existing FSRS/SM-2 selection should remain. Theme selection should map cleanly
to the new neutral token system.

### Docs

Docs keep markdown rendering but get a more polished reading surface:

- Table of contents where practical.
- Search or command access.
- Better table styling through shadcn-compatible tokens.

### Feedback

Feedback becomes a simple shadcn form page or dialog with success/error states.

### Auth

Login, register, reset password, verify email, and not found screens move to
neutral shadcn auth/status layouts:

- Professional centered forms.
- No dominant gradients.
- Clear validation and loading states.
- Links between auth flows remain obvious.

## Component Architecture

### UI Primitive Layer

`apps/web/src/components/ui/*` should become the shadcn-solid primitive layer.
Target primitives include:

- Button
- Input
- Textarea
- Label
- Select
- Checkbox
- Switch
- Card
- Badge
- Alert
- Dialog
- AlertDialog
- Sheet / Drawer
- DropdownMenu
- Tooltip
- Tabs
- Command
- Table
- Toast / Sonner
- Skeleton
- Progress
- Separator
- ScrollArea

Use shadcn-solid components as source-owned app components, consistent with the
shadcn model. References:

- https://shadcn-solid.com/docs/introduction
- https://shadcn-solid.com/docs/about

### App Component Layer

Domain-specific app components should live outside the primitive layer.

Suggested components:

- `AppShell`
- `CommandBar`
- `ContextPanel`
- `TaskRail`
- `LibraryExplorer`
- `StudyQueue`
- `StudySession`
- `DeckWorkspace`
- `CardEditorDrawer`
- `CreateFlow`
- `InsightCard`
- `DashboardSection`

These components may use app data, route state, and domain logic. UI primitives
should not.

### Compatibility and Migration

Keep familiar imports where possible:

- `@/components/ui/button`
- `@/components/ui/card`
- `@/components/ui/input`
- `@/lib/utils`

Handle current custom props carefully:

- `Button loading` can be preserved by an app wrapper or built into the local
  button if the pattern stays generic.
- `Input iconLeft` and `iconRight` can move to composed wrappers or remain if
  the local shadcn-solid implementation supports it cleanly.
- `Progress variant` can remain if it maps to semantic tokens.

The goal is not to make primitives domain-specific. Business UX belongs in app
components.

## Theme and Visual System

Adopt shadcn default neutral styling.

Theme direction:

- Use semantic CSS variables for background, foreground, card, popover,
  primary, secondary, muted, accent, destructive, border, input, ring, radius.
- Use neutral/zinc-like surfaces for both light and dark modes.
- Keep dark mode class-based.
- Keep typography restrained and dense enough for a power-user app.
- Reduce or remove old gradient CTA and pastel surface utilities from primary
  workflows.
- Keep brand/logo presence small and professional.

Visual principles:

- Dense but readable.
- Predictable controls.
- Stable dimensions for toolbars, sidebars, cards, tables, and panels.
- No decorative gradient orbs or purely ornamental hero sections.
- Cards are for repeated items, panels, modals, or framed tools, not nested
  decorative page sections.

## Data/API Architecture

Add experience-oriented aggregate endpoints so the frontend can render the new
shell and workspaces without excessive request orchestration.

### Proposed Endpoints

`GET /dashboard/command-center`

Returns:

- Review queue summary.
- Streak.
- Due decks.
- Recent decks/cards.
- Weak areas.
- Forecast preview.
- Pending suggestions.
- Notifications.

`GET /study/queue`

Query modes:

- `due`
- `deck`
- `folder`
- `class`
- `smart-group`
- `interleaved`
- `at-risk`

Returns ordered cards and metadata explaining why each card is in the queue.

`GET /command/search`

Returns unified command/search results:

- Cards
- Decks
- Folders
- Classes
- Docs
- Settings
- Actions

Each result should include type, title, subtitle, href or action id, and
optional metadata.

`GET /library/explorer`

Returns class/folder/deck tree with counts, due counts, and recency metadata.

`GET /decks/:id/workspace`

Returns deck workspace data:

- Deck metadata.
- Cards page data.
- Study summary.
- Analytics summary.
- Graph count/status.
- Duplicate count/status.
- AI suggestion count/status.

Heavy graph data can remain lazy-loaded.

`POST /create/preview`

Accepts manual, AI, CSV, or import payloads and returns preview cards plus
validation and duplicate information.

`POST /create/commit`

Commits reviewed preview cards to the target deck.

`GET /insights/overview`

Returns forecast, weak groups, heatmap summary, at-risk cards, and trend data.

### Frontend Query Strategy

- App shell loads library explorer and a lightweight command-center snapshot.
- Workspaces use route-specific aggregate endpoints.
- Heavy data such as graph and heatmap loads lazily when tabs open.
- Mutations invalidate by scope: command center, explorer, deck workspace,
  study queue, insights.
- Use optimistic updates only for lightweight rename/reorder interactions.
- Use server-confirmed state for create/import/study review mutations.

## Error, Loading, and Empty States

Every major workspace needs polished states.

Loading:

- Shell skeletons for explorer, panels, and main cards.
- Route-level skeletons that preserve layout dimensions.
- Lazy tab skeletons for graph/heatmap/docs.

Empty:

- Empty library: create class/deck, import, or generate cards.
- Empty deck: add manually, generate, or import.
- No due cards: study weak areas, browse library, create new cards.
- No insights: prompt the user to study more cards.

Error:

- Shell can render even if a panel aggregate fails.
- Compact retry states in right panel.
- Route-level alerts for failed workspace data.
- Mutation errors through toast/sonner plus inline validation where useful.

## Accessibility and Interaction

- Prefer shadcn-solid primitives for dialog, sheet, dropdown, tooltip, tabs,
  command, select, and toast behavior.
- Maintain keyboard-first command access.
- Ensure focus trapping and escape handling in dialogs and sheets.
- Ensure visible focus states.
- Keep mobile navigation usable through bottom nav and sheets.
- Avoid hover-only critical actions; provide accessible menus or persistent
  controls for touch.

## Performance

Performance remains a design requirement.

- Keep initial shell data small.
- Lazy-load heavy routes and heavy visual tabs.
- Avoid rendering the entire library tree unnecessarily.
- Keep study interactions under 100 ms perceived response for flip and rating.
- Prefer CSS transform/opacity for motion.
- Keep mobile layouts stable and avoid text overlap.
- Do not load graph/heatmap/markdown-heavy docs until needed.

## Implementation Phases

### Phase 1: Foundation

- Add shadcn-solid setup.
- Convert theme to shadcn default neutral tokens.
- Replace/align base UI primitives.
- Build app shell skeleton: task rail, command bar, explorer, context panel.

### Phase 2: Experience API

- Add aggregate endpoints and service tests.
- Implement command-center snapshot, library explorer, command search, study
  queue, deck workspace, create preview/commit, and insights overview.

### Phase 3: Core Workspaces

- Redesign Home.
- Redesign Study.
- Redesign Library.
- Redesign Deck/Card workspace.
- Redesign Create.
- Redesign Insights.
- Migrate graph, heatmap, duplicate scanner, and AI suggestions into the new
  workspace patterns.

### Phase 4: Supporting Surfaces

- Redesign Settings.
- Redesign Docs.
- Redesign Feedback.
- Redesign Auth/status pages.
- Redesign Not Found.

### Phase 5: Full QA Polish

- Typecheck and build.
- Backend test suite.
- Route-by-route manual walkthrough.
- Keyboard navigation check.
- Dialog/sheet focus behavior check.
- Light/dark mode check.
- Mobile viewport check.
- Visual overlap check.
- Performance review for shell, study, library, graph, and docs.

## Testing Strategy

Backend:

- Add unit tests for aggregate endpoint service shapes.
- Cover empty data, unauthenticated behavior, missing deck/folder/class, and
  mixed queue modes.
- Reuse the existing Bun test setup.

Frontend:

- Run typecheck and production build.
- Add focused tests only if the existing frontend test infrastructure supports
  them without a large unrelated setup.
- Prefer manual route walkthrough and browser visual checks for this design
  pass if frontend testing is currently absent.

Manual UX checklist:

- Home renders review queue, insights, recent work, and empty states.
- Command search finds entities and actions.
- Library explorer loads once and updates after mutations.
- Study queue starts from all supported modes.
- Deck tabs lazy-load heavy content.
- Create preview/commit handles validation and duplicates.
- Settings auth docs feedback render in neutral shadcn style.
- Mobile uses bottom nav and sheet panels without overlap.

## Definition of Done

- All existing web routes render in the new shadcn default visual system.
- Main workflows use the Command Center shell.
- Global command/search works for entities and core actions.
- Library explorer is visible and fast.
- Right context/action panel provides useful route-aware next actions.
- Old pastel deck cards and gradient CTA motifs are no longer primary UI
  patterns.
- Aggregate API endpoints have backend test coverage.
- Typecheck and build pass.
- Backend tests pass.
- Manual visual QA confirms desktop and mobile layouts have no major overlap,
  blank states, or broken interactions.

## Open Risks

- Full polish across the entire app is a large scope and should be planned with
  explicit phase checkpoints.
- shadcn-solid component APIs may not match current custom props one-to-one,
  requiring temporary wrappers.
- Command search needs careful action metadata design to avoid becoming a
  shallow text search.
- Aggregate endpoints must not duplicate business logic already owned by
  existing services.
- Graph and heatmap views may need special lazy-loading and sizing QA.

