# Language Learning Knowledge Graph v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. All production changes must follow test-driven development. The user explicitly requires working in the current checkout and making no git commits.

**Goal:** Replace the unreliable card-pair detector with an additive, user-scoped lexical knowledge graph while preserving cards, SRS, and the legacy graph during rollout.

**Architecture:** Cards remain learning artifacts and map deterministically to lexical senses, which belong to lexemes and connect through typed relations. PostgreSQL/pgvector supplies storage, one-hop graph queries, ANN candidate retrieval, and a durable leased queue. Gemini is isolated behind a provider adapter and can only create pending suggestions.

**Tech Stack:** Bun, TypeScript 5.9, ElysiaJS 1.4, Drizzle ORM, PostgreSQL + pgvector, `@google/genai`, SolidJS 1.9, TanStack Solid Query, Cytoscape with fCoSE/Dagre.

## Global Constraints

- Do not commit. Work directly in the current checkout and preserve unrelated user changes.
- Use test-first RED → GREEN → REFACTOR for every behavior change.
- All new Elysia routes are registered after `.use(requireAuth)`, use TypeBox schemas, and only delegate to services.
- Every service accepts `userId` and returns `NotFoundError('<Resource>')` for unowned data.
- Failure bodies remain exactly `{ error: string }`; services throw `AppError` subclasses.
- Do not model any vector column in Drizzle. Vector reads/writes use parameterized raw SQL and remain exactly 768 dimensions.
- Add one schema file per new table and export both table and relations from `db/schema/index.ts`.
- Hand-write idempotent migration `0025_language_knowledge_graph.sql`; do not use `db:push`, `db:reset`, or `CREATE INDEX CONCURRENTLY`.
- Add `KG_V2_ENABLED=false` in `env.ts`, `.env.example`, and both ENV mock blocks.
- Use one Gemini adapter based on `@google/genai`; all calls have timeout/abort, bounded concurrency, structured response validation, and usage accounting.
- Embedding model is `gemini-embedding-2`, dimension 768, representation version `v1`.
- Candidate retrieval uses pgvector cosine HNSW, `k=8`, canonical pairs, coverage-first ranking, max four incident candidates before coverage, and budget `min(300, max(40, ceil(cardCount * 0.6)))`.
- Verification uses at most 25 pairs and 20,000 input characters per request, temperature 0, JSON Schema, one retry for missing items, and Gemini concurrency 2.
- AI relations are always pending. V1 never auto-accepts.
- Relation types are exactly `synonym | antonym | is_a | part_of | derived_from | collocation | confused_with | translation_of | coordinate`.
- `none` and `abstain` are verifier outputs only and never persisted as edges.
- PostgreSQL worker claims with `FOR UPDATE SKIP LOCKED`, leases, CAS transitions, retry with exponential backoff + jitter up to five attempts, and `.unref()` polling.
- Keep `/ai/detect`, the legacy deck graph, `card_links`, and legacy UI available for at least one release.
- Project accepted lexical relations to canonical legacy `card_links(..., 'related')`.
- Solid components never destructure/alias props; use Solid control-flow components and clean up every listener/timer/Cytoscape instance.
- Semantic/mixed graphs use fCoSE; hierarchy-only graphs use Dagre.
- The focused explorer loads one hop and does not expose a raw similarity threshold.
- Do not change FSRS/SM-2 scheduling.
- Baseline on 2026-07-27: `bun run typecheck` exits 0; API tests 310 pass/3 fail; web tests 33 pass/0 fail.

---

### Task 1: Fix legacy candidate correctness and authorization

**Files:**
- Modify: `apps/api/src/modules/knowledge-graph/kg-ai.service.ts`
- Modify: `apps/api/src/modules/knowledge-graph/kg.service.ts`
- Modify: `apps/api/src/modules/knowledge-graph/kg.routes.ts`
- Modify/Create tests under `apps/api/__tests__/modules/knowledge-graph/`
- Modify: `apps/api/src/db/migrations/0025_language_knowledge_graph.sql` when Task 3 creates it

**Produces:**
- `canonicalPair(a, b)`
- `filterKnownPairs(candidates, knownPairs)`
- `rankCandidatesForCoverage(candidates, maxSuggestions)`
- Ownership-safe dismiss and link boundaries

**Requirements:**

