# Testing

Everything runs on Bun's built-in runner (`bun:test`, Bun 1.3.10). **There is no Vitest, Jest, jsdom, Playwright, testcontainers or Solid testing-library anywhere**, and no test database — all I/O is mocked. Do not add integration/E2E tooling without an explicit decision.

## Commands

| What | Exact command | Current result |
|---|---|---|
| API tests | `cd apps/api && bun test` | 271 pass, **3 fail**, 576 assertions, 274 tests / 24 files, ~435 ms |
| API + coverage | `cd apps/api && bun run test:coverage` | same counts + `All files 60.08% funcs / 66.25% lines`; **exits 1** because of the 3 failures |
| API watch | `cd apps/api && bun run test:watch` | — |
| One API file | `cd apps/api && bun test __tests__/modules/cards/cards.service.test.ts` | — |
| **Web tests** | `cd apps/web && bun test` | 16 pass, 33 assertions, 16 tests / 4 files, ~57 ms |
| Typecheck (all CI runs) | `bun run typecheck` (root) | **FAILS** — api clean, web 22 errors, exit 2 |

`apps/web/package.json` has **no `test` script**; the bare runner is the only way. `bun run test` at the repo root is not a thing either — it prints `a package.json script "test" was not found` and shells out to `/usr/bin/test`, reporting a confusing exit 1.

> **Never run `bun test` from the repo root.** `apps/api/bunfig.toml` is CWD-relative, so the preload never loads and `apps/api/src/config/env.ts:33` throws `Missing required environment variable: DATABASE_URL`. All 15 tests in `__tests__/shared/embedding-utils.test.ts` silently vanish, a pino WARN leaks (the logger mock is also absent), and you get 276 tests / 272 pass / 4 fail / 1 error instead of 274 + 16. `bun test apps/api` from the root is equally broken (260 tests). It does *not* sweep `node_modules/`, `skills/`, `.agents/` or `docs/` — it finds exactly the 24 api + 4 web files.

`embedding-utils.test.ts` is the one file that breaks at root because it is the only api test that transitively imports the real `src/db/index.ts` (via `shared/embedding-utils.ts:2`) without importing the db mock.

## Layout

| Location | Convention |
|---|---|
| `apps/api/__tests__/` | Mirrors `src/`: `__tests__/modules/<module>/<name>.test.ts`, `__tests__/shared/<name>.test.ts` |
| `apps/api/__tests__/helpers/` | `db-mock.ts`, `external-mocks.ts`, `fixtures.ts` |
| `apps/api/__tests__/preload.ts` | Registered by `apps/api/bunfig.toml` |
| `apps/web/src/**/` | **Colocated** `<name>.test.ts` beside the source |
| `packages/*` | No tests |

