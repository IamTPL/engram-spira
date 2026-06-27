# Shadcn-Solid Command Center Redesign Design

Date: 2026-06-28
Status: Review revision 1
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

The panel changes based on route and selected object. It supports these content
categories, selected through the route-specific ownership table below:

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

Panel ownership rules:

- `AppShell` owns panel layout, open/collapsed state, persistence, and mobile
  sheet behavior.
- Each workspace exports a `contextPanel` descriptor or component for the shell
  to render.
- The panel may read route aggregate data passed from the workspace. It should
  not independently refetch the same route aggregate.
- The panel may lazy-load optional secondary data, such as graph insight
  details, only when opened or when the relevant tab is active.
- Global panel content is used only when no route-specific content exists.
- Panel actions dispatch through the same command action registry used by the
  command menu.

Route-specific panel responsibilities:

| Workspace | Panel responsibility |
| --- | --- |
| Home | Review queue, next actions, notifications, recent work. |
| Study | Current queue, card context, related cards, shortcuts, SRS metadata. |
| Library | Selected class/folder/deck summary, create/import actions, filters. |
| Deck | Deck actions, selected card metadata, duplicate/AI/graph counters. |
| Create | Preview summary, validation issues, commit readiness. |
| Insights | Selected insight explanation and direct study/create actions. |
| Settings | Unsaved changes, account/security actions where useful. |
| Docs | Table of contents or related docs where useful. |

Panel testing requirements:

- Each workspace has a default empty selection state.
- Each workspace has at least one actionable panel state.
- Mobile sheet opens and closes through keyboard and pointer interactions.
- Panel actions are reachable from command search when appropriate.

## Responsive Layout Rules

Desktop, tablet, and mobile need explicit behavior.

### Desktop: `>= 1280px`

- Top command bar is persistent.
- Task rail is icon-only and persistent.
- Library explorer is visible by default and resizable/collapsible.
- Right context panel is visible by default and collapsible.
- Main workspace uses remaining width and must not hide primary actions behind
  horizontal overflow.

### Laptop / Tablet: `768px - 1279px`

- Top command bar remains persistent.
- Task rail may stay icon-only.
- Library explorer collapses behind a trigger when width is constrained.
- Right context panel is collapsed by default and opens as a sheet.
- Workspace toolbars wrap into two rows before overflowing.

### Mobile: `< 768px`

- Top command entry remains reachable as a compact search button/input.
- Primary navigation uses bottom nav: Home, Study, Library, Create, Insights.
- Settings and secondary actions move to menus.
- Library explorer opens as a sheet.
- Context panel opens as a sheet.
- Command menu opens full-screen.
- Study controls keep fixed, stable dimensions and remain thumb-reachable.

Persistence rules:

- Collapsed state for explorer and context panel can persist in local storage.
- Route changes should preserve user collapse preference but update panel
  content.
- Mobile sheets close after navigation unless the action explicitly opens a
  detail panel.

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

## Existing Route Inventory and Mapping

The implementation plan must account for every current route in
`apps/web/src/app.tsx`.

| Current route | Current surface | New workspace mapping | Notes |
| --- | --- | --- | --- |
| `/login` | Login page | Auth | Guest-only route. Use neutral auth layout and preserve redirect to `/` when already logged in. |
| `/register` | Registration page | Auth | Guest-only route. Preserve password validation and strength feedback. |
| `/reset-password` | Password reset | Auth | Keep token-based reset behavior and error handling. |
| `/verify-email` | Email verification | Auth/status | Keep verification status states and resend path where supported. |
| `/` | Dashboard | Home / Command Center | Becomes the primary cockpit with review queue, recent work, insights, and actions. |
| `/folder/:folderId` | Folder deck grid | Library | Becomes a scoped Library view. Preserve create deck, search/filter, delete deck, and template selection. |
| `/deck/:deckId` | Deck/cards workspace | Deck / Card Workspace | Becomes tabbed deck workspace: cards, study, graph, duplicates, AI suggestions, analytics. |
| `/study/interleaved` | Interleaved study | Study | Becomes one queue mode inside Study. Existing route may redirect to the new route/state if routing is consolidated. |
| `/study/:deckId` | Deck study mode | Study | Becomes deck-scoped study queue. Preserve keyboard shortcuts and SRS rating behavior. |
| `/settings` | Settings | Settings | Use shadcn tabs/forms. Preserve profile, theme, study algorithm, and account actions. |
| `/feedback` | Feedback page | Feedback | Can remain a page or become a route-backed dialog/sheet. Preserve submission behavior. |
| `/docs` | Docs page | Docs | Preserve markdown docs rendering. Add neutral reading surface and navigation polish. |
| `*` | Not found | Status | Use neutral status layout with routes back to Home/Library/Study. |

