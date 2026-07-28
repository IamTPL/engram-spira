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
  return { userId: user.id, cardId: card.id };
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

afterAll(async () => {
  for (const databaseName of [...createdDatabases]) {
    await dropDisposableDatabase(databaseName);
  }
});

describe('0026 FSRS-only expansion migration', () => {
  test('declares the expansion and journal entry without a legacy contract change', async () => {
    const migration = await Bun.file(
      resolve(MIGRATIONS_DIR, '0026_fsrs_only_expand.sql'),
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
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "${tableName}"`);
    }
    expect(migration).not.toMatch(
      /(?:ALTER|DROP)\s+(?:TABLE\s+)?(?:"?(?:users|study_progress|review_logs|fsrs_user_params)"?)/i,
    );
    expect(migration).not.toContain('CREATE TYPE');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "uq_fsrs_parameter_revisions_active_user"',
    );
    expect(migration).toContain(
      'INCLUDE ("card_id", "state")',
    );

    const previous = journal.entries.find((entry) => entry.idx === 25);
    const current = journal.entries.find((entry) => entry.idx === 26);
    expect(current).toMatchObject({
      idx: 26,
      tag: '0026_fsrs_only_expand',
    });
    expect(current!.when).toBeGreaterThan(previous!.when);
  });

  integrationTest(
    'applies the complete history to a blank database',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 26);
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
    'upgrades a 0025 database and safely reruns 0026',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 25);
        await applyMigrationFile(sql, '0026_fsrs_only_expand.sql');
        await applyMigrationFile(sql, '0026_fsrs_only_expand.sql');
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
    'enforces revision uniqueness, source, hash, and active revision contracts',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 26);
        const { userId } = await seedUserAndCard(sql);
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
        await applyMigrationsThrough(sql, 26);
        const { userId, cardId } = await seedUserAndCard(sql);
        const revisionId = await insertRevision(sql, userId);
        const insertState = (overrides: {
          state?: string;
          stability?: string | number;
          difficulty?: string | number;
          reps?: number;
          lapses?: number;
          parameterRevisionId?: string;
        } = {}) => sql`
          INSERT INTO fsrs_card_states (
            user_id, card_id, next_review_at, stability, difficulty, state,
            elapsed_days, scheduled_days, learning_steps, reps, lapses,
            parameter_revision_id, state_version
          )
          VALUES (
            ${userId}, ${cardId}, now(),
            ${overrides.stability ?? 1.5},
            ${overrides.difficulty ?? 5},
            ${overrides.state ?? 'review'},
            0, 1, 0, ${overrides.reps ?? 1}, ${overrides.lapses ?? 0},
            ${overrides.parameterRevisionId ?? revisionId}, 1
          )
        `;

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
        await expectForeignKeyViolation(
          'fk_fsrs_card_states_parameter_revision',
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
    'enforces review event idempotency, sequence, snapshots, enums, and ranges',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 26);
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
          afterStability?: string | number;
        } = {}) => sql`
          INSERT INTO fsrs_review_events (
            request_id, user_id, card_id, sequence, rating, reviewed_at,
            duration_ms, parameter_revision_id, origin,
            before_state, before_due_at, before_stability, before_difficulty,
            before_scheduled_days, before_learning_steps,
            elapsed_days, after_state, after_due_at, after_stability,
            after_difficulty, after_scheduled_days, after_learning_steps,
            after_reps, after_lapses, after_state_version
          )
          VALUES (
            ${overrides.requestId ?? requestId}, ${userId}, ${cardId},
            ${overrides.sequence ?? 1}, ${overrides.rating ?? 'good'}, now(),
            ${overrides.durationMs === undefined ? 1000 : overrides.durationMs},
            ${revisionId}, ${overrides.origin ?? 'live'},
            ${overrides.beforeState === undefined
              ? 'learning'
              : overrides.beforeState},
            ${overrides.beforeState === null ? null : new Date()},
            ${overrides.beforeState === null ? null : 1.2},
            ${overrides.beforeState === null ? null : 5},
            ${overrides.beforeState === null ? null : 1},
            ${overrides.beforeState === null ? null : 0},
            1, 'review', now(), ${overrides.afterStability ?? 2.4}, 5,
            2, 0, 2, 0, 2
          )
        `;

        await insertEvent();
        await expectUniqueViolation(
          'uq_fsrs_review_events_user_request',
          () => insertEvent({ sequence: 2 }),
        );
        await expectUniqueViolation(
          'uq_fsrs_review_events_user_card_sequence',
          () => insertEvent({ requestId: crypto.randomUUID() }),
        );
        await expectCheckViolation(
          'chk_fsrs_review_events_sequence',
          () => insertEvent({
            requestId: crypto.randomUUID(),
            sequence: 0,
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
        await insertEvent({
          requestId: crypto.randomUUID(),
          sequence: 2,
          beforeState: null,
        });
      } finally {
        await sql.end();
        await dropDisposableDatabase(databaseName);
      }
    },
    30_000,
  );

  integrationTest(
    'enforces migration-run status, checksum, and timestamp contracts',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 26);
        await expectCheckViolation(
          'chk_fsrs_migration_runs_status',
          () => sql`
            INSERT INTO fsrs_migration_runs (
              status, engine_version, algorithm_version, policy_version,
              source_counts, result_counts, anomalies
            )
            VALUES (
              'queued', 'engine', 'algorithm', 'policy',
              '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
            )
          `,
        );
        await expectCheckViolation(
          'chk_fsrs_migration_runs_source_checksum',
          () => sql`
            INSERT INTO fsrs_migration_runs (
              status, engine_version, algorithm_version, policy_version,
              source_counts, result_counts, anomalies, source_checksum
            )
            VALUES (
              'running', 'engine', 'algorithm', 'policy',
              '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'short'
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
    'provides a supporting index for every foreign key',
    async () => {
      const { databaseName, sql } = await createDisposableDatabase();
      try {
        await applyMigrationsThrough(sql, 26);
        const uncovered = await sql<{ constraint_name: string }[]>`
          WITH foreign_keys AS (
            SELECT
              constraint_name,
              table_name,
              array_agg(att.attname ORDER BY key_position.ordinality) AS columns
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              USING (constraint_schema, constraint_name)
            JOIN pg_constraint con
              ON con.conname = tc.constraint_name
            JOIN unnest(con.conkey) WITH ORDINALITY AS key_position(attnum, ordinality)
              ON true
            JOIN pg_attribute att
              ON att.attrelid = con.conrelid
             AND att.attnum = key_position.attnum
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_name LIKE 'fsrs_%'
            GROUP BY constraint_name, table_name
          )
          SELECT fk.constraint_name
          FROM foreign_keys fk
          WHERE NOT EXISTS (
            SELECT 1
            FROM pg_indexes indexes
            WHERE indexes.schemaname = 'public'
              AND indexes.tablename = fk.table_name
              AND (
                SELECT array_agg(name ORDER BY position)
                FROM (
                  SELECT
                    (regexp_matches(indexes.indexdef, '\\(([^)]*)\\)'))[1] AS raw
                ) match
                CROSS JOIN LATERAL unnest(string_to_array(match.raw, ', '))
                  WITH ORDINALITY AS indexed(name, position)
                WHERE position <= cardinality(fk.columns)
              ) = fk.columns
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
});