Both tsconfigs typecheck their tests (`apps/api` includes `__tests__/**/*.ts`; `apps/web`'s `src/**/*.ts` sweeps in the colocated files), so **a type error in a test breaks the only CI gate.**

Import primitives from `'bun:test'` only, and use `test(...)` — never `it(...)`. Every existing file uses `test`.

## The DB mocking strategy

`__tests__/preload.ts` handles **only env and logging**: it `mock.module`s `src/config/env.ts` (twice — absolute path and `'../config/env'`) with a canned `ENV`, and `src/shared/logger.ts` (three times) with a noop logger whose `child()` returns itself.

> **It does *not* mock the database**, despite its own docstring claiming so. `DB_MODULE_PATH` and `DB_SCHEMA_PATH` on lines 11-12 are dead variables. DB isolation comes solely from importing `helpers/db-mock`.

`helpers/db-mock.ts` builds one self-returning object that stands in for the whole Drizzle fluent API:

| Group | Members | Behaviour |
|---|---|---|
| Builders | `select`, `from`, `where`, `innerJoin`, `leftJoin`, `groupBy`, `orderBy`, `insert`, `values`, `onConflictDoUpdate`, `update`, `set`, `delete` | return the chain itself, so any call order composes |
| Terminals | `limit`, `returning`, `execute` | `Promise.resolve(chain._returnValue)` |
| Thenable | `chain.then = (resolve) => resolve(chain._returnValue)` | lets a bare `await db.select().from(x).where(y)` with no terminal call resolve to rows |
| Transaction | `transaction: mock((fn) => fn(chain))` | runs the body immediately with the **same** chain as `tx`; no rollback simulation |

Interception is `mock.module(resolve(import.meta.dir, '../../src/db/index.ts'), …)`, called at import time and again on every `resetMocks()`. (The two extra registrations for `'../../db'` / `'../../db/index'` resolve to a nonexistent `apps/api/db` and are **inert** — do not copy that pattern.)

| Function | Use it when |
|---|---|
| `resetMocks()` | Always, in `beforeEach`. Rebuilds the chain and re-registers the module mock |
| `setMockReturn(rows)` | The service performs exactly **one** DB round-trip |
| `setMockReturnSequence([rows1, rows2, …])` | Several round-trips. Installs a shared cursor; yields `[]` once exhausted |

Count the awaits in the service and supply exactly that many arrays, each annotated with the query it satisfies:

```ts
setMockReturnSequence([
  [deck],  // verifyDeckOwnership
  [],      // SELECT … FOR UPDATE deck lock
  [],      // existing sortOrder query
  [card],  // insert … returning
]);
```

**Adding a mock for a new query shape.** The chain covers only `limit`, `returning`, `execute` and `then`. A service terminating with `.offset()`, `.having()`, `.for('update')`, `.union()`, or using `pgClient` directly, gets the chain object back instead of rows and fails confusingly. Add the method to `createChainMock` — self-returning if mid-chain, `mock(() => Promise.resolve(chain._returnValue))` if terminal — and if terminal, also add it to the `setMockReturnSequence` override block so it joins the cursor. **Prefer refactoring the new service to injectable loaders instead** (below).

Services that reference Drizzle columns also need a schema stub in the same file, with string-valued columns (9 test files do this):

```ts
mock.module('../../../src/db/schema', () => ({
  cards: { id: 'id', deckId: 'deckId', sortOrder: 'sortOrder' },
}));
```

## The external-service mocking strategy

`helpers/external-mocks.ts` exports six factories but **only three are used**, and only by `auth.service.test.ts`:

| Helper | Status |
|---|---|
| `mockArgon2()` | **used, works** — replaces `@node-rs/argon2` with `hash: pw => \`$mock_hash$${pw}\`` and a matching `verify`. Fixtures encode passwords as `$mock_hash$password123` |
| `mockEmailModule()` | **called but INERT** — see below |
| `mockLogger()` | **used, works** (only because preload already registered the logger by absolute path) |
| `mockNodemailer()` | **dead** — zero call sites |
| `mockGeminiAI()` | **dead and partly broken** — builds an `embedContent` mock at line 39 that it never attaches to the module, so embedding calls are not intercepted |
| `mockEnv()` | **dead** — preload already handles ENV |

> **`mockEmailModule()` does nothing.** `mock.module` resolves its specifier relative to the *calling* file, so `'../../shared/email'` written in `__tests__/helpers/external-mocks.ts:61` resolves to `apps/api/shared/email` — a path that does not exist — while `auth.service.ts:19` imports the identical string relative to `src/modules/auth/`, i.e. the real `apps/api/src/shared/email`. Verified: `bun test --coverage __tests__/modules/auth/auth.service.test.ts` reports `src/shared/email.ts` at 60.00% funcs / 24.46% lines with uncovered lines `26-30,32-35,56-108,159-201` — `sendVerificationEmail` (`:113-157`) is **not** in that list, so the real function executes and `getTransporter` (`:20-38`) is entered and throws. The tests still pass only because the real function swallows the SMTP failure and logs a warning, which the preload's logger mock hides. `mockLogger()` shares the same broken specifier but happens to work because preload already registered the logger by absolute path.
>
> Consequence: **do not copy the `'../../shared/*'` specifier pattern.** Register mocks by absolute path (`resolve(import.meta.dir, '../../src/…')`) as `db-mock.ts` does, or from the test file itself where the relative path matches the subject's.

**Do not mock `@google/generative-ai` or `nodemailer` directly.** Mock the app's own wrappers:

```ts
mock.module('../../../src/config/ai', () => ({
  getGenAI: mock(() => ({ getGenerativeModel: mock(() => ({ generateContent: mock(async () => ({ response: { text: () => '[]' } })) })) })),
  checkAiRateLimit: mock(() => {}),
}));
mock.module('../../../src/modules/embedding/embedding.service', () => ({
  enqueueEmbedding: mock(() => {}),
  embedCardBatch: mock(async () => {}),
}));
```

## Fixtures

`helpers/fixtures.ts` — 10 plain `(overrides = {}) => ({ ...defaults, ...overrides })` factories: `createUser`, `createSession`, `createClass`, `createFolder`, `createDeck`, `createCard`, `createStudyProgress`, `createTemplateField`, `createCardFieldValue`, and `createExperienceFixtureRows()` (a whole two-user graph plus 4 `queueRows` covering due / new / learning / at-risk).

IDs are stable strings (`user-1`, `class-1`, `folder-1`, `deck-1`, `template-1`, `card-1`, `field-1`); `createdAt` defaults to `new Date('2026-01-01')`. Build entities from the factories and override only the field under test — do not inline entity literals.

## Preferred pattern for new code: injectable loaders

The whole `experience` module needs **no DB mock at all**. Every service takes a loaders/services object with a `default*Loaders` fallback:

```ts
export type StudyQueueLoaders = { ensureDeck; ensureFolder; ensureClass; ensureSmartGroup; loadQueueRows };
export async function getStudyQueue(userId, query, loaders = defaultStudyQueueLoaders) { … }
```

Tests build the object with a spread-override helper and pass pure async functions. `create-preview.service.ts` goes further and exports `createInMemoryPreviewStore` for the same reason. **Write new services this way.**

## Recipes

### (a) A pure function

No mocks, no helpers.

```ts
// apps/api/__tests__/shared/my-util.test.ts
import { describe, test, expect } from 'bun:test';
import { myFn } from '../../src/shared/my-util';

describe('myFn', () => {
  test('handles the happy path', () => {
    expect(myFn(2)).toBe(4);
  });
  test('throws on bad input', () => {
    expect(() => myFn(-1)).toThrow('Invalid');
  });
});
```

Group by behaviour with nested `describe` — `srs.engine.test.ts` uses one per review action plus an `Edge cases` block. For time-based assertions use a ±200 ms window against `Date.now()`. For outputs you cannot hand-compute (FSRS), assert invariants — ranges, membership in a valid set, monotonicity — as `fsrs.engine.test.ts` does.

### (b) A service with DB access

Order matters: **mocks first, subject import last.** Bun hoists static imports, so a mock declared after the subject import never takes effect.

```ts
// apps/api/__tests__/modules/widgets/widgets.service.test.ts
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { resetMocks, setMockReturn, setMockReturnSequence } from '../../helpers/db-mock';
import { createDeck } from '../../helpers/fixtures';

// 1. every mock.module at top level, BEFORE the subject import
mock.module('../../../src/db/schema', () => ({
  widgets: { id: 'id', deckId: 'deckId', userId: 'userId' },
}));

// 2. now import the subject
import * as widgetsService from '../../../src/modules/widgets/widgets.service';

describe('widgets.service', () => {
  beforeEach(() => resetMocks());

  test('throws NotFoundError when the deck is not owned', async () => {
    setMockReturn([]);
    await expect(widgetsService.create('deck-1', 'wrong-user', {}))
      .rejects.toThrow('Deck not found');
  });

  test('creates after verifying ownership', async () => {
    setMockReturnSequence([
      [createDeck()],       // verifyDeckOwnership
      [{ id: 'widget-1' }], // insert returning
    ]);
    expect((await widgetsService.create('deck-1', 'user-1', {})).id).toBe('widget-1');
  });
});
```

Always assert the ownership-failure path with `.rejects.toThrow('<Resource> not found')`. Services throw `AppError` subclasses; never assert on a returned error object.

### (c) A route

In-process Elysia. No server, no port.

```ts
import { describe, test, expect } from 'bun:test';
import Elysia from 'elysia';
import { createWidgetRoutes } from '../../../src/modules/widgets/widgets.routes';
import { AppError, UnauthorizedError } from '../../../src/shared/errors';

function authForRoutes() {
  return new Elysia({ name: 'test-auth' }).derive({ as: 'scoped' }, ({ headers }) => {
    if (headers.authorization !== 'Bearer test-user') throw new UnauthorizedError();
    return { currentUser: { id: 'user-1' }, currentSession: { id: 'session-1', userId: 'user-1' } };
  });
}

function routeServices(overrides: Record<string, unknown> = {}) {
  return { listWidgets: async () => [], ...overrides };
}

function app(services = routeServices()) {
  return new Elysia()
    .onError(({ error, set }) => {
      if (error instanceof AppError) { set.status = error.statusCode; return { error: error.message }; }
      if (error instanceof Error && error.message === 'Unauthorized') { set.status = 401; return { error: 'Unauthorized' }; }
      set.status = 500;
      return { error: error instanceof Error ? error.message : String(error) };
    })
    .use(createWidgetRoutes(services as any, authForRoutes()));
}

test('rejects unauthenticated requests', async () => {
  const res = await app().handle(new Request('http://test/widgets'));
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: 'Unauthorized' });
});
```

Route factories must accept their service layer as a parameter (`createExperienceRoutes(services, auth)`). Assert **both** status and the exact JSON body; for aggregate endpoints pin `Object.keys(body.meta.sections)` in order.

## Traps

- **Cross-file `mock.module` leakage.** Bun runs every discovered test file in **one process** and the mock registry is process-global. `kg.service.test.ts:4` stubs `checkAiRateLimit` as a no-op, and Bun loads that file before `config-ai.test.ts` (discovery order is filesystem order, **not** alphabetical — alphabetically `ai/` would come first), so its two rate-limit tests see a function that never throws. The leak is not really about order: it reproduces with either file listed first on the command line. `bun test __tests__/modules/ai/config-ai.test.ts` alone passes 4/4. **Whenever a test fails only in the full suite, re-run it in isolation before debugging the implementation** — and never stub a shared app module with a behaviour-neutering mock. (`ai.service.test.ts` registers a byte-similar stub but is *not* the culprit: pairing it with `config-ai.test.ts` passes 6/6.)
- **Fixture time bomb.** `fixtures.ts:110-113` hard-codes `now = 2026-06-28`, `past = 2026-06-27`, `future = 2026-06-29`. Real time has passed, so `study-queue.service.ts:159 isDue()` now classifies the "future" rows as due and `experience.service.test.ts:780` fails. Derive fixture dates from `Date.now()`; never write an absolute date whose past/future-ness carries meaning.
- `setMockReturnSequence`'s cursor (`returnQueue`, `callIndex`) is module-level and **not** cleared by `resetMocks()` — only a fresh `setMockReturnSequence()` resets it. A test calling `setMockReturn` after a previous test's sequence can inherit a stale `limit`/`then` implementation.
- `resetMocks()` rebinds `mockDbChain` to a **new object**, so a locally cached reference goes stale. Assert against the live import.
- `db.transaction` hands the **same** chain in as `tx`, so transaction-body queries consume the outer cursor — count them. There is no rollback simulation, so **transaction correctness is not covered by any test**: the mock cannot detect a missing `FOR UPDATE` or wrong `tx` usage.
- `relationship-verifier.test.ts` is a lone `expect(typeof verifyRelationships).toBe('function')` smoke test — its presence in the file list is not coverage (0.00% funcs).
- No test file uses `beforeAll`/`afterAll`/`afterEach`. The only lifecycle pattern is `beforeEach(() => resetMocks())` plus explicit `.mockClear()` calls in `auth.service.test.ts`.
- `experience.service.test.ts` also contains compile-time type assertions (`Equal`/`Expect` + `@ts-expect-error`) that only `tsc` validates, not the runner.

## Coverage shape

166 of the 274 api tests are in the 11 files that use **no** DB mock (pure functions, injected loaders, in-process routes); 108 are in the 13 db-mocked service tests. The heaviest files: `srs.engine` 26, `experience.service` 25, `create-preview` 24, `auth.service` 22, `constants` 19, `experience.routes` 17, `embedding-utils` 15, `fsrs.engine` 15.

**Zero tests** exist for `embedding.service.ts`, `search.service.ts`, `duplicate-detection.service.ts`, `recommendations.service.ts`, `review-logs-cleanup.ts` or any `*.routes.ts` outside `experience`.

## CI

`.github/workflows/ci.yml` has exactly one job, `typecheck`: checkout → setup-bun (`latest`, unpinned) → `bun install --frozen-lockfile` → `bun run typecheck`. **There is no test job**, so test regressions never block a PR — catching them locally is your responsibility. CI is also currently red on the typecheck itself; see [known-issues.md](known-issues.md).