1. Add failing tests showing linked/dismissed top-ranked pairs do not prevent rank 21+ from being returned.
2. Add failing tests for reverse pair canonicalization and both-card ownership.
3. Move the cap after canonicalization, same-label removal, known/dismissed removal, and coverage ranking.
4. Canonicalize legacy links and dismissals at the service boundary.
5. Make dismiss route delegate to a service that validates both cards belong to the user.
6. Later add migration dedupe and canonical-order check for legacy pairs.
7. Run only the affected KG tests, then the full API suite and compare with baseline.

### Task 2: Repair the legacy graph presentation

**Files:**
- Modify: `apps/web/src/components/deck-view/graph-view.tsx`
- Modify: the existing AI suggestions component under `apps/web/src/components/deck-view/`
- Create: focused pure graph-state helpers and tests as needed

**Requirements:**

1. Write tests for connected/isolated counts, actual rendered-node count, layout choice, and selected-only acceptance.
2. Header shows total cards, connected cards, isolated cards, and relationships.
3. Container height uses the actual rendered node set.
4. Related/mixed legacy graph uses fCoSE; Dagre is reserved for directed hierarchy.
5. Add isolated-node toggle.
6. Remove Accept All; allow per-item or checked-item acceptance.
7. Preserve the accessible list and reduced-motion behavior.
8. Run web tests and typecheck.

### Task 3: Add lexical graph schema and migration

**Files:**
- Create one schema file each for `lexemes`, `lexical_senses`, `card_senses`, `sense_relations`, `kg_runs`, `kg_relation_suggestions`, and `card_embedding_metadata`
- Modify: `apps/api/src/db/schema/index.ts`
- Create: `apps/api/src/db/migrations/0025_language_knowledge_graph.sql`
- Modify: `apps/api/src/db/migrations/meta/_journal.json`
- Add schema/migration tests

**Requirements:**

1. Write failing schema/migration tests before production schema changes.
2. UUID PKs, timestamps, FKs, ownership columns, checks, and indexes follow existing conventions.
3. `lexemes` unique `(user_id, language_tag, normalized_lemma)`.
4. `lexical_senses` unique `(lexeme_id, part_of_speech, definition_language_tag, normalized_definition)`.
5. `card_senses` unique `(card_id, sense_id)`.
6. `sense_relations` has no-self, confidence range, exact relation whitelist, endpoint indexes, and canonical UUID order for symmetric types.
7. `kg_runs` carries run type, lifecycle/stage, snapshot/fingerprint, progress/stats JSON, attempt/backoff, lease, cancellation/error/timestamps, and partial active-run uniqueness.
8. `kg_relation_suggestions` carries run/user endpoints, artifacts/hashes, typed verdict fields, fingerprint, lifecycle, and `(run_id,status)` index.
9. `card_embedding_metadata` carries card/model/dimensions/representation/content hash/timestamp and no vector column.
10. Migration also canonicalizes/deduplicates legacy `card_links` and dismissals and prevents future reverse duplicates safely.
11. Journal entry is idx 25 and has `when > 1785125637081`.
12. Verify blank migration, upgrade from 0024, and idempotent rerun using a disposable database.

### Task 4: Implement canonical vocabulary artifacts

**Files:**
- Create focused artifact/normalization modules under `apps/api/src/modules/knowledge-graph/`
- Add unit tests

**Interface:**

```ts
interface VocabularyArtifact {
  cardId: string;
  sourceLanguageTag: string;
  definitionLanguageTag: string;
  lemma: string;
  normalizedLemma: string;
  partOfSpeech: string;
  definition: string;
  normalizedDefinition: string;
  ipa: string | null;
  examples: string[];
  contentHash: string;
  representationVersion: 'v1';
}
```

**Requirements:**

1. Tests cover Unicode NFKC, whitespace collapse, locale-aware lowercase, retained diacritics, POS fallback, canonical JSON hash, and homographs/polysemy.
2. Build from templates containing named `word` and `definition` fields; parse optional POS/IPA/examples deterministically.
3. Unsupported templates throw `ValidationError`; do not call an LLM to infer fields.
4. SHA-256 is computed from stable canonical JSON.

### Task 5: Centralize Gemini and embedding provenance

**Files:**
- Modify package manifests/lockfile to replace deprecated SDK with `@google/genai`
- Create provider interfaces/adapter under `apps/api/src/modules/ai/` or shared AI boundary
- Refactor generation, embedding, and KG verifier call sites
- Modify `apps/api/src/config/env.ts`, `.env.example`, and both preload mocks
- Add provider/provenance tests