Global surfaces currently mounted at app root must also survive:

- `FocusDrawer`: becomes a Study or command-triggered focus panel. It remains
  lazy-loaded because it can pull in Three.js through the reward experience.
- `GlobalSearch`: is replaced by or migrated into the new command menu.
- `Toaster`: is replaced by shadcn-solid compatible toast/sonner behavior.
- `RouteAnnouncer` and `AppErrorBoundary`: remain part of the shell and must be
  verified after the shell rewrite.

## Supporting Surface Acceptance Criteria

Full polish means these surfaces have explicit acceptance criteria, not just a
visual restyle.

### Auth and Status

- Login/register/reset/verify/not-found use the same neutral auth/status
  layout system.
- Form labels, validation errors, loading buttons, and success/error alerts are
  visible and keyboard accessible.
- Guest/protected route redirects remain unchanged.
- Password reset and email verification preserve token query behavior.

### Settings

- Settings are grouped into tabs or sidebar sections: profile, appearance,
  study algorithm, notifications, and account/security.
- Study algorithm settings preserve current SM-2/FSRS selection behavior.
- Theme settings map to the new light/dark/system neutral token set.
- Profile updates show inline validation and toast confirmation.

### Docs

- Markdown rendering remains functional.
- Tables use neutral shadcn-compatible styling.
- Long docs have a readable max width and do not collide with shell panels.
- Docs are reachable from command search.

### Feedback

- Feedback form supports type, message, validation, submit loading, success,
  and error states.
- Feedback is reachable from command search and settings/help areas.

### Not Found

- Unknown routes render a polished status state.
- Primary actions return to Home, Library, or Study.

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

All new endpoints below are authenticated unless explicitly marked public. They
should use the existing API error shape: `{ error: string }` with the current
HTTP status conventions. They should also avoid duplicating business rules from
existing services; aggregate services compose existing module services and add
presentation metadata only.

Aggregate endpoints should return a section-status envelope so optional widget
failures are explicit and renderable:

```ts
type AggregateResponse<TData> = {
  data: TData;
  meta: {
    generatedAt: string;
    sections: Record<
      string,
      | { status: 'ok' }
      | { status: 'empty' }
      | { status: 'error'; message: string; retryable: boolean }
    >;
  };
};
```

The response shapes below describe the `data` member of that envelope unless
the endpoint is not an aggregate. Required section failures should still return
a normal API error instead of an envelope with unusable data.

List-style payloads must include explicit limits. Initial defaults should favor
fast shell rendering:

- command results: max 8 per group, 30 total by default.
- explorer tree: include all classes/folders/decks for the current user unless
  data volume requires pagination later.
- deck cards: paginated, default 50 cards.
- recent work: default 5 decks and 5 cards.
- insights previews: default 5 weak groups and 7-14 forecast days depending on
  the existing study service behavior.

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

Response shape:

