# Frontend (`apps/web`)

SolidJS 1.9 SPA on Vite 7, TanStack Solid Query 5, `@solidjs/router` 0.15, Tailwind CSS **v4** (CSS-first config), Kobalte 0.13 headless primitives, Eden Treaty client. 111 `.ts`/`.tsx` files, 13 routes, 13 page components, 60 components (28 in `components/ui/`), 7 stores.

## SolidJS rules — non-negotiable

**1. Never destructure or alias props.** Solid props are a reactive proxy; destructuring reads the value once and kills reactivity. Zero files in `apps/web` destructure today — keep it that way.

```tsx
// ✗ dead on arrival
const Widget = ({ title, items }: Props) => <h1>{title}</h1>;
const Widget = (props: Props) => { const t = props.title; return <h1>{t}</h1>; };

// ✓
const Widget: Component<Props> = (props) => <h1>{props.title}</h1>;

// ✓ when you need to spread
const [local, others] = splitProps(props, ['class', 'variant']);
return <button class={cn(buttonVariants({ variant: local.variant }), local.class)} {...others} />;
```

Spread `{...others}` **last**. Use `mergeProps` only to default a whole prop object.

**2. Derivations are thunks; `createMemo` is for expensive or identity-stable work.**

```tsx
const total = () => a() + b();                      // ✓ cheap derivation
const idSet = createMemo(() => new Set(ids()));     // ✓ new object each run — needs memo
```

**3. Control flow is components, not JavaScript.** `<Show when fallback>` for conditionals, `<For each>` for keyed lists, `<Index each>` **only** when children are position-stable inputs that must keep focus (`array-input.tsx:51`, `template-builder.tsx:225`). Never `array.map()` in reactive JSX except a static never-reordered list.

**4. Every listener/timer/observer gets an `onCleanup`** in the same scope — document listeners, `ResizeObserver`, patched history methods.

**5. Module-scope reactivity must be wrapped in `createRoot`.** A bare `createSignal` at module scope is fine; `createEffect` or `createQuery` is not (`theme.store.ts:43`, `notifications.store.ts:15`).

**6. Forbidden React idioms** — none appear in the codebase and none may be introduced:

| Never | Use |
|---|---|
| `useState` / `useEffect` / `useMemo` / `useCallback` / `useRef` | `createSignal` / `createEffect` / `createMemo` / plain fn / `ref={el => …}` or `let el!: HTMLDivElement` |
| `className` | `class` |
| `htmlFor` | `for` |
| `onChange` on a text input | `onInput` |
| `key` prop | `<For>` keys by reference |
| `React.Fragment` | `<>…</>` |
| early `return` in a component body to change rendering | `<Show>` |
| conditional hook calls | — |

## Entry and routing

