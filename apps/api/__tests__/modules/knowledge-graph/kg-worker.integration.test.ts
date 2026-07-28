import { afterAll, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  createPostgresKgRunRepository,
  requestKgRunCancellation,
  type KgWorkerExecutor,
} from '../../../src/modules/knowledge-graph/kg-worker';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const workerA = '00000000-0000-4000-8000-000000000001';
const workerB = '00000000-0000-4000-8000-000000000002';
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
  if (!/^engram_kg_worker_test_[a-f0-9]+$/.test(databaseName)) {
    throw new Error(`Refusing unsafe disposable database name: ${databaseName}`);
  }
}

async function createDisposableDatabase() {
  const databaseName =
    `engram_kg_worker_test_${crypto.randomUUID().replaceAll('-', '')}`;
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
  const sql = postgres(databaseUrl.toString(), {
    max: 6,
    onnotice: () => {},
  });
  await sql`
    CREATE TABLE kg_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL DEFAULT gen_random_uuid(),
      run_type varchar(30) NOT NULL DEFAULT 'deck_index',
      deck_id uuid,
      focus_sense_id uuid,
      status varchar(20) NOT NULL DEFAULT 'queued',
      stage varchar(20) NOT NULL DEFAULT 'snapshot',
      fingerprint varchar(64) NOT NULL DEFAULT repeat('f', 64),
      representation_version varchar(20) NOT NULL DEFAULT 'v1',
      embedding_model varchar(100) NOT NULL DEFAULT 'embedding-model',
      prompt_version varchar(50) NOT NULL DEFAULT 'prompt-v1',
      taxonomy_version varchar(50) NOT NULL DEFAULT 'taxonomy-v1',
      source_language_tag varchar(35) NOT NULL DEFAULT 'vi',
      definition_language_tag varchar(35) NOT NULL DEFAULT 'en',
      snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      stats jsonb NOT NULL DEFAULT '{}'::jsonb,
      attempt_count integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 5,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      locked_by uuid,
      locked_until timestamptz,
      heartbeat_at timestamptz,
      error_code varchar(100),
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

  return {
    databaseName,
    sql,
    executor: drizzle(sql) as unknown as KgWorkerExecutor,
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

integrationTest('reports only currently claimable queue depth and age', async () => {
  const { databaseName, sql, executor } = await createDisposableDatabase();
  try {
    await sql`
      INSERT INTO kg_runs (
        deck_id,
        status,
        next_attempt_at,
        locked_by,
        locked_until,
        cancel_requested_at,
        created_at
      )
      VALUES
        (
          gen_random_uuid(),
          'queued',
          now(),
          NULL,
          NULL,
          NULL,
          now() - interval '2 seconds'
        ),
        (
          gen_random_uuid(),
          'queued',
          now() + interval '1 hour',
          NULL,
          NULL,
          NULL,
          now() - interval '10 seconds'
        ),
        (
          gen_random_uuid(),
          'processing',
          now(),
          ${workerA},
          now() - interval '1 second',
          NULL,
          now() - interval '1 second'
        ),
        (
          gen_random_uuid(),
          'queued',
          now(),
          NULL,
          NULL,
          now(),
          now() - interval '20 seconds'
        )
    `;

    const telemetry =
      await createPostgresKgRunRepository(executor).loadQueueTelemetry();

    expect(telemetry.depth).toBe(2);
    expect(telemetry.oldestAgeMs).toBeGreaterThanOrEqual(1_900);
    expect(telemetry.oldestAgeMs).toBeLessThan(10_000);
  } finally {
    await sql.end();
    await dropDisposableDatabase(databaseName);
  }
});

integrationTest('concurrent atomic claimers never own the same run', async () => {
  const { databaseName, sql, executor } = await createDisposableDatabase();
  try {
    await sql`
      INSERT INTO kg_runs (deck_id, created_at)
      VALUES
        (gen_random_uuid(), now() - interval '2 seconds'),
        (gen_random_uuid(), now() - interval '1 second')
    `;
    const repository = createPostgresKgRunRepository(executor);

    const [claimedA, claimedB] = await Promise.all([
      repository.claimBatch(workerA, 1, 30_000),
      repository.claimBatch(workerB, 1, 30_000),
    ]);

    expect(claimedA).toHaveLength(1);
    expect(claimedB).toHaveLength(1);
    expect(claimedA[0]?.id).not.toBe(claimedB[0]?.id);
    const rows = await sql<{ locked_by: string }[]>`
      SELECT locked_by
      FROM kg_runs
      ORDER BY created_at
    `;
    expect(new Set(rows.map((row) => row.locked_by))).toEqual(
      new Set([workerA, workerB]),
    );
  } finally {
    await sql.end();
    await dropDisposableDatabase(databaseName);
  }
});

integrationTest(
  'claiming reclaims only expired leases and ignores future, cancelled, terminal, and exhausted rows',
  async () => {
    const { databaseName, sql, executor } = await createDisposableDatabase();
    try {
      const rows = await sql<{ id: string; status: string }[]>`
        INSERT INTO kg_runs (
          deck_id,
          status,
          next_attempt_at,
          locked_by,
          locked_until,
          cancel_requested_at,
          attempt_count,
          created_at
        )
        VALUES
          (
            gen_random_uuid(),
            'processing',
            now(),
            ${workerA},
            now() - interval '1 second',
            NULL,
            1,
            now() - interval '7 seconds'
          ),
          (
            gen_random_uuid(),
            'processing',
            now(),
            ${workerA},
            now() + interval '1 hour',
            NULL,
            1,
            now() - interval '6 seconds'
          ),
          (
            gen_random_uuid(),
            'queued',
            now() + interval '1 hour',
            NULL,
            NULL,
            NULL,
            0,
            now() - interval '5 seconds'
          ),
          (
            gen_random_uuid(),
            'queued',
            now(),
            NULL,
            NULL,
            now(),
            0,
            now() - interval '4 seconds'
          ),
          (
            gen_random_uuid(),
            'completed',
            now(),
            NULL,
            NULL,
            NULL,
            1,
            now() - interval '3 seconds'
          ),
          (
            gen_random_uuid(),
            'queued',
            now(),
            NULL,
            NULL,
            NULL,
            5,
            now() - interval '2 seconds'
          )
        RETURNING id, status
      `;
      const expiredId = rows[0]!.id;
      const repository = createPostgresKgRunRepository(executor);

      const claimed = await repository.claimBatch(workerB, 10, 30_000);

      expect(claimed.map((run) => run.id)).toEqual([expiredId]);
      expect(claimed[0]?.attemptCount).toBe(2);
      const owned = await sql<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM kg_runs
        WHERE status = 'processing' AND locked_by = ${workerB}
      `;
      expect(owned[0]?.count).toBe(1);
    } finally {
      await sql.end();
      await dropDisposableDatabase(databaseName);
    }
  },
);

