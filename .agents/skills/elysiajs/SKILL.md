---
name: elysiajs
description: Use when writing, reviewing, or debugging ElysiaJS routes, plugins, or validation schemas — covers method-chaining type inference, the `t` validator namespace, life-cycle hook order (derive/resolve/beforeHandle/onError), plugin scope (local/scoped/global), and Eden Treaty type-safety failures (e.g. "Property X does not exist", a collapsed `App` type, stray TS2339/TS7053 errors).
---

# ElysiaJS

Reference for Elysia's structural type system, not a tutorial. Elysia infers request/response types from how you chain calls and what schemas you attach — break either one and the compiler stops catching your mistakes, often far from where you broke it. Written against Elysia `^1.4` (this repo's `apps/api` version); the mechanics below are stable across the 1.x line.

Project-specific conventions (error contract, auth middleware, module layout) live in `AGENTS.md` and `docs/agents/api-conventions.md` — this skill covers Elysia-the-framework, not this repo's rules on top of it.

## Quick Reference

| Concern | API | Notes |
|---|---|---|
| Body/query/params validation | `t.Object`, `t.String`, `t.Number`, `t.Array`, `t.Union`, `t.Optional`, `t.Cookie` | TypeBox under the hood; also validates headers and per-status responses |
| Route-local validation | 3rd arg of `.get/.post/...` | Takes precedence over `.guard()` |
| Shared validation across routes | `.guard({ query: t.Object({...}) })` | `override` (default) or `standalone` merge strategy |
| Inject data before validation | `.derive((ctx) => ({...}))` | Runs in `transform`; input is **unvalidated** |
| Inject data after validation | `.resolve((ctx) => ({...}))` | Runs in `beforeHandle`; official guidance: prefer this "in most cases" — it's the safer default |
| Hook/plugin visibility | `{ as: 'local' \| 'scoped' \| 'global' }` | local = this instance only; scoped = propagates one level up; global = everywhere |
| Detect a validation failure | `onError(({ code, error }) => code === 'VALIDATION')` | `error.all[0].message` / `.summary` has the first failing field |
| End-to-end client types | `export type App = typeof app` + `treaty<App>(url)` | The whole client's type safety hangs on this one export |

## Method chaining is the type system

Every `.get/.post/.use/.derive/...` call returns a **new, more specific type**. Elysia has no separate "controller class" concept — the instance itself accumulates the type. Reassigning to a variable or extracting a step breaks the chain and Elysia falls back to a widened type.

```ts
// ✅ stays chained — full inference all the way down
const app = new Elysia()
  .decorate('db', db)
  .derive(({ headers }) => ({ userId: headers['x-user-id'] }))
  .get('/me', ({ db, userId }) => db.users.find(userId))

// ❌ breaks the chain — `app` loses the decorate/derive types before .get sees them
let app = new Elysia()
app = app.decorate('db', db)
app = app.derive(({ headers }) => ({ userId: headers['x-user-id'] }))
app.get('/me', ({ db, userId }) => db.users.find(userId))  // userId/db types degrade
```

**Controller anti-pattern** (official Elysia guidance): passing the whole `Context` into a plain class/function loses type integrity and locks the code to Elysia's `Context` shape.

```ts
// ❌ Don't — Context passed whole, hard to test, type integrity lost
class WidgetController {
  static root(context: Context) { return WidgetService.list(context.query) }
}
app.get('/', WidgetController.root)

// ✅ Do — destructure only what the handler needs, delegate to a plain function
app.get('/', ({ query }) => widgetService.list(query))
```

## Schema is the single source of truth

Don't hand-write a TypeScript `interface` next to a `t.Object` — the schema **is** the type. Extract it with `typeof schema.static` when you need the plain TS type elsewhere.

```ts
const CreateWidget = t.Object({
  name: t.String({ minLength: 1 }),
  tags: t.Optional(t.Array(t.String(), { maxItems: 10 })),
  priority: t.Union([t.Literal('low'), t.Literal('high')]),
})
type CreateWidget = typeof CreateWidget.static   // ✅ derived, never duplicated by hand

app.post('/widgets', ({ body }) => create(body), { body: CreateWidget })
```

Six places a schema can apply: `body`, `query`, `params`, `headers` (`additionalProperties: true` by default), `cookie` (`t.Cookie`), and per-status `response` (`{ 200: schema, 422: schema }`). Query/params are auto-coerced to the declared type (a numeric string becomes `number` if the schema says `t.Number()`).

**Local beats global.** A route's own 3rd-arg schema always wins over a `.guard()` schema for the same field.

```ts
app
  .guard({ query: t.Object({ page: t.Numeric() }) })     // applies to every route below
  .get('/a', ({ query }) => query)                        // uses the guard schema
  .get('/b', ({ query }) => query, {
    query: t.Object({ page: t.Numeric(), limit: t.Numeric() }),  // ✅ this one wins here
  })
```

## Detecting a validation failure

```ts
app.onError(({ code, error, set }) => {
  if (code === 'VALIDATION') {
    set.status = 422
    return { error: error.all[0]?.summary ?? error.all[0]?.message ?? 'Validation failed' }
  }
})
```

`error.all` lists every failing field (OpenAPI-shaped, each with a `path`); `error.all[0]` is usually enough for a single-message API error body.

