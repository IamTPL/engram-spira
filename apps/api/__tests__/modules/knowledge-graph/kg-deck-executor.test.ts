import { describe, expect, test } from 'bun:test';

import type { VocabularyArtifact } from '../../../src/modules/knowledge-graph/vocabulary-artifact';
import type {
  ClaimedKgRun,
  KgStageExecutionContext,
  KgRunStage,
} from '../../../src/modules/knowledge-graph/kg-worker';
import {
  buildVerificationCandidateSnapshot,
  createDeckKnowledgeGraphExecutor,
  parseVerificationCandidateSnapshot,
  type DeckKnowledgeGraphExecutorDependencies,
} from '../../../src/modules/knowledge-graph/kg-deck-executor';
import { buildDeckIndexSnapshot } from '../../../src/modules/knowledge-graph/kg-indexing.service';

const CARD_ID = '00000000-0000-4000-8000-000000000001';
const DECK_ID = '00000000-0000-4000-8000-000000000010';
const RUN_ID = '00000000-0000-4000-8000-000000000020';
const USER_ID = '00000000-0000-4000-8000-000000000030';
const HASH = 'a'.repeat(64);

const artifact: VocabularyArtifact = {
  cardId: CARD_ID,
  sourceLanguageTag: 'en',
  definitionLanguageTag: 'vi',
  lemma: 'bank',
  normalizedLemma: 'bank',
  partOfSpeech: 'noun',
  definition: 'ngân hàng',
  normalizedDefinition: 'ngân hàng',
  ipa: null,
  examples: [],
  contentHash: HASH,
  representationVersion: 'v1',
};

const snapshot = buildDeckIndexSnapshot([artifact]);

function run(stage: KgRunStage): ClaimedKgRun {
  return {
    id: RUN_ID,
    userId: USER_ID,
    runType: 'deck_index',
    deckId: DECK_ID,
    focusSenseId: null,
    stage,
    fingerprint: 'f'.repeat(64),
    representationVersion: 'v1',
    embeddingModel: 'gemini-embedding-2',
    promptVersion: 'kg-relations-v1',
    taxonomyVersion: 'lexical-relations-v1',
    sourceLanguageTag: 'en',
    definitionLanguageTag: 'vi',
    snapshot,
    progress: {},
    stats: {},
    attemptCount: 1,
    maxAttempts: 5,
    cancelRequestedAt: null,
  };
}

function context(
  stage: KgRunStage,
  transitions: KgRunStage[],
): KgStageExecutionContext {
  const claimed = run(stage);
  return {
    run: claimed,
    workerId: 'test-worker',
    signal: new AbortController().signal,
    async heartbeat() {
      return true;
    },
    async advanceStage(nextStage, progress, statsPatch) {
      transitions.push(nextStage);
      claimed.stage = nextStage;
      Object.assign(claimed.progress, progress ?? {});
      Object.assign(claimed.stats, statsPatch ?? {});
      return true;
    },
    async saveSnapshotAndAdvance(nextSnapshot, nextStage, progress, statsPatch) {
      transitions.push(nextStage);
      claimed.snapshot = nextSnapshot;
      claimed.stage = nextStage;
      Object.assign(claimed.progress, progress ?? {});
      Object.assign(claimed.stats, statsPatch ?? {});
      return true;
    },
  };
}

