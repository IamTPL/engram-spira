import { afterAll, expect, test } from 'bun:test';
import postgres from 'postgres';

import {
  createPostgresSuggestionReviewRepository,
} from '../../../src/modules/knowledge-graph/kg-suggestion-review.repository';
import { buildVocabularyArtifact } from '../../../src/modules/knowledge-graph/vocabulary-artifact';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const databases = new Set<string>();
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

function assertDatabaseName(databaseName: string) {
  if (!/^engram_kg_review_test_[a-f0-9]+$/.test(databaseName)) {
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
    `engram_kg_review_test_${crypto.randomUUID().replaceAll('-', '')}`;
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
    CREATE TABLE card_templates (
      id uuid PRIMARY KEY,
      user_id uuid
    )
  `;
  await sql`
    CREATE TABLE template_fields (
      id uuid PRIMARY KEY,
      template_id uuid NOT NULL,
      name text NOT NULL
    )
  `;
  await sql`
    CREATE TABLE decks (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      card_template_id uuid NOT NULL
    )
  `;
  await sql`
    CREATE TABLE cards (
      id uuid PRIMARY KEY,
      deck_id uuid NOT NULL
    )
  `;
  await sql`
    CREATE TABLE card_field_values (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      card_id uuid NOT NULL,
      template_field_id uuid NOT NULL,
      value jsonb NOT NULL,
      UNIQUE (card_id, template_field_id)
    )
  `;
  await sql`
    CREATE TABLE lexemes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      language_tag text NOT NULL,
      lemma text NOT NULL,
      normalized_lemma text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, language_tag, normalized_lemma)
    )
  `;
  await sql`
    CREATE TABLE lexical_senses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      lexeme_id uuid NOT NULL,
      part_of_speech text NOT NULL,
      definition_language_tag text NOT NULL,
      definition text NOT NULL,
      normalized_definition text NOT NULL,
      ipa text,
      examples jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (
        lexeme_id,
        part_of_speech,
        definition_language_tag,
        normalized_definition
      )
    )
  `;
  await sql`
    CREATE TABLE card_senses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      card_id uuid NOT NULL,
      sense_id uuid NOT NULL,
      source text NOT NULL,
      is_primary boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (card_id, sense_id)
    )
  `;
  await sql`
    CREATE TABLE sense_relations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      source_sense_id uuid NOT NULL,
      target_sense_id uuid NOT NULL,
      relation_type text NOT NULL,
      origin text NOT NULL,
      confidence real NOT NULL,
      evidence jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (
        user_id,
        source_sense_id,
        target_sense_id,
        relation_type
      )
    )
  `;
  await sql`
    CREATE TABLE card_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_card_id uuid NOT NULL,
      target_card_id uuid NOT NULL,
      link_type text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source_card_id, target_card_id, link_type)
    )
  `;
  await sql`
    CREATE TABLE kg_runs (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL
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
      accepted_relation_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      accepted_at timestamptz,
      dismissed_at timestamptz,
      superseded_at timestamptz,
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
  otherRunId: string;
  templateId: string;
  wordFieldId: string;
  definitionFieldId: string;
  sourceCardId: string;
  targetCardId: string;
  sourceSenseId: string;
  targetSenseId: string;
};

