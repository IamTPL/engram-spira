import { describe, expect, test } from 'bun:test';

import {
  buildKgEmbeddingRepresentation,
  ensureKgEmbeddings,
  isKgEmbeddingReusable,
  writeKgEmbeddingBatch,
  type CardEmbeddingState,
  type KgEmbeddingSqlClient,
} from '../../../src/modules/knowledge-graph/kg-embedding.service';
import type { VocabularyArtifact } from '../../../src/modules/knowledge-graph/vocabulary-artifact';

const contentHash = 'a'.repeat(64);
const artifact: VocabularyArtifact = {
  cardId: '00000000-0000-4000-8000-000000000001',
  sourceLanguageTag: 'vi',
  definitionLanguageTag: 'en',
  lemma: 'ăn',
  normalizedLemma: 'ăn',
  partOfSpeech: 'verb',
  definition: 'to eat',
  normalizedDefinition: 'to eat',
  ipa: '/an/',
  examples: ['Tôi ăn cơm.', 'Bạn ăn chưa?'],
  contentHash,
  representationVersion: 'v1',
};

const embedding = (value = 0.1) =>
  Array.from({ length: 768 }, () => value);

function validState(
  overrides: Partial<CardEmbeddingState> = {},
): CardEmbeddingState {
  return {
    cardId: artifact.cardId,
    embeddingCount: 1,
    model: 'gemini-embedding-2',
    dimensions: 768,
    representationVersion: 'v1',
    contentHash,
    ...overrides,
  };
}