function dependencies(
  overrides: Partial<DeckKnowledgeGraphExecutorDependencies> = {},
): DeckKnowledgeGraphExecutorDependencies {
  return {
    embeddingModel: 'gemini-embedding-2',
    async snapshotDeck() {
      return {
        artifacts: [artifact],
        snapshot,
        nextStage: 'indexing',
        progress: { snapshotCards: 1 },
        statsPatch: { snapshotCards: 1 },
      };
    },
    async publishIndex() {
      return {
        outcome: 'published',
        stats: { lexemes: 1, senses: 1, mappings: 1 },
        nextStage: 'embeddings',
        progress: { indexedCards: 1 },
        statsPatch: {
          indexedLexemes: 1,
          indexedSenses: 1,
          indexedMappings: 1,
        },
      };
    },
    async ensureEmbeddings() {
      return {
        embedded: 1,
        reused: 0,
        usage: { inputTokens: 11, outputTokens: 0 },
      };
    },
    async generateCandidates() {
      return {
        candidates: [],
        nextStage: 'verification',
        progress: {
          candidateCount: 0,
          coveredNodeCount: 0,
          candidateBudget: 40,
        },
        statsPatch: {
          candidateCount: 0,
          coveredNodeCount: 0,
          candidateBudget: 40,
          candidateFallbackSources: 0,
        },
      };
    },
    async verifySuggestions() {
      return {
        nextStage: 'persistence',
        partial: false,
        retryableFailure: null,
        cached: 0,
        persisted: 0,
        suggestions: 0,
        unresolvedCandidateIds: [],
        progress: { verified: 0, suggestions: 0, unresolved: 0 },
        statsPatch: {
          verifierRequests: 0,
          verified: 0,
          suggestions: 0,
          schemaInvalid: 0,
          timeouts: 0,
          providerErrors: 0,
          missingRetries: 0,
          inputTokens: 7,
          outputTokens: 3,
        },
      };
    },
    ...overrides,
  };
}