async function seed(sql: ReturnType<typeof postgres>): Promise<Fixture> {
  const fixture: Fixture = {
    userId: id(1),
    otherUserId: id(2),
    runId: id(3),
    otherRunId: id(4),
    templateId: id(5),
    wordFieldId: id(6),
    definitionFieldId: id(7),
    sourceCardId: id(20),
    targetCardId: id(10),
    sourceSenseId: id(40),
    targetSenseId: id(30),
  };
  const deckId = id(8);
  const otherTemplateId = id(9);
  const otherDeckId = id(11);
  const sourceLexemeId = id(50);
  const targetLexemeId = id(51);
  await sql`
    INSERT INTO users (id)
    VALUES (${fixture.userId}), (${fixture.otherUserId})
  `;
  await sql`
    INSERT INTO card_templates (id, user_id)
    VALUES
      (${fixture.templateId}, ${fixture.userId}),
      (${otherTemplateId}, ${fixture.otherUserId})
  `;
  await sql`
    INSERT INTO template_fields (id, template_id, name)
    VALUES
      (${fixture.wordFieldId}, ${fixture.templateId}, 'word'),
      (${fixture.definitionFieldId}, ${fixture.templateId}, 'definition')
  `;
  await sql`
    INSERT INTO decks (id, user_id, card_template_id)
    VALUES
      (${deckId}, ${fixture.userId}, ${fixture.templateId}),
      (${otherDeckId}, ${fixture.otherUserId}, ${otherTemplateId})
  `;
  await sql`
    INSERT INTO cards (id, deck_id)
    VALUES
      (${fixture.sourceCardId}, ${deckId}),
      (${fixture.targetCardId}, ${deckId})
  `;
  await sql`
    INSERT INTO card_field_values (card_id, template_field_id, value)
    VALUES
      (${fixture.sourceCardId}, ${fixture.wordFieldId}, ${sql.json('parent')}),
      (
        ${fixture.sourceCardId},
        ${fixture.definitionFieldId},
        ${sql.json('cha hoặc mẹ')}
      ),
      (${fixture.targetCardId}, ${fixture.wordFieldId}, ${sql.json('child')}),
      (
        ${fixture.targetCardId},
        ${fixture.definitionFieldId},
        ${sql.json('con')}
      )
  `;
  await sql`
    INSERT INTO lexemes (
      id,
      user_id,
      language_tag,
      lemma,
      normalized_lemma
    )
    VALUES
      (${sourceLexemeId}, ${fixture.userId}, 'en', 'parent', 'parent'),
      (${targetLexemeId}, ${fixture.userId}, 'en', 'child', 'child')
  `;
  await sql`
    INSERT INTO lexical_senses (
      id,
      lexeme_id,
      part_of_speech,
      definition_language_tag,
      definition,
      normalized_definition
    )
    VALUES
      (
        ${fixture.sourceSenseId},
        ${sourceLexemeId},
        'unknown',
        'vi',
        'cha hoặc mẹ',
        'cha hoặc mẹ'
      ),
      (
        ${fixture.targetSenseId},
        ${targetLexemeId},
        'unknown',
        'vi',
        'con',
        'con'
      )
  `;
  await sql`
    INSERT INTO card_senses (card_id, sense_id, source, is_primary)
    VALUES
      (${fixture.sourceCardId}, ${fixture.sourceSenseId}, 'deterministic', true),
      (${fixture.targetCardId}, ${fixture.targetSenseId}, 'deterministic', true)
  `;
  await sql`
    INSERT INTO kg_runs (id, user_id)
    VALUES
      (${fixture.runId}, ${fixture.userId}),
      (${fixture.otherRunId}, ${fixture.otherUserId})
  `;
  return fixture;
}

function cardArtifact(
  fixture: Fixture,
  cardId: string,
  word: string,
  definition: string,
) {
  return buildVocabularyArtifact({
    cardId,
    sourceLanguageTag: 'en',
    definitionLanguageTag: 'vi',
    templateFields: [
      { id: fixture.wordFieldId, name: 'word' },
      { id: fixture.definitionFieldId, name: 'definition' },
    ],
    fieldValues: [
      { templateFieldId: fixture.wordFieldId, value: word },
      {
        templateFieldId: fixture.definitionFieldId,
        value: definition,
      },
    ],
  });
}

