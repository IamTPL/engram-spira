import { describe, expect, test } from 'bun:test';

import {
  createDeckKnowledgeGraphRun,
  getKnowledgeGraphRun,
  cancelKnowledgeGraphRun,
  type KgRunRecord,
  type KgRunRepository,
} from '../../../src/modules/knowledge-graph/kg-runs.service';
import type { DeckIndexingRepository } from '../../../src/modules/knowledge-graph/kg-indexing.service';

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

function indexingRepository(): DeckIndexingRepository {
  return {
    async loadDeckSource(_userId, deckId) {
      return {
        deckId,
        templateId: id(10),
        templateFields: [
          { id: id(11), name: 'word' },
          { id: id(12), name: 'definition' },
        ],
        cards: [
          {
            cardId: id(20),
            fieldValues: [
              { templateFieldId: id(11), value: 'Bank' },
              { templateFieldId: id(12), value: 'Ngân hàng' },
            ],
          },
        ],
      };
    },
    async transaction(_userId, operation) {
      return operation({
        loadDeckSource: async () => {
          throw new Error('not used');
        },
        persistPlan: async () => {
          throw new Error('not used');
        },
      });
    },
  };
}

function runRecord(
  overrides: Partial<KgRunRecord> = {},
): KgRunRecord {
  return {
    id: id(100),
    userId: id(1),
    runType: 'deck_index',
    deckId: id(2),
    focusSenseId: null,
    status: 'queued',
    stage: 'snapshot',
    fingerprint: 'f'.repeat(64),
    representationVersion: 'v1',
    embeddingModel: 'gemini-embedding-2',
    promptVersion: 'kg-relations-v1',
    taxonomyVersion: 'lexical-relations-v1',
    sourceLanguageTag: 'en',
    definitionLanguageTag: 'vi',
    snapshot: {},
    progress: {},
    stats: {},
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-07-27T00:00:00.000Z'),
    ...overrides,
  };
}

function repository(
  enqueueResult: { run: KgRunRecord; reused: boolean },
): KgRunRepository & {
  enqueued: Parameters<KgRunRepository['enqueueDeckRun']>[0][];
} {
  const enqueued: Parameters<KgRunRepository['enqueueDeckRun']>[0][] = [];
  return {
    enqueued,
    async enqueueDeckRun(input) {
      enqueued.push(input);
      return enqueueResult;
    },
    async enqueueSenseExpansionRun() {
      throw new Error('not used');
    },
    async getOwnedRun() {
      return enqueueResult.run;
    },
    async cancelOwnedRun() {
      return { ...enqueueResult.run, status: 'cancelled' };
    },
  };
}

describe('KG run service', () => {
  test('canonicalizes languages, fingerprints the exact snapshot/version tuple, and wakes only a new run', async () => {
    const store = repository({ run: runRecord(), reused: false });
    let wakes = 0;

    const response = await createDeckKnowledgeGraphRun(
      id(1),
      {
        deckId: id(2),
        sourceLanguageTag: 'EN-us',
        definitionLanguageTag: 'VI',
      },
      {
        indexingRepository: indexingRepository(),
        runRepository: store,
        embeddingModel: 'gemini-embedding-2',
        wakeWorker: () => {
          wakes++;
        },
      },
    );

    expect(response).toEqual({
      runId: id(100),
      status: 'queued',
      reused: false,
    });
    expect(wakes).toBe(1);
    expect(store.enqueued).toHaveLength(1);
    expect(store.enqueued[0]).toMatchObject({
      userId: id(1),
      deckId: id(2),
      sourceLanguageTag: 'en-US',
      definitionLanguageTag: 'vi',
      representationVersion: 'v1',
      embeddingModel: 'gemini-embedding-2',
      promptVersion: 'kg-relations-v1',
      taxonomyVersion: 'lexical-relations-v1',
      snapshot: {
        representationVersion: 'v1',
        cards: [{ cardId: id(20) }],
      },
    });
    expect(store.enqueued[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test('returns exact reused completed/active run without waking the worker', async () => {
    const completed = runRecord({ status: 'completed' });
    const store = repository({ run: completed, reused: true });
    let wakes = 0;

    const response = await createDeckKnowledgeGraphRun(
      id(1),
      {
        deckId: id(2),
        sourceLanguageTag: 'en',
        definitionLanguageTag: 'vi',
      },
      {
        indexingRepository: indexingRepository(),
        runRepository: store,
        embeddingModel: 'gemini-embedding-2',
        wakeWorker: () => {
          wakes++;
        },
      },
    );

    expect(response).toEqual({
      runId: completed.id,
      status: 'completed',
      reused: true,
    });
    expect(wakes).toBe(0);
  });

  test('returns the exact public run DTO without lease, snapshot, or fingerprint internals', async () => {
    const store = repository({
      run: runRecord({
        status: 'partial',
        stage: 'persistence',
        progress: { completed: 12, total: 20 },
        stats: {
          cards: 20,
          indexedSenses: 20,
          candidates: 12,
          verified: 10,
          suggestions: 8,
          coveredNodes: 18,
          embeddingRequests: 1,
          verifierRequests: 1,
          inputTokens: null,
          outputTokens: 300,
        },
        errorCode: 'KG_PARTIAL',
        errorMessage: 'Some candidates could not be verified',
      }),
      reused: true,
    });

    const response = await getKnowledgeGraphRun(id(1), id(100), store);

    expect(response).toEqual({
      id: id(100),
      type: 'deck_index',
      status: 'partial',
      stage: 'persistence',
      progress: { completed: 12, total: 20 },
      stats: {
        cards: 20,
        indexedSenses: 20,
        candidates: 12,
        verified: 10,
        suggestions: 8,
        coveredNodes: 18,
        embeddingRequests: 1,
        verifierRequests: 1,
        inputTokens: null,
        outputTokens: 300,
      },
      error: {
        code: 'KG_PARTIAL',
        message: 'Some candidates could not be verified',
      },
    });
    expect(response).not.toHaveProperty('snapshot');
    expect(response).not.toHaveProperty('fingerprint');
    expect(response).not.toHaveProperty('lockedBy');
  });

  test('delegates idempotent cancellation with user scope', async () => {
    const store = repository({ run: runRecord(), reused: false });
    const response = await cancelKnowledgeGraphRun(id(1), id(100), store);
    expect(response.status).toBe('cancelled');
  });
});
