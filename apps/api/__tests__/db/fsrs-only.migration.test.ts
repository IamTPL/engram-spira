import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
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
  if (!/^engram_fsrs_test_[a-f0-9]+$/.test(databaseName)) {
    throw new Error(`Refusing unsafe disposable database name: ${databaseName}`);
  }
}

async function createDisposableDatabase() {
  const databaseName =
    `engram_fsrs_test_${crypto.randomUUID().replaceAll('-', '')}`;
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
    databaseUrl: databaseUrl.toString(),
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

async function seedUserAndCard(sql: Sql) {
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
  const [card] = await sql<{ id: string }[]>`
    INSERT INTO cards (deck_id)
    VALUES (${deck.id})
    RETURNING id
  `;
  return { userId: user.id, deckId: deck.id, cardId: card.id };
}

async function seedDeckForUser(sql: Sql, userId: string) {
  const [template] = await sql<{ id: string }[]>`
    INSERT INTO card_templates (user_id, name)
    VALUES (${userId}, 'Additional vocabulary')
    RETURNING id
  `;
  const [ownedClass] = await sql<{ id: string }[]>`
    INSERT INTO classes (user_id, name)
    VALUES (${userId}, 'Additional languages')
    RETURNING id
  `;
  const [folder] = await sql<{ id: string }[]>`
    INSERT INTO folders (class_id, name)
    VALUES (${ownedClass.id}, 'Additional folder')
    RETURNING id
  `;
  const [deck] = await sql<{ id: string }[]>`
    INSERT INTO decks (user_id, folder_id, card_template_id, name)
    VALUES (${userId}, ${folder.id}, ${template.id}, 'Additional deck')
    RETURNING id
  `;
  return deck.id;
}

async function insertRevision(sql: Sql, userId: string, revision = 1) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO fsrs_parameter_revisions (
      user_id,
      revision,
      engine_version,
      algorithm_version,
      policy_version,
      parameters,
      params_hash,
      source
    )
    VALUES (
      ${userId},
      ${revision},
      'ts-fsrs-5',
      'fsrs-6',
      'policy-1',
      '{"desiredRetention":0.9}'::jsonb,
      ${revision.toString().padStart(64, 'a')},
      'default'
    )
    RETURNING id
  `;
  return row.id;
}

async function insertCanonicalState(
  sql: Sql,
  userId: string,
  cardId: string,
  parameterRevisionId: string,
) {
  await sql`
    INSERT INTO fsrs_card_states (
      user_id, card_id, next_review_at, last_reviewed_at,
      stability, difficulty, state, elapsed_days, scheduled_days,
      learning_steps, reps, lapses, parameter_revision_id, state_version
    )
    VALUES (
      ${userId}, ${cardId}, now(), now(), 1.5, 5, 'review',
      0, 1, 0, 1, 0, ${parameterRevisionId}, 1
    )
  `;
}

async function insertCanonicalEvent(
  sql: Sql,
  userId: string,
  cardId: string,
  parameterRevisionId: string,
) {
  await sql`
    INSERT INTO fsrs_review_events (
      request_id, user_id, card_id, sequence, rating, reviewed_at,
      parameter_revision_id, origin, before_state, before_due_at,
      before_stability, before_difficulty, before_scheduled_days,
      before_learning_steps, elapsed_days, after_state, after_due_at,
      after_stability, after_difficulty, after_scheduled_days,
      after_learning_steps, after_reps, after_lapses, after_state_version
    )
    VALUES (
      ${crypto.randomUUID()}, ${userId}, ${cardId}, 1, 'good', now(),
      ${parameterRevisionId}, 'live', NULL, NULL, NULL, NULL, NULL, NULL,
      0, 'learning', now(), 1.5, 5, 0, 1, 1, 0, 1
    )
  `;
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

async function expectPostgresCode(
  code: string,
  operation: () => Promise<unknown>,
) {
  try {
    await operation();
    throw new Error('Expected PostgreSQL to reject the row');
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

const expectCheckViolation = (
  constraintName: string,
  operation: () => Promise<unknown>,
) => expectPostgresError('23514', constraintName, operation);

const expectUniqueViolation = (
  constraintName: string,
  operation: () => Promise<unknown>,
) => expectPostgresError('23505', constraintName, operation);

const expectForeignKeyViolation = (
  constraintName: string,
  operation: () => Promise<unknown>,
) => expectPostgresError('23503', constraintName, operation);

async function expectNotNullViolation(
  columnName: string,
  operation: () => Promise<unknown>,
) {
  try {
    await operation();
    throw new Error('Expected PostgreSQL to reject the row');
  } catch (error) {
    expect(error).toMatchObject({
      code: '23502',
      column_name: columnName,
    });
  }
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

afterAll(async () => {
  for (const databaseName of [...createdDatabases]) {
    await dropDisposableDatabase(databaseName);
  }
});

describe('0027 FSRS-only hardening migration', () => {
  test('keeps committed 0026 immutable and journals hardening separately', async () => {
    const expansion = await Bun.file(
      resolve(MIGRATIONS_DIR, '0026_fsrs_only_expand.sql'),
    ).text();
    const hardening = await Bun.file(
      resolve(MIGRATIONS_DIR, '0027_fsrs_only_hardening.sql'),
    ).text();
    const journal = await Bun.file(
      resolve(MIGRATIONS_DIR, 'meta/_journal.json'),
    ).json() as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };

    for (const tableName of [
      'fsrs_parameter_revisions',
      'fsrs_card_states',
      'fsrs_review_events',
      'fsrs_migration_runs',
    ]) {
      expect(expansion).toContain(`CREATE TABLE IF NOT EXISTS "${tableName}"`);
    }
    expect(
      createHash('sha256').update(expansion).digest('hex'),
    ).toBe('fce5cfa03d07d92f373a0e273ee49613d71d4948cf940f8235bdc58ff397f6c8');
    expect(expansion).not.toMatch(
      /(?:ALTER|DROP)\s+(?:TABLE\s+)?(?:"?(?:users|study_progress|review_logs|fsrs_user_params)"?)/i,
    );
    expect(expansion).not.toContain('CREATE TYPE');
    expect(expansion).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "uq_fsrs_parameter_revisions_active_user"',
    );
    expect(expansion).toContain(
      'INCLUDE ("card_id", "state")',
    );
    expect(hardening).toContain(
      'ALTER COLUMN "last_reviewed_at" SET NOT NULL',
    );
    expect(hardening).toContain(
      '"fk_fsrs_card_states_parameter_revision_user"',
    );
    expect(hardening).toContain(
      '"fk_fsrs_review_events_parameter_revision_user"',
    );
    expect(hardening).toContain(
      '"trg_fsrs_card_states_card_owner"',
    );
    expect(hardening).toContain(
      '"trg_fsrs_review_events_card_owner"',
    );
    expect(hardening).toContain(
      '"learning_cycle" integer DEFAULT 1 NOT NULL',
    );
    expect(hardening).toContain(
      '"uq_fsrs_review_events_user_card_cycle_sequence"',
    );
    expect(hardening).toContain(
      'DROP INDEX IF EXISTS "idx_fsrs_card_states_parameter_revision"',
    );
    expect(hardening).toContain(
      'DROP INDEX IF EXISTS "idx_fsrs_review_events_parameter_revision"',
    );

    const previous = journal.entries.find((entry) => entry.idx === 26);
    const current = journal.entries.find((entry) => entry.idx === 27);
    expect(current).toMatchObject({
      idx: 27,
      tag: '0027_fsrs_only_hardening',
    });
    expect(current!.when).toBeGreaterThan(previous!.when);
  });

  integrationTest(
    'applies the complete history to a blank database',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        const tables = await sql<{ table_name: string }[]>`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name LIKE 'fsrs_%'
        `;
        expect(tables.map((row) => row.table_name)).toEqual(
          expect.arrayContaining([
            'fsrs_parameter_revisions',
            'fsrs_card_states',
            'fsrs_review_events',
            'fsrs_migration_runs',
          ]),
        );
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'upgrades an original 0026 database and safely reruns 0027',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 25);
        await applyMigrationFile(sql, '0026_fsrs_only_expand.sql');
        const { userId, cardId } = await seedUserAndCard(sql);
        const revisionId = await insertRevision(sql, userId);
        await insertCanonicalState(sql, userId, cardId, revisionId);
        await insertCanonicalEvent(sql, userId, cardId, revisionId);

        const preUpgradeIndexes = await sql<{ definition: string }[]>`
          SELECT pg_get_indexdef(index_relation.oid) AS definition
          FROM pg_class index_relation
          WHERE index_relation.relname IN (
            'idx_fsrs_card_states_parameter_revision',
            'idx_fsrs_review_events_parameter_revision'
          )
          ORDER BY index_relation.relname
        `;
        expect(preUpgradeIndexes.every((row) =>
          !row.definition.includes('user_id')
        )).toBe(true);

        await applyMigrationFile(sql, '0027_fsrs_only_hardening.sql');
        await applyMigrationFile(sql, '0026_fsrs_only_expand.sql');
        const [lastReviewedAt] = await sql<{ is_nullable: string }[]>`
          SELECT is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'fsrs_card_states'
            AND column_name = 'last_reviewed_at'
        `;
        expect(lastReviewedAt.is_nullable).toBe('NO');
        const learningCycleColumns = await sql<{
          table_name: string;
          is_nullable: string;
          column_default: string;
        }[]>`
          SELECT table_name, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN ('fsrs_card_states', 'fsrs_review_events')
            AND column_name = 'learning_cycle'
          ORDER BY table_name
        `;
        expect([...learningCycleColumns]).toEqual([
          {
            table_name: 'fsrs_card_states',
            is_nullable: 'NO',
            column_default: '1',
          },
          {
            table_name: 'fsrs_review_events',
            is_nullable: 'NO',
            column_default: '1',
          },
        ]);
        const postUpgradeIndexes = await sql<{
          name: string;
          definition: string;
        }[]>`
          SELECT
            index_relation.relname AS name,
            pg_get_indexdef(index_relation.oid) AS definition
          FROM pg_class index_relation
          WHERE index_relation.relname IN (
            'idx_fsrs_card_states_parameter_revision',
            'idx_fsrs_review_events_parameter_revision'
          )
          ORDER BY index_relation.relname
        `;
        expect([...postUpgradeIndexes]).toEqual([
          {
            name: 'idx_fsrs_card_states_parameter_revision',
            definition: expect.stringContaining(
              '(parameter_revision_id, user_id)',
            ),
          },
          {
            name: 'idx_fsrs_review_events_parameter_revision',
            definition: expect.stringContaining(
              '(parameter_revision_id, user_id)',
            ),
          },
        ]);
        const parameterForeignKeys = await sql<{ name: string }[]>`
          SELECT con.conname AS name
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname IN ('fsrs_card_states', 'fsrs_review_events')
            AND con.contype = 'f'
            AND con.conname LIKE '%parameter_revision%'
          ORDER BY con.conname
        `;
        expect(parameterForeignKeys.map((row) => row.name)).toEqual([
          'fk_fsrs_card_states_parameter_revision_user',
          'fk_fsrs_review_events_parameter_revision_user',
        ]);
        await applyMigrationFile(sql, '0027_fsrs_only_hardening.sql');
        const [{ count }] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (
              'fsrs_parameter_revisions',
              'fsrs_card_states',
              'fsrs_review_events',
              'fsrs_migration_runs'
            )
        `;
        expect(count).toBe(4);
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'fails closed when nullable legacy card states cannot be hardened',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 26);
        const { userId, cardId } = await seedUserAndCard(sql);
        const revisionId = await insertRevision(sql, userId);
        await sql`
          ALTER TABLE fsrs_card_states
          ALTER COLUMN last_reviewed_at DROP NOT NULL
        `;
        await sql`
          INSERT INTO fsrs_card_states (
            user_id, card_id, next_review_at, last_reviewed_at,
            stability, difficulty, state, elapsed_days, scheduled_days,
            learning_steps, reps, lapses, parameter_revision_id, state_version
          )
          VALUES (
            ${userId}, ${cardId}, now(), NULL, 1.5, 5, 'review',
            0, 1, 0, 1, 0, ${revisionId}, 1
          )
        `;

        try {
          await applyMigrationFile(sql, '0027_fsrs_only_hardening.sql');
          throw new Error('Expected migration hardening to fail closed');
        } catch (error) {
          expect(error).toMatchObject({
            code: 'P0001',
            message: expect.stringContaining(
              'Cannot harden fsrs_card_states.last_reviewed_at',
            ),
          });
        }
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'fails closed on rerun when a legacy card state has mismatched ownership',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        const first = await seedUserAndCard(sql);
        const second = await seedUserAndCard(sql);
        const revisionId = await insertRevision(sql, first.userId);
        await insertCanonicalState(
          sql,
          first.userId,
          first.cardId,
          revisionId,
        );
        await sql`
          DROP TRIGGER trg_cards_fsrs_owner_consistency ON cards
        `;
        await sql`
          UPDATE cards
          SET deck_id = ${second.deckId}
          WHERE id = ${first.cardId}
        `;

        await expectForeignKeyViolation(
          'fk_fsrs_card_states_card_owner',
          () => applyMigrationFile(sql, '0027_fsrs_only_hardening.sql'),
        );
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'fails closed on rerun when a legacy review event has mismatched ownership',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        const first = await seedUserAndCard(sql);
        const second = await seedUserAndCard(sql);
        const revisionId = await insertRevision(sql, first.userId);
        await insertCanonicalEvent(
          sql,
          first.userId,
          first.cardId,
          revisionId,
        );
        await sql`
          DROP TRIGGER trg_cards_fsrs_owner_consistency ON cards
        `;
        await sql`
          UPDATE cards
          SET deck_id = ${second.deckId}
          WHERE id = ${first.cardId}
        `;

        await expectForeignKeyViolation(
          'fk_fsrs_review_events_card_owner',
          () => applyMigrationFile(sql, '0027_fsrs_only_hardening.sql'),
        );
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'enforces revision uniqueness, source, hash, and active revision contracts',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        const { userId } = await seedUserAndCard(sql);
        await expectCheckViolation(
          'chk_fsrs_parameter_revisions_revision',
          () => sql`
            INSERT INTO fsrs_parameter_revisions (
              user_id, revision, engine_version, algorithm_version,
              policy_version, parameters, params_hash, source
            )
            VALUES (
              ${userId}, 0, 'engine', 'algorithm', 'policy',
              '{}'::jsonb, ${'0'.repeat(64)}, 'manual'
            )
          `,
        );
        await insertRevision(sql, userId);

        await expectUniqueViolation(
          'uq_fsrs_parameter_revisions_user_revision',
          () => insertRevision(sql, userId),
        );
        await expectUniqueViolation(
          'uq_fsrs_parameter_revisions_active_user',
          () => insertRevision(sql, userId, 2),
        );
        await sql`
          UPDATE fsrs_parameter_revisions
          SET retired_at = now()
          WHERE user_id = ${userId}
        `;
        await insertRevision(sql, userId, 2);
        await sql`
          UPDATE fsrs_parameter_revisions
          SET retired_at = now()
          WHERE user_id = ${userId}
            AND retired_at IS NULL
        `;
        await sql`
          INSERT INTO fsrs_parameter_revisions (
            user_id, revision, engine_version, algorithm_version,
            policy_version, parameters, params_hash, source, retired_at
          )
          VALUES (
            ${userId}, 7, 'engine', 'algorithm-a', 'policy',
            '{}'::jsonb, ${'e'.repeat(64)}, 'manual', now()
          )
        `;
        await sql`
          INSERT INTO fsrs_parameter_revisions (
            user_id, revision, engine_version, algorithm_version,
            policy_version, parameters, params_hash, source, retired_at
          )
          VALUES (
            ${userId}, 8, 'engine', 'algorithm-b', 'policy',
            '{}'::jsonb, ${'e'.repeat(64)}, 'manual', now()
          )
        `;
        await expectUniqueViolation(
          'uq_fsrs_parameter_revisions_resolved_params',
          () => sql`
            INSERT INTO fsrs_parameter_revisions (
              user_id, revision, engine_version, algorithm_version,
              policy_version, parameters, params_hash, source, retired_at
            )
            VALUES (
              ${userId}, 9, 'engine', 'algorithm-b', 'policy',
              '{}'::jsonb, ${'e'.repeat(64)}, 'manual', now()
            )
          `,
        );
        await expectCheckViolation(
          'chk_fsrs_parameter_revisions_source',
          () => sql`
            INSERT INTO fsrs_parameter_revisions (
              user_id, revision, engine_version, algorithm_version,
              policy_version, parameters, params_hash, source
            )
            VALUES (
              ${userId}, 3, 'engine', 'algorithm', 'policy',
              '{}'::jsonb, ${'b'.repeat(64)}, 'imported'
            )
          `,
        );
        await expectCheckViolation(
          'chk_fsrs_parameter_revisions_params_hash',
          () => sql`
            INSERT INTO fsrs_parameter_revisions (
              user_id, revision, engine_version, algorithm_version,
              policy_version, parameters, params_hash, source
            )
            VALUES (
              ${userId}, 3, 'engine', 'algorithm', 'policy',
              '{}'::jsonb, 'short', 'manual'
            )
          `,
        );
        await expectCheckViolation(
          'chk_fsrs_parameter_revisions_params_hash',
          () => sql`
            INSERT INTO fsrs_parameter_revisions (
              user_id, revision, engine_version, algorithm_version,
              policy_version, parameters, params_hash, source, retired_at
            )
            VALUES (
              ${userId}, 4, 'engine', 'algorithm', 'policy',
              '{}'::jsonb, ${'A'.repeat(64)}, 'manual', now()
            )
          `,
        );
        await expectCheckViolation(
          'chk_fsrs_parameter_revisions_parameters',
          () => sql`
            INSERT INTO fsrs_parameter_revisions (
              user_id, revision, engine_version, algorithm_version,
              policy_version, parameters, params_hash, source, retired_at
            )
            VALUES (
              ${userId}, 5, 'engine', 'algorithm', 'policy',
              '[]'::jsonb, ${'c'.repeat(64)}, 'manual', now()
            )
          `,
        );
        await expectCheckViolation(
          'chk_fsrs_parameter_revisions_timestamps',
          () => sql`
            INSERT INTO fsrs_parameter_revisions (
              user_id, revision, engine_version, algorithm_version,
              policy_version, parameters, params_hash, source,
              created_at, activated_at, retired_at
            )
            VALUES (
              ${userId}, 6, 'engine', 'algorithm', 'policy',
              '{}'::jsonb, ${'d'.repeat(64)}, 'manual',
              '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z',
              '2026-01-03T00:00:00Z'
            )
          `,
        );
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'rejects invalid card states, ranges, counters, and parameter references',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        const { userId, cardId } = await seedUserAndCard(sql);
        const revisionId = await insertRevision(sql, userId);
        const insertState = (overrides: {
          state?: string;
          stability?: string | number;
          difficulty?: string | number;
          reps?: number;
          lapses?: number;
          stateVersion?: number;
          elapsedDays?: number;
          scheduledDays?: number;
          learningSteps?: number;
          learningCycle?: number;
          lastReviewedAt?: Date | null;
          parameterRevisionId?: string;
        } = {}) => sql`
          INSERT INTO fsrs_card_states (
            user_id, card_id, next_review_at, last_reviewed_at,
            stability, difficulty, state,
            elapsed_days, scheduled_days, learning_steps, reps, lapses,
            parameter_revision_id, state_version, learning_cycle
          )
          VALUES (
            ${userId}, ${cardId}, now(),
            ${overrides.lastReviewedAt === undefined
              ? new Date()
              : overrides.lastReviewedAt},
            ${overrides.stability ?? 1.5},
            ${overrides.difficulty ?? 5},
            ${overrides.state ?? 'review'},
            ${overrides.elapsedDays ?? 0},
            ${overrides.scheduledDays ?? 1},
            ${overrides.learningSteps ?? 0},
            ${overrides.reps ?? 1}, ${overrides.lapses ?? 0},
            ${overrides.parameterRevisionId ?? revisionId},
            ${overrides.stateVersion ?? 1},
            ${overrides.learningCycle ?? 1}
          )
        `;

        await expectNotNullViolation(
          'last_reviewed_at',
          () => insertState({ lastReviewedAt: null }),
        );
        await expectCheckViolation(
          'chk_fsrs_card_states_state',
          () => insertState({ state: 'new' }),
        );
        for (const stability of [0, 'NaN', 'Infinity', '-Infinity']) {
          await expectCheckViolation(
            'chk_fsrs_card_states_stability',
            () => insertState({ stability }),
          );
        }
        for (const difficulty of [0, 11, 'NaN', 'Infinity', '-Infinity']) {
          await expectCheckViolation(
            'chk_fsrs_card_states_difficulty',
            () => insertState({ difficulty }),
          );
        }
        await expectCheckViolation(
          'chk_fsrs_card_states_reps_lapses',
          () => insertState({ reps: 0 }),
        );
        await expectCheckViolation(
          'chk_fsrs_card_states_reps_lapses',
          () => insertState({ reps: 1, lapses: 2 }),
        );
        for (const counters of [
          { elapsedDays: -1 },
          { scheduledDays: -1 },
          { learningSteps: -1 },
          { lapses: -1 },
        ]) {
          await expectCheckViolation(
            'chk_fsrs_card_states_non_negative_counters',
            () => insertState(counters),
          );
        }
        await expectPostgresCode(
          '23514',
          () => insertState({ reps: 1, stateVersion: 0 }),
        );
        await expectCheckViolation(
          'chk_fsrs_card_states_state_projection',
          () => insertState({ reps: 2, stateVersion: 1 }),
        );
        await expectCheckViolation(
          'chk_fsrs_card_states_learning_cycle',
          () => insertState({ learningCycle: 0 }),
        );
        await expectForeignKeyViolation(
          'fk_fsrs_card_states_parameter_revision_user',
          () => insertState({ parameterRevisionId: crypto.randomUUID() }),
        );

        await insertState();
        await expectUniqueViolation(
          'uq_fsrs_card_states_user_card',
          () => insertState(),
        );
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'rejects cross-user card ownership and parameter revisions',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        const first = await seedUserAndCard(sql);
        const second = await seedUserAndCard(sql);
        const firstRevisionId = await insertRevision(sql, first.userId);
        const secondRevisionId = await insertRevision(sql, second.userId);

        const insertState = (
          userId: string,
          cardId: string,
          parameterRevisionId: string,
        ) => sql`
          INSERT INTO fsrs_card_states (
            user_id, card_id, next_review_at, last_reviewed_at,
            stability, difficulty, state, elapsed_days, scheduled_days,
            learning_steps, reps, lapses, parameter_revision_id, state_version
          )
          VALUES (
            ${userId}, ${cardId}, now(), now(), 1.5, 5, 'review',
            0, 1, 0, 1, 0, ${parameterRevisionId}, 1
          )
        `;

        await expectForeignKeyViolation(
          'fk_fsrs_card_states_parameter_revision_user',
          () => insertState(first.userId, first.cardId, secondRevisionId),
        );
        await expectForeignKeyViolation(
          'fk_fsrs_card_states_card_owner',
          () => insertState(first.userId, second.cardId, firstRevisionId),
        );

        const insertEvent = (
          userId: string,
          cardId: string,
          parameterRevisionId: string,
        ) => sql`
          INSERT INTO fsrs_review_events (
            request_id, user_id, card_id, sequence, rating, reviewed_at,
            parameter_revision_id, origin, before_state, before_due_at,
            before_stability, before_difficulty, before_scheduled_days,
            before_learning_steps, elapsed_days, after_state, after_due_at,
            after_stability, after_difficulty, after_scheduled_days,
            after_learning_steps, after_reps, after_lapses, after_state_version
          )
          VALUES (
            ${crypto.randomUUID()}, ${userId}, ${cardId}, 1, 'good', now(),
            ${parameterRevisionId}, 'live', NULL, NULL, NULL, NULL, NULL, NULL,
            0, 'learning', now(), 1.5, 5, 0, 1, 1, 0, 1
          )
        `;

        await expectForeignKeyViolation(
          'fk_fsrs_review_events_parameter_revision_user',
          () => insertEvent(first.userId, first.cardId, secondRevisionId),
        );
        await expectForeignKeyViolation(
          'fk_fsrs_review_events_card_owner',
          () => insertEvent(first.userId, second.cardId, firstRevisionId),
        );
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'preserves FSRS ownership when cards or decks are reassigned',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        const first = await seedUserAndCard(sql);
        const second = await seedUserAndCard(sql);
        const sameOwnerDeckId = await seedDeckForUser(sql, first.userId);
        const revisionId = await insertRevision(sql, first.userId);
        const [stateOnlyCard] = await sql<{ id: string }[]>`
          INSERT INTO cards (deck_id)
          VALUES (${first.deckId})
          RETURNING id
        `;

        await insertCanonicalState(
          sql,
          first.userId,
          first.cardId,
          revisionId,
        );
        await insertCanonicalEvent(
          sql,
          first.userId,
          first.cardId,
          revisionId,
        );
        await insertCanonicalState(
          sql,
          first.userId,
          stateOnlyCard.id,
          revisionId,
        );

        // Rerunning the migration must preserve and reinstall both guards.
        await applyMigrationFile(sql, '0027_fsrs_only_hardening.sql');

        await sql`
          UPDATE cards
          SET deck_id = ${sameOwnerDeckId}
          WHERE id = ${first.cardId}
        `;
        await sql`
          UPDATE decks
          SET user_id = ${first.userId}
          WHERE id = ${sameOwnerDeckId}
        `;

        await expectForeignKeyViolation(
          'fk_cards_fsrs_owner_consistency',
          () => sql`
            UPDATE cards
            SET deck_id = ${second.deckId}
            WHERE id = ${first.cardId}
          `,
        );

        await sql`
          DELETE FROM fsrs_card_states
          WHERE card_id = ${first.cardId}
        `;
        await expectForeignKeyViolation(
          'fk_cards_fsrs_owner_consistency',
          () => sql`
            UPDATE cards
            SET deck_id = ${second.deckId}
            WHERE id = ${first.cardId}
          `,
        );

        await expectForeignKeyViolation(
          'fk_decks_fsrs_owner_consistency',
          () => sql`
            UPDATE decks
            SET user_id = ${second.userId}
            WHERE id = ${first.deckId}
          `,
        );
        await expectForeignKeyViolation(
          'fk_decks_fsrs_owner_consistency',
          () => sql`
            UPDATE decks
            SET user_id = ${second.userId}
            WHERE id = ${sameOwnerDeckId}
          `,
        );
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'serializes FSRS writes with card and deck ownership changes',
    async () => {
      const { databaseName, databaseUrl, sql } =
        await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        await sql.unsafe(`SET lock_timeout = '5s'`);
        await sql.unsafe(`SET statement_timeout = '10s'`);
        const first = await seedUserAndCard(sql);
        const second = await seedUserAndCard(sql);
        const revisionId = await insertRevision(sql, first.userId);

        const runRace = async (
          insertFsrsRow: (transaction: Sql) => Promise<unknown>,
          mutateOwnership: () => Promise<unknown>,
        ) => {
          const writer = postgres(databaseUrl, {
            max: 1,
            onnotice: () => {},
          });
          const insertReady = createDeferred();
          const releaseInsert = createDeferred();
          let mutationSettled = false;
          let mutationError: unknown;

          const insertPromise = writer.begin(async (transaction) => {
            await transaction.unsafe(`SET LOCAL lock_timeout = '5s'`);
            await transaction.unsafe(`SET LOCAL statement_timeout = '10s'`);
            await insertFsrsRow(transaction as unknown as Sql);
            insertReady.resolve();
            await releaseInsert.promise;
          });
          await Promise.race([
            insertReady.promise,
            insertPromise.then(() => {
              throw new Error('FSRS insert transaction ended before pausing');
            }),
          ]);

          const mutationPromise = mutateOwnership()
            .catch((error) => {
              mutationError = error;
            })
            .finally(() => {
              mutationSettled = true;
            });
          await new Promise((resolve) => setTimeout(resolve, 100));
          const settledWhileInsertOpen = mutationSettled;

          releaseInsert.resolve();
          await insertPromise;
          await mutationPromise;
          await writer.end();

          return { settledWhileInsertOpen, mutationError };
        };

        const cardMoveRace = await runRace(
          (transaction) => insertCanonicalState(
            transaction,
            first.userId,
            first.cardId,
            revisionId,
          ),
          () => sql`
            UPDATE cards
            SET deck_id = ${second.deckId}
            WHERE id = ${first.cardId}
          `,
        );

        const [eventOnlyCard] = await sql<{ id: string }[]>`
          INSERT INTO cards (deck_id)
          VALUES (${first.deckId})
          RETURNING id
        `;
        const deckOwnerRace = await runRace(
          (transaction) => insertCanonicalEvent(
            transaction,
            first.userId,
            eventOnlyCard.id,
            revisionId,
          ),
          () => sql`
            UPDATE decks
            SET user_id = ${second.userId}
            WHERE id = ${first.deckId}
          `,
        );

        expect(cardMoveRace.settledWhileInsertOpen).toBe(false);
        expect(cardMoveRace.mutationError).toMatchObject({
          code: '23503',
          constraint_name: 'fk_cards_fsrs_owner_consistency',
        });
        expect(deckOwnerRace.settledWhileInsertOpen).toBe(false);
        expect(deckOwnerRace.mutationError).toMatchObject({
          code: '23503',
          constraint_name: 'fk_decks_fsrs_owner_consistency',
        });

        const [{ count }] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM (
            SELECT state.card_id
            FROM fsrs_card_states state
            INNER JOIN cards card ON card.id = state.card_id
            INNER JOIN decks deck ON deck.id = card.deck_id
            WHERE state.user_id IS DISTINCT FROM deck.user_id
            UNION ALL
            SELECT event.card_id
            FROM fsrs_review_events event
            INNER JOIN cards card ON card.id = event.card_id
            INNER JOIN decks deck ON deck.id = card.deck_id
            WHERE event.user_id IS DISTINCT FROM deck.user_id
          ) mismatch
        `;
        expect(count).toBe(0);
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'serializes FSRS writes when ownership changes acquire locks first',
    async () => {
      const { databaseName, databaseUrl, sql } =
        await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        await sql.unsafe(`SET lock_timeout = '5s'`);
        await sql.unsafe(`SET statement_timeout = '10s'`);
        const first = await seedUserAndCard(sql);
        const second = await seedUserAndCard(sql);
        const revisionId = await insertRevision(sql, first.userId);

        const runRace = async (
          mutateOwnership: (transaction: Sql) => Promise<unknown>,
          insertFsrsRow: () => Promise<unknown>,
        ) => {
          const ownerWriter = postgres(databaseUrl, {
            max: 1,
            onnotice: () => {},
          });
          const mutationReady = createDeferred();
          const releaseMutation = createDeferred();
          let insertSettled = false;
          let insertError: unknown;

          const mutationPromise = ownerWriter.begin(async (transaction) => {
            await transaction.unsafe(`SET LOCAL lock_timeout = '5s'`);
            await transaction.unsafe(`SET LOCAL statement_timeout = '10s'`);
            await mutateOwnership(transaction as unknown as Sql);
            mutationReady.resolve();
            await releaseMutation.promise;
          });
          await Promise.race([
            mutationReady.promise,
            mutationPromise.then(() => {
              throw new Error(
                'Ownership transaction ended before pausing',
              );
            }),
          ]);

          const insertPromise = insertFsrsRow()
            .catch((error) => {
              insertError = error;
            })
            .finally(() => {
              insertSettled = true;
            });
          await new Promise((resolve) => setTimeout(resolve, 100));
          const settledWhileMutationOpen = insertSettled;

          releaseMutation.resolve();
          await mutationPromise;
          await insertPromise;
          await ownerWriter.end();

          return { settledWhileMutationOpen, insertError };
        };

        const cardMoveRace = await runRace(
          (transaction) => transaction`
            UPDATE cards
            SET deck_id = ${second.deckId}
            WHERE id = ${first.cardId}
          `,
          () => insertCanonicalState(
            sql,
            first.userId,
            first.cardId,
            revisionId,
          ),
        );

        const [eventOnlyCard] = await sql<{ id: string }[]>`
          INSERT INTO cards (deck_id)
          VALUES (${first.deckId})
          RETURNING id
        `;
        const deckOwnerRace = await runRace(
          (transaction) => transaction`
            UPDATE decks
            SET user_id = ${second.userId}
            WHERE id = ${first.deckId}
          `,
          () => insertCanonicalEvent(
            sql,
            first.userId,
            eventOnlyCard.id,
            revisionId,
          ),
        );

        expect(cardMoveRace.settledWhileMutationOpen).toBe(false);
        expect(cardMoveRace.insertError).toMatchObject({
          code: '23503',
          constraint_name: 'fk_fsrs_card_states_card_owner',
        });
        expect(deckOwnerRace.settledWhileMutationOpen).toBe(false);
        expect(deckOwnerRace.insertError).toMatchObject({
          code: '23503',
          constraint_name: 'fk_fsrs_review_events_card_owner',
        });

        const [{ count }] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM (
            SELECT state.card_id
            FROM fsrs_card_states state
            INNER JOIN cards card ON card.id = state.card_id
            INNER JOIN decks deck ON deck.id = card.deck_id
            WHERE state.user_id IS DISTINCT FROM deck.user_id
            UNION ALL
            SELECT event.card_id
            FROM fsrs_review_events event
            INNER JOIN cards card ON card.id = event.card_id
            INNER JOIN decks deck ON deck.id = card.deck_id
            WHERE event.user_id IS DISTINCT FROM deck.user_id
          ) mismatch
        `;
        expect(count).toBe(0);
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'enforces review event idempotency, sequence, snapshots, enums, and ranges',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        const { userId, cardId } = await seedUserAndCard(sql);
        const revisionId = await insertRevision(sql, userId);
        const requestId = crypto.randomUUID();
        const insertEvent = (overrides: {
          requestId?: string;
          sequence?: number;
          rating?: string;
          origin?: string;
          durationMs?: number | null;
          beforeState?: string | null;
          beforeDueAt?: Date | null;
          beforeStability?: string | number | null;
          beforeDifficulty?: string | number | null;
          beforeScheduledDays?: number | null;
          beforeLearningSteps?: number | null;
          afterStability?: string | number;
          afterDifficulty?: string | number;
          afterScheduledDays?: number;
          afterLearningSteps?: number;
          afterReps?: number;
          afterLapses?: number;
          afterStateVersion?: number;
          elapsedDays?: number;
          learningCycle?: number;
        } = {}) => {
          const sequence = overrides.sequence ?? 1;
          const beforeState = overrides.beforeState === undefined
            ? sequence === 1
              ? null
              : 'learning'
            : overrides.beforeState;
          return sql`
          INSERT INTO fsrs_review_events (
            request_id, user_id, card_id, sequence, rating, reviewed_at,
            learning_cycle, duration_ms, parameter_revision_id, origin,
            before_state, before_due_at, before_stability, before_difficulty,
            before_scheduled_days, before_learning_steps,
            elapsed_days, after_state, after_due_at, after_stability,
            after_difficulty, after_scheduled_days, after_learning_steps,
            after_reps, after_lapses, after_state_version
          )
          VALUES (
            ${overrides.requestId ?? requestId}, ${userId}, ${cardId},
            ${sequence}, ${overrides.rating ?? 'good'}, now(),
            ${overrides.learningCycle ?? 1},
            ${overrides.durationMs === undefined ? 1000 : overrides.durationMs},
            ${revisionId}, ${overrides.origin ?? 'live'},
            ${beforeState},
            ${overrides.beforeDueAt === undefined
              ? beforeState === null ? null : new Date()
              : overrides.beforeDueAt},
            ${overrides.beforeStability === undefined
              ? beforeState === null ? null : 1.2
              : overrides.beforeStability},
            ${overrides.beforeDifficulty === undefined
              ? beforeState === null ? null : 5
              : overrides.beforeDifficulty},
            ${overrides.beforeScheduledDays === undefined
              ? beforeState === null ? null : 1
              : overrides.beforeScheduledDays},
            ${overrides.beforeLearningSteps === undefined
              ? beforeState === null ? null : 0
              : overrides.beforeLearningSteps},
            ${overrides.elapsedDays ?? 1}, 'review', now(),
            ${overrides.afterStability ?? 2.4},
            ${overrides.afterDifficulty ?? 5},
            ${overrides.afterScheduledDays ?? 2},
            ${overrides.afterLearningSteps ?? 0},
            ${overrides.afterReps ?? sequence}, ${overrides.afterLapses ?? 0},
            ${overrides.afterStateVersion ?? sequence}
          )
        `;
        };

        await insertEvent();
        await expectUniqueViolation(
          'uq_fsrs_review_events_user_request',
          () => insertEvent({ sequence: 2 }),
        );
        await expectUniqueViolation(
          'uq_fsrs_review_events_user_card_cycle_sequence',
          () => insertEvent({ requestId: crypto.randomUUID() }),
        );
        await insertEvent({
          requestId: crypto.randomUUID(),
          learningCycle: 2,
        });
        await expectCheckViolation(
          'chk_fsrs_review_events_sequence',
          () => insertEvent({
            requestId: crypto.randomUUID(),
            sequence: 0,
            beforeState: null,
            afterReps: 1,
            afterStateVersion: 1,
          }),
        );
        await expectCheckViolation(
          'chk_fsrs_review_events_learning_cycle',
          () => insertEvent({
            requestId: crypto.randomUUID(),
            learningCycle: 0,
          }),
        );
        await expectCheckViolation(
          'chk_fsrs_review_events_sequence_projection',
          () => insertEvent({
            requestId: crypto.randomUUID(),
            sequence: 2,
            beforeState: 'learning',
            afterReps: 1,
            afterStateVersion: 2,
          }),
        );
        await expectCheckViolation(
          'chk_fsrs_review_events_sequence_projection',
          () => insertEvent({
            requestId: crypto.randomUUID(),
            sequence: 2,
            beforeState: 'learning',
            afterReps: 2,
            afterStateVersion: 1,
          }),
        );
        await expectCheckViolation(
          'chk_fsrs_review_events_sequence_snapshot',
          () => insertEvent({
            requestId: crypto.randomUUID(),
            sequence: 1,
            beforeState: 'learning',
          }),
        );
        await expectCheckViolation(
          'chk_fsrs_review_events_before_snapshot',
          () => insertEvent({
            requestId: crypto.randomUUID(),
            sequence: 2,
            beforeState: 'learning',
            beforeDueAt: null,
          }),
        );
        await expectCheckViolation(
          'chk_fsrs_review_events_sequence_snapshot',
          () => insertEvent({
            requestId: crypto.randomUUID(),
            sequence: 2,
            beforeState: null,
          }),
        );
        await expectCheckViolation(
          'chk_fsrs_review_events_rating',
          () => insertEvent({
            requestId: crypto.randomUUID(),
            sequence: 2,
            rating: 'skip',
          }),
        );
        await expectCheckViolation(
          'chk_fsrs_review_events_origin',
          () => insertEvent({
            requestId: crypto.randomUUID(),
            sequence: 2,
            origin: 'replay',
          }),
        );
        await expectCheckViolation(
          'chk_fsrs_review_events_duration',
          () => insertEvent({
            requestId: crypto.randomUUID(),
            sequence: 2,
            durationMs: -1,
          }),
        );
        for (const afterStability of ['NaN', 'Infinity', '-Infinity']) {
          await expectCheckViolation(
            'chk_fsrs_review_events_after_stability',
            () => insertEvent({
              requestId: crypto.randomUUID(),
              sequence: 2,
              afterStability,
            }),
          );
        }
        for (const beforeStability of [0, 'NaN', 'Infinity', '-Infinity']) {
          await expectCheckViolation(
            'chk_fsrs_review_events_before_stability',
            () => insertEvent({
              requestId: crypto.randomUUID(),
              sequence: 2,
              beforeState: 'learning',
              beforeStability,
            }),
          );
        }
        for (const difficulty of [0, 11, 'NaN', 'Infinity', '-Infinity']) {
          await expectCheckViolation(
            'chk_fsrs_review_events_before_difficulty',
            () => insertEvent({
              requestId: crypto.randomUUID(),
              sequence: 2,
              beforeState: 'learning',
              beforeDifficulty: difficulty,
            }),
          );
          await expectCheckViolation(
            'chk_fsrs_review_events_after_difficulty',
            () => insertEvent({
              requestId: crypto.randomUUID(),
              sequence: 2,
              beforeState: 'learning',
              afterDifficulty: difficulty,
            }),
          );
        }
        for (const counters of [
          { elapsedDays: -1 },
          { beforeScheduledDays: -1 },
          { beforeLearningSteps: -1 },
          { afterScheduledDays: -1 },
          { afterLearningSteps: -1 },
          { afterReps: -1, afterStateVersion: 2 },
          { afterReps: 2, afterLapses: -1, afterStateVersion: 2 },
          { afterReps: 2, afterLapses: 3, afterStateVersion: 2 },
        ]) {
          await expectCheckViolation(
            'chk_fsrs_review_events_non_negative_counters',
            () => insertEvent({
              requestId: crypto.randomUUID(),
              sequence: 2,
              beforeState: 'learning',
              ...counters,
            }),
          );
        }
        await insertEvent({
          requestId: crypto.randomUUID(),
          sequence: 2,
          beforeState: 'learning',
        });
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'keeps review events append-only while their user and card still exist',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        const { userId, cardId } = await seedUserAndCard(sql);
        const revisionId = await insertRevision(sql, userId);
        await insertCanonicalEvent(sql, userId, cardId, revisionId);

        await expectPostgresError(
          '55000',
          'chk_fsrs_review_events_append_only_update',
          () => sql`
            UPDATE fsrs_review_events
            SET duration_ms = 1000
            WHERE card_id = ${cardId}
          `,
        );
        for (const mutation of [
          () => sql`
            UPDATE fsrs_review_events
            SET user_id = ${crypto.randomUUID()}
            WHERE card_id = ${cardId}
          `,
          () => sql`
            UPDATE fsrs_review_events
            SET card_id = ${crypto.randomUUID()}
            WHERE card_id = ${cardId}
          `,
        ]) {
          await expectPostgresError(
            '55000',
            'chk_fsrs_review_events_append_only_update',
            mutation,
          );
        }
        await expectPostgresError(
          '55000',
          'chk_fsrs_review_events_append_only_delete',
          () => sql`
            DELETE FROM fsrs_review_events
            WHERE card_id = ${cardId}
          `,
        );

        const [{ count }] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM fsrs_review_events
          WHERE card_id = ${cardId}
        `;
        expect(count).toBe(1);
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'keeps parameter revisions referenced and cascades states with their cards and users',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);

        const parameterCase = await seedUserAndCard(sql);
        const parameterRevisionId = await insertRevision(
          sql,
          parameterCase.userId,
        );
        await insertCanonicalState(
          sql,
          parameterCase.userId,
          parameterCase.cardId,
          parameterRevisionId,
        );
        await insertCanonicalEvent(
          sql,
          parameterCase.userId,
          parameterCase.cardId,
          parameterRevisionId,
        );
        await expectForeignKeyViolation(
          'fk_fsrs_card_states_parameter_revision_user',
          () => sql`
            DELETE FROM fsrs_parameter_revisions
            WHERE id = ${parameterRevisionId}
          `,
        );
        await sql`
          DELETE FROM fsrs_card_states
          WHERE card_id = ${parameterCase.cardId}
        `;
        await expectForeignKeyViolation(
          'fk_fsrs_review_events_parameter_revision_user',
          () => sql`
            DELETE FROM fsrs_parameter_revisions
            WHERE id = ${parameterRevisionId}
          `,
        );

        const cardCascade = await seedUserAndCard(sql);
        const cardRevisionId = await insertRevision(sql, cardCascade.userId);
        await insertCanonicalState(
          sql,
          cardCascade.userId,
          cardCascade.cardId,
          cardRevisionId,
        );
        await sql`
          DELETE FROM cards
          WHERE id = ${cardCascade.cardId}
        `;
        const [{ cardStateCount }] = await sql<{ cardStateCount: number }[]>`
          SELECT count(*)::int AS "cardStateCount"
          FROM fsrs_card_states
          WHERE card_id = ${cardCascade.cardId}
        `;
        expect(cardStateCount).toBe(0);

        const userCascade = await seedUserAndCard(sql);
        const userRevisionId = await insertRevision(sql, userCascade.userId);
        await insertCanonicalState(
          sql,
          userCascade.userId,
          userCascade.cardId,
          userRevisionId,
        );
        await sql`
          DELETE FROM users
          WHERE id = ${userCascade.userId}
        `;
        const [{ userStateCount }] = await sql<{ userStateCount: number }[]>`
          SELECT count(*)::int AS "userStateCount"
          FROM fsrs_card_states
          WHERE user_id = ${userCascade.userId}
        `;
        expect(userStateCount).toBe(0);
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'allows review-event deletion only through user card or deck cascades',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);

        const cardCascade = await seedUserAndCard(sql);
        const cardRevisionId = await insertRevision(
          sql,
          cardCascade.userId,
        );
        await insertCanonicalEvent(
          sql,
          cardCascade.userId,
          cardCascade.cardId,
          cardRevisionId,
        );
        await sql`
          DELETE FROM cards
          WHERE id = ${cardCascade.cardId}
        `;

        const deckCascade = await seedUserAndCard(sql);
        const deckRevisionId = await insertRevision(
          sql,
          deckCascade.userId,
        );
        await insertCanonicalEvent(
          sql,
          deckCascade.userId,
          deckCascade.cardId,
          deckRevisionId,
        );
        await sql`
          DELETE FROM decks
          WHERE id = ${deckCascade.deckId}
        `;

        const userCascade = await seedUserAndCard(sql);
        const userRevisionId = await insertRevision(
          sql,
          userCascade.userId,
        );
        await insertCanonicalEvent(
          sql,
          userCascade.userId,
          userCascade.cardId,
          userRevisionId,
        );
        await sql`
          DELETE FROM users
          WHERE id = ${userCascade.userId}
        `;

        const [{ count }] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM fsrs_review_events
          WHERE card_id IN (
            ${cardCascade.cardId},
            ${deckCascade.cardId},
            ${userCascade.cardId}
          )
        `;
        expect(count).toBe(0);
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'enforces the complete migration-run lifecycle',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        const sourceChecksum = 'a'.repeat(64);
        const resultChecksum = 'b'.repeat(64);
        const finishedAt = new Date(Date.now() + 60_000);
        const insertRun = (values: {
          status: string;
          finishedAt?: Date | null;
          sourceChecksum?: string | null;
          resultChecksum?: string | null;
          errorMessage?: string | null;
        }) => sql`
          INSERT INTO fsrs_migration_runs (
            status, engine_version, algorithm_version, policy_version,
            finished_at, source_counts, result_counts, anomalies,
            source_checksum, result_checksum, error_message
          )
          VALUES (
            ${values.status}, 'engine', 'algorithm', 'policy',
            ${values.finishedAt ?? null},
            '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
            ${values.sourceChecksum ?? null},
            ${values.resultChecksum ?? null},
            ${values.errorMessage ?? null}
          )
        `;

        await insertRun({
          status: 'running',
          sourceChecksum,
        });
        await insertRun({
          status: 'completed',
          finishedAt,
          sourceChecksum,
          resultChecksum,
        });
        await insertRun({
          status: 'failed',
          finishedAt,
          errorMessage: 'Planning failed before the source was checksummed',
        });

        await expectCheckViolation(
          'chk_fsrs_migration_runs_status',
          () => insertRun({ status: 'queued' }),
        );
        for (const invalidRun of [
          {
            status: 'running',
          },
          {
            status: 'running',
            finishedAt,
            sourceChecksum,
          },
          {
            status: 'running',
            sourceChecksum,
            resultChecksum,
          },
          {
            status: 'running',
            sourceChecksum,
            errorMessage: 'unexpected',
          },
          {
            status: 'completed',
            sourceChecksum,
            resultChecksum,
          },
          {
            status: 'completed',
            finishedAt,
            resultChecksum,
          },
          {
            status: 'completed',
            finishedAt,
            sourceChecksum,
          },
          {
            status: 'completed',
            finishedAt,
            sourceChecksum,
            resultChecksum,
            errorMessage: 'unexpected',
          },
          {
            status: 'failed',
            errorMessage: 'failed',
          },
          {
            status: 'failed',
            finishedAt,
          },
          {
            status: 'failed',
            finishedAt,
            errorMessage: '   ',
          },
          {
            status: 'failed',
            finishedAt,
            resultChecksum,
            errorMessage: 'failed',
          },
        ] as const) {
          await expectCheckViolation(
            'chk_fsrs_migration_runs_lifecycle',
            () => insertRun(invalidRun),
          );
        }

        await expectCheckViolation(
          'chk_fsrs_migration_runs_source_checksum',
          () => insertRun({
            status: 'running',
            sourceChecksum: 'short',
          }),
        );
        await expectCheckViolation(
          'chk_fsrs_migration_runs_source_checksum',
          () => insertRun({
            status: 'running',
            sourceChecksum: 'A'.repeat(64),
          }),
        );
        await expectCheckViolation(
          'chk_fsrs_migration_runs_json_shapes',
          () => sql`
            INSERT INTO fsrs_migration_runs (
              status, engine_version, algorithm_version, policy_version,
              source_counts, result_counts, anomalies, source_checksum
            )
            VALUES (
              'running', 'engine', 'algorithm', 'policy',
              '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, ${sourceChecksum}
            )
          `,
        );
        await expectCheckViolation(
          'chk_fsrs_migration_runs_timestamps',
          () => sql`
            INSERT INTO fsrs_migration_runs (
              status, engine_version, algorithm_version, policy_version,
              started_at, finished_at, source_counts, result_counts, anomalies,
              source_checksum, result_checksum
            )
            VALUES (
              'completed', 'engine', 'algorithm', 'policy',
              '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z',
              '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
              ${sourceChecksum}, ${resultChecksum}
            )
          `,
        );
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'fails closed when preexisting migration runs violate the lifecycle',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        await sql`
          ALTER TABLE fsrs_migration_runs
          DROP CONSTRAINT chk_fsrs_migration_runs_lifecycle
        `;
        await sql`
          INSERT INTO fsrs_migration_runs (
            status, engine_version, algorithm_version, policy_version,
            source_counts, result_counts, anomalies
          )
          VALUES (
            'running', 'engine', 'algorithm', 'policy',
            '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
          )
        `;

        await expectCheckViolation(
          'chk_fsrs_migration_runs_lifecycle',
          () => applyMigrationFile(sql, '0027_fsrs_only_hardening.sql'),
        );
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'provides a supporting index for every foreign key',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        const uncovered = await sql<{ constraint_name: string }[]>`
          WITH foreign_keys AS (
            SELECT
              con.oid AS constraint_oid,
              con.conname AS constraint_name,
              con.conrelid AS table_oid,
              con.conkey AS column_numbers
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace namespace ON namespace.oid = rel.relnamespace
            WHERE con.contype = 'f'
              AND namespace.nspname = 'public'
              AND rel.relname LIKE 'fsrs_%'
          )
          SELECT fk.constraint_name
          FROM foreign_keys fk
          WHERE NOT EXISTS (
            SELECT 1
            FROM pg_index index_metadata
            WHERE index_metadata.indrelid = fk.table_oid
              AND index_metadata.indisvalid
              AND index_metadata.indisready
              AND (index_metadata.indkey::smallint[])[
                0:cardinality(fk.column_numbers) - 1
              ] = fk.column_numbers
          )
        `;
        expect([...uncovered]).toEqual([]);
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'keeps the due-query covering columns as physical index includes',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 27);
        const [index] = await sql<{ definition: string }[]>`
          SELECT pg_get_indexdef(index_relation.oid) AS definition
          FROM pg_class index_relation
          WHERE index_relation.relname = 'idx_fsrs_card_states_due'
        `;
        expect(index.definition).toContain(
          'INCLUDE (card_id, state)',
        );
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );
});