**Requirements:**

1. Tests first for timeout, abort, dimensions, structured output, bounded concurrency, usage metadata, and cache validity.
2. Adapter exposes generation, 768-dimensional embedding, and structured classification.
3. Use `gemini-embedding-2`; embed canonical artifact representation with semantic-similarity task instruction.
4. Persist metadata with the logical embedding update; old vectors without valid metadata are stale.
5. Re-embed only stale/missing cards on demand in batches of at most 50.
6. Add `KG_V2_ENABLED=false` in all four required config locations.

### Task 6: Implement the durable PostgreSQL run worker

**Files:**
- Create worker/repository modules under `apps/api/src/modules/knowledge-graph/`
- Wire startup/shutdown in API bootstrap behind `KG_V2_ENABLED`
- Add worker tests using injectable loaders/repositories

**Requirements:**

1. Tests cover duplicate enqueue, `SKIP LOCKED`, lease recovery, CAS protection, heartbeat, cancellation, retryable 429/5xx, non-retryable validation/ownership, max five attempts, restart, and unref polling.
2. Lifecycle: `queued → processing → completed|partial|failed`; `queued|processing → cancelled`; retry `processing → queued`; content change `processing → stale`.
3. Stages: `snapshot → indexing → embeddings → candidates → verification → persistence`.
4. Concurrency for provider calls is two.
5. Module can later move to a separate process without schema changes.

### Task 7: Deterministically index cards to senses

**Files:**
- Create indexing service/repository modules
- Add tests

**Requirements:**

1. Snapshot card IDs and content hashes.
2. Build one primary vocabulary artifact/sense per card in v1.
3. Idempotently upsert user lexeme, exact sense, and deterministic `card_senses`.
4. Preserve future many-sense cardinality.
5. Recheck snapshot before publish and mark run stale on change.
6. Test user isolation, repeat runs, homographs, content edits, and transaction rollback.

### Task 8: Generate candidates with pgvector kNN and coverage ranking

**Files:**
- Create raw-SQL candidate repository and pure ranking module
- Add unit and Postgres integration tests

**Requirements:**

1. Parameterized LATERAL cosine kNN gets `k=8` neighbors per card/sense within the owned deck.
2. Never model vector columns in Drizzle.
3. Filter self, accepted, dismissed, cached negative, stale/mismatched embeddings before budget.
4. Rank uncovered nodes, mutual-kNN, deterministic lexical evidence, cosine similarity, stable UUID tie-break.
5. Max four incident candidates per node before all possible nodes are covered.
6. Budget is `min(300, max(40, ceil(cardCount * 0.6)))`.
7. Tests enforce no more than `n*k` directed results and Family fixture coverage of all 98 cards.
8. Capture and document `EXPLAIN (ANALYZE, BUFFERS)` showing HNSW plan on a realistic fixture.

### Task 9: Add a typed batched relation verifier

**Files:**
- Replace/refactor `relationship-verifier.ts`
- Add validation/prompt/version modules and tests

**Interface:**

```ts
interface RelationVerdict {
  candidateId: string;
  decision: 'relation' | 'none' | 'abstain';
  relationType: RelationType | null;
  direction: 'source_to_target' | 'target_to_source' | 'symmetric' | null;
  confidenceBand: 'high' | 'medium' | 'low';
  reason: string;
  evidence: { source: string; target: string } | null;
}
```

**Requirements:**

1. At most 25 pairs and 20,000 input chars per request, temperature 0, JSON Schema.
2. Reject unknown IDs/types, invalid relation/direction combinations, and evidence not found verbatim in sent artifact fields.
3. Retry missing items once in a smaller batch.
4. Malformed/timeout/retry exhaustion yields partial run, not implicit `none`.
5. Store retrieval score, mutual flag, and verifier band separately.
6. Tests cover injection-like card text, malformed JSON, unknown IDs, direction, evidence, missing entries, timeout, 429/5xx, and request-count caps.

### Task 10: Persist suggestions, accept/dismiss transactionally, and expose API

**Files:**
- Create/refactor KG v2 service, repositories, routes, schemas, and route tests
- Modify API module wiring/index

**Endpoints:**

