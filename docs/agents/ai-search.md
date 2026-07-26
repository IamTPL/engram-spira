# AI, embeddings, search, duplicates, knowledge graph

Four subsystems on top of one Gemini SDK (`@google/generative-ai ^0.24.1`) and one pgvector column.

| Module | Owns |
|---|---|
| `modules/ai/` | `ai_generation_jobs` queue, Gemini card generation, prompts, duplicate detection |
| `modules/embedding/` | 768-dim embeddings → `card_field_values.embedding`, backfill, vector search |
| `modules/search/` | `GET /search` — semantic with ILIKE fallback |
| `modules/knowledge-graph/` | `card_links`, deck graph, AI relationship detection + dismissal |

## Models and keys

| | Value |
|---|---|
| Generation model | `ENV.GEMINI_MODEL`, default **`gemini-3-flash-preview`** |
| Embedding model | `ENV.GEMINI_EMBEDDING_MODEL`, default **`gemini-embedding-001`** |
| Dimension | `EMBEDDING_DIMENSIONS = 768`, sent as `outputDimensionality` on every call |
| Key | `GEMINI_API_KEY`, default `''`, **not** in `REQUIRED_VARS` |

Never hardcode a model string in a service — read `ENV`. (`relationship-verifier.ts:58` has `ENV.GEMINI_MODEL ?? 'gemini-3-flash-preview'`, which is dead code since `ENV.GEMINI_MODEL` is never nullish.)

An empty `GEMINI_API_KEY` is a *valid* ENV value, so the failure mode is a runtime throw deep inside a fire-and-forget path — logged as a warn by `enqueueEmbedding` — not a startup error. There are **three independent lazy `GoogleGenerativeAI` singletons**: `config/ai.ts:16`, `embedding.service.ts:22` and `knowledge-graph/relationship-verifier.ts:9` (the last does not even check the key is non-empty). So mocking only `src/config/ai` in a test leaves both the embedding **and** the relationship-verifier clients live.

No `generationConfig`, `temperature`, `responseMimeType` or `safetySettings` are set on any Gemini call. JSON output is enforced **purely by prompt text**.

## The AI job queue

Table `ai_generation_jobs`, `status varchar(20)` with exactly five values and **no DB constraint or enum** enforcing them:

```
processing → pending → saved
     ↓         ↓
   failed    expired
```

| Transition | Trigger |
|---|---|
| → `processing` | `POST /ai/generate` inserts the row, returns `{jobId, status}` immediately, fires `void processJobInBackground(...)` |
| `processing` → `pending` | generation succeeded; writes `generatedCards` + `cardCount` |
| `processing` → `failed` | any failure; writes `errorMessage` |
| `pending` → `saved` | `POST /ai/jobs/:jobId/save` |
| `pending`/`processing` → `expired` | hourly `cleanupExpiredJobs()` for rows older than 24 h |
| `processing` → `failed` | `recoverOrphanedJobs()` at startup — "Generation was interrupted by a server restart." |

> **Adding a status value means editing four places** — the schema doc comment (`ai-generation-jobs.ts:30`), the `VALID_STATUSES` whitelist in `listJobs` (`ai.service.ts:397-403`), the `cleanupExpiredJobs` status list (`ai.service.ts:459`), and the frontend poll handler (`ai-generate-modal.tsx:92-104`). Nothing in the DB will catch a mistake.

### Generation flow

