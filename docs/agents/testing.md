# Testing

Everything runs on Bun's built-in runner (`bun:test`, Bun 1.3.10). **There is no Vitest, Jest, jsdom, Playwright, testcontainers or Solid testing-library anywhere.** Do not add integration/E2E tooling without an explicit decision.

There are two strategies, and which one you use is decided by *what* you are testing:

| Subject | Strategy |
|---|---|
| Pure function, domain helper, statement **builder** | no mocks at all |
| Service | injectable loaders (preferred) or `helpers/db-mock` |
| Route | in-process Elysia + injected services |
| **Repository (`*.postgres.ts`), migration, or executed SQL** | a **real, disposable Postgres database** — see [Postgres-backed suites](#postgres-backed-suites) |

The claim "no test database — all I/O is mocked" was true until the FSRS-only work; **16 files now talk to real Postgres** (`grep -rln TEST_POSTGRES_ADMIN_URL apps/api/__tests__`).

## Commands

| What | Exact command | Current result |
|---|---|---|
| API tests | `cd apps/api && bun test` | **691 pass / 0 fail**, 2 321 assertions, 77 files, ~32 s (dominated by the Postgres suites) |
| API + coverage | `cd apps/api && bun run test:coverage` | same counts, exit 0. Re-measure the percentages yourself — the ones this doc used to quote predate ~50 files |
| API watch | `cd apps/api && bun run test:watch` | — |
| One API file | `cd apps/api && bun test __tests__/modules/cards/cards.service.test.ts` | — |
| **Web tests** | `cd apps/web && bun test` | **91 pass / 0 fail**, 257 assertions, 17 files, ~83 ms |
| Typecheck (all CI runs) | `bun run typecheck` (root) | **exit 0** — both workspaces clean |

`apps/web/package.json` has **no `test` script**; the bare runner is the only way. `bun run test` at the repo root is not a thing either — it prints `a package.json script "test" was not found` and shells out to `/usr/bin/test`, reporting a confusing exit 1.

> **Never run `bun test` from the repo root.** `apps/api/bunfig.toml` is CWD-relative, so the preload never loads and `apps/api/src/config/env.ts:33` throws `Missing required environment variable: DATABASE_URL`. The 15 tests in `__tests__/shared/embedding-utils.test.ts` silently vanish, a pino WARN leaks (the logger mock is also absent), and the totals no longer match either workspace's real count. `bun test apps/api` from the root is equally broken. It does *not* sweep `node_modules/`, `skills/`, `.agents/` or `docs/` — it finds the api and web files, just with a broken environment.

`embedding-utils.test.ts` is the one file that breaks at root because it is the only api test that transitively imports the real `src/db/index.ts` (via `shared/embedding-utils.ts:2`) without importing the db mock.

## Layout

| Location | Convention |
|---|---|
| `apps/api/__tests__/` | Mirrors `src/`: `__tests__/modules/<module>/<name>.test.ts`, `__tests__/shared/<name>.test.ts` |
| `apps/api/__tests__/helpers/` | `db-mock.ts`, `external-mocks.ts`, `fixtures.ts` |
| `apps/api/__tests__/preload.ts` | Registered by `apps/api/bunfig.toml` |
| `apps/api/__tests__/**/*.postgres.test.ts`, `*.integration.test.ts`, `__tests__/db/*` | Real disposable Postgres. Self-contained: each file creates, migrates and drops its own database |
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

`helpers/fixtures.ts` — 9 plain `(overrides = {}) => ({ ...defaults, ...overrides })` factories: `createUser`, `createSession`, `createClass`, `createFolder`, `createDeck`, `createCard`, `createTemplateField`, `createCardFieldValue`, and `createExperienceFixtureRows()` (a whole two-user graph plus `queueRows` covering due / new / learning / at-risk). `createStudyProgress` is **gone** — `study_progress` no longer exists.

IDs are stable strings (`user-1`, `class-1`, `folder-1`, `deck-1`, `template-1`, `card-1`, `field-1`); `createdAt` defaults to `new Date('2026-01-01')`. Build entities from the factories and override only the field under test — do not inline entity literals.

`createExperienceFixtureRows()` derives `now` / `past` / `future` from `Date.now()` (`fixtures.ts:98-100`) precisely because the queue classifies rows against the real clock. **Never bake an absolute date into a fixture whose past/future-ness matters** (AGENTS.md §3 rule 26) — an absolute date is only safe when *every* instant it is compared against is also fixed by the test. The moment one side is the real clock or a column default, derive it.

## Preferred pattern for new code: injectable loaders

The whole `experience` module needs **no DB mock at all**. Every service takes a loaders/services object with a `default*Loaders` fallback:

```ts
export type StudyQueueLoaders = { ensureDeck; ensureFolder; ensureClass; ensureSmartGroup; loadQueueRows };
export async function getStudyQueue(userId, query, loaders = defaultStudyQueueLoaders) { … }
```

Tests build the object with a spread-override helper and pass pure async functions. `create-preview.service.ts` goes further and exports `createInMemoryPreviewStore` for the same reason. **Write new services this way.**

## Postgres-backed suites

16 test files run against a **real** database. Each is self-contained: `beforeAll` connects to the admin
database from `TEST_POSTGRES_ADMIN_URL` (default
`postgresql://postgres:postgrespassword@localhost:5435/postgres`), `CREATE DATABASE`s a uniquely-named
disposable database, applies **every** `src/db/migrations/*.sql` in order, and `afterAll` drops it
`WITH (FORCE)`. They need `docker compose up -d`; without the container they fail with connection errors that
are **not** a regression.

| File | What it pins |
|---|---|
| `modules/study/fsrs-live.postgres.test.ts` | the write path: locks, per-`requestId` idempotency, 409/422 paths, revision creation, daily-log roll-up |
| `modules/study/fsrs-read.postgres.test.ts` | the canonical loader, order preservation, row validation |
| `modules/study/fsrs-deck-reads.postgres.test.ts` | queue / schedule / enrichment / interleaving, plus a pinned `EXPLAIN (ANALYZE, BUFFERS)` plan over 300 seeded cards (`:508`) |
| `modules/study/fsrs-consumers.postgres.test.ts` | **every exported `*Sql()` builder**, executed and `EXPLAIN`-gated |
| `modules/study/fsrs-sql.postgres.test.ts` | the SQL ↔ `ts-fsrs` retrievability oracle |
| `db/fsrs-only.migration.test.ts`, `db/language-knowledge-graph.migration.test.ts` | migrations are idempotent; every FK has a covering index; CHECK constraints reject what they should |
| `db/*.schema.test.ts` | the Drizzle schema matches what the migrations built |
| `modules/knowledge-graph/*.integration.test.ts`, `modules/embedding/card-embedding-storage.integration.test.ts` | the KG and embedding repositories |

Re-derive the list with `grep -rln TEST_POSTGRES_ADMIN_URL apps/api/__tests__`.

**Migrations must be applied inside a transaction block.** `0027` issues a bare `LOCK TABLE`, which Postgres
only allows in one, so the loop wraps each file's statements in `database.begin(...)` after splitting on
`--> statement-breakpoint` (`fsrs-consumers.postgres.test.ts:85-103`). Copy that shape.

### Rule: run the repository through a `drizzle()`-wrapped client

This is not optional, and it is the reason a 500 on `GET /study/deck/:id` once shipped with a green suite.
`drizzle(client)` **mutates** the client it is handed: timestamp/date parsers *and* serializers, plus the
`json`/`jsonb` serializers, become identity functions. So in production, through `pgClient`, a bound `Date`
throws and a `timestamptz` column comes back as **text** — while a test that opens its own pristine
`postgres(url)` happily binds `Date`s and reads `Date`s back.

Every `*.postgres.test.ts` therefore wraps the client it uses:

```ts
// fsrs-consumers.postgres.test.ts:295-298 — one client, wrapped, used for both seeding and assertions
raw = postgres(url.toString(), { max: 4, onnotice: () => {} });
await applyMigrations(raw);
// Production shape: the SAME client is wrapped by drizzle.
db = drizzle(raw);
```

`fsrs-deck-reads.postgres.test.ts` / `fsrs-live.postgres.test.ts` keep a named `drizzleWrappedSql` alongside a
plain client and run at least one end-to-end case through it. Either shape is fine; what is not fine is a
repository test that only ever sees a pristine client. Seeds must bind through `src/db/pg-codecs.ts`:
`bindTimestamp(date)` for `$n::timestamptz`, `bindJson(value)` with the placeholder cast **`$n::text::jsonb`**.
Full rationale: AGENTS.md §3 rule 27 and [database.md](database.md#client-appsapisrcdbindexts).

## SQL is tested by executing the builder, not by reading the service

Every consumer statement is an **exported builder** — `export function <name>Sql(userId, …, asOf): SQL` — and
the service around it does nothing but `db.execute` and map rows. There are 13 of them
(`grep -rn 'export function .*Sql(' apps/api/src`). The export exists *for the test*: a statement inlined into
a service body cannot be executed against real Postgres, and cannot be `EXPLAIN`ed. Do not add one.

`fsrs-consumers.postgres.test.ts` renders each builder with `PgDialect().sqlToQuery`, executes it against a
seeded disposable database, asserts the returned rows, and then puts it through the `EXPLAIN` gate.

### The `EXPLAIN` gate helper

```ts
// fsrs-consumers.postgres.test.ts:275
async function explainUsesStateIndex(statement: SQL) {
  const { sql: text, params } = dialect.sqlToQuery(statement);
  await raw.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL enable_seqscan = off');
    const rows = await transaction.unsafe<Record<string, string>[]>(
      `EXPLAIN (FORMAT TEXT) ${text}`,
      params as never[],
    );
    const plan = rows.map((row) => Object.values(row)[0]).join('\n');
    expect(plan).toMatch(STATE_INDEXES);
    expect(plan).not.toContain('Seq Scan on fsrs_card_states');
  });
}
```

`STATE_INDEXES` is `/idx_fsrs_card_states_(card_user|user_due)/u` (`:56`) — either composite is accepted
because the chosen path depends on the statement's shape. **Know its limits:** it is scale-dependent (at a few
hundred analysed rows the planner may pick the narrower `idx_fsrs_card_states_parameter_revision` for the same
predicate — still index access) and `SET LOCAL enable_seqscan = off` only *discourages* sequential scans. The
gate proves "no seq-scan regression on `fsrs_card_states`", not "this exact plan forever". For a stronger
claim, seed real volume and pin the plan the way `fsrs-deck-reads.postgres.test.ts:508` does: 300 cards with
state rows, `enable_seqscan/hashjoin/mergejoin/bitmapscan/material` all off, `EXPLAIN (ANALYZE, BUFFERS)`, then
assert both `idx_cards_deck_sort_order` and `idx_fsrs_card_states_card_user` appear.

A change that adds or rewrites a statement adds its gate test **in the same commit**
([performance.md](performance.md) §6).

### The oracle test

`fsrs-sql.postgres.test.ts:55` is the pattern for "SQL must agree with TypeScript": it generates 5 000
`(w20, stability, elapsed)` triples from a **deterministic LCG** (`seeded(20260908)`, `:45`) so any failure is
reproducible, evaluates `fsrs_retrievability()` in Postgres over `unnest($1::float8[], …)` in one statement,
computes the same values with `ts-fsrs`'s own `forgetting_curve`, and asserts agreement to 8 decimals while
tracking the worst offender for the failure message. Reach for this shape whenever a formula exists in both
languages.

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

Group by behaviour with nested `describe` — `fsrs-live.domain.test.ts` uses one per validation concern. For time-based assertions use a ±200 ms window against `Date.now()`. For outputs you cannot hand-compute, prefer an **oracle** (compare against the reference implementation, as `fsrs-sql.postgres.test.ts` does) over loose range assertions; fall back to invariants — ranges, membership in a valid set, monotonicity — only when no oracle exists.

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
- **Fixture time bombs.** An absolute date is safe only when *every* instant it is compared against is also fixed by the test. The moment one side is the real clock **or a column default**, derive from `Date.now()`. Both known bombs are defused: `createExperienceFixtureRows()` derives `now/past/future` (`fixtures.ts:98-100`), and `fsrs-live.postgres.test.ts` pins `created_at`/`activated_at` to `SEEDED_REVISION_AT` on seeded revisions instead of letting them default to the real `now()` while `retired_at` was baked (which tripped `chk_fsrs_parameter_revisions_timestamps` once the clock passed the baked date). That second one is the instructive case: the test baked only *one* side.
- **A pristine `postgres()` test client hides `pgClient` bugs** — the single most expensive trap in this repo. See [Postgres-backed suites](#rule-run-the-repository-through-a-drizzle-wrapped-client).
- `setMockReturnSequence`'s cursor (`returnQueue`, `callIndex`) is module-level and **not** cleared by `resetMocks()` — only a fresh `setMockReturnSequence()` resets it. A test calling `setMockReturn` after a previous test's sequence can inherit a stale `limit`/`then` implementation.
- `resetMocks()` rebinds `mockDbChain` to a **new object**, so a locally cached reference goes stale. Assert against the live import.
- `db.transaction` hands the **same** chain in as `tx`, so transaction-body queries consume the outer cursor — count them. There is no rollback simulation, so **transaction correctness is not covered by any test**: the mock cannot detect a missing `FOR UPDATE` or wrong `tx` usage.
- `relationship-verifier.test.ts` is a lone `expect(typeof verifyRelationships).toBe('function')` smoke test — its presence in the file list is not coverage (0.00% funcs).
- **`beforeAll`/`afterAll` are in normal use** — 16 files have them, all of them the Postgres-backed suites creating and dropping their disposable database. (This doc used to claim no file used them; that stopped being true in July 2026.) Mocked suites still use only `beforeEach(() => resetMocks())`, plus explicit `.mockClear()` calls in `auth.service.test.ts`.
- `experience.service.test.ts` also contains compile-time type assertions (`Equal`/`Expect` + `@ts-expect-error`) that only `tsc` validates, not the runner.

## Coverage shape

**691 tests across 77 api files** (2026-09-09). The distribution has changed shape since this section was
first written: the bulk is no longer db-mocked service tests but **pure-function and real-Postgres** suites.

Re-derive the per-file counts rather than trusting a list:

```bash
cd apps/api && for f in $(find __tests__ -name '*.test.ts'); do \
  echo "$(grep -cE '^\s*(test|it)\(' "$f") $f"; done | sort -rn | head -12
```

Heaviest files today: `fsrs-live.domain` 31, `auth.service` 30, `fsrs-live.postgres` 28, `create-preview` 26,
`experience.service` 25, `fsrs.engine` 23, `vocabulary-artifact` 18, `experience.routes` 17,
`forecast.service` 16, `gemini-provider` 16, `study.service` 15, `kg-indexing.service` 15. `srs.engine` (26)
was the heaviest file until SM-2 was deleted.

Four route files have tests — `experience.routes`, `kg.routes`, `retention.routes`, `study-write.routes` —
so "no `*.routes.ts` outside `experience` is tested" is no longer true.

**Zero tests** exist for `search.service.ts`, `duplicate-detection.service.ts`, or the remaining
`*.routes.ts` files (auth, cards, decks, classes, folders, card-templates, ai, embedding, import-export,
notifications, feedback, users). `review-logs-cleanup.ts` is no longer on that list because the file is gone.

## CI

`.github/workflows/ci.yml` has exactly one job, `typecheck`: checkout → setup-bun (`latest`, unpinned) → `bun install --frozen-lockfile` → `bun run typecheck`. **There is no test job**, so test regressions never block a PR — catching them locally is your responsibility. That matters more now that 16 suites need a Postgres container: CI could not run them as written even if a test job existed. Typecheck is currently green; see [known-issues.md](known-issues.md).
