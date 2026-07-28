import { afterAll, expect, test } from 'bun:test';
import postgres from 'postgres';

import { createPostgresKgRunsRepository } from '../../../src/modules/knowledge-graph/kg-runs.repository';
import type { EnqueueDeckRunInput } from '../../../src/modules/knowledge-graph/kg-runs.service';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const databases = new Set<string>();
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

function assertDatabaseName(databaseName: string) {
  if (!/^engram_kg_runs_test_[a-f0-9]+$/.test(databaseName)) {
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
    `engram_kg_runs_test_${crypto.randomUUID().replaceAll('-', '')}`;
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
  await sql`CREATE TABLE decks (id uuid PRIMARY KEY, user_id uuid NOT NULL)`;
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
    CREATE UNIQUE INDEX uq_kg_runs_active_deck
    ON kg_runs (user_id, deck_id)
    WHERE deck_id IS NOT NULL
      AND status IN ('queued', 'processing')
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

function enqueueInput(
  userId: string,
  deckId: string,
  fingerprint = 'f'.repeat(64),
): EnqueueDeckRunInput {
  return {
    userId,
    deckId,
    fingerprint,
    representationVersion: 'v1',
    embeddingModel: 'gemini-embedding-2',
    promptVersion: 'kg-relations-v1',
    taxonomyVersion: 'lexical-relations-v1',
    sourceLanguageTag: 'en',
    definitionLanguageTag: 'vi',
    snapshot: {
      representationVersion: 'v1',
      cards: [],
      snapshotHash: 'a'.repeat(64),
    },
  };
}

integrationTest(
  'reuses completed fingerprints and atomically coalesces concurrent active deck runs',
  async () => {
    const { databaseName, sql } = await createDatabase();
    try {
      const userId = id(1);
      const deckId = id(2);
      await sql`INSERT INTO users (id) VALUES (${userId})`;
      await sql`INSERT INTO decks (id, user_id) VALUES (${deckId}, ${userId})`;
      const repository = createPostgresKgRunsRepository(sql);

      const [first, second] = await Promise.all([
        repository.enqueueDeckRun(enqueueInput(userId, deckId)),
        repository.enqueueDeckRun(enqueueInput(userId, deckId)),
      ]);
      expect([first.reused, second.reused].sort()).toEqual([false, true]);
      expect(first.run.id).toBe(second.run.id);
      expect(
        await sql`SELECT id FROM kg_runs WHERE status = 'queued'`,
      ).toHaveLength(1);

      await sql`
        UPDATE kg_runs
        SET status = 'completed', completed_at = now()
        WHERE id = ${first.run.id}
      `;
      const completed = await repository.enqueueDeckRun(
        enqueueInput(userId, deckId),
      );
      expect(completed).toMatchObject({
        reused: true,
        run: { id: first.run.id, status: 'completed' },
      });
      expect(await sql`SELECT id FROM kg_runs`).toHaveLength(1);
    } finally {
      await sql.end();
      await dropDatabase(databaseName);
    }
  },
);

integrationTest(
  'scopes get/cancel by user and makes queued, processing, and terminal cancellation idempotent',
  async () => {
    const { databaseName, sql } = await createDatabase();
    try {
      const userId = id(1);
      const otherUserId = id(2);
      const deckId = id(3);
      await sql`
        INSERT INTO users (id) VALUES (${userId}), (${otherUserId})
      `;
      await sql`INSERT INTO decks (id, user_id) VALUES (${deckId}, ${userId})`;
      const repository = createPostgresKgRunsRepository(sql);

      const queued = await repository.enqueueDeckRun(
        enqueueInput(userId, deckId),
      );
      expect(
        await repository.cancelOwnedRun(userId, queued.run.id),
      ).toMatchObject({ status: 'cancelled' });
      expect(
        await repository.cancelOwnedRun(userId, queued.run.id),
      ).toMatchObject({ status: 'cancelled' });

      const processing = await repository.enqueueDeckRun(
        enqueueInput(userId, deckId, 'e'.repeat(64)),
      );
      await sql`
        UPDATE kg_runs
        SET status = 'processing', locked_by = ${id(99)}
        WHERE id = ${processing.run.id}
      `;
      const requested = await repository.cancelOwnedRun(
        userId,
        processing.run.id,
      );
      expect(requested.status).toBe('processing');
      const cancellation = await sql<{ cancelRequestedAt: Date | null }[]>`
        SELECT cancel_requested_at AS "cancelRequestedAt"
        FROM kg_runs
        WHERE id = ${processing.run.id}
      `;
      expect(cancellation[0]?.cancelRequestedAt).not.toBeNull();

      await expect(
        repository.getOwnedRun(otherUserId, processing.run.id),
      ).rejects.toThrow('Knowledge graph run not found');
      await expect(
        repository.cancelOwnedRun(otherUserId, processing.run.id),
      ).rejects.toThrow('Knowledge graph run not found');
    } finally {
      await sql.end();
      await dropDatabase(databaseName);
    }
  },
);