describe('deck knowledge graph stage executor', () => {
  test('runs the durable stages in order and reports public stats', async () => {
    const transitions: KgRunStage[] = [];
    let candidateCalls = 0;
    const deps = dependencies({
      async generateCandidates(input) {
        candidateCalls += 1;
        expect(input).toMatchObject({
          runId: RUN_ID,
          userId: USER_ID,
          deckId: DECK_ID,
          embeddingModel: 'gemini-embedding-2',
        });
        return {
          candidates: [],
          nextStage: 'verification',
          progress: {
            candidateCount: 0,
            coveredNodeCount: 0,
            candidateBudget: 40,
          },
          statsPatch: {
            candidateCount: 0,
            coveredNodeCount: 0,
            candidateBudget: 40,
            candidateFallbackSources: 0,
          },
        };
      },
    });

    const result = await createDeckKnowledgeGraphExecutor(deps)(
      context('snapshot', transitions),
    );

    expect(transitions).toEqual([
      'indexing',
      'embeddings',
      'candidates',
      'verification',
      'persistence',
    ]);
    expect(candidateCalls).toBe(1);
    expect(result).toEqual({
      outcome: 'completed',
      progress: { completed: 6, total: 6 },
      statsPatch: {
        cards: 1,
        indexedSenses: 1,
        candidates: 0,
        candidateFallbackSources: 0,
        verified: 0,
        suggestions: 0,
        coveredNodes: 0,
        embeddingRequests: 1,
        embeddingCacheHits: 0,
        verifierRequests: 0,
        verificationCacheHits: 0,
        inputTokens: 18,
        outputTokens: 3,
        unresolved: 0,
      },
    });
  });

  test('resumes verification from the durably frozen candidate set', async () => {
    const transitions: KgRunStage[] = [];
    let candidateCalls = 0;
    const deps = dependencies({
      async generateCandidates() {
        candidateCalls += 1;
        return {
          candidates: [],
          nextStage: 'verification',
          progress: {
            candidateCount: 0,
            coveredNodeCount: 0,
            candidateBudget: 40,
          },
          statsPatch: {
            candidateCount: 0,
            coveredNodeCount: 0,
            candidateBudget: 40,
            candidateFallbackSources: 0,
          },
        };
      },
      async verifySuggestions() {
        const base = await dependencies().verifySuggestions({
          runId: RUN_ID,
          userId: USER_ID,
          deckId: DECK_ID,
          workerId: 'test-worker',
          candidates: [],
          attemptCount: 1,
          maxAttempts: 5,
        });
        return {
          ...base,
          partial: true,
          unresolvedCandidateIds: ['missing'],
          progress: { verified: 0, suggestions: 0, unresolved: 1 },
        };
      },
    });
    const executionContext = context('verification', transitions);
    executionContext.run.stats = {
      cards: 1,
      indexedSenses: 1,
      inputTokens: 11,
      outputTokens: 0,
    };
    executionContext.run.progress.verificationCandidates =
      buildVerificationCandidateSnapshot([]);

    const result = await createDeckKnowledgeGraphExecutor(deps)(
      executionContext,
    );

    expect(candidateCalls).toBe(0);
    expect(transitions).toEqual(['persistence']);
    expect(result.outcome).toBe('partial');
    expect(result.statsPatch?.unresolved).toBe(1);
  });

  test('checkpoints cumulative verifier stats before surfacing a retryable failure', async () => {
    const transitions: KgRunStage[] = [];
    const retryableFailure = Object.assign(new Error('provider unavailable'), {
      status: 503,
    });
    const executionContext = context('verification', transitions);
    executionContext.run.stats = {
      cards: 1,
      indexedSenses: 1,
      verifierRequests: 2,
      inputTokens: 11,
      outputTokens: 5,
      schemaInvalid: 1,
      timeouts: 0,
      providerErrors: 2,
      missingRetries: 1,
    };
    executionContext.run.progress.verificationCandidates =
      buildVerificationCandidateSnapshot([]);

    const deps = dependencies({
      async verifySuggestions(input) {
        expect(input).toMatchObject({
          runId: RUN_ID,
          userId: USER_ID,
          deckId: DECK_ID,
          workerId: 'test-worker',
        });
        return {
          nextStage: 'persistence',
          partial: true,
          retryableFailure,
          cached: 0,
          persisted: 0,
          suggestions: 0,
          unresolvedCandidateIds: ['missing'],
          progress: { verified: 0, suggestions: 0, unresolved: 1 },
          statsPatch: {
            verifierRequests: 1,
            verified: 0,
            suggestions: 0,
            schemaInvalid: 0,
            timeouts: 1,
            providerErrors: 1,
            missingRetries: 0,
            inputTokens: 7,
            outputTokens: 3,
          },
        };
      },
    });

    let thrown: unknown;
    try {
      await createDeckKnowledgeGraphExecutor(deps)(executionContext);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(retryableFailure);
    expect(transitions).toEqual(['verification']);
    expect(executionContext.run.stats).toMatchObject({
      verifierRequests: 3,
      inputTokens: 18,
      outputTokens: 8,
      schemaInvalid: 1,
      timeouts: 1,
      providerErrors: 3,
      missingRetries: 1,
      unresolved: 1,
    });
    expect(executionContext.run.progress.verificationCandidates).toEqual(
      buildVerificationCandidateSnapshot([]),
    );
  });

  test('rejects a malformed durable candidate set instead of changing its budget', () => {
    expect(() =>
      parseVerificationCandidateSnapshot({
        version: 'v1',
        items: [{ fingerprint: 'not-a-candidate' }],
      }),
    ).toThrow('Invalid verification candidate snapshot');
  });

  test('marks a queued run stale when the deck snapshot changed', async () => {
    const transitions: KgRunStage[] = [];
    const changedSnapshot = {
      ...snapshot,
      cards: [{ cardId: CARD_ID, contentHash: 'b'.repeat(64) }],
      snapshotHash: 'c'.repeat(64),
    };
    const deps = dependencies({
      async snapshotDeck() {
        return {
          artifacts: [{ ...artifact, contentHash: 'b'.repeat(64) }],
          snapshot: changedSnapshot,
          nextStage: 'indexing',
          progress: { snapshotCards: 1 },
          statsPatch: { snapshotCards: 1 },
        };
      },
    });

    const result = await createDeckKnowledgeGraphExecutor(deps)(
      context('snapshot', transitions),
    );

    expect(result.outcome).toBe('stale');
    expect(transitions).toEqual([]);
  });

  test('marks a run stale if the configured embedding model changed', async () => {
    const transitions: KgRunStage[] = [];
    const result = await createDeckKnowledgeGraphExecutor(
      dependencies({ embeddingModel: 'different-model' }),
    )(context('embeddings', transitions));

    expect(result.outcome).toBe('stale');
    expect(transitions).toEqual([]);
  });
});
