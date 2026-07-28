import { afterAll, expect, test } from 'bun:test';
import postgres, { type Sql } from 'postgres';

import {
  writeLegacyCardEmbedding,
  type CardEmbeddingSqlClient,
} from '../../../src/modules/embedding/card-embedding-storage';
import {
  writeKgEmbeddingBatch,
  type KgEmbeddingWrite,
} from '../../../src/modules/knowledge-graph/kg-embedding.service';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const cardId = '00000000-0000-4000-8000-000000000001';
const firstFieldId = '00000000-0000-4000-8000-000000000011';
const secondFieldId = '00000000-0000-4000-8000-000000000012';
const createdDatabases = new Set<string>();
const vector = (value: number) =>
  Array.from({ length: 768 }, () => value);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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
  if (!/^engram_embedding_test_[a-f0-9]+$/.test(databaseName)) {
    throw new Error(`Refusing unsafe disposable database name: ${databaseName}`);
  }
}

async function createDisposableDatabase() {
  const databaseName =
    `engram_embedding_test_${crypto.randomUUID().replaceAll('-', '')}`;
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
      max: 4,
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

afterAll(async () => {
  for (const databaseName of [...createdDatabases]) {
    await dropDisposableDatabase(databaseName);
  }
});

function controlledClient(sql: Sql, pauseAfterLock: boolean) {
  const beforeParentLock = deferred();
  const afterParentLock = deferred();
  const beforeLock = deferred();
  const afterLock = deferred();
  const resume = deferred();
  const execute = sql as unknown as CardEmbeddingSqlClient;
  const client = (async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => execute(strings, ...values)) as unknown as CardEmbeddingSqlClient;

  client.begin = async <T>(
    run: (transaction: CardEmbeddingSqlClient) => Promise<T>,
  ) =>
    sql.begin(async (transaction) => {
      const executeTransaction =
        transaction as unknown as CardEmbeddingSqlClient;
      await executeTransaction`SET LOCAL deadlock_timeout = '50ms'`;
      const transactionClient = (async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const statement = strings.join('?');
        const isParentLock =
          statement.includes('FROM cards AS card') &&
          statement.includes('FOR KEY SHARE');
        const isCardLock =
          statement.includes('FROM card_field_values') &&
          statement.includes('FOR UPDATE');
        if (isParentLock) beforeParentLock.resolve();
        if (isCardLock) beforeLock.resolve();
        const result = await executeTransaction(strings, ...values);
        if (isParentLock) afterParentLock.resolve();
        if (isCardLock) {
          afterLock.resolve();
          if (pauseAfterLock) await resume.promise;
        }
        return result;
      }) as unknown as CardEmbeddingSqlClient;
      transactionClient.begin = client.begin;
      return run(transactionClient);
    }) as Promise<T>;

  return {
    client,
    beforeParentLock: beforeParentLock.promise,
    afterParentLock: afterParentLock.promise,
    beforeLock: beforeLock.promise,
    afterLock: afterLock.promise,
    resume: resume.resolve,
  };
}

function kgWrite(value: number): KgEmbeddingWrite {
  return {
    cardId,
    embedding: vector(value),
    model: 'gemini-embedding-2',
    dimensions: 768,
    representationVersion: 'v1',
    contentHash: 'a'.repeat(64),
  };
}

async function resetCard(sql: Sql, duplicateVectors = false) {
  await sql`DELETE FROM cards`;
  await sql`INSERT INTO cards (id) VALUES (${cardId})`;
  const firstVector = duplicateVectors ? `[${vector(0.1).join(',')}]` : null;
  const secondVector = duplicateVectors ? `[${vector(0.2).join(',')}]` : null;
  await sql`
    INSERT INTO card_field_values (id, card_id, embedding)
    VALUES
      (${firstFieldId}, ${cardId}, ${firstVector}::vector),
      (${secondFieldId}, ${cardId}, ${secondVector}::vector)
  `;
}

