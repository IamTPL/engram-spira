import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres, { type Sql } from 'postgres';
import {
  createPostgresFsrsReplayRepository,
} from '../../../src/modules/study/fsrs-replay.postgres';
import { createFsrsReplayService } from '../../../src/modules/study/fsrs-replay.service';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../src/db/migrations');
const DATABASE_NAME =
  `engram_fsrs_replay_${crypto.randomUUID().replaceAll('-', '')}`;
const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const LOG_ID = '33333333-3333-4333-8333-333333333333';
const LOG_ID_2 = '44444444-4444-4444-8444-444444444444';
const CONFLICT_USER_ID = '55555555-5555-4555-8555-555555555555';
const RECOVERY_USER_ID = '66666666-6666-4666-8666-666666666666';
const LOCK_USER_ID = '77777777-7777-4777-8777-777777777777';
const FAILURE_USER_ID = '88888888-8888-4888-8888-888888888888';
const FAILURE_LOG_ID = '99999999-9999-4999-8999-999999999999';
const RESET_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RESET_LOG_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RESET_LOG_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RESET_LOG_3 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DML_USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DML_LOG_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
let admin: Sql;
let sql: Sql;

function assertDisposableName(name: string) {
  if (!/^engram_fsrs_replay_[a-f0-9]+$/u.test(name)) {
    throw new Error(`Unsafe disposable database name: ${name}`);
  }
}

async function applyMigrations(database: Sql) {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
    .sort();
  for (const file of files) {
    const source = await Bun.file(resolve(MIGRATIONS_DIR, file)).text();
    const statements = source
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    await database.begin(async (transaction) => {
      for (const statement of statements) {
        await transaction.unsafe(statement);
      }
    });
  }
}

async function seedUser(userId: string, suffix: string) {
  await sql`
    INSERT INTO users (id, email, password_hash)
    VALUES (${userId}, ${`${suffix}@example.com`}, 'hash')
  `;
  const [template] = await sql<{ id: string }[]>`
    INSERT INTO card_templates (user_id, name)
    VALUES (${userId}, ${`Vocabulary ${suffix}`})
    RETURNING id
  `;
  const [ownedClass] = await sql<{ id: string }[]>`
    INSERT INTO classes (user_id, name)
    VALUES (${userId}, ${`Class ${suffix}`})
    RETURNING id
  `;
  const [folder] = await sql<{ id: string }[]>`
    INSERT INTO folders (class_id, name)
    VALUES (${ownedClass.id}, ${`Folder ${suffix}`})
    RETURNING id
  `;
  const [deck] = await sql<{ id: string }[]>`
    INSERT INTO decks (user_id, folder_id, card_template_id, name)
    VALUES (${userId}, ${folder.id}, ${template.id}, ${`Deck ${suffix}`})
    RETURNING id
  `;
  const [card] = await sql<{ id: string }[]>`
    INSERT INTO cards (deck_id) VALUES (${deck.id}) RETURNING id
  `;
  return card.id;
}