```ts
type CommandCenterResponse = {
  reviewQueue: {
    dueCount: number;
    newCount: number;
    learningCount: number;
    atRiskCount: number;
    nextAction: CommandActionRef | null;
  };
  streak: { current: number; longest: number } | null;
  dueDecks: Array<{
    id: string;
    name: string;
    folderId: string | null;
    dueCount: number;
    newCount: number;
    lastStudiedAt: string | null;
  }>;
  recent: {
    decks: Array<{ id: string; name: string; updatedAt: string | null }>;
    cards: Array<{ id: string; deckId: string; title: string; updatedAt: string | null }>;
  };
  weakAreas: Array<{
    id: string;
    label: string;
    cardCount: number;
    avgRetention: number | null;
    action: CommandActionRef;
  }>;
  forecast: {
    days: Array<{ date: string; atRiskCount: number; avgRetention: number | null }>;
  };
  pendingSuggestions: {
    duplicates: number;
    aiSuggestions: number;
  };
  notifications: Array<{
    id: string;
    title: string;
    body: string | null;
    createdAt: string;
    href: string | null;
  }>;
};
```

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

Query shape:

```ts
type StudyQueueQuery = {
  mode: 'due' | 'deck' | 'folder' | 'class' | 'smart-group' | 'interleaved' | 'at-risk';
  deckId?: string;
  folderId?: string;
  classId?: string;
  smartGroupId?: string;
  limit?: number;
};
```

Response shape:

```ts
type StudyQueueResponse = {
  mode: StudyQueueQuery['mode'];
  title: string;
  cards: Array<{
    id: string;
    deckId: string;
    front: string;
    back: string;
    templateName: string | null;
    reason: 'due' | 'new' | 'learning' | 'at-risk' | 'manual' | 'interleaved';
    dueAt: string | null;
    retentionEstimate: number | null;
  }>;
  summary: {
    total: number;
    due: number;
    new: number;
    learning: number;
    atRisk: number;
  };
};
```

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

Query shape:

```ts
type CommandSearchQuery = {
  q: string;
  scope?: 'all' | 'cards' | 'decks' | 'library' | 'actions' | 'docs';
  currentRoute?: string;
  limit?: number;
};
```

Response shape:

```ts
type CommandSearchResponse = {
  groups: Array<{
    id: 'actions' | 'cards' | 'decks' | 'folders' | 'classes' | 'docs' | 'settings';
    label: string;
    results: CommandResult[];
  }>;
};

type CommandResult = {
  id: string;
  type: 'action' | 'card' | 'deck' | 'folder' | 'class' | 'doc' | 'setting';
  title: string;
  subtitle: string | null;
  href: string | null;
  action: CommandActionRef | null;
  icon: string | null;
  keywords: string[];
  disabledReason: string | null;
};

type CommandActionRef = {
  id: string;
  label: string;
  params?: Record<string, string | number | boolean | null>;
};
```

Ranking rules:

- Exact title matches first.
- Route-aware actions before global actions.
- Recently opened decks/cards before older matches.
- Entity matches before docs/settings for non-action queries.
- Disabled actions may appear only when the disabled reason helps the user
  understand what to do next.

Execution rules:

- Navigation results use `href`.
- Action results use a local command registry keyed by `action.id`.
- Destructive actions never execute directly from search; they open a
  confirmation dialog.
- Actions that require a selected deck/card must validate params before
  execution and show a compact error if context is missing.

Command action registry interface:

```ts
type CommandActionContext = {
  route: string;
  currentUserId: string;
  selectedDeckId?: string;
  selectedCardId?: string;
  selectedFolderId?: string;
  selectedClassId?: string;
};

type CommandActionResult =
  | {
      status: 'success';
      message?: string;
      navigateTo?: string;
      invalidate?: QueryInvalidationKey[];
    }
  | {
      status: 'error';
      message: string;
      fieldErrors?: Record<string, string>;
    }
  | {
      status: 'confirm';
      title: string;
      description: string;
      confirmLabel: string;
      destructive?: boolean;
      onConfirmAction: CommandActionRef;
    };

type CommandActionDefinition<TParams extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  label: string;
  keywords: string[];
  requiredParams: Array<keyof TParams>;
  validateParams: (params: Record<string, unknown>, context: CommandActionContext) => TParams | CommandActionResult;
  run: (params: TParams, context: CommandActionContext) => Promise<CommandActionResult> | CommandActionResult;
};

type QueryInvalidationKey =
  | 'command-center'
  | 'library-explorer'
  | 'study-queue'
  | 'deck-workspace'
  | 'insights-overview'
  | 'command-search';
```

