import { afterAll, expect, test } from 'bun:test';
import postgres from 'postgres';

import { createPostgresKgRunsRepository } from '../../../src/modules/knowledge-graph/kg-runs.repository';
import { createPostgresSenseExpansionRepository } from '../../../src/modules/knowledge-graph/kg-expansion.repository';
import {
  buildSenseExpansionArtifact,
  buildSenseExpansionSuggestionFingerprint,
  parseSenseExpansionSuggestions,
  type SenseExpansionSource,
} from '../../../src/modules/knowledge-graph/kg-expansion.service';
import type { EnqueueSenseExpansionRunInput } from '../../../src/modules/knowledge-graph/kg-runs.service';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const databases = new Set<string>();
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

function assertDatabaseName(databaseName: string) {
  if (!/^engram_kg_expansion_test_[a-f0-9]+$/.test(databaseName)) {
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
    `engram_kg_expansion_test_${crypto.randomUUID().replaceAll('-', '')}`;
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
  const sql = postgres(url.toString(), { max: 8, onnotice: () => {} });
  await sql`CREATE TABLE users (id uuid PRIMARY KEY)`;
  await sql`
    CREATE TABLE lexemes (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      language_tag text NOT NULL,
      lemma text NOT NULL,
      normalized_lemma text NOT NULL
    )
  `;
  await sql`
    CREATE TABLE lexical_senses (
      id uuid PRIMARY KEY,
      lexeme_id uuid NOT NULL,
      part_of_speech text NOT NULL,
      definition_language_tag text NOT NULL,
      definition text NOT NULL,
      normalized_definition text NOT NULL,
      ipa text,
      examples jsonb NOT NULL DEFAULT '[]',
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE kg_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      run_type text NOT NULL,
      deck_id uuid,
      focus_sense_id uuid,
      status text NOT NULL DEFAULT 'queued',
      stage text NOT NULL DEFAULT 'snapshot',
      fingerprint text NOT NULL,
      representation_version text NOT NULL,
      embedding_model text NOT NULL,
      prompt_version text NOT NULL,
      taxonomy_version text NOT NULL,
      source_language_tag text NOT NULL,
      definition_language_tag text NOT NULL,
      snapshot jsonb NOT NULL DEFAULT '{}',
      progress jsonb NOT NULL DEFAULT '{}',
      stats jsonb NOT NULL DEFAULT '{}',
      attempt_count integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 5,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      locked_by uuid,
      locked_until timestamptz,
      heartbeat_at timestamptz,
      error_code text,
      error_message text,
      cancel_requested_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      partial_at timestamptz,
      failed_at timestamptz,
      cancelled_at timestamptz,
      stale_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX uq_kg_runs_active_focus_sense
    ON kg_runs (user_id, focus_sense_id)
    WHERE focus_sense_id IS NOT NULL
      AND status IN ('queued', 'processing')
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
      status text NOT NULL DEFAULT 'pending',
      accepted_relation_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      accepted_at timestamptz,
      dismissed_at timestamptz,
      superseded_at timestamptz,
      UNIQUE (user_id, fingerprint)
    )
  `;
  await sql`
    CREATE TABLE sense_relations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      source_sense_id uuid NOT NULL,
      target_sense_id uuid NOT NULL,
      relation_type text NOT NULL
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

function source(): SenseExpansionSource {
  return {
    senseId: id(10),
    lexemeId: id(11),
    sourceLanguageTag: 'en',
    definitionLanguageTag: 'vi',
    lemma: 'bank',
    normalizedLemma: 'bank',
    partOfSpeech: 'noun',
    definition: 'ngân hàng',
    normalizedDefinition: 'ngân hàng',
    ipa: '/bæŋk/',
    examples: ['I deposited money at the bank.'],
  };
}

async function seedSense(
  sql: postgres.Sql,
  userId = id(1),
  value = source(),
) {
  await sql`INSERT INTO users (id) VALUES (${userId}) ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO lexemes (
      id,
      user_id,
      language_tag,
      lemma,
      normalized_lemma
    )
    VALUES (
      ${value.lexemeId},
      ${userId},
      ${value.sourceLanguageTag},
      ${value.lemma},
      ${value.normalizedLemma}
    )
  `;
  await sql`
    INSERT INTO lexical_senses (
      id,
      lexeme_id,
      part_of_speech,
      definition_language_tag,
      definition,
      normalized_definition,
      ipa,
      examples
    )
    VALUES (
      ${value.senseId},
      ${value.lexemeId},
      ${value.partOfSpeech},
      ${value.definitionLanguageTag},
      ${value.definition},
      ${value.normalizedDefinition},
      ${value.ipa},
      ${sql.json(value.examples)}
    )
  `;
}

function enqueueInput(
  userId = id(1),
  fingerprint = 'f'.repeat(64),
): EnqueueSenseExpansionRunInput {
  const focus = buildSenseExpansionArtifact(source());
  return {
    userId,
    focusSenseId: source().senseId,
    fingerprint,
    representationVersion: 'v1',
    embeddingModel: 'gemini-embedding-2',
    promptVersion: 'kg-expansion-v1',
    taxonomyVersion: 'lexical-relations-v1',
    sourceLanguageTag: 'en',
    definitionLanguageTag: 'vi',
    snapshot: {
      version: 'sense-expansion-v1',
      generationModel: 'gemini-2.5-flash',
      maxSuggestions: 8,
      focus,
    },
  };
}

function suggestion() {
  const focus = buildSenseExpansionArtifact(source());
  const [value] = parseSenseExpansionSuggestions(
    [
      {
        target: {
          sourceLanguageTag: 'en',
          definitionLanguageTag: 'vi',
          lemma: 'financial institution',
          partOfSpeech: 'noun',
          definition: 'tổ chức tài chính',
          ipa: null,
          examples: [],
        },
        relationType: 'is_a',
        direction: 'source_to_target',
        confidenceBand: 'high',
        reason: 'A bank is a type of financial institution.',
        evidence: {
          source: 'lemma: bank',
          target: 'lemma: financial institution',
        },
      },
    ],
    focus,
  );
  if (!value) throw new Error('Expected fixture suggestion');
  return {
    ...value,
    fingerprint: buildSenseExpansionSuggestionFingerprint({
      userId: id(1),
      sourceArtifact: focus,
      suggestion: value,
      generationModel: 'gemini-2.5-flash',
      representationVersion: 'v1',
      promptVersion: 'kg-expansion-v1',
      taxonomyVersion: 'lexical-relations-v1',
    }),
  };
}

integrationTest(
  'loads only an owned sense and atomically reuses unchanged completed or active expansion runs',
  async () => {
    const { databaseName, sql } = await createDatabase();
    try {
      await seedSense(sql);
      await sql`INSERT INTO users (id) VALUES (${id(2)})`;
      const sourceRepository = createPostgresSenseExpansionRepository(sql);
      const runsRepository = createPostgresKgRunsRepository(sql);

      expect(
        await sourceRepository.loadOwnedSense(id(1), source().senseId),
      ).toEqual(source());
      expect(
        await sourceRepository.loadOwnedSense(id(2), source().senseId),
      ).toBeNull();

      const [first, second] = await Promise.all([
        runsRepository.enqueueSenseExpansionRun(enqueueInput()),
        runsRepository.enqueueSenseExpansionRun(enqueueInput()),
      ]);
      expect([first.reused, second.reused].sort()).toEqual([false, true]);
      expect(first.run.id).toBe(second.run.id);
      expect(first.run).toMatchObject({
        runType: 'sense_expansion',
        deckId: null,
        focusSenseId: source().senseId,
        stage: 'snapshot',
        progress: { completed: 0, total: 3 },
        stats: { indexedSenses: 1 },
        snapshot: {
          version: 'sense-expansion-v1',
          generationModel: 'gemini-2.5-flash',
          maxSuggestions: 8,
          focus: { lemma: 'bank' },
        },
      });

      await sql`
        UPDATE kg_runs
        SET status = 'completed', completed_at = now()
        WHERE id = ${first.run.id}
      `;
      const completed =
        await runsRepository.enqueueSenseExpansionRun(enqueueInput());
      expect(completed).toMatchObject({
        reused: true,
        run: { id: first.run.id, status: 'completed' },
      });

      const changed = await runsRepository.enqueueSenseExpansionRun(
        enqueueInput(id(1), 'e'.repeat(64)),
      );
      expect(changed.reused).toBe(false);
      expect(changed.run.id).not.toBe(first.run.id);

      await expect(
        runsRepository.enqueueSenseExpansionRun(
          enqueueInput(id(2), 'a'.repeat(64)),
        ),
      ).rejects.toThrow('Lexical sense not found');
    } finally {
      await sql.end();
      await dropDatabase(databaseName);
    }
  },
);

integrationTest(
  'persists artifact-only pending suggestions behind the run lease and remains idempotent',
  async () => {
    const { databaseName, sql } = await createDatabase();
    try {
      await seedSense(sql);
      const runsRepository = createPostgresKgRunsRepository(sql);
      const sourceRepository = createPostgresSenseExpansionRepository(sql);
      const queued =
        await runsRepository.enqueueSenseExpansionRun(enqueueInput());
      const workerId = id(99);
      await sql`
        UPDATE kg_runs
        SET
          status = 'processing',
          stage = 'persistence',
          locked_by = ${workerId},
          locked_until = now() + interval '1 minute'
        WHERE id = ${queued.run.id}
      `;
      const focus = buildSenseExpansionArtifact(source());
      const fence = {
        runId: queued.run.id,
        userId: id(1),
        focusSenseId: source().senseId,
        workerId,
        expectedFocus: focus,
      };

      expect(
        await sourceRepository.persistSuggestions(fence, [suggestion()]),
      ).toEqual({
        outcome: 'persisted',
        persisted: 1,
        pending: 1,
      });
      const rows = await sql<{
        status: string;
        sourceCardId: string | null;
        targetCardId: string | null;
        sourceSenseId: string | null;
        targetSenseId: string | null;
      }[]>`
        SELECT
          status,
          source_card_id AS "sourceCardId",
          target_card_id AS "targetCardId",
          source_sense_id AS "sourceSenseId",
          target_sense_id AS "targetSenseId"
        FROM kg_relation_suggestions
      `;
      expect([...rows]).toEqual([
        {
          status: 'pending',
          sourceCardId: null,
          targetCardId: null,
          sourceSenseId: source().senseId,
          targetSenseId: null,
        },
      ]);
      expect(
        await sourceRepository.persistSuggestions(fence, [suggestion()]),
      ).toEqual({
        outcome: 'persisted',
        persisted: 0,
        pending: 1,
      });
      expect(
        await sourceRepository.persistSuggestions(
          { ...fence, workerId: id(98) },
          [suggestion()],
        ),
      ).toEqual({ outcome: 'superseded' });

      await sql`
        UPDATE lexical_senses
        SET
          definition = 'bờ sông',
          normalized_definition = 'bờ sông',
          updated_at = now()
        WHERE id = ${source().senseId}
      `;
      expect(
        await sourceRepository.persistSuggestions(fence, [suggestion()]),
      ).toEqual({ outcome: 'stale' });
      expect(await sql`SELECT id FROM kg_relation_suggestions`).toHaveLength(1);

      await sql`
        UPDATE lexical_senses
        SET
          definition = 'ngân hàng',
          normalized_definition = 'ngân hàng',
          updated_at = now()
        WHERE id = ${source().senseId}
      `;
      await sql`
        UPDATE kg_runs
        SET cancel_requested_at = now()
        WHERE id = ${queued.run.id}
      `;
      expect(
        await sourceRepository.persistSuggestions(fence, [suggestion()]),
      ).toEqual({ outcome: 'superseded' });
    } finally {
      await sql.end();
      await dropDatabase(databaseName);
    }
  },
);

integrationTest(
  'resolves existing targets, suppresses accepted edges, and reattaches compatible pending suggestions',
  async () => {
    const { databaseName, sql } = await createDatabase();
    try {
      await seedSense(sql);
      const record = suggestion();
      const target = record.targetArtifact;
      await seedSense(sql, id(1), {
        senseId: id(20),
        lexemeId: id(21),
        sourceLanguageTag: target.sourceLanguageTag,
        definitionLanguageTag: target.definitionLanguageTag,
        lemma: target.lemma,
        normalizedLemma: target.normalizedLemma,
        partOfSpeech: target.partOfSpeech,
        definition: target.definition,
        normalizedDefinition: target.normalizedDefinition,
        ipa: target.ipa,
        examples: target.examples,
      });
      const runsRepository = createPostgresKgRunsRepository(sql);
      const sourceRepository = createPostgresSenseExpansionRepository(sql);
      const workerId = id(99);
      const first =
        await runsRepository.enqueueSenseExpansionRun(enqueueInput());
      await sql`
        UPDATE kg_runs
        SET
          status = 'processing',
          stage = 'persistence',
          locked_by = ${workerId},
          locked_until = now() + interval '1 minute'
        WHERE id = ${first.run.id}
      `;
      const focus = buildSenseExpansionArtifact(source());
      const firstFence = {
        runId: first.run.id,
        userId: id(1),
        focusSenseId: source().senseId,
        workerId,
        expectedFocus: focus,
      };
      expect(
        await sourceRepository.persistSuggestions(firstFence, [record]),
      ).toMatchObject({
        outcome: 'persisted',
        persisted: 1,
        pending: 1,
      });
      const resolved = await sql<{ targetSenseId: string | null }[]>`
        SELECT target_sense_id AS "targetSenseId"
        FROM kg_relation_suggestions
      `;
      expect(resolved[0]?.targetSenseId).toBe(id(20));

      await sql`
        UPDATE kg_runs
        SET
          status = 'completed',
          completed_at = now(),
          locked_by = NULL,
          locked_until = NULL
        WHERE id = ${first.run.id}
      `;
      const second = await runsRepository.enqueueSenseExpansionRun(
        enqueueInput(id(1), 'e'.repeat(64)),
      );
      await sql`
        UPDATE kg_runs
        SET
          status = 'processing',
          stage = 'persistence',
          locked_by = ${workerId},
          locked_until = now() + interval '1 minute'
        WHERE id = ${second.run.id}
      `;
      const secondFence = { ...firstFence, runId: second.run.id };
      expect(
        await sourceRepository.persistSuggestions(secondFence, [record]),
      ).toEqual({
        outcome: 'persisted',
        persisted: 0,
        pending: 1,
      });
      const reattached = await sql<{ runId: string }[]>`
        SELECT run_id AS "runId"
        FROM kg_relation_suggestions
      `;
      expect(reattached[0]?.runId).toBe(second.run.id);

      await sql`DELETE FROM kg_relation_suggestions`;
      await sql`
        INSERT INTO sense_relations (
          user_id,
          source_sense_id,
          target_sense_id,
          relation_type
        )
        VALUES (${id(1)}, ${source().senseId}, ${id(20)}, 'is_a')
      `;
      expect(
        await sourceRepository.persistSuggestions(secondFence, [record]),
      ).toEqual({
        outcome: 'persisted',
        persisted: 0,
        pending: 0,
      });
      expect(await sql`SELECT id FROM kg_relation_suggestions`).toHaveLength(0);
    } finally {
      await sql.end();
      await dropDatabase(databaseName);
    }
  },
);
