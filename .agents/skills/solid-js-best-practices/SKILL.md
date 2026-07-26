---
name: solid-js-best-practices
description: Use when writing, reviewing, or debugging SolidJS components, signals, stores, or JSX — covers fine-grained reactivity rules (why destructured props or component-body variables silently stop updating), Show/For/Index/Switch, onCleanup, module-scope reactive state, and porting React habits (useEffect, className, key props, early return) into Solid idioms.
---

# SolidJS Best Practices

Reference for Solid's reactivity model, not a tutorial. **A Solid component function body runs exactly once** — it is a setup function, not a render function. Everything that needs to update over time must live inside a signal, a memo, or JSX bound to one of those; a plain variable read once at setup time is frozen forever. Written against `solid-js ^1.9`, `@solidjs/router ^0.15`, `@tanstack/solid-query ^5` (this repo's `apps/web` versions).

Project-specific conventions (app-shell, stores, design tokens) live in `AGENTS.md` and `docs/agents/frontend.md` — this skill covers Solid-the-framework, not this repo's rules on top of it.

## Quick Reference

| Need | Use | Not |
|---|---|---|
| A reactive value | `createSignal` | `useState` |
| A value derived from other reactive values | plain function `() => a() + b()`, or `createMemo` if expensive/needs referential stability | `useMemo` |
| Run a side effect when dependencies change | `createEffect` | `useEffect` |
| Nested/object reactive state | `createStore` | mutating a plain object |
| Conditional rendering | `<Show when={} fallback={}>` | ternary that unmounts/remounts, or early `return` |
| Keyed list rendering | `<For each={}>` | `array.map()` inside JSX |
| Position-stable list (inputs that must keep focus) | `<Index each={}>` | `<For>` when items reorder |
| Cleanup a listener/timer/observer | `onCleanup(() => ...)` | relying on garbage collection |
| Reactive primitive at module scope | wrap in `createRoot(() => ...)` | bare `createEffect`/`createQuery` at module scope |
| Pass through DOM props while adding your own | `splitProps(props, [...])` | destructuring `props` |
| Default a whole props object | `mergeProps(defaults, props)` | `props.x ?? default` scattered everywhere |

## Never destructure props

Props in Solid are a reactive object of getters, not a plain object snapshot. Destructuring — or assigning `props.x` to a local `const` — reads the value **once**, at setup time, and detaches it from future updates.

```tsx
// ❌ dead on arrival — title is frozen to whatever it was on first render
const Badge: Component<{ title: string; count: number }> = ({ title, count }) => (
  <span>{title}: {count}</span>
);

// ❌ same bug, just delayed one line
const Badge: Component<{ title: string; count: number }> = (props) => {
  const { title, count } = props;
  return <span>{title}: {count}</span>;
};

// ✅ read through the accessor inside JSX — stays reactive
const Badge: Component<{ title: string; count: number }> = (props) => (
  <span>{props.title}: {props.count}</span>
);
```

**When you need to spread props onto a DOM element**, peel your own keys off with `splitProps` and spread the rest last — this keeps every prop, including the ones you didn't name, reactive:

```tsx
const Button: Component<ButtonProps> = (props) => {
  const [local, others] = splitProps(props, ['class', 'variant']);
  return <button class={cn(buttonVariants({ variant: local.variant }), local.class)} {...others} />;
};
```

**Use `mergeProps`** only to default an entire props object (not per-field fallbacks scattered through the component):

```tsx
const props = mergeProps({ size: 'md' as const }, initialProps);
```

## Derived values: thunk, memo, or effect?

```tsx
const total = () => a() + b();                       // ✅ cheap — recomputed on every read, that's fine
const idSet = createMemo(() => new Set(ids()));       // ✅ createMemo — result is a NEW object each run;
                                                        //    memoize so downstream consumers get referential stability
createEffect(() => {                                   // ✅ createEffect — for SIDE EFFECTS only
  document.title = pageTitle();                         //    (DOM writes, subscriptions, logging — not values you read elsewhere)
});
```

Reach for `createMemo` when the computation is expensive, or when its *result* needs to be the same object reference across reads (e.g. building a `Set`/`Map`, or reducing over a list) — not for every derived value. A plain accessor thunk is the default; it costs nothing extra and stays simplest.

**Never use `createEffect` to sync one signal into another.** That's the Solid equivalent of a `useEffect` dependency-array bug — it works, then breaks under a reordering or an extra update cycle. Derive it instead:

```tsx
// ❌ effect-to-sync-a-signal — timing-fragile, an extra render cycle behind
const [fullName, setFullName] = createSignal('');
createEffect(() => setFullName(`${first()} ${last()}`));

// ✅ just derive it — no signal needed at all
const fullName = () => `${first()} ${last()}`;
```

## Control flow is components, not JavaScript

Solid's compiler optimizes `<Show>`/`<For>`/`<Switch>` into fine-grained DOM patches. Plain JS control flow inside JSX (`? :`, `&&`, `.map()`) either fights that optimization or breaks it outright.