Initial action IDs:

| Action id | Required params | Behavior | Invalidation |
| --- | --- | --- | --- |
| `navigate.home` | none | Navigate to `/`. | none |
| `navigate.study` | optional `mode`, `deckId` | Navigate/open Study workspace. | none |
| `navigate.library` | optional `classId`, `folderId`, `deckId` | Navigate/open Library scope. | none |
| `navigate.create` | optional `targetDeckId`, `source` | Navigate/open Create workspace. | none |
| `navigate.insights` | none | Navigate to Insights. | none |
| `study.startQueue` | `mode`; optional scope id | Start a queue using `/study/queue`. | `study-queue`, `command-center` |
| `deck.create` | `folderId`, `name`, `templateId` | Create deck after validation. | `library-explorer`, `command-center` |
| `deck.delete.confirm` | `deckId` | Return confirmation result only. | none |
| `deck.delete` | `deckId` | Delete deck after confirmation. | `library-explorer`, `command-center` |
| `card.createManual` | `deckId`, `templateId` | Open manual create form. | none |
| `create.openAiPaste` | optional `targetDeckId` | Open AI paste create flow. | none |
| `create.importCsv` | optional `targetDeckId` | Open CSV import flow. | none |
| `insight.studyAtRisk` | optional `deckId` or `groupId` | Start at-risk study queue. | `study-queue`, `command-center` |
| `settings.open` | optional `section` | Navigate/open Settings section. | none |

Runtime behavior:

- Command menu, toolbars, and context panel all call the same registry.
- The caller owns loading UI and must disable duplicate submission for the same
  action/params while it is pending.
- `success.message` shows a toast when present.
- `error.message` shows a toast or inline compact error depending on caller
  surface.
- `navigateTo` runs after success toast scheduling.
- `invalidate` maps to TanStack Query invalidation scopes.
- Confirmation results must be rendered through a shadcn alert dialog and then
  dispatch `onConfirmAction`.

`GET /library/explorer`

Returns class/folder/deck tree with counts, due counts, and recency metadata.

Response shape:

```ts
type LibraryExplorerResponse = {
  classes: Array<{
    id: string;
    name: string;
    description: string | null;
    folderCount: number;
    deckCount: number;
    cardCount: number;
    dueCount: number;
    folders: Array<{
      id: string;
      name: string;
      deckCount: number;
      cardCount: number;
      dueCount: number;
      decks: Array<{
        id: string;
        name: string;
        cardCount: number;
        dueCount: number;
        updatedAt: string | null;
      }>;
    }>;
  }>;
  recentDeckIds: string[];
};
```

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

Query shape:

```ts
type DeckWorkspaceQuery = {
  cardPage?: number;
  cardPageSize?: number;
  cardSearch?: string;
  sort?: 'createdAt' | 'updatedAt' | 'dueAt' | 'template';
};
```

Response shape:

```ts
type DeckWorkspaceResponse = {
  deck: {
    id: string;
    name: string;
    folderId: string;
    cardTemplateId: string;
    cardCount: number;
  };
  cards: {
    items: Array<{ id: string; title: string; preview: string; updatedAt: string | null }>;
    page: number;
    pageSize: number;
    total: number;
  };
  study: {
    dueCount: number;
    newCount: number;
    learningCount: number;
    lastStudiedAt: string | null;
  };
  analytics: {
    avgRetention: number | null;
    atRiskCount: number;
  };
  counters: {
    graphLinks: number;
    duplicates: number;
    aiSuggestions: number;
  };
};
```

`POST /create/preview`

Accepts manual, AI, CSV, or import payloads and returns preview cards plus
validation and duplicate information.

Request shape:

```ts
type CreatePreviewRequest =
  | {
      source: 'manual';
      targetDeckId: string;
      templateId: string;
      payload: ManualCreatePayload;
    }
  | {
      source: 'ai-paste';
      targetDeckId: string;
      templateId: string;
      payload: AiPasteCreatePayload;
    }
  | {
      source: 'csv';
      targetDeckId: string;
      templateId: string;
      payload: CsvCreatePayload;
    }
  | {
      source: 'json';
      targetDeckId: string;
      templateId: string;
      payload: JsonCreatePayload;
    };

type ManualCreatePayload = {
  fields: Record<string, string>;
};

type AiPasteCreatePayload = {
  text: string;
  mode: 'vocabulary' | 'qa';
  requestedCount?: number;
};

type CsvCreatePayload = {
  filename: string;
  content: string;
  delimiter?: ',' | ';' | '\t';
  hasHeader: boolean;
  fieldMapping: Record<string, string>;
};

type JsonCreatePayload = {
  filename: string;
  content: string;
  fieldMapping?: Record<string, string>;
};
```

Limits:

- Manual: one card per preview request.
- AI paste: max 30,000 characters and max 50 requested cards.
- CSV: max 1 MB content and max 1,000 rows.
- JSON: max 1 MB content and max 1,000 cards.
- All text fields should be trimmed server-side but not silently truncated.

Validation rules:

- `targetDeckId` must belong to the current user.
- `templateId` must be valid for the target deck or explicitly allowed by the
  existing template rules.
- Required template fields must be present before commit.
- Duplicate detection returns candidates but does not automatically remove cards
  unless the user selects a skip/merge resolution.

Preview storage:

```ts
type CreatePreviewRecord = {
  previewId: string;
  userId: string;
  targetDeckId: string;
  templateId: string;
  source: CreatePreviewRequest['source'];
  expiresAt: string;
};
```

Preview records expire after 60 minutes. They may be stored in memory for the
first implementation if that matches existing app constraints, but the behavior
must be explicit: expired previews return a validation error telling the user to
generate the preview again.

Response shape:

```ts
type CreatePreviewResponse = {
  previewId: string;
  expiresAt: string;
  cards: Array<{
    clientId: string;
    fields: Record<string, string>;
    validationErrors: string[];
    duplicateCandidates: Array<{
      cardId: string;
      similarity: number;
      title: string;
    }>;
    resolution: 'create' | 'skip' | 'merge';
  }>;
  summary: {
    total: number;
    valid: number;
    invalid: number;
    possibleDuplicates: number;
  };
};
```

`POST /create/commit`

Commits reviewed preview cards to the target deck.

Request shape:

```ts
type CreateCommitRequest = {
  previewId: string;
  idempotencyKey: string;
  cards: Array<{
    clientId: string;
    resolution: 'create' | 'skip' | 'merge';
    mergeTargetCardId?: string;
    fields?: Record<string, string>;
  }>;
};
```

Response shape:

```ts
type CreateCommitResponse = {
  createdCardIds: string[];
  skippedClientIds: string[];
  mergedCardIds: string[];
};
```

Commit rules:

- `idempotencyKey` is required and scoped to `previewId` + current user.
- Repeating the same commit request with the same idempotency key returns the
  same result without creating duplicate cards.
- Commit fails if the preview is expired.
- Commit fails if any requested `clientId` is not part of the preview.
- Commit fails if a `merge` resolution lacks a valid `mergeTargetCardId`.
- Successful commit invalidates deck workspace, library explorer, command
  center, insights, and relevant command-search caches.

`GET /insights/overview`

Returns forecast, weak groups, heatmap summary, at-risk cards, and trend data.

Response shape:

```ts
type InsightsOverviewResponse = {
  forecast: CommandCenterResponse['forecast'];
  weakAreas: CommandCenterResponse['weakAreas'];
  atRiskCards: Array<{ id: string; deckId: string; title: string; retentionEstimate: number | null }>;
  heatmap: Array<{ date: string; count: number }>;
  trends: {
    reviewedThisWeek: number;
    retentionDelta: number | null;
  };
};
```

### Frontend Query Strategy

- App shell loads library explorer and a lightweight command-center snapshot.
- Workspaces use route-specific aggregate endpoints.
- Heavy data such as graph and heatmap loads lazily when tabs open.
- Mutations invalidate by scope: command center, explorer, deck workspace,
  study queue, insights.
