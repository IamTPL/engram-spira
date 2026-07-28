import { afterAll, expect, test } from 'bun:test';
import postgres from 'postgres';

import { createPostgresSuggestionPersistenceRepository } from '../../../src/modules/knowledge-graph/kg-verification.repository';
import type { PersistedVerifierSuggestion } from '../../../src/modules/knowledge-graph/kg-verification.service';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const databases = new Set<string>();
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

function assertDatabaseName(databaseName: string) {
  if (!/^engram_kg_verifier_test_[a-f0-9]+$/.test(databaseName)) {
    throw new Error(`Refusing unsafe disposable database name: ${databaseName}`);
  }
}

async function canUsePostgres() {
  const sql = postgres(ADMIN_URL, { max: 1, connect_timeout: 2 });
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end();
  }
}

async function createDatabase() {
  const databaseName =
    `engram_kg_verifier_test_${crypto.randomUUID().replaceAll('-', '')}`;
  assertDatabaseName(databaseName);
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    databases.add(databaseName);
  } finally {
    await admin.end();
  }
  const url = new URL(ADMIN_URL);
  url.pathname = `/${databaseName}`;
  const sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  await sql`CREATE TABLE users (id uuid PRIMARY KEY)`;
  await sql`CREATE TABLE decks (id uuid PRIMARY KEY, user_id uuid NOT NULL)`;
  await sql`CREATE TABLE cards (id uuid PRIMARY KEY, deck_id uuid NOT NULL)`;
  await sql`CREATE TABLE lexemes (id uuid PRIMARY KEY, user_id uuid NOT NULL)`;
  await sql`
    CREATE TABLE lexical_senses (id uuid PRIMARY KEY, lexeme_id uuid NOT NULL)
  `;
  await sql`
    CREATE TABLE kg_runs (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      deck_id uuid NOT NULL,
      status text NOT NULL,
      stage text NOT NULL,
      locked_by text,
      locked_until timestamptz,
      cancel_requested_at timestamptz,
      embedding_model text NOT NULL,
      representation_version text NOT NULL,
      prompt_version text NOT NULL,
      taxonomy_version text NOT NULL
    )
  `;
  await sql`
    CREATE TABLE card_embedding_metadata (
      card_id uuid PRIMARY KEY,
      model text NOT NULL,
      dimensions integer NOT NULL,
      representation_version text NOT NULL,
      content_hash text NOT NULL
    )
  `;
  await sql`
    CREATE TABLE kg_relation_suggestions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id uuid NOT NULL,
      user_id uuid NOT NULL,
      source_card_id uuid,
      target_card_id uuid,
      source_sense_id uuid,
      target_sense_id uuid,
      source_artifact jsonb NOT NULL,
      target_artifact jsonb NOT NULL,
      source_content_hash text NOT NULL,
      target_content_hash text NOT NULL,
      decision text NOT NULL,
      relation_type text,
      direction text,
      confidence_band text NOT NULL,
      reason text NOT NULL,
      evidence jsonb,
      retrieval_similarity real,
      mutual_knn boolean NOT NULL DEFAULT false,
      fingerprint text NOT NULL,
      status text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, fingerprint)
    )
  `;
  return { databaseName, sql };
}

async function dropDatabase(databaseName: string) {
  assertDatabaseName(databaseName);
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    databases.delete(databaseName);
  } finally {
    await admin.end();
  }
}

afterAll(async () => {
  for (const databaseName of [...databases]) {
    await dropDatabase(databaseName);
  }
});

const integrationTest = (await canUsePostgres()) ? test : test.skip;

type Fixture = {
  userId: string;
  otherUserId: string;
  runId: string;
  secondRunId: string;
  sourceCardId: string;
  targetCardId: string;
  sourceSenseId: string;
  targetSenseId: string;
  foreignSenseId: string;
  deckId: string;
  workerId: string;
};