describe('KG embedding representation and provenance', () => {
  test('builds an exact deterministic v1 semantic-similarity representation', () => {
    expect(buildKgEmbeddingRepresentation(artifact)).toBe(
      'task: semantic similarity\n' +
        'input: {"representationVersion":"v1","sourceLanguageTag":"vi",' +
        '"definitionLanguageTag":"en","lemma":"ăn","normalizedLemma":"ăn",' +
        '"partOfSpeech":"verb","definition":"to eat",' +
        '"normalizedDefinition":"to eat","ipa":"/an/",' +
        '"examples":["Tôi ăn cơm.","Bạn ăn chưa?"]}',
    );
  });

  test('reuses only a present vector with exact card and provenance metadata', () => {
    expect(isKgEmbeddingReusable(artifact, validState())).toBe(true);

    const staleStates: Array<CardEmbeddingState | null> = [
      null,
      validState({ embeddingCount: 0 }),
      validState({ cardId: '00000000-0000-4000-8000-000000000099' }),
      validState({ model: 'gemini-embedding-001' }),
      validState({ dimensions: 1_536 }),
      validState({ representationVersion: 'v0' }),
      validState({ contentHash: 'b'.repeat(64) }),
    ];
    for (const state of staleStates) {
      expect(isKgEmbeddingReusable(artifact, state)).toBe(false);
    }

    const duplicateVectorState = {
      ...validState(),
      embeddingCount: 2,
    };
    expect(isKgEmbeddingReusable(artifact, duplicateVectorState)).toBe(false);
  });

  test('uses a warm cache without calling the provider or writer', async () => {
    let providerCalls = 0;
    let writerCalls = 0;

    const result = await ensureKgEmbeddings([artifact], {
      loadStates: async () => [validState()],
      embedTexts: async () => {
        providerCalls++;
        return {
          value: [embedding()],
          usage: { inputTokens: null, outputTokens: null },
        };
      },
      writeBatch: async () => {
        writerCalls++;
      },
    });

    expect(result).toEqual({
      embedded: 0,
      reused: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect(providerCalls).toBe(0);
    expect(writerCalls).toBe(0);
  });

  test('embeds only stale cards in requests of at most 50 inputs', async () => {
    const artifacts = Array.from({ length: 121 }, (_, index) => ({
      ...artifact,
      cardId: `card-${index}`,
      contentHash: index.toString(16).padStart(64, '0'),
    }));
    const requestSizes: number[] = [];
    const persistedCardIds: string[] = [];

    const result = await ensureKgEmbeddings(artifacts, {
      loadStates: async () => [],
      embedTexts: async (inputs) => {
        requestSizes.push(inputs.length);
        return {
          value: inputs.map((_, index) => embedding(index / 1_000)),
          usage: { inputTokens: inputs.length, outputTokens: null },
        };
      },
      writeBatch: async (entries) => {
        persistedCardIds.push(...entries.map((entry) => entry.cardId));
      },
    });

    expect(requestSizes).toEqual([50, 50, 21]);
    expect(persistedCardIds).toEqual(artifacts.map((item) => item.cardId));
    expect(result).toEqual({
      embedded: 121,
      reused: 0,
      usage: { inputTokens: 121, outputTokens: null },
    });
  });

  test('returns null aggregate usage when any provider batch is unknown', async () => {
    const artifacts = Array.from({ length: 51 }, (_, index) => ({
      ...artifact,
      cardId: `card-${index}`,
      contentHash: index.toString(16).padStart(64, '0'),
    }));
    let batchIndex = 0;

    const result = await ensureKgEmbeddings(artifacts, {
      loadStates: async () => [],
      embedTexts: async (inputs) => {
        const usage =
          batchIndex++ === 0
            ? { inputTokens: null, outputTokens: 7 }
            : { inputTokens: 5, outputTokens: null };
        return {
          value: inputs.map(() => embedding()),
          usage,
        };
      },
      writeBatch: async () => {},
    });

    expect(result.usage).toEqual({
      inputTokens: null,
      outputTokens: null,
    });
  });

  test('rolls back vector and metadata writes together when a batch entry fails', async () => {
    const committed: string[] = [];
    let staged: string[] = [];
    const transactionTag = Object.assign(
      async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<Array<{ id: string; hasEmbedding?: boolean }>> => {
        const statement = strings.join('?');
        if (
          statement.includes('FROM cards AS card') &&
          statement.includes('FOR KEY SHARE')
        ) {
          return [{ id: String(values[0]) }];
        }
        if (
          statement.includes('FROM card_field_values') &&
          statement.includes('FOR UPDATE')
        ) {
          return [{ id: `field-${String(values[0])}`, hasEmbedding: false }];
        }
        if (statement.includes('UPDATE card_field_values')) {
          staged.push(`vector:${String(values[2])}`);
          return [{ id: 'field-value' }];
        }
        if (statement.includes('INSERT INTO card_embedding_metadata')) {
          const cardId = String(values[0]);
          if (cardId.endsWith('2')) throw new Error('metadata write failed');
          staged.push(`metadata:${cardId}`);
        }
        return [];
      },
      {
        async begin<T>(run: (sql: KgEmbeddingSqlClient) => Promise<T>) {
          staged = [];
          try {
            const result = await run(transactionTag as KgEmbeddingSqlClient);
            committed.push(...staged);
            return result;
          } catch (error) {
            staged = [];
            throw error;
          }
        },
      },
    ) as KgEmbeddingSqlClient;

    await expect(
      writeKgEmbeddingBatch(
        [
          {
            cardId: 'card-1',
            embedding: embedding(0.1),
            model: 'gemini-embedding-2',
            dimensions: 768,
            representationVersion: 'v1',
            contentHash: '1'.repeat(64),
          },
          {
            cardId: 'card-2',
            embedding: embedding(0.2),
            model: 'gemini-embedding-2',
            dimensions: 768,
            representationVersion: 'v1',
            contentHash: '2'.repeat(64),
          },
        ],
        transactionTag,
      ),
    ).rejects.toThrow('metadata write failed');

    expect(committed).toEqual([]);
  });

  test('rejects malformed vectors before opening a database transaction', async () => {
    let transactions = 0;
    const sqlClient = Object.assign(
      async () => [],
      {
        async begin<T>(run: (sql: KgEmbeddingSqlClient) => Promise<T>) {
          transactions++;
          return run(sqlClient as KgEmbeddingSqlClient);
        },
      },
    ) as KgEmbeddingSqlClient;

    await expect(
      writeKgEmbeddingBatch(
        [
          {
            cardId: artifact.cardId,
            embedding: embedding().slice(1),
            model: 'gemini-embedding-2',
            dimensions: 768,
            representationVersion: 'v1',
            contentHash,
          },
        ],
        sqlClient,
      ),
    ).rejects.toThrow('Invalid Gemini embedding response');
    await expect(
      writeKgEmbeddingBatch(
        [
          {
            cardId: artifact.cardId,
            embedding: Array.from({ length: 768 }, () => 0),
            model: 'gemini-embedding-2',
            dimensions: 768,
            representationVersion: 'v1',
            contentHash,
          },
        ],
        sqlClient,
      ),
    ).rejects.toThrow('non-zero norm');
    expect(transactions).toBe(0);
  });
});