```tsx
// ❌ array.map() inside JSX — re-creates every child on every list change, no keying
<ul>{items().map((item) => <li>{item.name}</li>)}</ul>

// ✅ <For> — keyed by reference, only touches what changed
<For each={items()}>{(item) => <li>{item.name}</li>}</For>

// ✅ <Index> — keyed by POSITION instead of reference; use when children must stay
//    mounted across reorders (e.g. an input that must keep focus/cursor position)
<Index each={rows()}>{(row, i) => <input value={row().text} onInput={(e) => update(i, e.currentTarget.value)} />}</Index>

// ❌ early return to change what renders — components run ONCE, this branch is locked in forever
const Panel: Component<{ open: boolean }> = (props) => {
  if (!props.open) return null;          // never re-evaluated after first render
  return <div>content</div>;
};

// ✅ <Show> — the compiler manages the mount/unmount reactively
const Panel: Component<{ open: boolean }> = (props) => (
  <Show when={props.open}>
    <div>content</div>
  </Show>
);
```

A **static, never-reordered** list (e.g. a hardcoded nav-item array defined outside any reactive scope) is the one case where `.map()` is harmless — there's nothing to react to. If the list itself can change, use `<For>`.

## Cleanup and module-scope reactivity

Every listener, timer, or observer you create needs a matching `onCleanup` in the same scope:

```tsx
createEffect(() => {
  const id = setInterval(tick, 1000);
  onCleanup(() => clearInterval(id));
});
```

**A bare `createSignal` at module scope is fine** — it has no subscriptions to clean up. **`createEffect`, `createMemo`, or a query hook at module scope is not** — they need an owner to run under, and outside a component there isn't one unless you provide one:

```ts
// theme.store.ts — module scope, outside any component
const [theme, setTheme] = createSignal<Theme>(readStored());   // ✅ fine bare

createRoot(() => {
  createEffect(() => {                                          // ✅ wrapped — has an owner to dispose into
    document.documentElement.classList.toggle('dark', theme() === 'dark');
  });
});
```

## Forbidden React idioms

None of these appear in a Solid codebase; porting them in from React habit is the most common source of "it looks right but doesn't update" bugs.

| React | Solid | Why the React version breaks here |
|---|---|---|
| `useState` | `createSignal` | `useState` re-renders a component tree; Solid has no re-render step to trigger |
| `useEffect` | `createEffect` | Same name, different model — `createEffect` tracks signal reads automatically, no dependency array |
| `useMemo` / `useCallback` | `createMemo` / plain function | Solid doesn't need callback memoization — components don't re-run |
| `useRef` | `let el!: HTMLDivElement` + `ref={el => ...}`, or a signal | Solid refs are plain variables assigned once at setup |
| `className` | `class` | — |
| `htmlFor` | `for` | — |
| `onChange` on a text input | `onInput` | `onChange` only fires on blur/commit in the DOM; Solid exposes the raw DOM event name |
| `key` prop on list items | nothing — `<For>` keys by item reference automatically | Adding a `key` prop does nothing and signals a React mental model |
| Conditional/early `return` to change rendering | `<Show>` | The component body runs once; a `return` there is permanent, not per-update |
| `<React.Fragment>` | `<>...</>` | — |

## Ecosystem specifics used in this stack

**`@solidjs/router`** — routes are declared as JSX, not a config object; lazy-load with `lazy(() => import(...))` and wrap the mount point in `<Suspense>`:

```tsx
const SettingsPage = lazy(() => import('./pages/settings'));

<Router>
  <Route path="/settings" component={() => <Suspense><SettingsPage /></Suspense>} />
</Router>
```

Guard routes with a wrapper component, not a route-config `beforeEnter` — there isn't one:

```tsx
const ProtectedRoute: Component<{ children: any }> = (props) => (
  <Show when={currentUser()} fallback={<Navigate href="/login" />}>{props.children}</Show>
);
```

**`@tanstack/solid-query`** — `createQuery` takes an **options accessor** (a function), not a plain object, so the query key/enabled flag stay reactive:

```tsx
const query = createQuery(() => ({
  queryKey: ['widget', props.id],           // re-keys automatically when props.id changes
  queryFn: () => fetchWidget(props.id),
  enabled: !!props.id,
}));

<Show when={query.data}>{(data) => <WidgetCard widget={data()} />}</Show>
```

Invalidate through the shared `queryClient`, keyed by the same array shape used in `queryKey` — a literal ad-hoc key at the call site will not match and silently invalidates nothing.

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Destructuring props (directly or via a local `const`) | Value never updates after first render, no error | Read `props.x` inline, or `splitProps` when spreading |
| `array.map()` on a reactive list inside JSX | List re-mounts entirely on every change; loses input focus/state per row | `<For each={list()}>` |
| `<Index>` used for a list that reorders by identity | Wrong row's data appears to "jump" between items | `<For>` — `<Index>` is for position-stable content only |
| Early `return null` / ternary swap to hide a section | Section never reappears once hidden, or never appears at all | `<Show when={}>` |
| `createEffect` at module scope with no `createRoot` | Warning about missing reactive root, or the effect silently never runs | Wrap in `createRoot(() => ...)` |
| `createEffect` used to derive a value into a second signal | Value lags one tick behind, or diverges under fast updates | Derive directly with a plain function — skip the extra signal |
| `onChange` on a text `<input>` | Handler fires on blur, not on keystroke | `onInput` |
| Missing `onCleanup` for a `setInterval`/listener/`ResizeObserver` | Leaks accumulate across navigations, especially inside `<Show>`/`<For>` that mount/unmount repeatedly | Pair every setup with `onCleanup` in the same scope |
| `createQuery` given a plain object instead of an accessor function | Query key changes are never picked up after the first render | `createQuery(() => ({ queryKey: [...], ... }))` |