1. `checkAiRateLimit(userId)` — **must be the first statement** of any new user-triggered Gemini entry point, before any DB work.
2. Verify deck ownership; `getTemplateInfo` throws `ValidationError` (422) if the template lacks at least one front **and** one back field.
3. Mode is auto-detected: `'vocabulary'` if the template has a field literally named `word` (lowercased), else `'qa'`.
4. `generateContentStream` with `{ timeout: AI_STREAM_TIMEOUT_MS }` = 3 min.
5. Strip ```` ```json ```` fences, then a bare `JSON.parse`. **There is no repair or retry logic anywhere.**
6. Drop entries lacking string `front`/`back`; Title-Case vocab fronts.
7. Zero surviving cards → `failed` with "No meaningful content found. Please enter a more specific topic."

`processJobInBackground` **must never throw** — every failure path must end in an UPDATE setting `status='failed'` plus `errorMessage`, because the caller uses `void` and a rejection escapes as an unhandled promise rejection.

Prompts live in `qa.prompt.ts` (`buildQAPrompt` — 8 rules, demands a JSON array of `{front, back}`) and `vocab.prompt.ts` (`buildVocabPrompt` — demands `{front, back, ipa, wordType, examples}`). Both instruct the model to return `[]` for garbage input.

### Saving

`saveGeneratedCards` requires `status === 'pending'`, else `ConflictError` (409) "Job has already been saved or expired". It inserts cards + `card_field_values` in one transaction under `SELECT id FROM decks WHERE id = … FOR UPDATE`, marks the job `saved`, and enqueues embeddings.

Vocab extras are stored by template-field **name** lookup: `word`, `definition`, `ipa`, `type` (**not** `wordType`), `examples`. Rename a seeded template field and the value is silently dropped.

### Job-queue caveats

- **Unbounded in-process concurrency.** `void processJobInBackground(...)` with no worker pool, no semaphore, no DB claim/lease. Concurrency is limited only by the rate limits. A restart kills every in-flight job — which is why `recoverOrphanedJobs()` exists.
- **The `AbortController` is decorative.** Despite the comment at `ai.service.ts:168`, only `{ timeout }` reaches the SDK; the signal is polled between stream chunks only.
- `cleanupExpiredJobs`'s own docstring claims it deletes `failed` jobs. **It does not** — the SQL is a single UPDATE, so failed rows accumulate forever.
- Vocab Title-Casing uses `/\b\w/g`, which fires after apostrophes and hyphens: `don't` → `Don'T`, `e-mail` → `E-Mail`.
- `sourceText` is truncated to 10 000 chars **when persisted**, but the untruncated string is what goes into the prompt.
- The `generateRateLimit` plugin is `.use()`d on the `aiRoutes` instance itself with `scoping: 'scoped'`, so its 20/min budget covers `POST /ai/generate`, `/jobs/:jobId/save`, `/check-duplicates` and `/deck-duplicates` alike — **not** "only the expensive generate endpoint" as the comment claims.
- A single `42P01`/`42703` Postgres error on `ai_generation_jobs` sets `skipAiJobMaintenance = true` for the **whole process lifetime**. Restart is required even after `db:migrate`.

## Embedding pipeline

`getCardText()` (`shared/embedding-utils.ts:11`) is the canonical flattener: field values ordered by `(templateFields.side, templateFields.sortOrder)`, space-joined; arrays joined by spaces; objects with a `text` key use that key; anything else `JSON.stringify`d; `null` when empty. **Always use it** — do not re-implement the flattening.

Writes go through raw postgres.js, never Drizzle:

```ts
await pgClient`UPDATE card_field_values SET embedding = ${`[${vec.join(',')}]`}::vector WHERE id = ${cfvId}`;
```

Call sites that trigger embedding (all fire-and-forget, after the transaction commits): `cards.service` create / update / batch, `experience/create-preview`, `ai.service.saveGeneratedCards`. `enqueueEmbedding` catches, logs a warn, never throws, never retries.

Backfill: `BACKFILL_BATCH_SIZE = 50`, `BACKFILL_YIELD_MS = 200`. `POST /embedding/backfill` starts it un-awaited, swallows the rejection, and returns `{started: true, …}` immediately.

### Embedding caveats

- **One embedding per card, on a nondeterministic row.** `storeEmbedding` targets the row from an unordered `.limit(1)`, so which `card_field_values` row holds the vector varies across re-embeds. Every reader compensates with `WHERE card_id = … AND embedding IS NOT NULL LIMIT 1` or `DISTINCT ON (cfv.card_id)`.
- **Re-embedding never clears the old vector.** If a different row wins the `.limit(1)` race, a card can end up with two non-NULL embeddings — and `backfillEmbeddings` will then permanently skip it, because its `NOT EXISTS` guard only checks for *any* non-NULL row.
- **`backfillEmbeddings` does not call `getCardText`** — it rebuilds card text inline (`embedding.service.ts:222-233`) and its flattening **omits the array branch**, so a `json_array` field embeds as `["a","b"]` in backfill but as `a b` via `getCardText`. The same card gets materially different vectors depending on which path ran. Fix toward `getCardText`; do not copy the bug.
- `backfillEmbeddings` `break`s out of the **whole** loop on the first batch API error or on an empty batch, so one card with empty text can terminate the entire backfill — and the route already returned `{started:true}`, so the caller never learns.
- `getEmbeddingStatus` counts `DISTINCT card_id` **globally**, not scoped to the authenticated user, despite sitting behind `requireAuth`.
- Both embed calls cast their request object to `any` to smuggle `outputDimensionality` past the SDK types.

## Search

`search()` (`search.service.ts:37`) tries `semanticSearch` (threshold **0.4**) and falls back to `textSearch` on **any exception AND when semantic returns zero rows**.

```sql
SELECT 1 - (cfv.embedding <=> $vec::vector) AS similarity
...
ORDER BY cfv.embedding <=> $vec::vector
```

`textSearch` is `cfv.value::text ILIKE $pattern` with `%`/`_` escaped as `\%`/`\_`, `SELECT DISTINCT`, and **every hit assigned `similarity = 1.0`**.

Semantic must always degrade gracefully — wrap the pgvector path in try/catch. A missing `GEMINI_API_KEY` or missing pgvector must never make `GET /search` return 5xx.

### Search caveats

- **The threshold filters in JS *after* the SQL `LIMIT`** (`embedding.service.ts:331`), so it can only shrink the top-N window, never widen the search. `limit=20, threshold=0.9` can return 0 rows even when 100 rows exceed 0.9.
- Because ILIKE hard-codes `1.0`, clients cannot distinguish a perfect semantic match from a substring match — all similarities being exactly 1.0 is the only hint the fallback fired.
- `textSearch` has `DISTINCT … LIMIT n` with **no `ORDER BY`**, so the fallback has no deterministic ranking. The same query can return different rows.
- No offset or cursor — `limit` (max 50) is the only knob, and `total` is just `results.length`, not a corpus count.
- `GET /search` is **not called anywhere in `apps/web`**; the deck-view search box uses `/cards/by-deck/:deckId/search` instead.

Thresholds in use, all separate constants: semantic search **0.4** · generic `searchByEmbedding` default **0.5** · study recommendations **0.5** · duplicate detection **0.85** · KG relationship detection **0.75** · at-risk retention **0.8**.

Always scope embedding/search SQL by `decks.user_id = $userId` **inside** the query (`embedding.service.ts:326`), never filter ownership in JavaScript afterwards.

## Duplicate detection

Two unrelated mechanisms in `duplicate-detection.service.ts`:

**Vector path** — `checkDuplicatesByCardId` / `checkDuplicatesByText`, threshold default **0.85** (route schema: min 0.5, max 1.0). `findDuplicates` hard-codes `limit 5` and rounds similarity to 3 dp. Gated by `assertEmbeddingAvailable(await isEmbeddingAvailable())`: the probe reads `information_schema.columns` and returns a boolean (it catches and **never throws**), while the assert helper throws `AppError(422, 'Embedding infrastructure not available. Run POST /embedding/backfill first.')`. If you change the default, change **both** the service and `ai.routes.ts:144`.

**Exact-word path** — `scanDeckDuplicates` uses **no embeddings at all**: it builds a trimmed, lowercased index on the field named `word` or `term` and emits every unordered pair in each group.

Caveats: `checkDuplicatesByText` does **not** call the availability gate, so it raises a raw Postgres error instead of the friendly 422. `scanDeckDuplicates` returns `{pairs: []}` — not 404 — for a missing or foreign deck, always returns empty when the template has neither `word` nor `term`, emits O(k²) pairs per group with no cap, and `String(wordField.value)` on a non-string jsonb value yields `[object Object]`, collapsing all such cards into one bogus group. The file also imports `getCardLabels` and `cosineSimilarity` without using them.

## Knowledge graph

| Piece | Behaviour |
|---|---|
| `kg.service.ts` | `createLink` verifies **both** cards in parallel, inserts `onConflictDoNothing`, and on conflict re-selects and returns the existing link (idempotent, not an error). `deleteLink` verifies **only the source card** — a known hole. Deck graph builds nodes/edges with a retention overlay. `searchCardsForLinking` escapes `%`/`_` |
| `kg-ai.service.ts` | `detectRelationships`: in-process O(n²) `cosineSimilarity` over at most **500 cards** (half-matrix `i<j`) → threshold (default **0.75**, range 0.5–1.0) → sort desc → top **20** → drop already-linked → drop dismissed → drop same-front-label → per-pair Gemini verification → return only confirmed pairs |
| `relationship-verifier.ts` | Calls Gemini **sequentially, one `generateContent` per candidate pair**, truncates each card text to 200 chars, extracts the first `{...}` via regex, and silently skips a pair (`logger.warn`) on non-JSON or a throw — it fails open |
| `dismissed_suggestions` | `uq_dismissed_user_pair(user_id, source, target)`. `POST /knowledge-graph/ai/dismiss` writes **directly in the route handler** — one of only two places in the API that does (the other is `GET`/`PATCH /study/algorithm` at `study.routes.ts:215-231`). Do not copy it |

`card_links.link_type` defaults to `'related'` and the route literal accepts only `'related'`. `LINK_TYPES.PREREQUISITE` exists as an (inert) constant in `packages/shared`, but the "prerequisite chain BFS" feature described in `docs/project_report.md` and `docs/c4/workspace.dsl` **does not exist** — the string `prerequisite` appears nowhere in `apps/api/src` or `apps/web/src`.

`card_concepts` is read by smart groups and the study queue but **nothing ever inserts into it**, so those features return empty on a fresh database. The doc comment in `schema/card-concepts.ts:7` claiming a 768-dim embedding lives there is wrong — only `card_field_values` has one.

## Rate limiting

Per-user: `checkAiRateLimit` — **30 requests / 1-hour fixed window** anchored on the first request (so 30 at 12:59 plus 30 at 13:01 both pass), in a process-local `Map`, swept every 10 min by a `setInterval` that is **not** `.unref()`'d.

Per-IP: `elysia-rate-limit` — see the table in [api-conventions.md](api-conventions.md).

Configuration belongs in the routes file, not the service. Register an IP limiter with `skip: (req) => !req || req.method === 'GET'` so Elysia lifecycle events and polling GETs are not counted.

## Frontend integration

`apps/web/src/pages/deck-view/ai-generate-modal.tsx` is the only client of the generation flow: `POST /ai/generate`, then polls `GET /ai/jobs/:jobId` every **2 000 ms**, stopping on `pending` or `failed`. The deck banner polls at `AI_BANNER_POLL_INTERVAL_MS` = 3 000. `AI_SOURCE_MIN_CHARS` / `AI_SOURCE_MAX_CHARS` (10 / 10 000) in `apps/web/src/constants/index.ts` mirror the route schema and carry an explicit "must stay in sync with the backend" comment.

## Test coverage — thin

`ai.service.test.ts` covers only `listJobs` + `getJob` (2 tests). `config-ai.test.ts` covers the rate limiter (4 tests, 2 currently failing from cross-file mock leakage). `embedding-utils.test.ts` covers `cosineSimilarity` + `computeRetention` only.

**There are zero tests for `embedding.service.ts`, `search.service.ts` and `duplicate-detection.service.ts`**, and `relationship-verifier.test.ts` is a single `typeof === 'function'` smoke test.

The established stubbing pattern is to mock the app's own wrappers, never the vendor SDK:

```ts
mock.module('../../../src/config/ai', () => ({ getGenAI: …, checkAiRateLimit: mock(() => {}) }));
mock.module('../../../src/modules/embedding/embedding.service', () => ({
  enqueueEmbedding: mock(() => {}), embedCardBatch: mock(async () => {}),
}));
```

`mockGeminiAI()` in `__tests__/helpers/external-mocks.ts` is dead and partly broken — it builds an `embedContent` mock it never attaches. See [testing.md](testing.md).