`index.tsx` imports `app.css`, side-effect-imports `./stores/theme.store` (so the dark class lands before first paint), **manually removes `#app-loading-shell`** (Solid's `render` appends rather than replacing `innerHTML`), then renders. It also imports `solid-devtools` as an unguarded runtime side effect.

`app.tsx` wraps everything in `AppErrorBoundary` → `QueryClientProvider` → `Router`. The `Router` `root` renders `props.children` + `<RouteAnnouncer/>` + `<Toaster/>` + `<Suspense><FocusDrawer/></Suspense>`. Lazy route components are **not** individually wrapped in `Suspense`.

Guards are two stable components composed by factories:

```tsx
const guest   = (Page: Component) => () => <GuestRoute><Page /></GuestRoute>;
const protect = (Page: Component) => () => <ProtectedRoute><AppShell><Page /></AppShell></ProtectedRoute>;
```

`ProtectedRoute` shows `LoadingScreen` while `isLoading()`, then `<Navigate href="/login">` if no `currentUser()`. `GuestRoute` redirects to `/` when a user *is* present. Session bootstrap is a single `onMount(() => fetchCurrentUser())`; `auth.store` starts `isLoading = true`.

| Route | Page | Load | Guard + shell |
|---|---|---|---|
| `/login` | login | eager | `guest` |
| `/register` | register | eager | `guest` |
| `/reset-password` | reset-password | eager | **none** |
| `/verify-email` | verify-email | eager | **none** |
| `/` | dashboard | eager | `protect` |
| `/folder/:folderId` | folder-view | lazy | `protect` |
| `/deck/:deckId` | deck-view | lazy | `protect` |
| `/study/interleaved` | interleaved-study | lazy | `protect` |
| `/study/:deckId` | study-mode | lazy | `protect` |
| `/settings` | settings | lazy | `protect` |
| `/feedback` | feedback | lazy | `protect` |
| `/docs` | docs | lazy | `protect` |
| `*` | not-found | lazy | **none** |

Login/register/reset-password/verify-email/dashboard are eager **on purpose** — a comment records that lazy-loading them interacted badly with the Router's Suspense. Keep it that way. `FocusDrawer` is lazy because it pulls in Three.js (~500 KB) via the reward popup.

## API client

```ts
export const api = treaty<App>(API_URL, {
  onRequest(path, options) { /* sets x-timezone-offset on EVERY request */ },
  fetch: { credentials: 'include' },
});
```

`API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'` — configurable at build time (`apps/web/.env.example`). `App` crosses the workspace boundary as a **relative source import**: `import type { App } from '../../../api/src/index'`.

> **The Vite `/api` proxy is dead config.** Both `server.proxy` and `preview.proxy` map `/api` → `:3001` with a prefix-stripping rewrite, but no code in `apps/web` ever requests an `/api` URL. Every request is absolute and cross-origin — which is why `credentials: 'include'` is required and why the API's `ALLOWED_ORIGINS` must include `http://localhost:3002`. Do not add an `/api` prefix to Elysia routes "to match the frontend", and do not expect proxy edits to have any effect.

`getApiError(error)` is the single error-normalisation boundary: a recursive walker over `Error.value`, arrays, the candidate keys `value`/`error`/`message`/`summary`/`detail`/`response`/`data`/`body`/`cause`, and even property getters, with an `[object Object]` guard and `'An unknown error occurred'` as the floor. **Its existence is why the API's `{ error: string }` body shape must never change.** Always route failures through it; never construct `fetch()` calls or hand-write API URLs.

> Because Eden inference is currently broken (see [known-issues.md](known-issues.md)), existing code casts: `(api as any).users.profile.patch`, `(api.dashboard as any)['command-center']`. Adding a new API route will **not** give you typed access until the `App` type is repaired.

## Data fetching

`lib/query-client.ts` — one `QueryClient`: `staleTime` **5 min**, `gcTime` **30 min**, `retry` **1**, `refetchOnWindowFocus` **true**. No mutation defaults. This, not any API header, is why a widget can show stale numbers after a mutation.

`experienceQueryKeys` (`lib/experience-api.ts:47-56`) is the canonical key factory:

```ts
commandCenter()    → ['command-center']
libraryExplorer()  → ['library-explorer']
commandSearch(q)   → ['command-search', q ?? null]
studyQueue(q)      → ['study-queue', q]
deckWorkspace(id,q)→ ['deck-workspace', id, q ?? null]
insightsOverview() → ['insights-overview']
```

Fetch experience endpoints only through `createExperienceApi` / `experienceApi`, key them with `experienceQueryKeys`, and let `AppShell.invalidateExperienceQueries` do invalidation. **Never call `queryClient.invalidateQueries` with an ad-hoc literal from a component.** Per-query overrides in use: library explorer 60 s, command center 30 s, command search 15 s.

Two existing violations, do not copy: `dashboard.tsx:170` uses `['experience-command-center', userId]` and `global-search.tsx:78` uses `['command-search', q, pathname]` — neither matches what the shell invalidates.

## Stores

7 module-scope stores, all `createSignal` pairs (no `createStore` — the only `solid-js/store` user is `pages/deck-view/ai-generate-modal.tsx`). The pattern is **read-only accessors + imperative action functions**, setter kept private:

```ts
const [theme, setTheme_] = createSignal<Theme>(read());
export { theme };
export function setTheme(next: Theme) { … }
```

| Store | Exposes | Notes |
|---|---|---|
| `auth.store` | `currentUser`, `isLoading`, `fetchCurrentUser`, `login`, `register`, `logout`, `updateProfile` | `logout()` also calls `queryClient.clear()` |
| `theme.store` | `theme`, `resolvedTheme`, `setTheme`, `toggleTheme` | `'engram-theme'`; `createRoot` effect writes the class on `<html>`; registers a `matchMedia` listener at module scope **with no cleanup** (leaks in tests) |
| `focus.store` | timer + session signals, `getStats`, … | `'engram-focus'`, trimmed to 200 sessions. **Runs side effects at import time** — resumes or completes an in-flight session, mutating localStorage |
| `notifications.store` | `dueDecks`, `totalDue`, `hasDue`, `refetchDue` | `createRoot` + `createQuery` on `['notifications']`, polling every `NOTIFICATIONS_POLL_MS` = 5 min. The query starts as soon as any component imports the module |
| `search.store` | `searchOpen`, `openSearch`, `closeSearch`, `toggleSearch` | |
| `toast.store` | `toasts`, `addToast`, `removeToast`, `toast.{success,error,info,warning}` | Dual-tracked: keeps a legacy signal in sync with `solid-sonner`. Calling solid-sonner directly desynchronises it |
| `sidebar.store` | — | **DEAD** — only the dead `components/layout/` files import it |

localStorage is touched by exactly three subsystems: theme, focus, and the shell panel keys.

## The app shell

`components/app-shell/` (12 files, ~1 920 lines) is **canonical** — `app.tsx:69` wraps every protected page in `<AppShell>`. Regions: `TaskRail` (64 px desktop icon rail, `md:flex`) · `LibraryExplorer` (resizable left aside, mobile Sheet) · `CommandBar` (top bar, panel toggles, Ctrl+K launcher) · `<main id="main-content">` · `ContextPanel` (resizable right aside, mobile Sheet) · `MobileBottomNav` (`md:hidden`).

**Extract branchable logic into a sibling `*-state.ts` of pure functions with a colocated `*-state.test.ts`.** That is the established pattern (`app-shell-state.ts`, `library-explorer-state.ts`) — do not put testable logic in the `.tsx`.

Panel geometry lives in `app-shell-state.ts`: explorer `{min 240, max 420, default 296}`, context `{min 280, max 460, default 340}`, persisted under `engram.shell.explorerWidth` / `contextWidth` / `explorerCollapsed` / `contextCollapsed`. Keep localStorage access behind `readStoredPanelWidth` / `readStoredBoolean` / `writeStoredValue` and guard `typeof window === 'undefined'`.

Desktop vs mobile is decided by `matchMedia('(min-width: 1280px)')`: above it panels collapse in place, below they open as Kobalte Sheets. Resizing is a pointer-capture drag plus ArrowLeft/ArrowRight on a `role="separator"` handle (16 px step, 40 px with Shift).

Pages are *meant* to register right-panel content and selection context through two hooks — `useRegisterContextPanel(accessor)` and `useRegisterActionContext(accessor, keys)`, both `createEffect` + `onCleanup`. Note there is **no page-level example to copy yet**: `useRegisterContextPanel` has zero callers anywhere, and `useRegisterActionContext` is called exactly once, from inside the shell itself (`library-explorer.tsx:88`). `useAppShell()` **throws** outside the provider, so no page on one of the five non-`protect()` routes (login, register, reset-password, verify-email, not-found) may call it.

### Shell caveats

- `#main-content` exists **only inside AppShell** (`protect()` is the sole place it is used), so the `index.html` skip link and `RouteAnnouncer`'s focus call are no-ops on the **five** unshelled routes: `/login`, `/register`, `/reset-password`, `/verify-email` and `*`.
- `protect()` instantiates AppShell **per route component**, so navigating between different pages remounts it and re-reads panel state from localStorage; the `on(pathname, …, {defer:true})` reset only matters for same-component navigation like `/deck/a` → `/deck/b`.
- Sheet-wrapped panels are double-gated (`<Sheet open>` **and** an inner `<Show>`). Removing the `Show` would mount the explorer and its queries permanently on mobile.
- `ContextPanel` takes `descriptor` as an **Accessor**, not a value. Passing a plain object breaks reactivity silently.
- `TaskRail` and `MobileBottomNav` duplicate the same 6-item nav definition byte-for-byte. Any nav change must be made in **both** files.
- Ctrl/Cmd+K is bound by a document listener inside `GlobalSearch` (lazy-loaded from `CommandBar`), not by the shell.

### Command actions

`lib/command-actions.ts` holds 14 definitions in a frozen `commandActionOrder` array. Each has `id`, `label`, `keywords`, `requiredParams` (declared everywhere, **read nowhere**), `validateParams` and `run`. `CommandActionResult` is a 3-variant union:

```ts
| { status: 'success'; message?; navigateTo?; invalidate? }
| { status: 'error'; message; fieldErrors? }
| { status: 'confirm'; title; description; confirmLabel; destructive?; onConfirmAction }
```

Actions **never throw** — `createCommandActionRunner` catches and converts to an error result. In wrappers/services throw normalised `Error`s (`throw new Error(getApiError(response.error))`); in actions return the union.

When adding an action: append the id to `commandActionOrder`, add the definition, and **update the id-list assertion in `command-actions.test.ts:15`**.

Actions return synthetic routes (`/study?mode=…`, `/library?…`, `/create?…`, `/insights`) that **do not exist in the router**. They work only because `AppShell.resolveAvailableRoute()` rewrites them to real paths — **and drops the query string**, so `study.startQueue` with `mode:'at-risk'` lands on `/study/interleaved` with the mode lost. If you use the runner outside AppShell you must replicate that mapping.

Only two invalidation bundles exist: `studyQueue = ['study-queue','command-center']` and `deckMutation = ['library-explorer','command-center']`. Nothing invalidates `deck-workspace`, `insights-overview` or `command-search`.

## UI primitives

`components/ui/` — 28 files, 83 exported components (79 via `export const`/`export function`, plus `Skeleton`, `ArrayInput`, `Toaster` and `AppErrorBoundary` exported as defaults). 9 wrap Kobalte (dialog, dropdown-menu, select, sheet, switch, checkbox, tabs, tooltip, alert-dialog), `command.tsx` wraps `cmdk-solid`, `sonner.tsx` wraps `solid-sonner`, 3 use `class-variance-authority` (button, badge, alert).

The shadcn-for-Solid convention:

```tsx
const buttonVariants = cva('base classes', { variants: {…}, defaultVariants: {…} });

export const Button: Component<JSX.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>> =
  (props) => {
    const [local, others] = splitProps(props, ['class', 'variant', 'size']);
    return <button class={cn(buttonVariants({ variant: local.variant, size: local.size }), local.class)} {...others} />;
  };

export { buttonVariants };   // re-export the variants object
```

`cn()` = `twMerge(clsx(inputs))` from `lib/utils.ts` — the **only** class-merge helper, used by 32 files. `cva` is not universal: `progress`, `sheet`, `skeleton` and `spinner` use plain lookup maps instead; either is acceptable.

New primitives go in `components/ui/`, prefer a Kobalte headless base, declare variants at module scope, re-export them. Icons come from `lucide-solid` only; every icon-only control needs an `aria-label`, and use `aria-current` / `aria-pressed` for state.

Note `Tooltip` is a convenience wrapper: passing `content` auto-renders trigger + portalled content; omitting it renders children bare.

## Styling

`app.css` (803 lines) is Tailwind v4 CSS-first — **there is no `tailwind.config.js/ts` anywhere.** Structure: `@import 'tailwindcss'` · `@custom-variant dark (&:where(.dark, .dark *))` · one `@theme` token block (L11-207) · a `.dark` override block (L209-290) · `@layer base` (L292-433) · `@layer utilities` (L434-775) · keyframes · a `prefers-reduced-motion` block (L776-803).

Dark mode is **class-based**, driven by `theme.store` putting `.dark` on `<html>`. Use `dark:` variants; never add `@media (prefers-color-scheme)` in component CSS.

Style with the semantic tokens (`bg-background`, `text-foreground`, `bg-muted`, `border`, `ring`, `destructive`, `success`, `warning`, `info`). **Never hardcode a hex value in a component** — add a token to `@theme` plus its `.dark` override.

> `apps/web/src/app.css` is the **only** source of truth for design tokens. `docs/ui/design.md` is superseded — it predates even the palette described below.
>
> **Palette provenance (rewritten again as of this doc revision, superseding the earlier "shadcn/zinc" rewrite this note used to describe).** Both `@theme` (light) and `.dark` now copy hex values verbatim from a reference dashboard template's own stylesheet — see the `/* source: ... */` comments inline in `app.css` — not from eyeballing a screenshot. Dark: background/sidebar `#171b23`, card `#1d2430`, border `#2c3442`, foreground `#ecf0f7`. Light mirrors the same template's light block. Do not re-sample a screenshot to adjust these; diff against the template source instead.
>
> **Text tokens vs. fill tokens — two different jobs, do not conflate them.** `--color-due/new/learning/risk/forecast/destructive` (and the `success`/`warning`/`info` aliases) are for **text and borders**; they're tuned per-theme to clear 4.5:1 against both white and their own tinted `-surface`, so light-mode `--color-risk` is a dark amber `#96620f`, not a pastel. `--color-*-fill` / `-fill-foreground` are a **separate set**, identical in both themes (no `.dark` override) — the reference template's actual chart pastels (`#89b5ff`, `#a1e3b5`, `#f0dbff`, `#ffd9a8`, `#fac6cd`), meant for icon chips, chart bars, meter segments and badge fills (solid pastel fill + dark glyph on top — the reference's avatar treatment). Putting a `-fill` token behind body text on a light background is close to unreadable (~1.6:1); putting the text-role token on a chip makes the chip look like the pre-rewrite "dark chip, thin pastel icon" version users found insufficiently pastel. `badge.tsx` and every dashboard stat/chart chip already follow this split — copy their pattern for new chip-shaped UI, not the old `bg-<name>-surface text-<name>` combination that still appears on non-chip pill/alert uses (banners, destructive buttons) where a saturated surface is correct.
>
> **Font**: `--font-sans` leads with `'Inter'`, self-hosted via `@fontsource/inter` (weights 400/500/600/700 only — the four the codebase actually uses — imported in `index.tsx` before `app.css`). This is the **static**, not variable, package; adding a fifth weight (e.g. `font-light`) requires importing that weight's CSS too or the browser synthesizes it.
>
> The CTA gradient utility classes were **de-gradiented, not removed**: `.btn-gradient` and `.bg-section-gradient` (`app.css` `@layer utilities`, commented "Legacy class names retained without gradient styling") are now flat `background-color: var(--color-primary)` / `var(--color-surface)` — plain semantic-token fills with no `.dark` override needed, since the token already varies. `.btn-gradient` currently has **zero callers** anywhere in `apps/web`. `.bg-section-gradient` has exactly one *live* caller, `dashboard/forecast-widget.tsx`; its other caller, `dashboard/smart-groups-widget.tsx`, is dead code (see [known-issues.md](known-issues.md)). Do not assume either class still renders a gradient — style search results off the class name will mislead you.
>
> Vestigial: `app.css:181-182` still define `--sidebar-width: 16rem` and `--sidebar-collapsed-width: 3.5rem`. The only consumer is the `.w-sidebar` utility (`@layer utilities`), which has **zero usages** in any `.tsx` — the app-shell explorer uses 296 px with 240–420 bounds from `app-shell-state.ts` instead.

`index.html`'s pre-JS loading shell is still internally inconsistent with the app: it hardcodes a **retired** palette (`--loading-background: #111215` etc., matching neither the current nor any prior documented `.dark` values) and switches on `@media (prefers-color-scheme: dark)` while the app itself is class-based, so a user with a light OS and a dark app preference gets a light flash before JS paints. Unlike an earlier version of this doc claimed, it does **not** currently reference Google Fonts at all — no `<link>`/`preconnect` to `fonts.googleapis.com` exists; Inter loads exclusively through the self-hosted `@fontsource/inter` import above.

## Build config

`vite.config.ts`: plugin order `devtools()` → `solid()` → `tailwindcss()`; the only alias is `@` → `src` (mirrored in `tsconfig.json` paths); dev port **3002**, preview **4173**; `build.target: 'es2020'`, `chunkSizeWarningLimit: 600`, `cssCodeSplit: true`.

`manualChunks` buckets — **extend this when you add a heavy dependency**:

| Bucket | Contents |
|---|---|
| `solid` | `solid-js`, `@solidjs/router` |
| `query` | `@tanstack/*` |
| `three` | `three` |
| `icons` | `lucide-solid` |

`tsconfig.json`: `jsx: 'preserve'` with `jsxImportSource: 'solid-js'`, `moduleResolution: 'bundler'`, `strict`, `types: ['vite/client']`. The `include` of `src/**/*.ts(x)` sweeps in the 4 colocated test files, so a type error in a test breaks CI; `bun:test` types resolve via the root `bun-types` hoist.

**Untyped npm package?** Hand-write a `declare module` shim in `apps/web/src/types/` — see `cytoscape-dagre.d.ts` and `cytoscape-fcose.d.ts`. Do not reach for `as any` or `skipLibCheck`.

**Declare dependencies in the workspace that imports them.** `apps/web` currently imports root-hoisted `three` / `three-stdlib` (used only by `components/focus/dodecahedron-dice.tsx`) without declaring them — a latent breakage. If you touch that file, move `three`, `three-stdlib` and `@types/three` into `apps/web/package.json`.

## Helpers worth knowing

| File | What |
|---|---|
| `lib/virtual-list.tsx` | Hand-rolled **fixed-row-height** virtualizer (`overscan` default 3, `ResizeObserver`, `contain: strict`, `onReachEnd`). Used only by deck-view. Variable-height rows mis-position. Children signature is `(item, index: () => number)` — index is an **accessor** |
| `lib/create-debounced-signal.ts` | `[debounced, setValue, immediate]`. Used by global search (180 ms) and deck-view |
| `lib/use-focus-trap.ts` | **Dead code** — no callers. Kobalte overlays already trap focus; do not wire it in |
| `components/route-announcer.tsx` | Renders null; monkey-patches `history.pushState`/`replaceState` + listens to `popstate` to focus `#main-content`, restoring the originals in `onCleanup` |
| `components/deck-view/graph-view.tsx` | Cytoscape: `cytoscape.use(dagre)` at module scope, imperative `Core` instance with manual `onCleanup`, node colours from retention thresholds 0.8/0.6 in `retentionColor()`. `cytoscape-fcose` is installed and typed but **imported nowhere** |
| `pages/docs.tsx` | `marked.parse()` piped through a hand-rolled `sanitizeHtml()` (DOMParser + allowlist) and a separate `sanitizeSvg()`, feeding two `innerHTML=` sinks with content fetched at runtime from `/docs/*`. **Any new doc-rendering surface must reuse those sanitizers** |
| `constants/index.ts` | `REVIEW_ACTIONS`, `AI_SOURCE_MIN_CHARS`/`MAX_CHARS` (10 / 10 000 — explicitly "must stay in sync with `ai.routes.ts`"), `KEYBOARD_SHORTCUTS` (Space/1/2/3/4), `ROUTES`, `STREAK_MESSAGES`, `HEATMAP_LEVELS` (still references retired `bg-palette-*` tokens), `NOTIFICATIONS_POLL_MS`, `WORD_TYPES` |

## The legacy layout tree

`components/layout/` still exists but only **`page-shell.tsx` is live** — now a pure max-width/scroll wrapper (`maxWidth` default `max-w-content`, optional `noScroll`) used by dashboard, deck-view-page, docs, feedback, folder-view and settings.

`header.tsx`, `mobile-nav.tsx`, `sidebar.tsx` and the 6 files in `layout/sidebar/` have **zero importers**, were last modified March 2026, and own **5 of the 22 tsc errors** (all in `sidebar/sidebar-context.tsx`). They are the only importers of `stores/sidebar.store.ts`. Never add features there. Deleting the tree is a cheaper partial fix for the error count than patching it — but that is its own task.

## Accessibility conventions

There is no explicit policy doc, but the code is consistent: a JS-free "Skip to content" link in `index.html` targeting `#main-content`; the `RouteAnnouncer` focusing that element after navigation; `aria-label` on every icon-only control; `aria-current` / `aria-pressed` for state; `role="separator"` with keyboard resize on the panel handles; a `prefers-reduced-motion` block in `app.css`. Match it. UI copy and code comments are **English** (several `docs/` files and `.agents/workflows/engram_workflow.md` are Vietnamese).

## Tests

4 files, 16 tests, all `bun:test`, all pure functions — `lib/experience-api.test.ts` (4), `lib/command-actions.test.ts` (5), `components/app-shell/app-shell-state.test.ts` (3), `components/app-shell/library-explorer-state.test.ts` (4).

**There is no `test` script in `apps/web/package.json`** — run `cd apps/web && bun test`. No jsdom, no `@solidjs/testing-library`, no happy-dom: **no component is ever rendered in a test**, so JSX regressions are caught only by typecheck and manual runs. Adding a component test requires adding a DOM environment first, which is a decision, not a drive-by. See [testing.md](testing.md).