async function waitForPausedRevisionInsert(timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [activity] = await sql<{ ready: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state = 'active'
          AND wait_event = 'PgSleep'
          AND query LIKE 'INSERT INTO fsrs_parameter_revisions%'
      ) AS ready
    `;
    if (activity?.ready) return;
    await Bun.sleep(20);
  }
  throw new Error('Timed out waiting for replay publish transaction');
}

beforeAll(async () => {
  assertDisposableName(DATABASE_NAME);
  admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${DATABASE_NAME}"`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${DATABASE_NAME}`;
  sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  await applyMigrations(sql);
});

afterAll(async () => {
  await sql?.end();
  assertDisposableName(DATABASE_NAME);
  await admin?.unsafe(`DROP DATABASE IF EXISTS "${DATABASE_NAME}" WITH (FORCE)`);
  await admin?.end();
});

describe('PostgreSQL FSRS replay repository', () => {
  test('dry-runs an empty all-user database without any writes', async () => {
    const repository = createPostgresFsrsReplayRepository(
      sql,
      `postgresql://localhost/${DATABASE_NAME}`,
    );
    const service = createFsrsReplayService(repository, () => 'UTC');
    const dryRun = await service.dryRun({ kind: 'all_users' });

    expect(dryRun.manifest.counts).toMatchObject({
      users: 0,
      events: 0,
      cardStates: 0,
    });
    expect([
      ...await sql`
        SELECT count(*)::int AS count FROM fsrs_migration_runs
      `,
    ]).toEqual([{ count: 0 }]);
  });

  test('applies exact rows, reuses byte-equivalent replay, and scopes users', async () => {
    const cardId = await seedUser(USER_ID, 'primary');
    await seedUser(OTHER_USER_ID, 'other');
    const [secondCard] = await sql<{ id: string }[]>`
      INSERT INTO cards (deck_id)
      SELECT deck_id FROM cards WHERE id = ${cardId}
      RETURNING id
    `;
    await sql.unsafe(
      `INSERT INTO review_logs (
        id, user_id, card_id, rating, reviewed_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'good',
        '2026-01-01T00:00:00.123456Z'::timestamptz)`,
      [LOG_ID, USER_ID, cardId],
    );
    await sql.unsafe(
      `INSERT INTO review_logs (
        id, user_id, card_id, rating, state, reviewed_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'hard', 'new',
        '2025-12-31T23:59:59.999999Z'::timestamptz
      )`,
      [LOG_ID_2, USER_ID, secondCard.id],
    );
    await sql`
      INSERT INTO study_progress (user_id, card_id, next_review_at)
      VALUES (${USER_ID}, ${cardId}, '2026-01-02T00:00:00Z')
    `;
    await sql`
      INSERT INTO study_progress (user_id, card_id, next_review_at)
      VALUES (${USER_ID}, ${secondCard.id}, '2026-01-02T00:00:00Z')
    `;

    const databaseUrl = new URL(ADMIN_URL);
    databaseUrl.pathname = `/${DATABASE_NAME}`;
    const repository = createPostgresFsrsReplayRepository(
      sql,
      databaseUrl.toString(),
    );
    const service = createFsrsReplayService(repository, () => 'UTC');
    const scope = { kind: 'user' as const, userId: USER_ID };
    const dryRun = await service.dryRun(scope);

    expect(
      dryRun.manifest.events.find((event) => event.sourceLogId === LOG_ID),
    ).toMatchObject({
      sourceReviewedAt: '2026-01-01T00:00:00.123456Z',
      reviewedAt: '2026-01-01T00:00:00.123Z',
    });
    const approved = {
      scope,
      expectedSourceChecksum: dryRun.manifest.sourceChecksum,
      expectedResultChecksum: dryRun.manifest.resultChecksum,
      allowProgressWithoutLogs: false,
    };
    const applied = await service.apply(approved);

    expect(applied.reused).toBe(false);
    expect([
      ...await sql`
        SELECT
          (SELECT count(*)::int FROM fsrs_parameter_revisions) AS revisions,
          (SELECT count(*)::int FROM fsrs_review_events) AS events,
          (SELECT count(*)::int FROM fsrs_card_states) AS states,
          (SELECT count(*)::int FROM fsrs_migration_runs
            WHERE status = 'completed') AS completed
      `,
    ]).toEqual([
      { revisions: 1, events: 2, states: 2, completed: 1 },
    ]);
    const expectedEvent = dryRun.manifest.events.find(
      (event) => event.sourceLogId === LOG_ID,
    )!;
    const expectedRevision = dryRun.manifest.parameterRevisions[0]!;
    expect([
      ...await sql`
        SELECT id::text AS id, user_id::text AS "userId", revision,
          engine_version AS "engineVersion",
          algorithm_version AS "algorithmVersion",
          policy_version AS "policyVersion", parameters,
          params_hash AS "paramsHash", source
        FROM fsrs_parameter_revisions WHERE user_id = ${USER_ID}
      `,
    ]).toEqual([expectedRevision]);
    expect([
      ...await sql.unsafe<Array<Record<string, unknown>>>(
        `SELECT id::text AS id, request_id::text AS "requestId",
           learning_cycle AS "learningCycle", sequence, rating, origin,
           before_state AS "beforeState", after_state AS "afterState",
           after_stability AS "afterStability",
           after_difficulty AS "afterDifficulty",
           after_reps AS "afterReps",
           after_state_version::int AS "afterStateVersion",
           to_char(reviewed_at AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "reviewedAt",
           to_char(after_due_at AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "afterDueAt"
         FROM fsrs_review_events WHERE id = $1::uuid`,
        [expectedEvent.id],
      ),
    ]).toEqual([
      {
        id: expectedEvent.id,
        requestId: expectedEvent.requestId,
        learningCycle: expectedEvent.learningCycle,
        sequence: expectedEvent.sequence,
        rating: expectedEvent.rating,
        origin: 'migration',
        beforeState: expectedEvent.beforeState,
        afterState: expectedEvent.afterState,
        afterStability: expectedEvent.afterStability,
        afterDifficulty: expectedEvent.afterDifficulty,
        afterReps: expectedEvent.afterReps,
        afterStateVersion: expectedEvent.afterStateVersion,
        reviewedAt: expectedEvent.reviewedAt,
        afterDueAt: expectedEvent.afterDueAt,
      },
    ]);
    const expectedState = dryRun.manifest.cardStates.find(
      (state) => state.cardId === cardId,
    )!;
    expect([
      ...await sql.unsafe<Array<Record<string, unknown>>>(
        `SELECT state, stability, difficulty, reps, lapses,
           learning_cycle AS "learningCycle",
           state_version::int AS "stateVersion",
           parameter_revision_id::text AS "parameterRevisionId",
           to_char(next_review_at AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "nextReviewAt",
           to_char(last_reviewed_at AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastReviewedAt"
         FROM fsrs_card_states
         WHERE user_id = $1::uuid AND card_id = $2::uuid`,
        [USER_ID, cardId],
      ),
    ]).toEqual([
      {
        state: expectedState.state,
        stability: expectedState.stability,
        difficulty: expectedState.difficulty,
        reps: expectedState.reps,
        lapses: expectedState.lapses,
        learningCycle: expectedState.learningCycle,
        stateVersion: expectedState.stateVersion,
        parameterRevisionId: expectedState.parameterRevisionId,
        nextReviewAt: expectedState.nextReviewAt,
        lastReviewedAt: expectedState.lastReviewedAt,
      },
    ]);
    expect([
      ...await sql`
        SELECT status, engine_version AS "engineVersion",
          algorithm_version AS "algorithmVersion",
          policy_version AS "policyVersion",
          source_counts AS "sourceCounts",
          result_counts AS "resultCounts",
          anomalies
        FROM fsrs_migration_runs WHERE id = ${applied.runId}
      `,
    ]).toEqual([
      {
        status: 'completed',
        engineVersion: dryRun.manifest.engineVersion,
        algorithmVersion: dryRun.manifest.algorithmVersion,
        policyVersion: dryRun.manifest.policyVersion,
        sourceCounts: { users: 1, reviews: 2, progressRows: 2 },
        resultCounts: dryRun.manifest.counts,
        anomalies: expect.any(Array),
      },
    ]);
    const domainTimestamps = [
      ...await sql`
        SELECT
          (SELECT min(created_at)::text FROM fsrs_parameter_revisions
            WHERE user_id = ${USER_ID}) AS revision,
          (SELECT min(received_at)::text FROM fsrs_review_events
            WHERE user_id = ${USER_ID}) AS event,
          (SELECT min(updated_at)::text FROM fsrs_card_states
            WHERE user_id = ${USER_ID}) AS state
      `,
    ];

    const rerun = await service.apply(approved);
    expect(rerun).toMatchObject({
      runId: applied.runId,
      reused: true,
    });
    expect([
      ...await sql`
        SELECT count(*)::int AS count FROM fsrs_migration_runs
      `,
    ]).toEqual([{ count: 1 }]);
    expect([
      ...await sql`
        SELECT count(*)::int AS count
        FROM fsrs_parameter_revisions
        WHERE user_id = ${OTHER_USER_ID}
      `,
    ]).toEqual([{ count: 0 }]);
    expect([
      ...await sql`
        SELECT
          (SELECT min(created_at)::text FROM fsrs_parameter_revisions
            WHERE user_id = ${USER_ID}) AS revision,
          (SELECT min(received_at)::text FROM fsrs_review_events
            WHERE user_id = ${USER_ID}) AS event,
          (SELECT min(updated_at)::text FROM fsrs_card_states
            WHERE user_id = ${USER_ID}) AS state
      `,
    ]).toEqual(domainTimestamps);
  });

  test('rejects source mutation after approval without changing canonical rows', async () => {
    const repository = createPostgresFsrsReplayRepository(
      sql,
      `postgresql://localhost/${DATABASE_NAME}`,
    );
    const service = createFsrsReplayService(repository, () => 'UTC');
    const scope = { kind: 'user' as const, userId: USER_ID };
    const approved = await service.dryRun(scope);
    await sql`
      UPDATE review_logs
      SET reviewed_at = reviewed_at + interval '1 microsecond'
      WHERE id = ${LOG_ID}
    `;

    await expect(
      service.apply({
        scope,
        expectedSourceChecksum: approved.manifest.sourceChecksum,
        expectedResultChecksum: approved.manifest.resultChecksum,
        allowProgressWithoutLogs: false,
      }),
    ).rejects.toThrow('source checksum');
    expect([
      ...await sql`
        SELECT count(*)::int AS count FROM fsrs_review_events
      `,
    ]).toEqual([{ count: 2 }]);
  });

  test('rolls back canonical writes and records a failed audit on conflict', async () => {
    await seedUser(CONFLICT_USER_ID, 'conflict');
    const repository = createPostgresFsrsReplayRepository(
      sql,
      `postgresql://localhost/${DATABASE_NAME}`,
    );
    const service = createFsrsReplayService(repository, () => 'UTC');
    const scope = {
      kind: 'user' as const,
      userId: CONFLICT_USER_ID,
    };
    const dryRun = await service.dryRun(scope);
    await sql`
      INSERT INTO fsrs_parameter_revisions (
        user_id, revision, engine_version, algorithm_version, policy_version,
        parameters, params_hash, source
      ) VALUES (
        ${CONFLICT_USER_ID}, 1, 'foreign-engine', 'foreign-algorithm',
        'foreign-policy', ${sql.json({})}, ${'f'.repeat(64)}, 'manual'
      )
    `;

    await expect(
      service.apply({
        scope,
        expectedSourceChecksum: dryRun.manifest.sourceChecksum,
        expectedResultChecksum: dryRun.manifest.resultChecksum,
        allowProgressWithoutLogs: false,
      }),
    ).rejects.toThrow('already exists');
    expect([
      ...await sql`
        SELECT
          (SELECT count(*)::int FROM fsrs_review_events
            WHERE user_id = ${CONFLICT_USER_ID}) AS events,
          (SELECT count(*)::int FROM fsrs_card_states
            WHERE user_id = ${CONFLICT_USER_ID}) AS states,
          (SELECT count(*)::int FROM fsrs_migration_runs
            WHERE status = 'failed'
              AND source_checksum = ${dryRun.manifest.sourceChecksum}) AS failed
      `,
    ]).toEqual([{ events: 0, states: 0, failed: 1 }]);
  });

  test('rolls back earlier inserts when persistence fails mid-transaction', async () => {
    const cardId = await seedUser(FAILURE_USER_ID, 'failure');
    await sql.unsafe(
      `INSERT INTO review_logs (
        id, user_id, card_id, rating, state, reviewed_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'good', 'new',
        '2026-03-01T00:00:00.000001Z'::timestamptz
      )`,
      [FAILURE_LOG_ID, FAILURE_USER_ID, cardId],
    );
    await sql`
      INSERT INTO study_progress (user_id, card_id, next_review_at)
      VALUES (${FAILURE_USER_ID}, ${cardId}, '2026-03-02T00:00:00Z')
    `;
    const repository = createPostgresFsrsReplayRepository(
      sql,
      `postgresql://localhost/${DATABASE_NAME}`,
    );
    const service = createFsrsReplayService(repository, () => 'UTC');
    const scope = { kind: 'user' as const, userId: FAILURE_USER_ID };
    const dryRun = await service.dryRun(scope);
    await sql.unsafe(`
      CREATE FUNCTION fail_fsrs_event_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected persistence failure';
      END
      $$
    `);
    await sql.unsafe(`
      CREATE TRIGGER fail_fsrs_event_insert
      BEFORE INSERT ON fsrs_review_events
      FOR EACH ROW EXECUTE FUNCTION fail_fsrs_event_insert()
    `);
    try {
      await expect(
        service.apply({
          scope,
          expectedSourceChecksum: dryRun.manifest.sourceChecksum,
          expectedResultChecksum: dryRun.manifest.resultChecksum,
          allowProgressWithoutLogs: false,
        }),
      ).rejects.toThrow('injected persistence failure');
    } finally {
      await sql.unsafe(
        'DROP TRIGGER IF EXISTS fail_fsrs_event_insert ON fsrs_review_events',
      );
      await sql.unsafe('DROP FUNCTION IF EXISTS fail_fsrs_event_insert()');
    }

    expect([
      ...await sql`
        SELECT
          (SELECT count(*)::int FROM fsrs_parameter_revisions
            WHERE user_id = ${FAILURE_USER_ID}) AS revisions,
          (SELECT count(*)::int FROM fsrs_review_events
            WHERE user_id = ${FAILURE_USER_ID}) AS events,
          (SELECT count(*)::int FROM fsrs_card_states
            WHERE user_id = ${FAILURE_USER_ID}) AS states,
          (SELECT count(*)::int FROM fsrs_migration_runs
            WHERE status = 'failed'
              AND source_checksum = ${dryRun.manifest.sourceChecksum}) AS failed
      `,
    ]).toEqual([
      { revisions: 0, events: 0, states: 0, failed: 1 },
    ]);
  });

  test('recovers abandoned running audit only after obtaining the session lock', async () => {
    await seedUser(RECOVERY_USER_ID, 'recovery');
    await sql`
      INSERT INTO fsrs_migration_runs (
        status, engine_version, algorithm_version, policy_version,
        source_counts, result_counts, anomalies, source_checksum
      ) VALUES (
        'running', 'old', 'old', 'old', ${sql.json({})}, ${sql.json({})},
        ${sql.json([])}, ${'e'.repeat(64)}
      )
    `;
    const repository = createPostgresFsrsReplayRepository(
      sql,
      `postgresql://localhost/${DATABASE_NAME}`,
    );
    const service = createFsrsReplayService(repository, () => 'UTC');
    const scope = {
      kind: 'user' as const,
      userId: RECOVERY_USER_ID,
    };
    const dryRun = await service.dryRun(scope);
    const applied = await service.apply({
      scope,
      expectedSourceChecksum: dryRun.manifest.sourceChecksum,
      expectedResultChecksum: dryRun.manifest.resultChecksum,
      allowProgressWithoutLogs: false,
    });

    expect(applied.recoveredRuns).toBe(1);
    expect([
      ...await sql`
        SELECT status, error_message AS "errorMessage"
        FROM fsrs_migration_runs
        WHERE source_checksum = ${'e'.repeat(64)}
      `,
    ]).toEqual([
      {
        status: 'failed',
        errorMessage: 'Abandoned replay recovered under advisory lock',
      },
    ]);
  });

  test('loads legacy reset boundaries and omits state for removed progress', async () => {
    const activeCardId = await seedUser(RESET_USER_ID, 'reset');
    const [removedCard] = await sql<{ id: string }[]>`
      INSERT INTO cards (deck_id)
      SELECT deck_id FROM cards WHERE id = ${activeCardId}
      RETURNING id
    `;
    await sql.unsafe(
      `INSERT INTO review_logs (
        id, user_id, card_id, rating, state, reviewed_at
      ) VALUES
        ($1::uuid, $2::uuid, $3::uuid, 'good', 'review',
          '2026-01-01T00:00:00.000001Z'::timestamptz),
        ($4::uuid, $2::uuid, $3::uuid, 'again', 'new',
          '2026-02-01T00:00:00.000001Z'::timestamptz),
        ($5::uuid, $2::uuid, $6::uuid, 'easy', 'new',
          '2026-03-01T00:00:00.000001Z'::timestamptz)`,
      [
        RESET_LOG_1,
        RESET_USER_ID,
        activeCardId,
        RESET_LOG_2,
        RESET_LOG_3,
        removedCard.id,
      ],
    );
    await sql`
      INSERT INTO study_progress (user_id, card_id, next_review_at)
      VALUES (${RESET_USER_ID}, ${activeCardId}, '2026-02-02T00:00:00Z')
    `;
    const repository = createPostgresFsrsReplayRepository(
      sql,
      `postgresql://localhost/${DATABASE_NAME}`,
    );
    const service = createFsrsReplayService(repository, () => 'UTC');
    const scope = { kind: 'user' as const, userId: RESET_USER_ID };
    const dryRun = await service.dryRun(scope);

    expect(
      dryRun.manifest.events
        .filter((event) => event.cardId === activeCardId)
        .map((event) => [event.learningCycle, event.sequence]),
    ).toEqual([[1, 1], [2, 1]]);
    expect(dryRun.manifest.anomalies.truncatedHistories).toEqual([
      {
        userId: RESET_USER_ID,
        cardId: activeCardId,
        firstLogId: RESET_LOG_1,
        legacyState: 'review',
      },
    ]);
    expect(dryRun.manifest.anomalies.inferredResets).toEqual([
      { userId: RESET_USER_ID, cardId: removedCard.id },
    ]);
    expect(dryRun.manifest.cardStates.map((state) => state.cardId)).toEqual([
      activeCardId,
    ]);

    await service.apply({
      scope,
      expectedSourceChecksum: dryRun.manifest.sourceChecksum,
      expectedResultChecksum: dryRun.manifest.resultChecksum,
      allowProgressWithoutLogs: false,
    });
    expect([
      ...await sql`
        SELECT
          (SELECT count(*)::int FROM fsrs_review_events
            WHERE user_id = ${RESET_USER_ID}) AS events,
          (SELECT count(*)::int FROM fsrs_card_states
            WHERE user_id = ${RESET_USER_ID}) AS states
      `,
    ]).toEqual([{ events: 3, states: 1 }]);
  });

  test('fails predictably while another session owns the replay lock', async () => {
    await seedUser(LOCK_USER_ID, 'lock');
    const repository = createPostgresFsrsReplayRepository(
      sql,
      `postgresql://localhost/${DATABASE_NAME}`,
    );
    const service = createFsrsReplayService(repository, () => 'UTC');
    const scope = { kind: 'user' as const, userId: LOCK_USER_ID };
    const dryRun = await service.dryRun(scope);
    const holder = await sql.reserve();
    await holder.unsafe(
      'SELECT pg_advisory_lock($1::bigint)',
      ['73918427409133721'],
    );
    try {
      await expect(
        service.apply({
          scope,
          expectedSourceChecksum: dryRun.manifest.sourceChecksum,
          expectedResultChecksum: dryRun.manifest.resultChecksum,
          allowProgressWithoutLogs: false,
        }),
      ).rejects.toThrow('already running');
    } finally {
      await holder.unsafe(
        'SELECT pg_advisory_unlock($1::bigint)',
        ['73918427409133721'],
      );
      holder.release();
    }
  });

  test('blocks source DML for the full canonical publish transaction', async () => {
    const cardId = await seedUser(DML_USER_ID, 'dml');
    await sql.unsafe(
      `INSERT INTO review_logs (
        id, user_id, card_id, rating, state, reviewed_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 'good', 'new',
        '2026-04-01T00:00:00.000001Z'::timestamptz
      )`,
      [DML_LOG_ID, DML_USER_ID, cardId],
    );
    await sql`
      INSERT INTO study_progress (user_id, card_id, next_review_at)
      VALUES (${DML_USER_ID}, ${cardId}, '2026-04-02T00:00:00Z')
    `;
    await sql.unsafe(`
      CREATE FUNCTION pause_fsrs_revision_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(1);
        RETURN NEW;
      END
      $$
    `);
    await sql.unsafe(`
      CREATE TRIGGER pause_fsrs_revision_insert
      BEFORE INSERT ON fsrs_parameter_revisions
      FOR EACH ROW EXECUTE FUNCTION pause_fsrs_revision_insert()
    `);
    const databaseUrl = new URL(ADMIN_URL);
    databaseUrl.pathname = `/${DATABASE_NAME}`;
    const repository = createPostgresFsrsReplayRepository(
      sql,
      databaseUrl.toString(),
    );
    const service = createFsrsReplayService(repository, () => 'UTC');
    const scope = { kind: 'user' as const, userId: DML_USER_ID };
    const dryRun = await service.dryRun(scope);
    const applyPromise = service.apply({
      scope,
      expectedSourceChecksum: dryRun.manifest.sourceChecksum,
      expectedResultChecksum: dryRun.manifest.resultChecksum,
      allowProgressWithoutLogs: false,
    });
    await waitForPausedRevisionInsert();
    const writer = postgres(databaseUrl.toString(), { max: 1 });
    try {
      let writerError: unknown;
      try {
        await writer.begin(async (transaction) => {
          await transaction.unsafe(`SET LOCAL lock_timeout = '100ms'`);
          await transaction.unsafe(
            `UPDATE review_logs SET rating = 'hard' WHERE id = $1::uuid`,
            [DML_LOG_ID],
          );
        });
      } catch (error) {
        writerError = error;
      }
      expect(writerError).toMatchObject({ code: '55P03' });
      await applyPromise;
    } finally {
      await writer.end();
      await sql.unsafe(
        'DROP TRIGGER IF EXISTS pause_fsrs_revision_insert ON fsrs_parameter_revisions',
      );
      await sql.unsafe('DROP FUNCTION IF EXISTS pause_fsrs_revision_insert()');
    }
    expect([
      ...await sql`
        SELECT rating FROM review_logs WHERE id = ${DML_LOG_ID}
      `,
    ]).toEqual([{ rating: 'good' }]);
  });
});