async function insertSuggestion(
  sql: ReturnType<typeof postgres>,
  fixture: Fixture,
  input: {
    id: string;
    sourceArtifact?: ReturnType<typeof cardArtifact>;
    targetArtifact?: ReturnType<typeof cardArtifact>;
    sourceCardId?: string | null;
    targetCardId?: string | null;
    sourceSenseId?: string | null;
    targetSenseId?: string | null;
    relationType?: 'synonym' | 'is_a';
    direction?: 'symmetric' | 'source_to_target' | 'target_to_source';
    confidenceBand?: 'high' | 'medium' | 'low';
  },
) {
  const sourceArtifact =
    input.sourceArtifact ??
    cardArtifact(fixture, fixture.sourceCardId, 'parent', 'cha hoặc mẹ');
  const targetArtifact =
    input.targetArtifact ??
    cardArtifact(fixture, fixture.targetCardId, 'child', 'con');
  const sourceCardId =
    input.sourceCardId === undefined
      ? fixture.sourceCardId
      : input.sourceCardId;
  const targetCardId =
    input.targetCardId === undefined
      ? fixture.targetCardId
      : input.targetCardId;
  const sourceSenseId =
    input.sourceSenseId === undefined
      ? fixture.sourceSenseId
      : input.sourceSenseId;
  const targetSenseId =
    input.targetSenseId === undefined
      ? fixture.targetSenseId
      : input.targetSenseId;
  const relationType = input.relationType ?? 'synonym';
  const direction = input.direction ?? 'symmetric';
  const confidenceBand = input.confidenceBand ?? 'high';
  await sql`
    INSERT INTO kg_relation_suggestions (
      id,
      run_id,
      user_id,
      source_card_id,
      target_card_id,
      source_sense_id,
      target_sense_id,
      source_artifact,
      target_artifact,
      source_content_hash,
      target_content_hash,
      decision,
      relation_type,
      direction,
      confidence_band,
      reason,
      evidence,
      retrieval_similarity,
      mutual_knn,
      fingerprint,
      status
    )
    VALUES (
      ${input.id},
      ${fixture.runId},
      ${fixture.userId},
      ${sourceCardId},
      ${targetCardId},
      ${sourceSenseId},
      ${targetSenseId},
      ${sql.json(
        sourceArtifact as unknown as Parameters<typeof sql.json>[0],
      )},
      ${sql.json(
        targetArtifact as unknown as Parameters<typeof sql.json>[0],
      )},
      ${sourceArtifact.contentHash},
      ${targetArtifact.contentHash},
      'relation',
      ${relationType},
      ${direction},
      ${confidenceBand},
      'Human-readable lexical evidence.',
      ${sql.json({ source: sourceArtifact.lemma, target: targetArtifact.lemma })},
      0.91,
      true,
      ${input.id.replaceAll('-', '').padEnd(64, '0').slice(0, 64)},
      'pending'
    )
  `;
}

integrationTest(
  'serializes concurrent accepts and creates one canonical relation and legacy link',
  async () => {
    const { databaseName, sql } = await createDatabase();
    try {
      const fixture = await seed(sql);
      const suggestionId = id(100);
      await insertSuggestion(sql, fixture, { id: suggestionId });
      await sql`DELETE FROM card_senses`;
      const repository = createPostgresSuggestionReviewRepository(sql);

      const [first, second] = await Promise.all([
        repository.accept(fixture.userId, suggestionId),
        repository.accept(fixture.userId, suggestionId),
      ]);
      expect(first.outcome).toBe('accepted');
      expect(second).toEqual(first);

      const relations = await sql<{
        id: string;
        sourceSenseId: string;
        targetSenseId: string;
        relationType: string;
      }[]>`
        SELECT
          id,
          source_sense_id AS "sourceSenseId",
          target_sense_id AS "targetSenseId",
          relation_type AS "relationType"
        FROM sense_relations
      `;
      expect(relations).toHaveLength(1);
      expect(relations[0]).toMatchObject({
        sourceSenseId: fixture.targetSenseId,
        targetSenseId: fixture.sourceSenseId,
        relationType: 'synonym',
      });
      const links = await sql<{
        sourceCardId: string;
        targetCardId: string;
      }[]>`
        SELECT
          source_card_id AS "sourceCardId",
          target_card_id AS "targetCardId"
        FROM card_links
      `;
      expect([...links]).toEqual([
        {
          sourceCardId: fixture.targetCardId,
          targetCardId: fixture.sourceCardId,
        },
      ]);
      const mappings = await sql<{ source: string; count: number }[]>`
        SELECT source, count(*)::int AS count
        FROM card_senses
        GROUP BY source
      `;
      expect([...mappings]).toEqual([{ source: 'ai', count: 2 }]);
      const accepted = await sql<{
        status: string;
        relationId: string;
      }[]>`
        SELECT
          status,
          accepted_relation_id AS "relationId"
        FROM kg_relation_suggestions
        WHERE id = ${suggestionId}
      `;
      expect(accepted[0]).toEqual({
        status: 'accepted',
        relationId: relations[0]!.id,
      });
    } finally {
      await sql.end();
      await dropDatabase(databaseName);
    }
  },
);

integrationTest(
  'persists superseded before returning and never publishes a stale relation',
  async () => {
    const { databaseName, sql } = await createDatabase();
    try {
      const fixture = await seed(sql);
      const suggestionId = id(101);
      await insertSuggestion(sql, fixture, { id: suggestionId });
      await sql`
        DELETE FROM card_field_values
        WHERE card_id = ${fixture.sourceCardId}
          AND template_field_id = ${fixture.definitionFieldId}
      `;
      const repository = createPostgresSuggestionReviewRepository(sql);

      expect(
        await repository.accept(fixture.userId, suggestionId),
      ).toEqual({ outcome: 'superseded' });
      expect(
        await sql`
          SELECT id
          FROM sense_relations
        `,
      ).toHaveLength(0);
      const rows = await sql<{
        status: string;
        superseded: boolean;
      }[]>`
        SELECT
          status,
          superseded_at IS NOT NULL AS superseded
        FROM kg_relation_suggestions
        WHERE id = ${suggestionId}
      `;
      expect(rows[0]).toEqual({ status: 'superseded', superseded: true });
    } finally {
      await sql.end();
      await dropDatabase(databaseName);
    }
  },
);