async function seed(
  sql: ReturnType<typeof postgres>,
): Promise<Fixture> {
  const fixture: Fixture = {
    userId: id(1),
    otherUserId: id(2),
    runId: id(3),
    secondRunId: id(4),
    sourceCardId: id(5),
    targetCardId: id(6),
    sourceSenseId: id(7),
    targetSenseId: id(8),
    foreignSenseId: id(9),
    deckId: id(10),
    workerId: 'kg-worker-test',
  };
  const otherDeckId = id(11);
  const sourceLexemeId = id(12);
  const targetLexemeId = id(13);
  const foreignLexemeId = id(14);
  await sql`
    INSERT INTO users (id)
    VALUES (${fixture.userId}), (${fixture.otherUserId})
  `;
  await sql`
    INSERT INTO decks (id, user_id)
    VALUES
      (${fixture.deckId}, ${fixture.userId}),
      (${otherDeckId}, ${fixture.otherUserId})
  `;
  await sql`
    INSERT INTO cards (id, deck_id)
    VALUES
      (${fixture.sourceCardId}, ${fixture.deckId}),
      (${fixture.targetCardId}, ${fixture.deckId})
  `;
  await sql`
    INSERT INTO lexemes (id, user_id)
    VALUES
      (${sourceLexemeId}, ${fixture.userId}),
      (${targetLexemeId}, ${fixture.userId}),
      (${foreignLexemeId}, ${fixture.otherUserId})
  `;
  await sql`
    INSERT INTO lexical_senses (id, lexeme_id)
    VALUES
      (${fixture.sourceSenseId}, ${sourceLexemeId}),
      (${fixture.targetSenseId}, ${targetLexemeId}),
      (${fixture.foreignSenseId}, ${foreignLexemeId})
  `;
  await sql`
    INSERT INTO kg_runs (
      id,
      user_id,
      deck_id,
      status,
      stage,
      locked_by,
      locked_until,
      embedding_model,
      representation_version,
      prompt_version,
      taxonomy_version
    )
    VALUES
      (
        ${fixture.runId},
        ${fixture.userId},
        ${fixture.deckId},
        'processing',
        'verification',
        ${fixture.workerId},
        now() + interval '10 minutes',
        'gemini-embedding-2',
        'v1',
        'kg-relations-v1',
        'lexical-relations-v1'
      ),
      (
        ${fixture.secondRunId},
        ${fixture.userId},
        ${fixture.deckId},
        'processing',
        'verification',
        ${fixture.workerId},
        now() + interval '10 minutes',
        'gemini-embedding-2',
        'v1',
        'kg-relations-v1',
        'lexical-relations-v1'
      )
  `;
  await sql`
    INSERT INTO card_embedding_metadata (
      card_id,
      model,
      dimensions,
      representation_version,
      content_hash
    )
    VALUES
      (
        ${fixture.sourceCardId},
        'gemini-embedding-2',
        768,
        'v1',
        ${'a'.repeat(64)}
      ),
      (
        ${fixture.targetCardId},
        'gemini-embedding-2',
        768,
        'v1',
        ${'b'.repeat(64)}
      )
  `;
  return fixture;
}

function artifact(cardId: string | null, word: string, hash: string) {
  return {
    cardId: cardId ?? id(999),
    sourceLanguageTag: 'en',
    definitionLanguageTag: 'vi',
    lemma: word,
    normalizedLemma: word,
    partOfSpeech: 'noun',
    definition: `definition ${word}`,
    normalizedDefinition: `definition ${word}`,
    ipa: null,
    examples: [],
    contentHash: hash,
    representationVersion: 'v1' as const,
  };
}

function record(
  fixture: Fixture,
  index: number,
  overrides: Partial<PersistedVerifierSuggestion> = {},
): PersistedVerifierSuggestion {
  const sourceHash = 'a'.repeat(64);
  const targetHash = 'b'.repeat(64);
  return {
    runId: fixture.runId,
    userId: fixture.userId,
    sourceCardId: fixture.sourceCardId,
    targetCardId: fixture.targetCardId,
    sourceSenseId: fixture.sourceSenseId,
    targetSenseId: fixture.targetSenseId,
    sourceArtifact: artifact(fixture.sourceCardId, 'source', sourceHash),
    targetArtifact: artifact(fixture.targetCardId, 'target', targetHash),
    sourceContentHash: sourceHash,
    targetContentHash: targetHash,
    decision: 'relation',
    relationType: 'synonym',
    direction: 'symmetric',
    confidenceBand: 'high',
    reason: 'Verified lexical evidence.',
    evidence: null,
    retrievalSimilarity: 0.88,
    mutualKnn: true,
    fingerprint: index.toString(16).padStart(64, '0'),
    status: 'pending',
    ...overrides,
  };
}

function fence(fixture: Fixture, runId = fixture.runId) {
  return {
    runId,
    userId: fixture.userId,
    deckId: fixture.deckId,
    workerId: fixture.workerId,
  };
}