async function readCardState(sql: Sql) {
  const cards = await sql<{ id: string }[]>`
    SELECT id
    FROM cards
    WHERE id = ${cardId}
  `;
  const fields = await sql<{ id: string; embedding: string | null }[]>`
    SELECT id, embedding::text AS embedding
    FROM card_field_values
    WHERE card_id = ${cardId}
    ORDER BY id
  `;
  const metadata = await sql<{
    model: string;
    dimensions: number;
    representation_version: string;
    content_hash: string;
  }[]>`
    SELECT model, dimensions, representation_version, content_hash
    FROM card_embedding_metadata
    WHERE card_id = ${cardId}
  `;
  return {
    cards: [...cards],
    fields: [...fields],
    metadata: [...metadata],
  };
}

function firstCoordinate(embedding: string) {
  return Number(embedding.slice(1).split(',', 1)[0]);
}

async function createEmbeddingSchema(sql: Sql) {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`
    CREATE TABLE cards (
      id uuid PRIMARY KEY
    )
  `;
  await sql`
    CREATE TABLE card_field_values (
      id uuid PRIMARY KEY,
      card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      embedding vector(768)
    )
  `;
  await sql`
    CREATE TABLE card_embedding_metadata (
      card_id uuid PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
      model varchar(100) NOT NULL,
      dimensions integer NOT NULL,
      representation_version varchar(20) NOT NULL,
      content_hash varchar(64) NOT NULL,
      embedded_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function waitForBlockedDelete(sql: Sql, backendPid: number) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const activity = await sql<{
      query: string;
      wait_event_type: string | null;
    }[]>`
      SELECT query, wait_event_type
      FROM pg_stat_activity
      WHERE pid = ${backendPid}
    `;
    if (
      activity[0]?.query.includes('DELETE FROM cards') &&
      activity[0].wait_event_type === 'Lock'
    ) {
      return;
    }
    await Bun.sleep(5);
  }
  throw new Error('Timed out waiting for the card delete to block');
}

integrationTest(
  'real PostgreSQL locks serialize both writers and repair duplicate vectors',
  async () => {
    const { databaseName, sql } = await createDisposableDatabase();
    try {
      await createEmbeddingSchema(sql);

      await resetCard(sql, true);
      await writeKgEmbeddingBatch(
        [kgWrite(0.4)],
        sql as unknown as CardEmbeddingSqlClient,
      );
      const repaired = await readCardState(sql);
      const repairedVectors = repaired.fields.filter(
        (field) => field.embedding !== null,
      );
      expect(repairedVectors).toHaveLength(1);
      expect(repairedVectors[0].id).toBe(firstFieldId);
      expect(firstCoordinate(repairedVectors[0].embedding!)).toBeCloseTo(0.4);

      await resetCard(sql);
      const pausedKg = controlledClient(sql, true);
      const kgFirst = writeKgEmbeddingBatch([kgWrite(0.5)], pausedKg.client);
      await pausedKg.afterLock;
      const waitingLegacy = controlledClient(sql, false);
      let legacySettled = false;
      const legacyLast = writeLegacyCardEmbedding(
        cardId,
        vector(0.6),
        false,
        waitingLegacy.client,
      ).finally(() => {
        legacySettled = true;
      });
      await waitingLegacy.beforeLock;
      expect(legacySettled).toBe(false);
      pausedKg.resume();
      await Promise.all([kgFirst, legacyLast]);

      const legacyFinal = await readCardState(sql);
      const legacyVectors = legacyFinal.fields.filter(
        (field) => field.embedding !== null,
      );
      expect(legacyVectors).toHaveLength(1);
      expect(legacyVectors[0].id).toBe(firstFieldId);
      expect(firstCoordinate(legacyVectors[0].embedding!)).toBeCloseTo(0.5);
      expect(legacyFinal.metadata).toEqual([
        {
          model: 'gemini-embedding-2',
          dimensions: 768,
          representation_version: 'v1',
          content_hash: 'a'.repeat(64),
        },
      ]);

      await resetCard(sql);
      const pausedLegacy = controlledClient(sql, true);
      const legacyFirst = writeLegacyCardEmbedding(
        cardId,
        vector(0.7),
        false,
        pausedLegacy.client,
      );
      await pausedLegacy.afterLock;
      const waitingKg = controlledClient(sql, false);
      let kgSettled = false;
      const kgLast = writeKgEmbeddingBatch(
        [kgWrite(0.8)],
        waitingKg.client,
      ).finally(() => {
        kgSettled = true;
      });
      await waitingKg.beforeLock;
      expect(kgSettled).toBe(false);
      pausedLegacy.resume();
      await Promise.all([legacyFirst, kgLast]);

      const kgFinal = await readCardState(sql);
      const kgVectors = kgFinal.fields.filter(
        (field) => field.embedding !== null,
      );
      expect(kgVectors).toHaveLength(1);
      expect(kgVectors[0].id).toBe(firstFieldId);
      expect(firstCoordinate(kgVectors[0].embedding!)).toBeCloseTo(0.8);
      expect(kgFinal.metadata).toEqual([
        {
          model: 'gemini-embedding-2',
          dimensions: 768,
          representation_version: 'v1',
          content_hash: 'a'.repeat(64),
        },
      ]);
    } finally {
      await sql.end();
      await dropDisposableDatabase(databaseName);
    }
  },
);

integrationTest(
  'locks the card parent before child rows so a concurrent delete cannot deadlock',
  async () => {
    const { databaseName, sql } = await createDisposableDatabase();
    const parentLocked = deferred();
    const continueDelete = deferred();
    let deleteBackendPid = 0;
    let deleteCard: Promise<unknown> | undefined;
    let writeEmbedding: Promise<unknown> | undefined;
    let writer: ReturnType<typeof controlledClient> | undefined;

    try {
      await createEmbeddingSchema(sql);
      await resetCard(sql);

      deleteCard = sql.begin(async (transaction) => {
        const executeTransaction = transaction as unknown as Sql;
        await executeTransaction`SET LOCAL deadlock_timeout = '50ms'`;
        const backend = await executeTransaction<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid
        `;
        deleteBackendPid = backend[0].pid;
        await executeTransaction`
          SELECT id
          FROM cards
          WHERE id = ${cardId}
          FOR UPDATE
        `;
        parentLocked.resolve();
        await continueDelete.promise;
        await executeTransaction`
          DELETE FROM cards
          WHERE id = ${cardId}
        `;
      });
      await parentLocked.promise;

      writer = controlledClient(sql, true);
      writeEmbedding = writeKgEmbeddingBatch([kgWrite(0.9)], writer.client);
      const firstWriterLock = await Promise.race([
        writer.beforeParentLock.then(() => 'parent' as const),
        writer.afterLock.then(() => 'child' as const),
      ]);

      continueDelete.resolve();
      if (firstWriterLock === 'child') {
        await waitForBlockedDelete(sql, deleteBackendPid);
      }
      writer.resume();

      const [deleteOutcome, writeOutcome] = await Promise.allSettled([
        deleteCard,
        writeEmbedding,
      ]);
      const outcomes = [deleteOutcome, writeOutcome];
      expect(
        outcomes.some(
          (outcome) =>
            outcome.status === 'rejected' &&
            (outcome.reason as { code?: string }).code === '40P01',
        ),
      ).toBe(false);
      expect(deleteOutcome.status).toBe('fulfilled');
      expect(writeOutcome.status).toBe('rejected');
      if (writeOutcome.status === 'rejected') {
        expect(writeOutcome.reason).toMatchObject({
          name: 'ValidationError',
          message: 'Card embedding target not found',
        });
      }

      const finalState = await readCardState(sql);
      expect(finalState).toEqual({
        cards: [],
        fields: [],
        metadata: [],
      });
    } finally {
      continueDelete.resolve();
      writer?.resume();
      await Promise.allSettled(
        [deleteCard, writeEmbedding].filter(
          (operation): operation is Promise<unknown> => operation !== undefined,
        ),
      );
      await sql.end();
      await dropDisposableDatabase(databaseName);
    }
  },
  10_000,
);