integrationTest(
  'upserts an artifact-only expansion sense and respects directed orientation',
  async () => {
    const { databaseName, sql } = await createDatabase();
    try {
      const fixture = await seed(sql);
      const suggestionId = id(102);
      const discovered = cardArtifact(
        fixture,
        id(999),
        'ancestor',
        'tổ tiên',
      );
      await insertSuggestion(sql, fixture, {
        id: suggestionId,
        targetCardId: null,
        targetSenseId: null,
        targetArtifact: discovered,
        relationType: 'is_a',
        direction: 'target_to_source',
        confidenceBand: 'medium',
      });
      const repository = createPostgresSuggestionReviewRepository(sql);

      const accepted = await repository.accept(fixture.userId, suggestionId);
      expect(accepted.outcome).toBe('accepted');
      const relations = await sql<{
        sourceLemma: string;
        targetLemma: string;
        relationType: string;
        confidence: number;
      }[]>`
        SELECT
          source_lexeme.lemma AS "sourceLemma",
          target_lexeme.lemma AS "targetLemma",
          relation.relation_type AS "relationType",
          relation.confidence::real AS confidence
        FROM sense_relations relation
        JOIN lexical_senses source_sense
          ON source_sense.id = relation.source_sense_id
        JOIN lexemes source_lexeme
          ON source_lexeme.id = source_sense.lexeme_id
        JOIN lexical_senses target_sense
          ON target_sense.id = relation.target_sense_id
        JOIN lexemes target_lexeme
          ON target_lexeme.id = target_sense.lexeme_id
      `;
      expect([...relations]).toEqual([
        {
          sourceLemma: 'ancestor',
          targetLemma: 'parent',
          relationType: 'is_a',
          confidence: 0.6,
        },
      ]);
      expect(await sql`SELECT id FROM card_links`).toHaveLength(0);
    } finally {
      await sql.end();
      await dropDatabase(databaseName);
    }
  },
);

integrationTest(
  'scopes list and mutations by user and makes dismiss repeat-safe',
  async () => {
    const { databaseName, sql } = await createDatabase();
    try {
      const fixture = await seed(sql);
      const suggestionId = id(103);
      await insertSuggestion(sql, fixture, { id: suggestionId });
      const repository = createPostgresSuggestionReviewRepository(sql);

      await expect(
        repository.list(
          fixture.otherUserId,
          fixture.runId,
          'pending',
          null,
          21,
        ),
      ).rejects.toThrow('Knowledge graph run not found');
      await expect(
        repository.accept(fixture.otherUserId, suggestionId),
      ).rejects.toThrow('Knowledge graph suggestion not found');

      const visible = await repository.list(
        fixture.userId,
        fixture.runId,
        'pending',
        null,
        21,
      );
      expect(visible.map((suggestion) => suggestion.id)).toEqual([
        suggestionId,
      ]);

      const first = await repository.dismiss(fixture.userId, suggestionId);
      const second = await repository.dismiss(fixture.userId, suggestionId);
      expect(second).toEqual(first);
      expect(first.status).toBe('dismissed');
      await expect(
        repository.accept(fixture.userId, suggestionId),
      ).rejects.toThrow('Suggestion is no longer pending');

      const foreignCardId = id(200);
      const foreignSuggestionId = id(104);
      await sql`
        INSERT INTO cards (id, deck_id)
        VALUES (${foreignCardId}, ${id(11)})
      `;
      await insertSuggestion(sql, fixture, {
        id: foreignSuggestionId,
        targetCardId: foreignCardId,
        targetArtifact: cardArtifact(
          fixture,
          foreignCardId,
          'child',
          'con',
        ),
      });
      await expect(
        repository.accept(fixture.userId, foreignSuggestionId),
      ).rejects.toThrow('Card not found');
    } finally {
      await sql.end();
      await dropDatabase(databaseName);
    }
  },
);