integrationTest(
  'persists typed suggestions idempotently and only refreshes a prior abstain',
  async () => {
    const { databaseName, sql } = await createDatabase();
    try {
      const fixture = await seed(sql);
      const repository =
        createPostgresSuggestionPersistenceRepository(sql);
      const records = [
        record(fixture, 1),
        record(fixture, 2, {
          decision: 'none',
          relationType: null,
          direction: null,
          status: 'rejected',
        }),
        record(fixture, 3, {
          decision: 'abstain',
          relationType: null,
          direction: null,
          status: 'rejected',
        }),
      ];

      expect(
        await repository.persistSuggestions(fence(fixture), records),
      ).toEqual({ persisted: 3, pending: 1 });
      expect(
        await repository.persistSuggestions(fence(fixture), records),
      ).toEqual({ persisted: 1, pending: 1 });
      const cached = await repository.loadExistingSuggestions(
        fixture.userId,
        records.map((item) => item.fingerprint),
      );
      expect(cached).toHaveLength(3);

      expect(
        await repository.persistSuggestions(
          fence(fixture, fixture.secondRunId),
          [
            record(fixture, 3, {
              runId: fixture.secondRunId,
              decision: 'relation',
              relationType: 'antonym',
              direction: 'symmetric',
              status: 'pending',
            }),
          ],
        ),
      ).toEqual({ persisted: 1, pending: 2 });
      const rows = await sql<{
        count: number;
        runId: string;
        decision: string;
        status: string;
      }[]>`
        SELECT
          count(*)::int AS count,
          max(run_id::text) FILTER (
            WHERE fingerprint = ${records[2]!.fingerprint}
          ) AS "runId",
          max(decision) FILTER (
            WHERE fingerprint = ${records[2]!.fingerprint}
          ) AS decision,
          max(status) FILTER (
            WHERE fingerprint = ${records[2]!.fingerprint}
          ) AS status
        FROM kg_relation_suggestions
      `;
      expect(rows[0]).toEqual({
        count: 3,
        runId: fixture.secondRunId,
        decision: 'relation',
        status: 'pending',
      });
    } finally {
      await sql.end();
      await dropDatabase(databaseName);
    }
  },
);

integrationTest(
  'reattaches a current pending deck suggestion even when there are no new records',
  async () => {
    const { databaseName, sql } = await createDatabase();
    try {
      const fixture = await seed(sql);
      const repository =
        createPostgresSuggestionPersistenceRepository(sql);
      const pending = record(fixture, 1);
      await repository.persistSuggestions(fence(fixture), [pending]);

      expect(
        await repository.persistSuggestions(
          fence(fixture, fixture.secondRunId),
          [],
        ),
      ).toEqual({ persisted: 0, pending: 1 });
      const [row] = await sql<{ runId: string }[]>`
        SELECT run_id AS "runId"
        FROM kg_relation_suggestions
        WHERE fingerprint = ${pending.fingerprint}
      `;
      expect(row?.runId).toBe(fixture.secondRunId);
    } finally {
      await sql.end();
      await dropDatabase(databaseName);
    }
  },
);

integrationTest(
  'rejects cancelled, expired, and foreign-worker persistence fences',
  async () => {
    const { databaseName, sql } = await createDatabase();
    try {
      const fixture = await seed(sql);
      const repository =
        createPostgresSuggestionPersistenceRepository(sql);
      const pending = record(fixture, 1);

      await sql`
        UPDATE kg_runs
        SET cancel_requested_at = now()
        WHERE id = ${fixture.runId}
      `;
      await expect(
        repository.persistSuggestions(fence(fixture), [pending]),
      ).rejects.toThrow('no longer writable');

      await sql`
        UPDATE kg_runs
        SET
          cancel_requested_at = NULL,
          locked_until = now() - interval '1 second'
        WHERE id = ${fixture.runId}
      `;
      await expect(
        repository.persistSuggestions(fence(fixture), [pending]),
      ).rejects.toThrow('no longer writable');

      await sql`
        UPDATE kg_runs
        SET locked_until = now() + interval '10 minutes'
        WHERE id = ${fixture.runId}
      `;
      await expect(
        repository.persistSuggestions(
          { ...fence(fixture), workerId: 'stale-worker' },
          [pending],
        ),
      ).rejects.toThrow('no longer writable');
      expect(
        await sql`SELECT id FROM kg_relation_suggestions`,
      ).toHaveLength(0);
    } finally {
      await sql.end();
      await dropDatabase(databaseName);
    }
  },
);

integrationTest(
  'rejects cross-user endpoints before insertion and supports artifact-only targets',
  async () => {
    const { databaseName, sql } = await createDatabase();
    try {
      const fixture = await seed(sql);
      const repository =
        createPostgresSuggestionPersistenceRepository(sql);

      await expect(
        repository.persistSuggestions(fence(fixture), [
          record(fixture, 1),
          record(fixture, 2, { targetSenseId: fixture.foreignSenseId }),
        ]),
      ).rejects.toThrow('Lexical sense not found');
      expect(
        await sql`SELECT id FROM kg_relation_suggestions`,
      ).toHaveLength(0);

      const artifactOnly = record(fixture, 3, {
        targetCardId: null,
        targetSenseId: null,
        targetArtifact: artifact(null, 'discovered', 'd'.repeat(64)),
        targetContentHash: 'd'.repeat(64),
      });
      expect(
        await repository.persistSuggestions(fence(fixture), [artifactOnly]),
      ).toEqual({ persisted: 1, pending: 0 });
    } finally {
      await sql.end();
      await dropDatabase(databaseName);
    }
  },
);