- Suggested cache keys:
  - `['command-center']`
  - `['library-explorer']`
  - `['command-search', q, scope, currentRoute]`
  - `['study-queue', mode, scopeId, limit]`
  - `['deck-workspace', deckId, cardPage, cardPageSize, cardSearch, sort]`
  - `['insights-overview']`
- Use optimistic updates only for lightweight rename/reorder interactions.
- Use server-confirmed state for create/import/study review mutations.

### Partial Failure Rules

Aggregate endpoints should prefer complete responses, but not every optional
widget should make the whole shell unusable.

- Required identity/scope failures return a normal API error.
- Optional section failures are represented in `meta.sections` using
  `{ status: 'error', message, retryable }`.
- Optional empty sections are represented in `meta.sections` using
  `{ status: 'empty' }` plus an empty array or null data in the corresponding
  response field.
- The frontend must render compact panel-level error states for optional
  failures and route-level errors for required workspace data.

### Existing vs New Scope Clarification

Template-based creation is not a new product subsystem; card templates already
exist and should be integrated into the Create workspace.

Notifications are not a new product subsystem; the repo already has a
notifications module. The Command Center should surface existing notification
data where available, and degrade gracefully if there are no notifications.

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

This design can produce multiple implementation plans or one master plan with
strict milestones. Full polish is the desired end state, not permission to ship
an unbounded single PR. Each phase below must end in a working app state and a
verification checkpoint.

### Phase 1: Foundation

- Add shadcn-solid setup.
- Convert theme to shadcn default neutral tokens.
- Replace/align base UI primitives.
- Build app shell skeleton: task rail, command bar, explorer, context panel.

Exit criteria:

- App builds with new primitive layer.
- Existing protected and guest routes still render.
- Shell can wrap at least Home and one secondary route.
- Light/dark neutral tokens are visible and stable.

### Phase 2: Experience API

- Add aggregate endpoints and service tests.
- Implement command-center snapshot, library explorer, command search, study
  queue, deck workspace, create preview/commit, and insights overview.

Exit criteria:

- New routes/services have backend tests for success, empty, and auth/error
  states.
- Frontend can query mocked or real aggregate shapes without ad hoc response
  interpretation.
- Existing API routes remain compatible.

### Phase 3: Core Workspaces

- Redesign Home.
- Redesign Study.
- Redesign Library.
- Redesign Deck/Card workspace.
- Redesign Create.
- Redesign Insights.
- Migrate graph, heatmap, duplicate scanner, and AI suggestions into the new
  workspace patterns.

Exit criteria:

- Home, Study, Library, Deck/Card, Create, and Insights are usable end to end.
- Command search can navigate to core entities and run safe actions.
- Context panel has route-specific content for each core workspace.
- Heavy graph/heatmap content lazy-loads.

### Phase 4: Supporting Surfaces

- Redesign Settings.
- Redesign Docs.
- Redesign Feedback.
- Redesign Auth/status pages.
- Redesign Not Found.

Exit criteria:

- Every current route listed in the route inventory renders in the new system.
- Auth redirects and token flows still work.
- Supporting surfaces meet their acceptance criteria.

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

Exit criteria:

- All automated verification passes.
- Desktop, tablet, and mobile route walkthroughs pass.
- No known blocking accessibility, layout overlap, or blank-state defects
  remain.

## Planning Boundaries

The implementation plan should be decomposed into epics with disjoint ownership
where possible:

1. UI primitive and theme foundation.
2. Shell/navigation/responsive layout.
3. Backend aggregate APIs.
4. Command search and action registry.
5. Home and Insights.
6. Study workspace.
7. Library and Deck/Card workspace.
8. Create/import/AI preview workflow.
9. Supporting routes.
10. QA polish.

Dependencies:

- Foundation precedes all redesigned screens.
- API contracts precede data-rich workspace implementation.
- Shell precedes route migration.
- Command action registry precedes command-search execution.
- Supporting routes can run after the main shell is stable.

The plan may split these epics into multiple PRs or checkpoints. A checkpoint
must not leave protected routes unreachable, auth broken, or core study review
behavior unusable.

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
