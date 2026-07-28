import { afterAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres, { type Sql } from 'postgres';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const MIGRATIONS_DIR = resolve(import.meta.dir, '../../src/db/migrations');
const createdDatabases = new Set<string>();

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
  if (!/^engram_kg_test_[a-f0-9]+$/.test(databaseName)) {
    throw new Error(`Refusing unsafe disposable database name: ${databaseName}`);
  }
}

async function createDisposableDatabase() {
  const databaseName = `engram_kg_test_${crypto.randomUUID().replaceAll('-', '')}`;
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
  return {
    databaseName,
    sql: postgres(databaseUrl.toString(), {
      max: 1,
      onnotice: () => {},
    }),
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

async function migrationFilesThrough(lastMigration: number) {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  return files.filter((file) => Number(file.slice(0, 4)) <= lastMigration);
}

async function applyMigrationFile(sql: Sql, fileName: string) {
  const source = await Bun.file(resolve(MIGRATIONS_DIR, fileName)).text();
  const statements = source
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);

  await sql.begin(async (transaction) => {
    for (const statement of statements) {
      await transaction.unsafe(statement);
    }
  });
}

async function applyMigrationsThrough(sql: Sql, lastMigration: number) {
  for (const fileName of await migrationFilesThrough(lastMigration)) {
    await applyMigrationFile(sql, fileName);
  }
}

async function seedOwnedCards(sql: Sql) {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash)
    VALUES (${`${crypto.randomUUID()}@example.com`}, 'hash')
    RETURNING id
  `;
  const [template] = await sql<{ id: string }[]>`
    INSERT INTO card_templates (user_id, name)
    VALUES (${user.id}, 'Vocabulary')
    RETURNING id
  `;
  const [ownedClass] = await sql<{ id: string }[]>`
    INSERT INTO classes (user_id, name)
    VALUES (${user.id}, 'Languages')
    RETURNING id
  `;
  const [folder] = await sql<{ id: string }[]>`
    INSERT INTO folders (class_id, name)
    VALUES (${ownedClass.id}, 'Vietnamese')
    RETURNING id
  `;
  const [deck] = await sql<{ id: string }[]>`
    INSERT INTO decks (user_id, folder_id, card_template_id, name)
    VALUES (${user.id}, ${folder.id}, ${template.id}, 'Family')
    RETURNING id
  `;
  const cards = await sql<{ id: string }[]>`
    INSERT INTO cards (deck_id)
    VALUES (${deck.id}), (${deck.id}), (${deck.id})
    RETURNING id
  `;

  return {
    userId: user.id,
    deckId: deck.id,
    cardIds: cards.map((card) => card.id).sort(),
  };
}

async function seedLexicalGraph(sql: Sql, userId: string) {
  const lexemeIds = [
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000202',
    '00000000-0000-0000-0000-000000000203',
  ];
  const senseIds = [
    '00000000-0000-0000-0000-000000000301',
    '00000000-0000-0000-0000-000000000302',
    '00000000-0000-0000-0000-000000000303',
  ];

  await sql`
    INSERT INTO lexemes (
      id,
      user_id,
      language_tag,
      lemma,
      normalized_lemma
    )
    VALUES
      (${lexemeIds[0]}, ${userId}, 'vi', 'mẹ', 'mẹ'),
      (${lexemeIds[1]}, ${userId}, 'vi', 'má', 'má'),
      (${lexemeIds[2]}, ${userId}, 'vi', 'cha', 'cha')
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
      (${senseIds[0]}, ${lexemeIds[0]}, 'noun', 'en', 'mother', 'mother'),
      (${senseIds[1]}, ${lexemeIds[1]}, 'noun', 'en', 'mom', 'mom'),
      (${senseIds[2]}, ${lexemeIds[2]}, 'noun', 'en', 'father', 'father')
  `;

  return { lexemeIds, senseIds };
}

type KgRunFixture = {
  userId: string;
  deckId?: string | null;
  focusSenseId?: string | null;
  runType?: 'deck_index' | 'sense_expansion' | string;
  status?: string;
  stage?: string;
  fingerprint?: string;
  attemptCount?: number;
  maxAttempts?: number;
};

async function insertKgRun(sql: Sql, fixture: KgRunFixture) {
  const [run] = await sql<{ id: string }[]>`
    INSERT INTO kg_runs (
      user_id,
      run_type,
      deck_id,
      focus_sense_id,
      status,
      stage,
      fingerprint,
      representation_version,
      embedding_model,
      prompt_version,
      taxonomy_version,
      source_language_tag,
      definition_language_tag,
      attempt_count,
      max_attempts
    )
    VALUES (
      ${fixture.userId},
      ${fixture.runType ?? 'deck_index'},
      ${fixture.deckId ?? null},
      ${fixture.focusSenseId ?? null},
      ${fixture.status ?? 'queued'},
      ${fixture.stage ?? 'snapshot'},
      ${fixture.fingerprint ?? crypto.randomUUID().replaceAll('-', '').repeat(2)},
      'v1',
      'gemini-embedding-2',
      'v1',
      'v1',
      'vi',
      'en',
      ${fixture.attemptCount ?? 0},
      ${fixture.maxAttempts ?? 5}
    )
    RETURNING id
  `;
  return run;
}

type SuggestionFixture = {
  id?: string;
  runId: string;
  userId: string;
  sourceCardId?: string | null;
  targetCardId?: string | null;
  sourceSenseId?: string | null;
  targetSenseId?: string | null;
  decision?: string;
  relationType?: string | null;
  direction?: string | null;
  confidenceBand?: string;
  retrievalSimilarity?: number | null;
  fingerprint?: string;
  status?: string;
  acceptedRelationId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  acceptedAt?: string | null;
  dismissedAt?: string | null;
  supersededAt?: string | null;
};

async function insertSuggestion(sql: Sql, fixture: SuggestionFixture) {
  const createdAt = fixture.createdAt ?? new Date().toISOString();
  const updatedAt = fixture.updatedAt ?? createdAt;
  const [suggestion] = await sql<{ id: string }[]>`
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
      retrieval_similarity,
      fingerprint,
      status,
      accepted_relation_id,
      created_at,
      updated_at,
      accepted_at,
      dismissed_at,
      superseded_at
    )
    VALUES (
      ${fixture.id ?? crypto.randomUUID()},
      ${fixture.runId},
      ${fixture.userId},
      ${fixture.sourceCardId ?? null},
      ${fixture.targetCardId ?? null},
      ${fixture.sourceSenseId ?? null},
      ${fixture.targetSenseId ?? null},
      '{"lemma":"mẹ"}'::jsonb,
      '{"lemma":"má"}'::jsonb,
      ${'a'.repeat(64)},
      ${'b'.repeat(64)},
      ${fixture.decision ?? 'relation'},
      ${fixture.relationType === undefined ? 'synonym' : fixture.relationType},
      ${fixture.direction === undefined ? 'symmetric' : fixture.direction},
      ${fixture.confidenceBand ?? 'high'},
      'Verified lexical relationship',
      ${fixture.retrievalSimilarity ?? 0.8},
      ${fixture.fingerprint ?? crypto.randomUUID().replaceAll('-', '').repeat(2)},
      ${fixture.status ?? 'pending'},
      ${fixture.acceptedRelationId ?? null},
      ${createdAt},
      ${updatedAt},
      ${fixture.acceptedAt ?? null},
      ${fixture.dismissedAt ?? null},
      ${fixture.supersededAt ?? null}
    )
    RETURNING id
  `;
  return suggestion;
}

async function expectPostgresError(
  code: string,
  constraintName: string,
  operation: () => Promise<unknown>,
) {
  try {
    await operation();
    throw new Error('Expected PostgreSQL to reject the row');
  } catch (error) {
    expect(error).toMatchObject({
      code,
      constraint_name: constraintName,
    });
  }
}

const expectConstraintViolation = (
  constraintName: string,
  operation: () => Promise<unknown>,
) => expectPostgresError('23514', constraintName, operation);

const expectUniqueViolation = (
  constraintName: string,
  operation: () => Promise<unknown>,
) => expectPostgresError('23505', constraintName, operation);

afterAll(async () => {
  for (const databaseName of [...createdDatabases]) {
    await dropDisposableDatabase(databaseName);
  }
});

describe('0025 language knowledge graph migration', () => {
  integrationTest(
    'applies the complete history to a blank database and enforces graph contracts',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 25);
        const fixture = await seedOwnedCards(sql);

        const [lexemeA] = await sql<{ id: string }[]>`
          INSERT INTO lexemes (
            user_id,
            language_tag,
            lemma,
            normalized_lemma
          )
          VALUES (${fixture.userId}, 'vi', 'mẹ', 'mẹ')
          RETURNING id
        `;
        const [lexemeB] = await sql<{ id: string }[]>`
          INSERT INTO lexemes (
            user_id,
            language_tag,
            lemma,
            normalized_lemma
          )
          VALUES (${fixture.userId}, 'vi', 'má', 'má')
          RETURNING id
        `;
        const [senseA] = await sql<{ id: string }[]>`
          INSERT INTO lexical_senses (
            id,
            lexeme_id,
            part_of_speech,
            definition_language_tag,
            definition,
            normalized_definition
          )
          VALUES (
            '00000000-0000-0000-0000-000000000101',
            ${lexemeA.id},
            'noun',
            'en',
            'mother',
            'mother'
          )
          RETURNING id
        `;
        const [senseB] = await sql<{ id: string }[]>`
          INSERT INTO lexical_senses (
            id,
            lexeme_id,
            part_of_speech,
            definition_language_tag,
            definition,
            normalized_definition
          )
          VALUES (
            '00000000-0000-0000-0000-000000000102',
            ${lexemeB.id},
            'noun',
            'en',
            'mom',
            'mom'
          )
          RETURNING id
        `;

        await sql`
          INSERT INTO sense_relations (
            user_id,
            source_sense_id,
            target_sense_id,
            relation_type,
            origin,
            confidence
          )
          VALUES (
            ${fixture.userId},
            ${senseA.id},
            ${senseB.id},
            'synonym',
            'manual',
            1
          )
        `;
        await sql`
          INSERT INTO sense_relations (
            user_id,
            source_sense_id,
            target_sense_id,
            relation_type,
            origin,
            confidence
          )
          VALUES (
            ${fixture.userId},
            ${senseB.id},
            ${senseA.id},
            'is_a',
            'ai',
            0.8
          )
        `;

        await expectConstraintViolation(
          'chk_sense_relations_symmetric_order',
          () => sql`
          INSERT INTO sense_relations (
            user_id,
            source_sense_id,
            target_sense_id,
            relation_type,
            origin,
            confidence
          )
          VALUES (
            ${fixture.userId},
            ${senseB.id},
            ${senseA.id},
            'antonym',
            'ai',
            0.9
          )
          `,
        );
        await expectConstraintViolation(
          'chk_sense_relations_type',
          () => sql`
          INSERT INTO sense_relations (
            user_id,
            source_sense_id,
            target_sense_id,
            relation_type,
            origin,
            confidence
          )
          VALUES (
            ${fixture.userId},
            ${senseA.id},
            ${senseB.id},
            'broader_than',
            'ai',
            0.9
          )
          `,
        );
        await expectConstraintViolation(
          'chk_sense_relations_confidence',
          () => sql`
          INSERT INTO sense_relations (
            user_id,
            source_sense_id,
            target_sense_id,
            relation_type,
            origin,
            confidence
          )
          VALUES (
            ${fixture.userId},
            ${senseA.id},
            ${senseB.id},
            'part_of',
            'ai',
            1.1
          )
          `,
        );

        await sql`
          INSERT INTO kg_runs (
            user_id,
            run_type,
            deck_id,
            fingerprint,
            representation_version,
            embedding_model,
            prompt_version,
            taxonomy_version,
            source_language_tag,
            definition_language_tag,
            snapshot
          )
          VALUES (
            ${fixture.userId},
            'deck_index',
            ${fixture.deckId},
            ${'a'.repeat(64)},
            'v1',
            'gemini-embedding-2',
            'v1',
            'v1',
            'vi',
            'en',
            '{}'::jsonb
          )
        `;
        await expectUniqueViolation(
          'uq_kg_runs_active_deck',
          () => sql`
            INSERT INTO kg_runs (
              user_id,
              run_type,
              deck_id,
              fingerprint,
              representation_version,
              embedding_model,
              prompt_version,
              taxonomy_version,
              source_language_tag,
              definition_language_tag,
              snapshot
            )
            VALUES (
              ${fixture.userId},
              'deck_index',
              ${fixture.deckId},
              ${'b'.repeat(64)},
              'v1',
              'gemini-embedding-2',
              'v1',
              'v1',
              'vi',
              'en',
              '{}'::jsonb
            )
          `,
        );

        await expectConstraintViolation(
          'chk_kg_runs_target',
          () => sql`
          INSERT INTO kg_runs (
            user_id,
            run_type,
            deck_id,
            focus_sense_id,
            fingerprint,
            representation_version,
            embedding_model,
            prompt_version,
            taxonomy_version,
            source_language_tag,
            definition_language_tag,
            snapshot
          )
          VALUES (
            ${fixture.userId},
            'sense_expansion',
            ${fixture.deckId},
            ${senseA.id},
            ${'c'.repeat(64)},
            'v1',
            'gemini-embedding-2',
            'v1',
            'v1',
            'vi',
            'en',
            '{}'::jsonb
          )
          `,
        );

        await expectConstraintViolation(
          'chk_kg_suggestions_endpoints',
          () => sql`
          INSERT INTO kg_relation_suggestions (
            run_id,
            user_id,
            source_artifact,
            target_artifact,
            source_content_hash,
            target_content_hash,
            decision,
            relation_type,
            direction,
            confidence_band,
            reason,
            fingerprint
          )
          SELECT
            id,
            ${fixture.userId},
            '{}'::jsonb,
            '{}'::jsonb,
            ${'d'.repeat(64)},
            ${'e'.repeat(64)},
            'relation',
            'synonym',
            'symmetric',
            'high',
            'No usable endpoints',
            ${'f'.repeat(64)}
          FROM kg_runs
          LIMIT 1
          `,
        );

        await expectConstraintViolation(
          'chk_card_embedding_metadata_dimensions',
          () => sql`
          INSERT INTO card_embedding_metadata (
            card_id,
            model,
            dimensions,
            representation_version,
            content_hash
          )
          VALUES (
            ${fixture.cardIds[0]},
            'gemini-embedding-2',
            3072,
            'v1',
            ${'0'.repeat(64)}
          )
          `,
        );

        const metadataColumns = await sql<{ column_name: string }[]>`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'card_embedding_metadata'
          ORDER BY ordinal_position
        `;
        expect(metadataColumns.map((column) => column.column_name)).toEqual([
          'card_id',
          'model',
          'dimensions',
          'representation_version',
          'content_hash',
          'embedded_at',
        ]);
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    90_000,
  );

  integrationTest(
    'enforces identities, worker lifecycle, suggestion verdicts, and FK actions',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 25);
        const fixture = await seedOwnedCards(sql);
        const { lexemeIds, senseIds } = await seedLexicalGraph(
          sql,
          fixture.userId,
        );

        await expectUniqueViolation(
          'uq_lexemes_user_language_lemma',
          () => sql`
            INSERT INTO lexemes (
              user_id,
              language_tag,
              lemma,
              normalized_lemma
            )
            VALUES (${fixture.userId}, 'vi', 'MẸ', 'mẹ')
          `,
        );
        await expectUniqueViolation(
          'uq_lexical_sense_identity',
          () => sql`
            INSERT INTO lexical_senses (
              lexeme_id,
              part_of_speech,
              definition_language_tag,
              definition,
              normalized_definition
            )
            VALUES (
              ${lexemeIds[0]},
              'noun',
              'en',
              'Mother',
              'mother'
            )
          `,
        );

        const [firstCardSense] = await sql<{ id: string }[]>`
          INSERT INTO card_senses (card_id, sense_id)
          VALUES (${fixture.cardIds[0]}, ${senseIds[0]})
          RETURNING id
        `;
        await expectUniqueViolation(
          'uq_card_senses_card_sense',
          () => sql`
            INSERT INTO card_senses (card_id, sense_id, source)
            VALUES (${fixture.cardIds[0]}, ${senseIds[0]}, 'manual')
          `,
        );
        await sql`
          INSERT INTO card_senses (card_id, sense_id, is_primary)
          VALUES (${fixture.cardIds[0]}, ${senseIds[1]}, true)
        `;
        await expectUniqueViolation(
          'uq_card_senses_primary_card',
          () => sql`
            UPDATE card_senses
            SET is_primary = true
            WHERE id = ${firstCardSense.id}
          `,
        );

        const activeDeckRun = await insertKgRun(sql, {
          userId: fixture.userId,
          deckId: fixture.deckId,
          fingerprint: '1'.repeat(64),
        });
        const completedDeckRun = await insertKgRun(sql, {
          userId: fixture.userId,
          deckId: fixture.deckId,
          status: 'completed',
          stage: 'persistence',
          fingerprint: '2'.repeat(64),
        });
        expect(completedDeckRun.id).toBeDefined();

        await expectConstraintViolation(
          'chk_kg_runs_status',
          () => insertKgRun(sql, {
            userId: fixture.userId,
            deckId: fixture.deckId,
            status: 'waiting',
          }),
        );
        await expectConstraintViolation(
          'chk_kg_runs_stage',
          () => insertKgRun(sql, {
            userId: fixture.userId,
            deckId: fixture.deckId,
            status: 'completed',
            stage: 'publishing',
          }),
        );
        await expectConstraintViolation(
          'chk_kg_runs_attempt_count',
          () => insertKgRun(sql, {
            userId: fixture.userId,
            deckId: fixture.deckId,
            status: 'completed',
            attemptCount: -1,
          }),
        );
        await expectConstraintViolation(
          'chk_kg_runs_max_attempts',
          () => insertKgRun(sql, {
            userId: fixture.userId,
            deckId: fixture.deckId,
            status: 'completed',
            maxAttempts: 0,
          }),
        );

        const activeFocusRun = await insertKgRun(sql, {
          userId: fixture.userId,
          runType: 'sense_expansion',
          focusSenseId: senseIds[0],
          fingerprint: '3'.repeat(64),
        });
        await expectUniqueViolation(
          'uq_kg_runs_active_focus_sense',
          () => insertKgRun(sql, {
            userId: fixture.userId,
            runType: 'sense_expansion',
            focusSenseId: senseIds[0],
            status: 'processing',
            fingerprint: '4'.repeat(64),
          }),
        );
        const completedFocusRun = await insertKgRun(sql, {
          userId: fixture.userId,
          runType: 'sense_expansion',
          focusSenseId: senseIds[0],
          status: 'completed',
          stage: 'persistence',
          fingerprint: '5'.repeat(64),
        });
        expect(completedFocusRun.id).toBeDefined();

        const suggestionFingerprint = '6'.repeat(64);
        const pendingSuggestion = await insertSuggestion(sql, {
          runId: activeDeckRun.id,
          userId: fixture.userId,
          sourceCardId: fixture.cardIds[0],
          targetCardId: fixture.cardIds[1],
          sourceSenseId: senseIds[0],
          targetSenseId: senseIds[1],
          fingerprint: suggestionFingerprint,
        });
        const expansionSuggestion = await insertSuggestion(sql, {
          runId: activeFocusRun.id,
          userId: fixture.userId,
          sourceSenseId: senseIds[0],
          fingerprint: '0'.repeat(64),
        });
        expect(expansionSuggestion.id).toBeDefined();
        await expectUniqueViolation(
          'uq_kg_suggestions_user_fingerprint',
          () => insertSuggestion(sql, {
            runId: completedDeckRun.id,
            userId: fixture.userId,
            sourceCardId: fixture.cardIds[1],
            targetCardId: fixture.cardIds[2],
            sourceSenseId: senseIds[1],
            targetSenseId: senseIds[2],
            fingerprint: suggestionFingerprint,
          }),
        );
        const otherFixture = await seedOwnedCards(sql);
        const otherUserRun = await insertKgRun(sql, {
          userId: otherFixture.userId,
          deckId: otherFixture.deckId,
        });
        const otherUserSuggestion = await insertSuggestion(sql, {
          runId: otherUserRun.id,
          userId: otherFixture.userId,
          sourceCardId: otherFixture.cardIds[0],
          targetCardId: otherFixture.cardIds[1],
          fingerprint: suggestionFingerprint,
        });
        expect(otherUserSuggestion.id).toBeDefined();
        await expectConstraintViolation(
          'chk_kg_suggestions_endpoints',
          () => insertSuggestion(sql, {
            runId: activeDeckRun.id,
            userId: fixture.userId,
            targetCardId: fixture.cardIds[1],
            fingerprint: '7'.repeat(64),
          }),
        );
        await expectConstraintViolation(
          'chk_kg_suggestions_relation_direction',
          () => insertSuggestion(sql, {
            runId: activeDeckRun.id,
            userId: fixture.userId,
            sourceCardId: fixture.cardIds[0],
            targetCardId: fixture.cardIds[1],
            relationType: 'synonym',
            direction: 'source_to_target',
            fingerprint: '8'.repeat(64),
          }),
        );
        await expectConstraintViolation(
          'chk_kg_suggestions_similarity',
          () => insertSuggestion(sql, {
            runId: activeDeckRun.id,
            userId: fixture.userId,
            sourceCardId: fixture.cardIds[0],
            targetCardId: fixture.cardIds[1],
            retrievalSimilarity: 1.1,
            fingerprint: '9'.repeat(64),
          }),
        );
        await expectConstraintViolation(
          'chk_kg_suggestions_status',
          () => insertSuggestion(sql, {
            runId: activeDeckRun.id,
            userId: fixture.userId,
            sourceCardId: fixture.cardIds[0],
            targetCardId: fixture.cardIds[1],
            status: 'waiting',
            fingerprint: 'a'.repeat(64),
          }),
        );

        const [acceptedRelation] = await sql<{ id: string }[]>`
          INSERT INTO sense_relations (
            user_id,
            source_sense_id,
            target_sense_id,
            relation_type,
            origin,
            confidence
          )
          VALUES (
            ${fixture.userId},
            ${senseIds[1]},
            ${senseIds[0]},
            'is_a',
            'manual',
            1
          )
          RETURNING id
        `;
        const acceptedSuggestion = await insertSuggestion(sql, {
          runId: activeDeckRun.id,
          userId: fixture.userId,
          sourceCardId: fixture.cardIds[1],
          targetCardId: fixture.cardIds[2],
          sourceSenseId: senseIds[1],
          targetSenseId: senseIds[2],
          relationType: 'is_a',
          direction: 'source_to_target',
          status: 'accepted',
          acceptedRelationId: acceptedRelation.id,
          fingerprint: 'b'.repeat(64),
        });
        await sql`DELETE FROM sense_relations WHERE id = ${acceptedRelation.id}`;
        const [relationCleared] = await sql<{
          accepted_relation_id: string | null;
        }[]>`
          SELECT accepted_relation_id
          FROM kg_relation_suggestions
          WHERE id = ${acceptedSuggestion.id}
        `;
        expect(relationCleared.accepted_relation_id).toBeNull();

        await sql`
          INSERT INTO card_embedding_metadata (
            card_id,
            model,
            dimensions,
            representation_version,
            content_hash
          )
          VALUES (
            ${fixture.cardIds[0]},
            'gemini-embedding-2',
            768,
            'v1',
            ${'c'.repeat(64)}
          )
        `;
        await sql`DELETE FROM cards WHERE id = ${fixture.cardIds[0]}`;
        const [cardDependents] = await sql<{
          mappings: number;
          metadata: number;
          suggestions: number;
        }[]>`
          SELECT
            (SELECT count(*)::integer FROM card_senses
              WHERE card_id = ${fixture.cardIds[0]}) AS mappings,
            (SELECT count(*)::integer FROM card_embedding_metadata
              WHERE card_id = ${fixture.cardIds[0]}) AS metadata,
            (SELECT count(*)::integer FROM kg_relation_suggestions
              WHERE id = ${pendingSuggestion.id}) AS suggestions
        `;
        expect(cardDependents).toMatchObject({
          mappings: 0,
          metadata: 0,
          suggestions: 0,
        });

        await sql`DELETE FROM kg_runs WHERE id = ${activeDeckRun.id}`;
        const [runSuggestions] = await sql<{ count: number }[]>`
          SELECT count(*)::integer AS count
          FROM kg_relation_suggestions
          WHERE run_id = ${activeDeckRun.id}
        `;
        expect(runSuggestions.count).toBe(0);

        await sql`DELETE FROM lexemes WHERE id = ${lexemeIds[0]}`;
        const [focusRuns] = await sql<{ count: number }[]>`
          SELECT count(*)::integer AS count
          FROM kg_runs
          WHERE id IN (${activeFocusRun.id}, ${completedFocusRun.id})
        `;
        expect(focusRuns.count).toBe(0);
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    90_000,
  );

  integrationTest(
    'creates complete supporting indexes for every new foreign key',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 25);
        const indexes = await sql<{
          indexname: string;
          indexdef: string;
        }[]>`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'idx_kg_runs_deck',
              'idx_kg_runs_focus_sense',
              'idx_kg_suggestions_accepted_relation'
            )
          ORDER BY indexname
        `;

        expect([...indexes]).toEqual([
          {
            indexname: 'idx_kg_runs_deck',
            indexdef:
              'CREATE INDEX idx_kg_runs_deck ON public.kg_runs USING btree (deck_id)',
          },
          {
            indexname: 'idx_kg_runs_focus_sense',
            indexdef:
              'CREATE INDEX idx_kg_runs_focus_sense ON public.kg_runs USING btree (focus_sense_id)',
          },
          {
            indexname: 'idx_kg_suggestions_accepted_relation',
            indexdef:
              'CREATE INDEX idx_kg_suggestions_accepted_relation ON public.kg_relation_suggestions USING btree (accepted_relation_id)',
          },
        ]);
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    90_000,
  );

  integrationTest(
    'reconciles old run-scoped suggestion duplicates before tightening identity',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 25);
        const fixture = await seedOwnedCards(sql);
        const { senseIds } = await seedLexicalGraph(sql, fixture.userId);
        const [acceptedRelation] = await sql<{ id: string }[]>`
          INSERT INTO sense_relations (
            user_id,
            source_sense_id,
            target_sense_id,
            relation_type,
            origin,
            confidence
          )
          VALUES (
            ${fixture.userId},
            ${senseIds[0]},
            ${senseIds[1]},
            'synonym',
            'manual',
            1
          )
          RETURNING id
        `;
        const [discardedSuggestionRelation] = await sql<{ id: string }[]>`
          INSERT INTO sense_relations (
            user_id,
            source_sense_id,
            target_sense_id,
            relation_type,
            origin,
            confidence
          )
          VALUES (
            ${fixture.userId},
            ${senseIds[0]},
            ${senseIds[1]},
            'is_a',
            'ai',
            0.8
          )
          RETURNING id
        `;

        const legacyRuns = [];
        for (let index = 0; index < 5; index++) {
          legacyRuns.push(await insertKgRun(sql, {
            userId: fixture.userId,
            deckId: fixture.deckId,
            status: 'completed',
            stage: 'persistence',
            fingerprint: String(index + 1).repeat(64),
          }));
        }

        await sql`
          ALTER TABLE kg_relation_suggestions
          DROP CONSTRAINT uq_kg_suggestions_user_fingerprint
        `;
        await sql`
          ALTER TABLE kg_relation_suggestions
          ADD CONSTRAINT uq_kg_suggestions_run_fingerprint
          UNIQUE (run_id, fingerprint)
        `;

        const createdEarlier = '2026-07-01T00:00:00.000Z';
        const createdLater = '2026-07-02T00:00:00.000Z';
        const lifecycleEarlier = '2026-07-03T00:00:00.000Z';
        const lifecycleLater = '2026-07-04T00:00:00.000Z';
        const updatedEarlier = '2026-07-05T00:00:00.000Z';
        const updatedLater = '2026-07-06T00:00:00.000Z';
        const lowerPriorityLatest = '2026-07-10T00:00:00.000Z';
        const acceptedFingerprint = 'a'.repeat(64);
        const dismissedFingerprint = 'b'.repeat(64);
        const rejectedFingerprint = 'c'.repeat(64);
        const pendingFingerprint = 'd'.repeat(64);
        const timestampFingerprint = 'e'.repeat(64);
        const suggestionBase = {
          userId: fixture.userId,
          sourceCardId: fixture.cardIds[0],
          targetCardId: fixture.cardIds[1],
          sourceSenseId: senseIds[0],
          targetSenseId: senseIds[1],
        };
        const legacySuggestions: SuggestionFixture[] = [
          {
            ...suggestionBase,
            id: '00000000-0000-0000-0000-000000000601',
            runId: legacyRuns[0].id,
            fingerprint: acceptedFingerprint,
            status: 'accepted',
            acceptedRelationId: acceptedRelation.id,
            createdAt: createdEarlier,
            updatedAt: updatedEarlier,
            acceptedAt: lifecycleEarlier,
          },
          {
            ...suggestionBase,
            id: '00000000-0000-0000-0000-000000000602',
            runId: legacyRuns[1].id,
            fingerprint: acceptedFingerprint,
            status: 'dismissed',
            createdAt: createdLater,
            updatedAt: lowerPriorityLatest,
            dismissedAt: lowerPriorityLatest,
          },
          {
            ...suggestionBase,
            id: '00000000-0000-0000-0000-000000000603',
            runId: legacyRuns[0].id,
            fingerprint: dismissedFingerprint,
            status: 'dismissed',
            createdAt: createdEarlier,
            updatedAt: updatedEarlier,
            dismissedAt: lifecycleEarlier,
          },
          {
            ...suggestionBase,
            id: '00000000-0000-0000-0000-000000000604',
            runId: legacyRuns[1].id,
            fingerprint: dismissedFingerprint,
            status: 'rejected',
            createdAt: createdLater,
            updatedAt: lowerPriorityLatest,
          },
          {
            ...suggestionBase,
            id: '00000000-0000-0000-0000-000000000605',
            runId: legacyRuns[0].id,
            fingerprint: rejectedFingerprint,
            status: 'rejected',
            createdAt: createdEarlier,
            updatedAt: updatedEarlier,
          },
          {
            ...suggestionBase,
            id: '00000000-0000-0000-0000-000000000606',
            runId: legacyRuns[1].id,
            fingerprint: rejectedFingerprint,
            status: 'pending',
            createdAt: createdLater,
            updatedAt: lowerPriorityLatest,
          },
          {
            ...suggestionBase,
            id: '00000000-0000-0000-0000-000000000607',
            runId: legacyRuns[0].id,
            fingerprint: pendingFingerprint,
            status: 'pending',
            createdAt: createdEarlier,
            updatedAt: updatedEarlier,
          },
          {
            ...suggestionBase,
            id: '00000000-0000-0000-0000-000000000608',
            runId: legacyRuns[1].id,
            fingerprint: pendingFingerprint,
            status: 'superseded',
            createdAt: createdLater,
            updatedAt: lowerPriorityLatest,
            supersededAt: lowerPriorityLatest,
          },
          {
            ...suggestionBase,
            id: '00000000-0000-0000-0000-000000000620',
            runId: legacyRuns[0].id,
            fingerprint: timestampFingerprint,
            status: 'accepted',
            acceptedRelationId: discardedSuggestionRelation.id,
            createdAt: createdLater,
            updatedAt: updatedLater,
            acceptedAt: lifecycleEarlier,
          },
          {
            ...suggestionBase,
            id: '00000000-0000-0000-0000-000000000621',
            runId: legacyRuns[1].id,
            fingerprint: timestampFingerprint,
            status: 'accepted',
            acceptedRelationId: acceptedRelation.id,
            createdAt: createdLater,
            updatedAt: updatedEarlier,
            acceptedAt: lifecycleLater,
          },
          {
            ...suggestionBase,
            id: '00000000-0000-0000-0000-000000000622',
            runId: legacyRuns[2].id,
            fingerprint: timestampFingerprint,
            status: 'accepted',
            acceptedRelationId: acceptedRelation.id,
            createdAt: createdEarlier,
            updatedAt: updatedLater,
            acceptedAt: lifecycleLater,
          },
          {
            ...suggestionBase,
            id: '00000000-0000-0000-0000-000000000623',
            runId: legacyRuns[3].id,
            fingerprint: timestampFingerprint,
            status: 'accepted',
            acceptedRelationId: acceptedRelation.id,
            createdAt: createdLater,
            updatedAt: updatedLater,
            acceptedAt: lifecycleLater,
          },
          {
            ...suggestionBase,
            id: '00000000-0000-0000-0000-000000000624',
            runId: legacyRuns[4].id,
            fingerprint: timestampFingerprint,
            status: 'accepted',
            acceptedRelationId: acceptedRelation.id,
            createdAt: createdLater,
            updatedAt: updatedLater,
            acceptedAt: lifecycleLater,
          },
        ];
        for (const suggestion of legacySuggestions) {
          await insertSuggestion(sql, suggestion);
        }

        await applyMigrationFile(sql, '0025_language_knowledge_graph.sql');

        const loadSurvivors = () => sql<{
          id: string;
          fingerprint: string;
          status: string;
          accepted_relation_id: string | null;
        }[]>`
          SELECT id, fingerprint, status, accepted_relation_id
          FROM kg_relation_suggestions
          WHERE user_id = ${fixture.userId}
          ORDER BY fingerprint
        `;
        const expectedSurvivors = [
          {
            id: '00000000-0000-0000-0000-000000000601',
            fingerprint: acceptedFingerprint,
            status: 'accepted',
            accepted_relation_id: acceptedRelation.id,
          },
          {
            id: '00000000-0000-0000-0000-000000000603',
            fingerprint: dismissedFingerprint,
            status: 'dismissed',
            accepted_relation_id: null,
          },
          {
            id: '00000000-0000-0000-0000-000000000605',
            fingerprint: rejectedFingerprint,
            status: 'rejected',
            accepted_relation_id: null,
          },
          {
            id: '00000000-0000-0000-0000-000000000607',
            fingerprint: pendingFingerprint,
            status: 'pending',
            accepted_relation_id: null,
          },
          {
            id: '00000000-0000-0000-0000-000000000623',
            fingerprint: timestampFingerprint,
            status: 'accepted',
            accepted_relation_id: acceptedRelation.id,
          },
        ];
        expect([...(await loadSurvivors())]).toEqual(expectedSurvivors);

        const identityConstraints = await sql<{
          conname: string;
          definition: string;
        }[]>`
          SELECT conname, pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
          WHERE conrelid = 'kg_relation_suggestions'::regclass
            AND conname IN (
              'uq_kg_suggestions_run_fingerprint',
              'uq_kg_suggestions_user_fingerprint'
            )
          ORDER BY conname
        `;
        expect([...identityConstraints]).toEqual([
          {
            conname: 'uq_kg_suggestions_user_fingerprint',
            definition: 'UNIQUE (user_id, fingerprint)',
          },
        ]);
        const acceptedRelationRows = await sql<{ id: string }[]>`
          SELECT id
          FROM sense_relations
          WHERE id IN (
            ${acceptedRelation.id},
            ${discardedSuggestionRelation.id}
          )
          ORDER BY id
        `;
        expect(acceptedRelationRows.map((row) => row.id).sort()).toEqual(
          [acceptedRelation.id, discardedSuggestionRelation.id].sort(),
        );

        await applyMigrationFile(sql, '0025_language_knowledge_graph.sql');
        expect([...(await loadSurvivors())]).toEqual(expectedSurvivors);
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    90_000,
  );

  integrationTest(
    'canonicalizes reversed legacy pairs before constraints and reruns safely',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 24);
        const fixture = await seedOwnedCards(sql);
        const [lowerCardId, middleCardId, higherCardId] = fixture.cardIds;

        await sql`
          INSERT INTO card_links (source_card_id, target_card_id, link_type)
          VALUES
            (${lowerCardId}, ${middleCardId}, 'prerequisite'),
            (${middleCardId}, ${lowerCardId}, 'related'),
            (${lowerCardId}, ${higherCardId}, 'related'),
            (${higherCardId}, ${lowerCardId}, 'related')
        `;
        await sql`
          INSERT INTO dismissed_suggestions (
            user_id,
            source_card_id,
            target_card_id
          )
          VALUES
            (${fixture.userId}, ${lowerCardId}, ${higherCardId}),
            (${fixture.userId}, ${higherCardId}, ${lowerCardId}),
            (${fixture.userId}, ${middleCardId}, ${middleCardId})
        `;

        await applyMigrationFile(sql, '0025_language_knowledge_graph.sql');

        const cardLinks = await sql<{
          source_card_id: string;
          target_card_id: string;
          link_type: string;
        }[]>`
          SELECT source_card_id, target_card_id, link_type
          FROM card_links
          ORDER BY source_card_id, target_card_id, link_type
        `;
        expect([...cardLinks]).toEqual([
          {
            source_card_id: lowerCardId,
            target_card_id: middleCardId,
            link_type: 'prerequisite',
          },
          {
            source_card_id: lowerCardId,
            target_card_id: middleCardId,
            link_type: 'related',
          },
          {
            source_card_id: lowerCardId,
            target_card_id: higherCardId,
            link_type: 'related',
          },
        ]);

        const dismissals = await sql<{
          source_card_id: string;
          target_card_id: string;
        }[]>`
          SELECT source_card_id, target_card_id
          FROM dismissed_suggestions
          WHERE user_id = ${fixture.userId}
        `;
        expect([...dismissals]).toEqual([
          {
            source_card_id: lowerCardId,
            target_card_id: higherCardId,
          },
        ]);

        await expectConstraintViolation(
          'chk_card_links_related_canonical_order',
          () => sql`
          INSERT INTO card_links (source_card_id, target_card_id, link_type)
          VALUES (${higherCardId}, ${lowerCardId}, 'related')
          `,
        );
        await expectConstraintViolation(
          'chk_dismissed_suggestions_canonical_order',
          () => sql`
          INSERT INTO dismissed_suggestions (
            user_id,
            source_card_id,
            target_card_id
          )
          VALUES (${fixture.userId}, ${higherCardId}, ${lowerCardId})
          `,
        );

        await applyMigrationFile(sql, '0025_language_knowledge_graph.sql');
        const cardLinkCount = await sql<{ count: number }[]>`
            SELECT count(*)::integer AS count
            FROM card_links
            WHERE link_type = 'related'
          `;
        expect([...cardLinkCount]).toEqual([{ count: 2 }]);
        const directedLinkCount = await sql<{ count: number }[]>`
          SELECT count(*)::integer AS count
          FROM card_links
          WHERE link_type = 'prerequisite'
        `;
        expect([...directedLinkCount]).toEqual([{ count: 1 }]);
        const dismissalCount = await sql<{ count: number }[]>`
            SELECT count(*)::integer AS count
            FROM dismissed_suggestions
            WHERE user_id = ${fixture.userId}
          `;
        expect([...dismissalCount]).toEqual([{ count: 1 }]);
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    90_000,
  );
});