## Life-cycle order — and why registration position matters

```
request → parse → transform (derive here) → beforeHandle (resolve here) → handler
        → afterHandle → mapResponse → onError → afterResponse
```

**A hook only applies to routes registered *after* it** (except `onRequest`, which is inherently global — it fires before Elysia knows which route matched):

```ts
new Elysia()
  .onBeforeHandle(() => console.log('1'))
  .get('/', () => 'hi')          // sees hook '1'
  .onBeforeHandle(() => console.log('2'))
  .get('/late', () => 'bye')     // sees hooks '1' AND '2'
```

The exact same rule governs `.use(somePlugin)` — routes inside a plugin only inherit hooks that were registered on the parent *before* `.use()` ran. This is why, in a real app, `.use(requireAuth)` has to sit above the routes you want protected, and public routes must be declared above that line.

**`derive` vs `resolve`** — both inject context with identical syntax, but timing differs:

```ts
app
  .derive(({ headers }) => ({                 // runs in `transform`, BEFORE validation
    rawUserId: headers['x-user-id'],           // headers/body here are still unvalidated
  }))
  .resolve(({ body }) => ({                    // runs in `beforeHandle`, AFTER validation
    validatedBody: body,                        // safe to trust the shape here
  }), { body: t.Object({ name: t.String() }) })
```

Official guidance: prefer `resolve` "in most cases" — it only ever sees data that already passed schema validation. Reach for `derive` when you need the value *before* validation runs (e.g. deciding which schema to even apply), or when it doesn't depend on `body`/`query` at all (auth from a cookie header is a common legitimate `derive` use, since cookies aren't schema-validated).

**Scope** governs *where* a hook/plugin's effect is visible, independent of registration order:

| Scope | Visible to |
|---|---|
| `local` (default) | Only this Elysia instance's own routes |
| `scoped` | This instance's routes **and** the parent that `.use()`s it — one level up, no further |
| `global` | Every instance in the whole app, however deeply nested |

A `derive({ as: 'scoped' })` inside a sub-plugin will NOT leak onto routes the root app registers after mounting that plugin — but it WILL apply to routes the parent registers on itself after the `.use()` call, since scoped propagates exactly one level up.

## Eden Treaty: one untyped route breaks every route

```ts
export type App = typeof app          // apps/api: the whole client contract
const api = treaty<App>(apiUrl)       // apps/web: point-free, fully-typed client
api.widgets.get()                     // path segments -> properties, dynamic segments -> calls
```

Eden Treaty walks `typeof app` structurally — it has no separate schema registry. **If even one route has an untyped handler and no `t` schema, TypeScript can't prove what that route returns, and it widens the *entire* `App` type to an index signature.** Every other route's specific types disappear along with it — not just the broken one.

```ts
// ❌ context typed `any`, no `t` schema — this ALONE can break inference for the whole app
export const widgetRoutes = new Elysia({ prefix: '/widgets' })
  .get('/', ({ query }: any) => widgetService.list(query))

// apps/web/src/lib/client.ts
api.decks.get()          // TS2339: Property 'get' does not exist  ← unrelated route, also broken
api.widgets.get()        // silently `any` — the bug you actually introduced

// ✅ fix: typed handler + schema restores inference everywhere
export const widgetRoutes = new Elysia({ prefix: '/widgets' })
  .get('/', ({ query }) => widgetService.list(query), {
    query: t.Object({ q: t.Optional(t.String()) }),
  })
```

**Symptom checklist** — if you see any of these on the *client* side, suspect an untyped route on the API side first, not a client bug: `TS2339 Property '...' does not exist on type`, `TS7053 Element implicitly has an 'any' type`, a route indexed with `['some-path']` that used to be `.somePath`, or a sudden wave of unrelated type errors after adding one new endpoint.

## Common mistakes

| Mistake | Why it breaks | Fix |
|---|---|---|
| Reassigning `app = app.use(...)` instead of chaining | Loses accumulated type between statements | Keep one unbroken chain, or return the extended instance from a function |
| Declaring an `interface` next to a `t.Object` for the "same" shape | Two sources of truth drift apart silently | Derive the type with `typeof schema.static` |
| Passing whole `Context` into a class/service method | Locks business logic to Elysia's types, hard to unit test | Destructure only the fields the function needs |
| One handler typed `(ctx: any)` with no schema | Collapses Eden's `App` type for the **entire** app, not just that route | Add a `t` schema and let the handler's context stay inferred |
| Using `derive` for data you're about to trust as validated | `derive` runs before validation — the shape isn't guaranteed yet | Use `resolve` once validation has run, unless you need the value pre-validation |
| Assuming a hook applies to a route registered before it | Elysia only applies hooks going forward from registration point | Register global/shared hooks (or `.use(authPlugin)`) above the routes that need them |
| Expecting a `scoped` hook to reach two levels up | Scoped propagates exactly one level, not transitively | Use `global` if it truly needs to reach everywhere |

## Sources

[elysiajs.com/essential/best-practice](https://elysiajs.com/essential/best-practice) · [elysiajs.com/essential/validation](https://elysiajs.com/essential/validation) · [elysiajs.com/essential/life-cycle](https://elysiajs.com/essential/life-cycle)
