import { describe, expect, test } from 'bun:test';

import {
  writeLegacyCardEmbedding,
  type CardEmbeddingSqlClient,
} from '../../../src/modules/embedding/card-embedding-storage';
import {
  writeKgEmbeddingBatch,
  type KgEmbeddingWrite,
} from '../../../src/modules/knowledge-graph/kg-embedding.service';

const cardId = '00000000-0000-4000-8000-000000000001';
const vector = (value: number) =>
  Array.from({ length: 768 }, () => value);

type Metadata = {
  model: string;
  dimensions: number;
  representationVersion: string;
  contentHash: string;
};

type FakeState = {
  cardExists?: boolean;
  fields: Array<{ id: string; embedding: number[] | null }>;
  metadata: Metadata | null;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createFakeEmbeddingDb(initial: FakeState) {
  const state: FakeState = {
    cardExists: initial.cardExists ?? true,
    fields: initial.fields.map((field) => ({
      id: field.id,
      embedding: field.embedding ? [...field.embedding] : null,
    })),
    metadata: initial.metadata ? { ...initial.metadata } : null,
  };
  const events: string[] = [];
  const lockTails = new Map<string, Promise<void>>();
  let nextTransactionId = 1;
  let pauseNextLock:
    | { entered: ReturnType<typeof deferred>; resume: ReturnType<typeof deferred> }
    | undefined;

  async function acquireLock(key: string) {
    const previous = lockTails.get(key) ?? Promise.resolve();
    const released = deferred();
    const tail = previous.then(() => released.promise);
    lockTails.set(key, tail);
    await previous;
    return () => {
      released.resolve();
      if (lockTails.get(key) === tail) {
        void tail.then(() => lockTails.delete(key));
      }
    };
  }

  const client = Object.assign(
    async () => [],
    {
      async begin<T>(
        run: (sql: CardEmbeddingSqlClient) => Promise<T>,
      ): Promise<T> {
        const transactionId = nextTransactionId++;
        const releases: Array<() => void> = [];
        const lockedCards = new Set<string>();
        const transaction = Object.assign(
          async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ): Promise<Array<Record<string, unknown>>> => {
            const statement = strings.join('?').replace(/\s+/g, ' ').trim();

            if (
              statement.includes('FROM cards AS card') &&
              statement.includes('FOR KEY SHARE')
            ) {
              return state.cardExists ? [{ id: String(values[0]) }] : [];
            }

            if (
              statement.includes('FROM card_field_values') &&
              statement.includes('FOR UPDATE')
            ) {
              const selectedCardId = String(values[0]);
              events.push(`wait:${transactionId}`);
              const release = await acquireLock(selectedCardId);
              releases.push(release);
              lockedCards.add(selectedCardId);
              events.push(`lock:${transactionId}`);
              if (pauseNextLock) {
                const pause = pauseNextLock;
                pauseNextLock = undefined;
                pause.entered.resolve();
                await pause.resume.promise;
              }
              return state.fields
                .slice()
                .sort((left, right) => left.id.localeCompare(right.id))
                .map((field) => ({
                  id: field.id,
                  hasEmbedding: field.embedding !== null,
                }));
            }

            if (statement.includes('UPDATE card_field_values')) {
              const updatedCardId = String(values.at(-1));
              if (!lockedCards.has(updatedCardId)) {
                throw new Error('vector write without SELECT FOR UPDATE');
              }
              const targetId = String(values[0]);
              const nextVector = JSON.parse(String(values[1])) as number[];
              for (const field of state.fields) {
                field.embedding = field.id === targetId ? nextVector : null;
              }
              events.push(`vector:${transactionId}`);
              return [{ id: targetId }];
            }

            if (
              statement.includes('FROM card_embedding_metadata AS metadata')
            ) {
              return state.metadata ? [{ id: String(values[0]) }] : [];
            }

            if (statement.includes('DELETE FROM card_embedding_metadata')) {
              const metadataCardId = String(values[0]);
              if (!lockedCards.has(metadataCardId)) {
                throw new Error('metadata delete without SELECT FOR UPDATE');
              }
              state.metadata = null;
              events.push(`metadata-delete:${transactionId}`);
              return [];
            }

            if (statement.includes('INSERT INTO card_embedding_metadata')) {
              const metadataCardId = String(values[0]);
              if (!lockedCards.has(metadataCardId)) {
                throw new Error('metadata write without SELECT FOR UPDATE');
              }
              state.metadata = {
                model: String(values[1]),
                dimensions: Number(values[2]),
                representationVersion: String(values[3]),
                contentHash: String(values[4]),
              };
              events.push(`metadata-upsert:${transactionId}`);
              return [];
            }

            return [];
          },
          {
            begin: client.begin,
          },
        ) as CardEmbeddingSqlClient;

        try {
          return await run(transaction);
        } finally {
          for (const release of releases.reverse()) release();
          events.push(`commit:${transactionId}`);
        }
      },
    },
  ) as CardEmbeddingSqlClient;

  return {
    client,
    events,
    state,
    pauseNextTransactionAtLock() {
      const entered = deferred();
      const resume = deferred();
      pauseNextLock = { entered, resume };
      return { entered: entered.promise, resume: resume.resolve };
    },
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

const validMetadata: Metadata = {
  model: 'gemini-embedding-2',
  dimensions: 768,
  representationVersion: 'v1',
  contentHash: 'a'.repeat(64),
};

describe('card embedding storage', () => {
  test('returns before touching child rows when the card parent is gone', async () => {
    const fake = createFakeEmbeddingDb({
      cardExists: false,
      fields: [{ id: 'field-a', embedding: vector(0.2) }],
      metadata: validMetadata,
    });

    expect(
      await writeLegacyCardEmbedding(cardId, vector(0.3), false, fake.client),
    ).toBe(false);
    expect(fake.events).toEqual(['commit:1']);
    expect(fake.state.fields[0].embedding?.[0]).toBe(0.2);
    expect(fake.state.metadata).toEqual(validMetadata);
  });

  test('legacy writes never overwrite a provenance-backed KG vector', async () => {
    const fake = createFakeEmbeddingDb({
      fields: [
        { id: 'field-b', embedding: vector(0.2) },
        { id: 'field-a', embedding: null },
      ],
      metadata: validMetadata,
    });

    expect(
      await writeLegacyCardEmbedding(cardId, vector(0.3), true, fake.client),
    ).toBe(false);
    expect(fake.state.metadata).toEqual(validMetadata);
    expect(fake.state.fields.find((field) => field.id === 'field-b')?.embedding?.[0])
      .toBe(0.2);

    expect(
      await writeLegacyCardEmbedding(cardId, vector(0.4), false, fake.client),
    ).toBe(false);
    expect(fake.state.metadata).toEqual(validMetadata);
    expect(
      fake.state.fields.filter((field) => field.embedding !== null),
    ).toEqual([
      {
        id: 'field-b',
        embedding: vector(0.2),
      },
    ]);
  });

  test('serializes races so a KG representation wins in either order', async () => {
    const kgFirst = createFakeEmbeddingDb({
      fields: [
        { id: 'field-a', embedding: null },
        { id: 'field-b', embedding: null },
      ],
      metadata: null,
    });
    const pausedKg = kgFirst.pauseNextTransactionAtLock();
    const kgPromise = writeKgEmbeddingBatch([kgWrite(0.5)], kgFirst.client);
    const kgLocked = await Promise.race([
      pausedKg.entered.then(() => true),
      kgPromise.then(
        () => false,
        () => false,
      ),
    ]);
    expect(kgLocked).toBe(true);
    const legacyPromise = writeLegacyCardEmbedding(
      cardId,
      vector(0.6),
      false,
      kgFirst.client,
    );
    await Promise.resolve();
    expect(kgFirst.events).not.toContain('lock:2');
    pausedKg.resume();
    await Promise.all([kgPromise, legacyPromise]);

    expect(kgFirst.state.metadata).toEqual(validMetadata);
    expect(
      kgFirst.state.fields.filter((field) => field.embedding !== null),
    ).toEqual([{ id: 'field-a', embedding: vector(0.5) }]);

    const legacyFirst = createFakeEmbeddingDb({
      fields: [
        { id: 'field-a', embedding: null },
        { id: 'field-b', embedding: null },
      ],
      metadata: null,
    });
    const pausedLegacy = legacyFirst.pauseNextTransactionAtLock();
    const firstLegacyPromise = writeLegacyCardEmbedding(
      cardId,
      vector(0.7),
      false,
      legacyFirst.client,
    );
    const legacyLocked = await Promise.race([
      pausedLegacy.entered.then(() => true),
      firstLegacyPromise.then(
        () => false,
        () => false,
      ),
    ]);
    expect(legacyLocked).toBe(true);
    const secondKgPromise = writeKgEmbeddingBatch(
      [kgWrite(0.8)],
      legacyFirst.client,
    );
    await Promise.resolve();
    expect(legacyFirst.events).not.toContain('lock:2');
    pausedLegacy.resume();
    await Promise.all([firstLegacyPromise, secondKgPromise]);

    expect(legacyFirst.state.metadata).toEqual(validMetadata);
    expect(
      legacyFirst.state.fields.filter((field) => field.embedding !== null),
    ).toEqual([{ id: 'field-a', embedding: vector(0.8) }]);
  });

  test('KG writes repair duplicate vectors to one deterministic field row', async () => {
    const fake = createFakeEmbeddingDb({
      fields: [
        { id: 'field-b', embedding: vector(0.1) },
        { id: 'field-a', embedding: vector(0.2) },
      ],
      metadata: validMetadata,
    });

    await writeKgEmbeddingBatch([kgWrite(0.9)], fake.client);

    expect(
      fake.state.fields.filter((field) => field.embedding !== null),
    ).toEqual([{ id: 'field-a', embedding: vector(0.9) }]);
    expect(fake.state.metadata).toEqual(validMetadata);
  });
});