integrationTest(
  'heartbeat and terminal CAS protect a reclaimed run from the stale worker',
  async () => {
    const { databaseName, sql, executor } = await createDisposableDatabase();
    try {
      await sql`
        INSERT INTO kg_runs (deck_id, created_at)
        VALUES (gen_random_uuid(), now() - interval '1 second')
      `;
      const repository = createPostgresKgRunRepository(executor);
      const [claimed] = await repository.claimBatch(workerA, 1, 100);
      const before = await sql<{ locked_until: Date }[]>`
        SELECT locked_until
        FROM kg_runs
        WHERE id = ${claimed!.id}
      `;

      expect(
        await repository.heartbeat(claimed!.id, workerB, 30_000),
      ).toEqual({ owned: false, cancelRequested: false });
      expect(
        await repository.heartbeat(claimed!.id, workerA, 30_000),
      ).toEqual({ owned: true, cancelRequested: false });
      const after = await sql<{ locked_until: Date }[]>`
        SELECT locked_until
        FROM kg_runs
        WHERE id = ${claimed!.id}
      `;
      expect(new Date(after[0]!.locked_until).getTime()).toBeGreaterThan(
        new Date(before[0]!.locked_until).getTime(),
      );

      await sql`
        UPDATE kg_runs
        SET locked_until = now() - interval '1 second'
        WHERE id = ${claimed!.id}
      `;
      const [reclaimed] = await repository.claimBatch(workerB, 1, 30_000);
      expect(reclaimed?.id).toBe(claimed?.id);
      expect(
        await repository.finish(
          claimed!.id,
          workerA,
          claimed!.stage,
          'completed',
          {},
          {},
        ),
      ).toBe(false);
      expect(
        await repository.finish(
          reclaimed!.id,
          workerB,
          reclaimed!.stage,
          'completed',
          {},
          {},
        ),
      ).toBe(true);
      const final = await sql<{
        status: string;
        locked_by: string | null;
        locked_until: Date | null;
        completed_at: Date | null;
      }[]>`
        SELECT status, locked_by, locked_until, completed_at
        FROM kg_runs
        WHERE id = ${claimed!.id}
      `;
      expect(final[0]?.status).toBe('completed');
      expect(final[0]?.locked_by).toBeNull();
      expect(final[0]?.locked_until).toBeNull();
      expect(Number.isFinite(new Date(final[0]!.completed_at!).getTime())).toBe(
        true,
      );
    } finally {
      await sql.end();
      await dropDisposableDatabase(databaseName);
    }
  },
);

