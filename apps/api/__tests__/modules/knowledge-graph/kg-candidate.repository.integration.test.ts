import { afterAll, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import {
  buildCandidateKnnQuery,
  createPostgresCandidateRepository,
  type CandidateSqlExecutor,
} from '../../../src/modules/knowledge-graph/kg-candidate.repository';
import {
  canonicalizeDirectedCandidates,
  generateDeckCandidates,
  type CandidateStageInput,
} from '../../../src/modules/knowledge-graph/kg-candidates';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const createdDatabases = new Set<string>();
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

async function canUseDisposablePostgres() {
  const admin = postgres(ADMIN_URL, {
    max: 1,
    connect_timeout: 2,
    idle_timeout: 1,
  });
  try {
    await admin`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await admin.end();
  }
}

const postgresAvailable = await canUseDisposablePostgres();
const integrationTest = postgresAvailable ? test : test.skip;

function assertDisposableDatabaseName(databaseName: string) {
  if (!/^engram_kg_candidate_test_[a-f0-9]+$/.test(databaseName)) {
    throw new Error(`Refusing unsafe disposable database name: ${databaseName}`);
  }
}

async function createDisposableDatabase() {
  const databaseName =
    `engram_kg_candidate_test_${crypto.randomUUID().replaceAll('-', '')}`;
  assertDisposableDatabaseName(databaseName);
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    createdDatabases.add(databaseName);
  } finally {
    await admin.end();
  }

  const databaseUrl = new URL(ADMIN_URL);
  databaseUrl.pathname = `/${databaseName}`;
  const client = postgres(databaseUrl.toString(), {
    max: 1,
    onnotice: () => {},
  });
  await client`CREATE EXTENSION IF NOT EXISTS vector`;
  await client.unsafe(`
    CREATE TABLE users (id uuid PRIMARY KEY);
    CREATE TABLE decks (id uuid PRIMARY KEY, user_id uuid NOT NULL);
    CREATE TABLE cards (id uuid PRIMARY KEY, deck_id uuid NOT NULL);
    CREATE TABLE card_field_values (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      card_id uuid NOT NULL,
      embedding vector(768)
    );
    CREATE TABLE card_embedding_metadata (
      card_id uuid PRIMARY KEY,
      model text NOT NULL,
      dimensions integer NOT NULL,
      representation_version text NOT NULL,
      content_hash text NOT NULL
    );
    CREATE TABLE lexemes (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      language_tag text NOT NULL,
      lemma text NOT NULL,
      normalized_lemma text NOT NULL
    );
    CREATE TABLE lexical_senses (
      id uuid PRIMARY KEY,
      lexeme_id uuid NOT NULL,
      part_of_speech text NOT NULL,
      definition_language_tag text NOT NULL,
      definition text NOT NULL,
      normalized_definition text NOT NULL,
      ipa text,
      examples jsonb NOT NULL DEFAULT '[]'::jsonb
    );
    CREATE TABLE card_senses (
      card_id uuid NOT NULL,
      sense_id uuid NOT NULL,
      is_primary boolean NOT NULL
    );
    CREATE TABLE sense_relations (
      user_id uuid NOT NULL,
      source_sense_id uuid NOT NULL,
      target_sense_id uuid NOT NULL,
      relation_type text NOT NULL
    );
    CREATE TABLE kg_runs (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      run_type text NOT NULL,
      deck_id uuid,
      embedding_model text NOT NULL,
      representation_version text NOT NULL,
      prompt_version text NOT NULL,
      taxonomy_version text NOT NULL,
      source_language_tag text NOT NULL,
      definition_language_tag text NOT NULL,
      snapshot jsonb NOT NULL
    );
    CREATE TABLE kg_relation_suggestions (
      user_id uuid NOT NULL,
      run_id uuid NOT NULL,
      source_content_hash text NOT NULL,
      target_content_hash text NOT NULL,
      decision text NOT NULL,
      fingerprint text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE dismissed_suggestions (
      user_id uuid NOT NULL,
      source_card_id uuid NOT NULL,
      target_card_id uuid NOT NULL
    )
  `);
  await client`
    CREATE INDEX idx_cfv_embedding
    ON card_field_values
    USING hnsw (embedding vector_cosine_ops)
  `;
  return {
    databaseName,
    client,
    executor: drizzle(client) as unknown as CandidateSqlExecutor,
  };
}

async function dropDisposableDatabase(databaseName: string) {
  assertDisposableDatabaseName(databaseName);
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    createdDatabases.delete(databaseName);
  } finally {
    await admin.end();
  }
}

afterAll(async () => {
  for (const databaseName of [...createdDatabases]) {
    await dropDisposableDatabase(databaseName);
  }
});

function vectorLiteral(index: number): string {
  const angle = index / 40;
  const values = [Math.cos(angle), Math.sin(angle)];
  while (values.length < 768) values.push(0);
  return `[${values.join(',')}]`;
}

integrationTest(
  'retrieves compatible k=8 neighbors with directional suppression and an HNSW plan',
  async () => {
    const { databaseName, client, executor } =
      await createDisposableDatabase();
    try {
      const userId = id(9_001);
      const deckId = id(9_002);
      const runId = id(9_003);
      const cardCount = 128;
      const cards = Array.from({ length: cardCount }, (_, index) => ({
        cardId: id(index + 1),
        senseId: id(index + 2_001),
        lexemeId: id(index + 4_001),
        contentHash: String(index + 1).padStart(64, 'a'),
      }));
      const input: CandidateStageInput = {
        runId,
        userId,
        deckId,
        embeddingModel: 'gemini-embedding-2',
        representationVersion: 'v1',
        promptVersion: 'relations-v1',
        taxonomyVersion: 'taxonomy-v1',
      };

      await client`INSERT INTO users (id) VALUES (${userId})`;
      await client`INSERT INTO decks (id, user_id) VALUES (${deckId}, ${userId})`;
      await client`
        INSERT INTO kg_runs (
          id,
          user_id,
          run_type,
          deck_id,
          embedding_model,
          representation_version,
          prompt_version,
          taxonomy_version,
          source_language_tag,
          definition_language_tag,
          snapshot
        )
        VALUES (
          ${runId},
          ${userId},
          'deck_index',
          ${deckId},
          ${input.embeddingModel},
          ${input.representationVersion},
          ${input.promptVersion},
          ${input.taxonomyVersion},
          'en',
          'en',
          ${JSON.stringify({
            representationVersion: 'v1',
            cards: cards.map((card) => ({
              cardId: card.cardId,
              contentHash: card.contentHash,
            })),
            snapshotHash: 'snapshot',
          })}::jsonb
        )
      `;
      await client.begin(async (rawTransaction) => {
        const transaction = rawTransaction as unknown as Sql;
        for (const [index, card] of cards.entries()) {
          await transaction`
            INSERT INTO cards (id, deck_id) VALUES (${card.cardId}, ${deckId})
          `;
          await transaction`
            INSERT INTO lexemes (
              id, user_id, language_tag, lemma, normalized_lemma
            )
            VALUES (
              ${card.lexemeId},
              ${userId},
              'en',
              ${`word ${index}`},
              ${`word ${index}`}
            )
          `;
          await transaction`
            INSERT INTO lexical_senses (
              id,
              lexeme_id,
              part_of_speech,
              definition_language_tag,
              definition,
              normalized_definition
            )
            VALUES (
              ${card.senseId},
              ${card.lexemeId},
              'noun',
              'en',
              ${`definition ${index}`},
              ${`definition ${index}`}
            )
          `;
          await transaction`
            INSERT INTO card_senses (card_id, sense_id, is_primary)
            VALUES (${card.cardId}, ${card.senseId}, true)
          `;
          await transaction`
            INSERT INTO card_embedding_metadata (
              card_id,
              model,
              dimensions,
              representation_version,
              content_hash
            )
            VALUES (
              ${card.cardId},
              'gemini-embedding-2',
              768,
              'v1',
              ${card.contentHash}
            )
          `;
          await transaction`
            INSERT INTO card_field_values (card_id, embedding)
            VALUES (${card.cardId}, ${vectorLiteral(index)}::vector)
          `;
        }
      });
      await client`
        INSERT INTO card_field_values (card_id, embedding)
        VALUES (${cards[1]!.cardId}, ${vectorLiteral(1)}::vector)
      `;
      await client.begin(async (rawTransaction) => {
        const transaction = rawTransaction as unknown as Sql;
        for (let index = 0; index < 96; index += 1) {
          await transaction`
            INSERT INTO card_field_values (card_id, embedding)
            VALUES (
              ${id(20_000 + index)},
              ${vectorLiteral(index * 1.25)}::vector
            )
          `;
        }
        // Dense off-deck noise around one vocabulary region exercises the
        // production failure mode where a filtered global HNSW scan cannot
        // fill the requested in-deck neighborhood within its scan budget.
        for (let index = 0; index < 256; index += 1) {
          await transaction`
            INSERT INTO card_field_values (card_id, embedding)
            VALUES (
              ${id(30_000 + index)},
              ${vectorLiteral(0)}::vector
            )
          `;
        }
      });
      await client`
        UPDATE card_embedding_metadata
        SET content_hash = ${'stale'.padStart(64, '0')}
        WHERE card_id = ${cards.at(-1)!.cardId}
      `;
      await client`
        UPDATE lexemes
        SET language_tag = 'vi'
        WHERE id = ${cards.at(-2)!.lexemeId}
      `;
      await client`
        INSERT INTO sense_relations (
          user_id,
          source_sense_id,
          target_sense_id,
          relation_type
        )
        VALUES (
          ${userId},
          ${cards[0]!.senseId},
          ${cards[1]!.senseId},
          'is_a'
        )
      `;
      await client`
        INSERT INTO sense_relations (
          user_id,
          source_sense_id,
          target_sense_id,
          relation_type
        )
        VALUES (
          ${userId},
          ${cards[2]!.senseId},
          ${cards[3]!.senseId},
          'synonym'
        )
      `;
      await client`ANALYZE card_field_values`;
      await client`SET enable_seqscan = off`;

      const repository = createPostgresCandidateRepository(executor);
      const retrieval = await repository.retrieveDirectedCandidates(input);
      expect(retrieval.cardCount).toBe(cardCount);
      const eligibleCardCount = cardCount - 2;
      expect(retrieval.rows).toHaveLength(eligibleCardCount * 8);
      const directedCounts = new Map<string, number>();
      for (const row of retrieval.rows) {
        directedCounts.set(
          row.source.cardId,
          (directedCounts.get(row.source.cardId) ?? 0) + 1,
        );
      }
      expect(
        Math.max(...directedCounts.values()),
      ).toBe(8);
      expect(Math.min(...directedCounts.values())).toBe(8);
      expect(
        cards
          .slice(0, -2)
          .filter((card) => !directedCounts.has(card.cardId))
          .map((card) => card.cardId),
      ).toEqual([]);
      expect(directedCounts.size).toBe(eligibleCardCount);
      const constrainedRows = await executor.execute<{
        fallbackSourceCount: number | string;
        sourceCardId: string | null;
      }>(
        buildCandidateKnnQuery(input, {
          hnswIterativeScan: 'off',
          hnswMaxScanTuples: 1,
          hnswEfSearch: 8,
        }),
      );
      const constrainedCounts = new Map<string, number>();
      for (const row of constrainedRows) {
        if (!row.sourceCardId) continue;
        constrainedCounts.set(
          row.sourceCardId,
          (constrainedCounts.get(row.sourceCardId) ?? 0) + 1,
        );
      }
      expect(
        Number(constrainedRows[0]?.fallbackSourceCount ?? 0),
      ).toBeGreaterThan(0);
      expect(constrainedRows.length).toBeLessThanOrEqual(
        eligibleCardCount * 8,
      );
      expect(constrainedCounts.size).toBe(eligibleCardCount);
      expect(Math.min(...constrainedCounts.values())).toBe(8);
      expect(Math.max(...constrainedCounts.values())).toBe(8);
      expect(
        new Set(
          retrieval.rows.map(
            (row) => `${row.source.cardId}:${row.target.cardId}`,
          ),
        ).size,
      ).toBe(retrieval.rows.length);
      expect(
        retrieval.rows.some(
          (row) =>
            row.source.cardId === cards.at(-1)!.cardId ||
            row.target.cardId === cards.at(-1)!.cardId ||
            row.source.cardId === cards.at(-2)!.cardId ||
            row.target.cardId === cards.at(-2)!.cardId,
        ),
      ).toBe(false);

      const canonical = canonicalizeDirectedCandidates(retrieval.rows, input);
      const directedPair = canonical.find(
        (candidate) =>
          candidate.source.cardId === cards[0]!.cardId &&
          candidate.target.cardId === cards[1]!.cardId,
      );
      expect(directedPair?.retrievedDirections).toEqual(['target_to_source']);
      expect(
        canonical.some(
          (candidate) =>
            candidate.source.cardId === cards[2]!.cardId &&
            candidate.target.cardId === cards[3]!.cardId,
        ),
      ).toBe(false);
      const generated = await generateDeckCandidates(input, repository);
      expect(generated.candidates).toHaveLength(77);

      const [
        dismissed,
        typedDismissed,
        duplicate,
        acceptedDuplicate,
        currentNegative,
        staleNegative,
        abstain,
        malformed,
      ] = canonical.slice(5, 13);
      expect([
        dismissed,
        typedDismissed,
        duplicate,
        acceptedDuplicate,
        currentNegative,
        staleNegative,
        abstain,
        malformed,
      ].every(Boolean)).toBe(true);
      const staleRunId = id(9_004);
      await client`
        INSERT INTO kg_runs (
          id,
          user_id,
          run_type,
          deck_id,
          embedding_model,
          representation_version,
          prompt_version,
          taxonomy_version,
          source_language_tag,
          definition_language_tag,
          snapshot
        )
        VALUES (
          ${staleRunId},
          ${userId},
          'deck_index',
          ${deckId},
          ${input.embeddingModel},
          ${input.representationVersion},
          'relations-old',
          ${input.taxonomyVersion},
          'en',
          'en',
          '{}'::jsonb
        )
      `;
      await client`
        INSERT INTO dismissed_suggestions (
          user_id, source_card_id, target_card_id
        )
        VALUES (
          ${userId},
          ${dismissed!.source.cardId},
          ${dismissed!.target.cardId}
        )
      `;
      await client`
        INSERT INTO kg_relation_suggestions (
          user_id,
          run_id,
          source_content_hash,
          target_content_hash,
          decision,
          fingerprint,
          status
        )
        VALUES (
          ${userId},
          ${runId},
          ${typedDismissed!.source.artifact.contentHash},
          ${typedDismissed!.target.artifact.contentHash},
          'relation',
          ${typedDismissed!.fingerprint},
          'dismissed'
        ), (
          ${userId},
          ${runId},
          ${duplicate!.source.artifact.contentHash},
          ${duplicate!.target.artifact.contentHash},
          'relation',
          ${duplicate!.fingerprint},
          'pending'
        ), (
          ${userId},
          ${runId},
          ${acceptedDuplicate!.source.artifact.contentHash},
          ${acceptedDuplicate!.target.artifact.contentHash},
          'relation',
          ${acceptedDuplicate!.fingerprint},
          'accepted'
        ), (
          ${userId},
          ${runId},
          ${currentNegative!.source.artifact.contentHash},
          ${currentNegative!.target.artifact.contentHash},
          'none',
          ${currentNegative!.fingerprint},
          'rejected'
        ), (
          ${userId},
          ${staleRunId},
          ${staleNegative!.source.artifact.contentHash},
          ${staleNegative!.target.artifact.contentHash},
          'none',
          ${staleNegative!.fingerprint},
          'rejected'
        ), (
          ${userId},
          ${runId},
          ${abstain!.source.artifact.contentHash},
          ${abstain!.target.artifact.contentHash},
          'abstain',
          ${abstain!.fingerprint},
          'rejected'
        ), (
          ${userId},
          ${runId},
          ${malformed!.source.artifact.contentHash},
          ${malformed!.target.artifact.contentHash},
          'malformed',
          ${malformed!.fingerprint},
          'rejected'
        )
      `;
      const suppressed = await repository.loadSuppressedFingerprints(
        input,
        canonical,
      );
      expect(suppressed).toEqual(
        new Set([
          dismissed!.fingerprint,
          typedDismissed!.fingerprint,
          duplicate!.fingerprint,
          acceptedDuplicate!.fingerprint,
          currentNegative!.fingerprint,
        ]),
      );
      const filtered = await generateDeckCandidates(input, repository);
      expect(
        filtered.candidates.some((candidate) =>
          suppressed.has(candidate.fingerprint),
        ),
      ).toBe(false);
      expect(
        repository.retrieveDirectedCandidates({
          ...input,
          userId: id(99_999),
        }),
      ).rejects.toThrow('Run not found');

      const planRows = await executor.execute<{ 'QUERY PLAN': string }>(
        sql`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
          ${buildCandidateKnnQuery(input)}`,
      );
      const plan = planRows.map((row) => row['QUERY PLAN']).join('\n');
      expect(plan).toContain('idx_cfv_embedding');
      expect(plan).toContain('Index Scan');

      await client`
        UPDATE card_field_values
        SET embedding = ${`[${Array.from({ length: 768 }, () => 0).join(',')}]`}::vector
        WHERE card_id = ${cards[10]!.cardId}
      `;
      const afterCorruption = await repository.retrieveDirectedCandidates(input);
      expect(
        afterCorruption.rows.some(
          (candidate) =>
            candidate.source.cardId === cards[10]!.cardId ||
            candidate.target.cardId === cards[10]!.cardId,
        ),
      ).toBe(false);
      expect(
        afterCorruption.rows.every(
          (candidate) =>
            Number.isFinite(candidate.similarity) &&
            candidate.similarity >= 0 &&
            candidate.similarity <= 1,
        ),
      ).toBe(true);
    } finally {
      await client.end();
      await dropDisposableDatabase(databaseName);
    }
  },
  20_000,
);