- `POST /knowledge-graph/runs/deck`
- `GET /knowledge-graph/runs/:runId`
- `POST /knowledge-graph/runs/:runId/cancel`
- `GET /knowledge-graph/runs/:runId/suggestions`
- `POST /knowledge-graph/suggestions/:id/accept`
- `POST /knowledge-graph/suggestions/:id/dismiss`
- `GET /knowledge-graph/cards/:cardId/neighborhood`
- `POST /knowledge-graph/senses/:senseId/expansion-runs`
- `POST /knowledge-graph/cards/:cardId/senses/:senseId`

**Requirements:**

1. Full TypeBox schemas and inferred Elysia handler types.
2. Deck run returns 202 `{ runId, status, reused }`; stable fingerprint includes user, snapshot, model, representation, prompt, taxonomy.
3. Unchanged completed run is reused with zero provider calls.
4. Cursor is opaque; suggestion limit max 50.
5. Acceptance locks pending suggestion, validates ownership and hashes, supersedes stale input with 409, upserts entities/mappings/relation, marks accepted, and projects canonical legacy link in one transaction.
6. Dismiss is idempotent and only transitions pending to dismissed.
7. Neighborhood is one hop, defaults to 24 nodes/40 edges, paginates, returns accurate global summary.
8. Expansion creates at most eight suggestions in one structured call; targets may exist without cards.
9. Card-to-sense mapping validates ownership of both resources.
10. Tests cover authorization, exact error bodies, idempotency, concurrent accept, rollback, stale content, pagination/caps, and cache reuse.

### Task 11: Build the focused Deck Analytics explorer

**Files:**
- Create KG API wrapper/key factory and pure graph-state modules with tests
- Refactor/create components under the live Deck Analytics/deck-view path
- Add card-row “Explore connections” entry point

**Requirements:**

1. URL state is `?view=graph&card=<id>`.
2. One-hop root query; selecting a node does not change root; explicit expansion merges/deduplicates.
3. Root change clears expansions, comparison, and cluster selection.
4. Filters map relation types to Meaning, Hierarchy, Form, and Usage groups.
5. Hierarchy-only uses Dagre/arrows; all other mixes use fCoSE/root-centered.
6. Initial cap 24/40; expansion adds max 12; desktop 60/120; mobile 30/50.
7. Disable animation above 40 nodes or for reduced motion.
8. Use one key factory: `all`, `deck`, `neighborhood`, `run`, and `suggestions`.
9. Show loading/error/retry/empty/partial/stale states.
10. Suggestions are accepted individually or by explicit checked selection.

### Task 12: Add learning actions, mobile mode, and accessibility

**Files:**
- Extend explorer/detail/list components and study navigation validation
- Add pure eligibility/cluster tests and component/API tests

**Requirements:**

1. Detail actions: compare root, view card, discover related words, add to deck, add to cluster.
2. Cluster always contains root, same deck only, max 12; study route/API validates ownership.
3. Do not alter the scheduling algorithm.
4. Learn-next ranks relation usefulness, verifier band, no existing card, low retention/due, stable tie-break.
5. Mobile defaults to grouped relationship list; graph is optional toggle; detail uses existing Sheet.
6. Touch targets are at least 44px; no hover-only action.
7. Canvas has a semantically equivalent grouped list.
8. Use `aria-live` for expansions/counts, textual retention, reduced motion, and focus restoration.
9. Tests cover URL restoration, merge/caps/layout, eligibility, cluster cap, mobile/keyboard, live announcements, and invalidation.

### Task 13: Performance, observability, rollout verification, and full review

**Files:**
- Add structured logging/metrics fields and evaluation fixtures/scripts where appropriate
- Update code-level configuration documentation only if required

**Requirements:**

1. Structured logs and `kg_runs.stats` cover queue age/depth, stage latency, candidates/coverage, provider requests/tokens, cache hits, schema failures, timeout/retry/429, accept/dismiss, stale/partial/failed.
2. Add a human-labelled Anh–Việt evaluation fixture format and runner; do not fabricate 300 labels.
3. Automated gates: Family candidate coverage 98, 100-card verifier requests ≤3, 500-card requests ≤12, warm rerun zero provider calls.
4. Run migration checks and HNSW `EXPLAIN`.
5. Run `bun run typecheck`, `cd apps/api && bun test`, and `cd apps/web && bun test`.
6. Compare with baseline and report every remaining pre-existing/new failure accurately.
7. Perform an independent whole-diff code review and resolve all critical/important findings.