integrationTest(
  'retry, failure, and cancellation release leases and set lifecycle timestamps',
  async () => {
    const { databaseName, sql, executor } = await createDisposableDatabase();
    try {
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO kg_runs (deck_id, created_at)
        VALUES
          (gen_random_uuid(), now() - interval '3 seconds'),
          (gen_random_uuid(), now() - interval '2 seconds'),
          (gen_random_uuid(), now() - interval '1 second')
        RETURNING id
      `;
      const repository = createPostgresKgRunRepository(executor);
      const claimed = await repository.claimBatch(workerA, 3, 30_000);
      expect(claimed).toHaveLength(3);

      expect(
        await repository.retry(
          claimed[0]!.id,
          workerA,
          'snapshot',
          { code: 'PROVIDER_HTTP_429', message: 'Transient provider failure' },
          5_000,
        ),
      ).toBe(true);
      expect(
        await repository.fail(
          claimed[1]!.id,
          workerA,
          'snapshot',
          { code: 'VALIDATION', message: 'Invalid provider response' },
        ),
      ).toBe(true);
      await sql`
        UPDATE kg_runs
        SET cancel_requested_at = now()
        WHERE id = ${claimed[2]!.id}
      `;
      expect(
        await repository.cancel(
          claimed[2]!.id,
          workerA,
          'snapshot',
        ),
      ).toBe(true);

      const rows = await sql<{
        id: string;
        status: string;
        locked_by: string | null;
        locked_until: string | null;
        next_attempt_at: string;
        failed_at: string | null;
        cancelled_at: string | null;
      }[]>`
        SELECT
          id,
          status,
          locked_by,
          locked_until,
          next_attempt_at,
          failed_at,
          cancelled_at
        FROM kg_runs
        WHERE id IN (${inserted[0]!.id}, ${inserted[1]!.id}, ${inserted[2]!.id})
        ORDER BY created_at
      `;
      expect(rows.map((row) => row.status)).toEqual([
        'queued',
        'failed',
        'cancelled',
      ]);
      expect(rows.every((row) => row.locked_by === null)).toBe(true);
      expect(rows.every((row) => row.locked_until === null)).toBe(true);
      expect(new Date(rows[0]!.next_attempt_at).getTime()).toBeGreaterThan(
        Date.now(),
      );
      expect(rows[1]!.failed_at).not.toBeNull();
      expect(rows[2]!.cancelled_at).not.toBeNull();
    } finally {
      await sql.end();
      await dropDisposableDatabase(databaseName);
    }
  },
);

integrationTest(
  'the future public cancellation operation closes queued work and signals processing work',
  async () => {
    const { databaseName, sql, executor } = await createDisposableDatabase();
    try {
      const userId = crypto.randomUUID();
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO kg_runs (user_id, deck_id, created_at)
        VALUES
          (${userId}, gen_random_uuid(), now() - interval '2 seconds'),
          (${userId}, gen_random_uuid(), now() - interval '1 second')
        RETURNING id
      `;
      const repository = createPostgresKgRunRepository(executor);
      const [processing] = await repository.claimBatch(workerA, 1, 30_000);

      expect(
        await requestKgRunCancellation(executor, inserted[1]!.id, userId),
      ).toBe('cancelled');
      expect(
        await requestKgRunCancellation(executor, processing!.id, userId),
      ).toBe('requested');
      expect(
        await repository.heartbeat(processing!.id, workerA, 30_000),
      ).toEqual({ owned: true, cancelRequested: true });
      expect(
        await repository.cancel(
          processing!.id,
          workerA,
          processing!.stage,
        ),
      ).toBe(true);
      expect(
        await requestKgRunCancellation(
          executor,
          processing!.id,
          crypto.randomUUID(),
        ),
      ).toBe('not_found');

      const statuses = await sql<{ status: string }[]>`
        SELECT status
        FROM kg_runs
        ORDER BY created_at
      `;
      expect(statuses.map((row) => row.status)).toEqual([
        'cancelled',
        'cancelled',
      ]);
    } finally {
      await sql.end();
      await dropDisposableDatabase(databaseName);
    }
  },
);

integrationTest(
  'crash recovery cancels abandoned requests and terminal-fails exhausted leases without touching live work',
  async () => {
    const { databaseName, sql, executor } = await createDisposableDatabase();
    try {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO kg_runs (
          deck_id,
          status,
          attempt_count,
          locked_by,
          locked_until,
          heartbeat_at,
          cancel_requested_at,
          created_at
        )
        VALUES
          (
            gen_random_uuid(),
            'processing',
            2,
            ${workerA},
            now() - interval '1 minute',
            now() - interval '2 minutes',
            now() - interval '90 seconds',
            now() - interval '4 minutes'
          ),
          (
            gen_random_uuid(),
            'processing',
            5,
            ${workerA},
            now() - interval '1 minute',
            now() - interval '2 minutes',
            NULL,
            now() - interval '3 minutes'
          ),
          (
            gen_random_uuid(),
            'processing',
            5,
            ${workerA},
            now() + interval '1 hour',
            now(),
            NULL,
            now() - interval '2 minutes'
          ),
          (
            gen_random_uuid(),
            'queued',
            0,
            NULL,
            NULL,
            NULL,
            now() - interval '1 minute',
            now() - interval '1 minute'
          )
        RETURNING id
      `;
      const repository = createPostgresKgRunRepository(executor);

      expect(await repository.recoverAbandoned()).toEqual({
        cancelled: 2,
        failed: 1,
      });

      const recovered = await sql<{
        id: string;
        status: string;
        locked_by: string | null;
        locked_until: string | null;
        failed_at: string | null;
        cancelled_at: string | null;
        error_code: string | null;
      }[]>`
        SELECT
          id,
          status,
          locked_by,
          locked_until,
          failed_at,
          cancelled_at,
          error_code
        FROM kg_runs
        ORDER BY created_at
      `;
      expect(recovered.map((row) => row.status)).toEqual([
        'cancelled',
        'failed',
        'processing',
        'cancelled',
      ]);
      expect(recovered[0]!.cancelled_at).not.toBeNull();
      expect(recovered[0]!.locked_by).toBeNull();
      expect(recovered[1]!.failed_at).not.toBeNull();
      expect(recovered[1]!.error_code).toBe('MAX_ATTEMPTS_EXHAUSTED');
      expect(recovered[1]!.locked_until).toBeNull();
      expect(recovered[2]!.locked_by).toBe(workerA);
      expect(recovered[3]!.cancelled_at).not.toBeNull();

      expect(await repository.claimBatch(workerB, 1, 30_000)).toEqual([]);
      expect(rows).toHaveLength(4);
    } finally {
      await sql.end();
      await dropDisposableDatabase(databaseName);
    }
  },
);

integrationTest(
  'snapshot persistence and stage advancement use one ownership/stage/cancellation CAS',
  async () => {
    const { databaseName, sql, executor } = await createDisposableDatabase();
    try {
      await sql`
        INSERT INTO kg_runs (deck_id, created_at)
        VALUES
          (gen_random_uuid(), now() - interval '3 seconds'),
          (gen_random_uuid(), now() - interval '2 seconds'),
          (gen_random_uuid(), now() - interval '1 second')
      `;
      const repository = createPostgresKgRunRepository(executor);
      const claimed = await repository.claimBatch(workerA, 3, 30_000);
      expect(claimed).toHaveLength(3);
      await sql`
        UPDATE kg_runs
        SET cancel_requested_at = now()
        WHERE id = ${claimed[2]!.id}
      `;

      expect(
        await repository.saveSnapshotAndAdvance(
          claimed[0]!.id,
          workerA,
          'snapshot',
          { version: 'deck-v2', cards: ['card-a'] },
          'indexing',
          { snapshotted: 1 },
          { cardsSeen: 1 },
        ),
      ).toBe(true);
      expect(
        await repository.saveSnapshotAndAdvance(
          claimed[0]!.id,
          workerA,
          'snapshot',
          { version: 'wrong-stage' },
          'indexing',
        ),
      ).toBe(false);
      expect(
        await repository.saveSnapshotAndAdvance(
          claimed[1]!.id,
          workerB,
          'snapshot',
          { version: 'wrong-owner' },
          'indexing',
        ),
      ).toBe(false);
      expect(
        await repository.saveSnapshotAndAdvance(
          claimed[2]!.id,
          workerA,
          'snapshot',
          { version: 'cancelled' },
          'indexing',
        ),
      ).toBe(false);

      const persisted = await sql<{
        id: string;
        stage: string;
        snapshot: { version?: string; cards?: string[] };
        progress: { snapshotted?: number };
        stats: { cardsSeen?: number };
      }[]>`
        SELECT id, stage, snapshot, progress, stats
        FROM kg_runs
        ORDER BY created_at
      `;
      expect(persisted[0]).toMatchObject({
        stage: 'indexing',
        snapshot: { version: 'deck-v2', cards: ['card-a'] },
        progress: { snapshotted: 1 },
        stats: { cardsSeen: 1 },
      });
      expect(persisted[1]).toMatchObject({
        stage: 'snapshot',
        snapshot: {},
      });
      expect(persisted[2]).toMatchObject({
        stage: 'snapshot',
        snapshot: {},
      });
    } finally {
      await sql.end();
      await dropDisposableDatabase(databaseName);
    }
  },
);

integrationTest(
  'a transition CAS loss can atomically finalize a cancellation request',
  async () => {
    const { databaseName, sql, executor } = await createDisposableDatabase();
    try {
      await sql`
        INSERT INTO kg_runs (deck_id)
        VALUES (gen_random_uuid())
      `;
      const repository = createPostgresKgRunRepository(executor);
      const [claimed] = await repository.claimBatch(workerA, 1, 30_000);
      await sql`
        UPDATE kg_runs
        SET cancel_requested_at = now()
        WHERE id = ${claimed!.id}
      `;

      expect(
        await repository.finish(
          claimed!.id,
          workerA,
          claimed!.stage,
          'completed',
          {},
          {},
        ),
      ).toBe(false);
      expect(
        await repository.finalizeCancellation(
          claimed!.id,
          workerA,
          claimed!.stage,
        ),
      ).toBe(true);

      const [row] = await sql<{
        status: string;
        locked_by: string | null;
        locked_until: string | null;
        cancelled_at: string | null;
      }[]>`
        SELECT status, locked_by, locked_until, cancelled_at
        FROM kg_runs
        WHERE id = ${claimed!.id}
      `;
      expect(row).toMatchObject({
        status: 'cancelled',
        locked_by: null,
        locked_until: null,
      });
      expect(row!.cancelled_at).not.toBeNull();
    } finally {
      await sql.end();
      await dropDisposableDatabase(databaseName);
    }
  },
);
