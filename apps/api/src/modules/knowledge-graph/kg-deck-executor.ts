import { getGeminiProvider } from '../ai/gemini-provider';
import { db } from '../../db';
import { ValidationError } from '../../shared/errors';
import {
  ensureKgEmbeddings,
  loadCardEmbeddingStates,
  writeKgEmbeddingBatch,
} from './kg-embedding.service';
import {
  parseDeckIndexSnapshot,
  publishDeckIndex,
  snapshotDeckForIndexing,
  type DeckIndexSnapshot,
} from './kg-indexing.service';
import { createPostgresKgIndexingRepository } from './kg-indexing.repository';
import {
  generateDeckCandidates,
  type CanonicalCandidate,
} from './kg-candidates';
import { createPostgresCandidateRepository } from './kg-candidate.repository';
import {
  toVerificationSuggestionCandidate,
  verifyAndPersistRelationshipSuggestions,
} from './kg-verification.service';
import { createPostgresSuggestionPersistenceRepository } from './kg-verification.repository';
import type {
  KgRunStage,
  KgStageExecutionContext,
  KgStageExecutionResult,
  KgStageExecutor,
} from './kg-worker';

const TOTAL_STAGES = 6;
const EMBEDDING_BATCH_SIZE = 50;
const MAX_PERSISTED_CANDIDATES = 300;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

type SnapshotResult = Awaited<ReturnType<typeof snapshotDeckForIndexing>>;
type PublishResult = Awaited<ReturnType<typeof publishDeckIndex>>;
type CandidateResult = Awaited<ReturnType<typeof generateDeckCandidates>>;
type KgEmbeddingResult = Awaited<ReturnType<typeof ensureKgEmbeddings>>;
type VerificationResult = Awaited<
  ReturnType<typeof verifyAndPersistRelationshipSuggestions>
>;

export type DeckKnowledgeGraphExecutorDependencies = {
  embeddingModel: string;
  snapshotDeck(input: {
    userId: string;
    deckId: string;
    sourceLanguageTag: string;
    definitionLanguageTag: string;
  }): Promise<SnapshotResult>;
  publishIndex(input: {
    userId: string;
    deckId: string;
    sourceLanguageTag: string;
    definitionLanguageTag: string;
    snapshot: Record<string, unknown>;
  }): Promise<PublishResult>;
  ensureEmbeddings(
    artifacts: SnapshotResult['artifacts'],
    signal?: AbortSignal,
  ): Promise<KgEmbeddingResult>;
  generateCandidates(input: {
    runId: string;
    userId: string;
    deckId: string;
    embeddingModel: string;
    representationVersion: string;
    promptVersion: string;
    taxonomyVersion: string;
  }): Promise<CandidateResult>;
  verifySuggestions(
    input: {
      runId: string;
      userId: string;
      deckId: string;
      workerId: string;
      candidates: ReturnType<typeof toVerificationSuggestionCandidate>[];
      attemptCount: number;
      maxAttempts: number;
    },
    signal?: AbortSignal,
  ): Promise<VerificationResult>;
};

function snapshotsMatch(
  expected: DeckIndexSnapshot,
  current: DeckIndexSnapshot,
): boolean {
  if (
    expected.representationVersion !== current.representationVersion ||
    expected.snapshotHash !== current.snapshotHash ||
    expected.cards.length !== current.cards.length
  ) {
    return false;
  }
  return expected.cards.every(
    (card, index) =>
      card.cardId === current.cards[index]?.cardId &&
      card.contentHash === current.cards[index]?.contentHash,
  );
}

function numericStat(
  stats: Record<string, unknown>,
  key: string,
): number {
  const value = stats[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function nullableTokenStat(
  stats: Record<string, unknown>,
  key: string,
): number | null {
  const value = stats[key];
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function addTokenUsage(
  current: number | null,
  increment: number | null,
): number | null {
  return current === null || increment === null ? null : current + increment;
}

function progress(completed: number) {
  return { completed, total: TOTAL_STAGES };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isVocabularyArtifact(value: unknown, cardId: string): boolean {
  if (!isRecord(value)) return false;
  return (
    value.cardId === cardId &&
    typeof value.sourceLanguageTag === 'string' &&
    typeof value.definitionLanguageTag === 'string' &&
    typeof value.lemma === 'string' &&
    typeof value.normalizedLemma === 'string' &&
    typeof value.partOfSpeech === 'string' &&
    typeof value.definition === 'string' &&
    typeof value.normalizedDefinition === 'string' &&
    (value.ipa === null || typeof value.ipa === 'string') &&
    isStringArray(value.examples) &&
    typeof value.contentHash === 'string' &&
    SHA256_PATTERN.test(value.contentHash) &&
    value.representationVersion === 'v1'
  );
}

function isCandidateEndpoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.cardId === 'string' &&
    UUID_PATTERN.test(value.cardId) &&
    typeof value.senseId === 'string' &&
    UUID_PATTERN.test(value.senseId) &&
    isVocabularyArtifact(value.artifact, value.cardId)
  );
}

export function buildVerificationCandidateSnapshot(
  candidates: CanonicalCandidate[],
): Record<string, unknown> {
  if (candidates.length > MAX_PERSISTED_CANDIDATES) {
    throw new ValidationError('Too many verification candidates');
  }
  return {
    version: 'v1',
    items: candidates,
  };
}

export function parseVerificationCandidateSnapshot(
  value: unknown,
): CanonicalCandidate[] {
  if (
    !isRecord(value) ||
    value.version !== 'v1' ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_PERSISTED_CANDIDATES
  ) {
    throw new ValidationError('Invalid verification candidate snapshot');
  }
  const fingerprints = new Set<string>();
  const candidates: CanonicalCandidate[] = [];
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      typeof item.candidateId !== 'string' ||
      typeof item.fingerprint !== 'string' ||
      item.candidateId !== item.fingerprint ||
      !SHA256_PATTERN.test(item.fingerprint) ||
      fingerprints.has(item.fingerprint) ||
      !isCandidateEndpoint(item.source) ||
      !isCandidateEndpoint(item.target) ||
      typeof item.similarity !== 'number' ||
      !Number.isFinite(item.similarity) ||
      item.similarity < -1 ||
      item.similarity > 1 ||
      typeof item.mutualKnn !== 'boolean' ||
      !Array.isArray(item.retrievedDirections) ||
      item.retrievedDirections.some(
        (direction) =>
          direction !== 'source_to_target' &&
          direction !== 'target_to_source',
      ) ||
      !isRecord(item.lexicalEvidence) ||
      typeof item.lexicalEvidence.matched !== 'boolean' ||
      (item.lexicalEvidence.reason !== null &&
        item.lexicalEvidence.reason !== 'same_normalized_lemma' &&
        item.lexicalEvidence.reason !== 'shared_lemma_token')
    ) {
      throw new ValidationError('Invalid verification candidate snapshot');
    }
    fingerprints.add(item.fingerprint);
    candidates.push(item as CanonicalCandidate);
  }
  return candidates;
}

function terminalStats(stats: Record<string, unknown>) {
  return {
    cards: numericStat(stats, 'cards'),
    indexedSenses: numericStat(stats, 'indexedSenses'),
    candidates: numericStat(stats, 'candidates'),
    candidateFallbackSources: numericStat(
      stats,
      'candidateFallbackSources',
    ),
    verified: numericStat(stats, 'verified'),
    suggestions: numericStat(stats, 'suggestions'),
    coveredNodes: numericStat(stats, 'coveredNodes'),
    embeddingRequests: numericStat(stats, 'embeddingRequests'),
    embeddingCacheHits: numericStat(stats, 'embeddingCacheHits'),
    verifierRequests: numericStat(stats, 'verifierRequests'),
    verificationCacheHits: numericStat(stats, 'verificationCacheHits'),
    inputTokens: nullableTokenStat(stats, 'inputTokens'),
    outputTokens: nullableTokenStat(stats, 'outputTokens'),
    unresolved: numericStat(stats, 'unresolved'),
  };
}

function staleResult(
  context: KgStageExecutionContext,
  completed: number,
): KgStageExecutionResult {
  return {
    outcome: 'stale',
    progress: progress(completed),
    statsPatch: terminalStats(context.run.stats),
  };
}

async function assertWorkerOwnership(
  context: KgStageExecutionContext,
): Promise<void> {
  if (context.signal.aborted) {
    throw context.signal.reason ?? new Error('Knowledge graph run aborted');
  }
  if (!(await context.heartbeat())) {
    throw context.signal.reason ?? new Error('Knowledge graph run superseded');
  }
}

async function advance(
  context: KgStageExecutionContext,
  stage: KgRunStage,
  completed: number,
  statsPatch: Record<string, unknown>,
  progressPatch: Record<string, unknown> = {},
): Promise<void> {
  if (
    !(await context.advanceStage(
      stage,
      { ...progress(completed), ...progressPatch },
      statsPatch,
    ))
  ) {
    throw context.signal.reason ?? new Error('Knowledge graph run superseded');
  }
}

function defaultDependencies(): DeckKnowledgeGraphExecutorDependencies {
  const provider = getGeminiProvider();
  const indexingRepository = createPostgresKgIndexingRepository();
  const candidateRepository = createPostgresCandidateRepository(db);
  const suggestionRepository =
    createPostgresSuggestionPersistenceRepository();

  return {
    embeddingModel: provider.embeddingModel,
    snapshotDeck: (input) =>
      snapshotDeckForIndexing(input, indexingRepository),
    publishIndex: (input) => publishDeckIndex(input, indexingRepository),
    ensureEmbeddings: (artifacts, signal) =>
      ensureKgEmbeddings(
        artifacts,
        {
          embeddingModel: provider.embeddingModel,
          loadStates: loadCardEmbeddingStates,
          embedTexts: (inputs, requestSignal) =>
            provider.embedTexts(inputs, requestSignal),
          writeBatch: writeKgEmbeddingBatch,
        },
        signal,
      ),
    generateCandidates: (input) =>
      generateDeckCandidates(input, candidateRepository),
    verifySuggestions: (input, signal) =>
      verifyAndPersistRelationshipSuggestions(
        input,
        suggestionRepository,
        provider,
        signal,
      ),
  };
}

export function createDeckKnowledgeGraphExecutor(
  dependencies: DeckKnowledgeGraphExecutorDependencies =
    defaultDependencies(),
): KgStageExecutor {
  return async (context) => {
    const run = context.run;
    if (run.runType !== 'deck_index' || run.deckId === null) {
      throw new Error('Unsupported knowledge graph run type');
    }

    let stage = run.stage;
    let selectedCandidates: CanonicalCandidate[] | null = null;
    let partial = numericStat(run.stats, 'unresolved') > 0;

    const loadCurrentDeck = async () => {
      await assertWorkerOwnership(context);
      const current = await dependencies.snapshotDeck({
        userId: run.userId,
        deckId: run.deckId!,
        sourceLanguageTag: run.sourceLanguageTag,
        definitionLanguageTag: run.definitionLanguageTag,
      });
      const expected = parseDeckIndexSnapshot(run.snapshot);
      return {
        current,
        matches: snapshotsMatch(expected, current.snapshot),
      };
    };

    while (true) {
      if (dependencies.embeddingModel !== run.embeddingModel) {
        return staleResult(context, Math.max(0, numericStat(run.progress, 'completed')));
      }

      if (stage === 'snapshot') {
        const { current, matches } = await loadCurrentDeck();
        if (!matches) return staleResult(context, 0);
        const statsPatch = { cards: current.artifacts.length };
        if (
          !(await context.saveSnapshotAndAdvance(
            current.snapshot,
            'indexing',
            progress(1),
            statsPatch,
          ))
        ) {
          throw context.signal.reason ?? new Error('Knowledge graph run superseded');
        }
        Object.assign(run.stats, statsPatch);
        run.snapshot = current.snapshot;
        stage = 'indexing';
        continue;
      }

      if (stage === 'indexing') {
        await assertWorkerOwnership(context);
        const indexed = await dependencies.publishIndex({
          userId: run.userId,
          deckId: run.deckId,
          sourceLanguageTag: run.sourceLanguageTag,
          definitionLanguageTag: run.definitionLanguageTag,
          snapshot: run.snapshot,
        });
        if (indexed.outcome === 'stale') return staleResult(context, 1);
        const statsPatch = { indexedSenses: indexed.stats.senses };
        await advance(context, 'embeddings', 2, statsPatch);
        Object.assign(run.stats, statsPatch);
        stage = 'embeddings';
        continue;
      }

      if (stage === 'embeddings') {
        const { current, matches } = await loadCurrentDeck();
        if (!matches) return staleResult(context, 2);
        const embedded = await dependencies.ensureEmbeddings(
          current.artifacts,
          context.signal,
        );
        const statsPatch = {
          embeddingRequests:
            embedded.embedded === 0
              ? 0
              : Math.ceil(embedded.embedded / EMBEDDING_BATCH_SIZE),
          embeddingCacheHits: embedded.reused,
          inputTokens: addTokenUsage(
            nullableTokenStat(run.stats, 'inputTokens'),
            embedded.usage.inputTokens,
          ),
          outputTokens: addTokenUsage(
            nullableTokenStat(run.stats, 'outputTokens'),
            embedded.usage.outputTokens,
          ),
        };
        await advance(context, 'candidates', 3, statsPatch);
        Object.assign(run.stats, statsPatch);
        stage = 'candidates';
        continue;
      }

      if (stage === 'candidates') {
        const { matches } = await loadCurrentDeck();
        if (!matches) return staleResult(context, 3);
        const candidates = await dependencies.generateCandidates({
          runId: run.id,
          userId: run.userId,
          deckId: run.deckId,
          embeddingModel: run.embeddingModel,
          representationVersion: run.representationVersion,
          promptVersion: run.promptVersion,
          taxonomyVersion: run.taxonomyVersion,
        });
        selectedCandidates = candidates.candidates;
        const statsPatch = {
          candidates: candidates.candidates.length,
          coveredNodes: candidates.progress.coveredNodeCount,
          candidateFallbackSources:
            candidates.statsPatch.candidateFallbackSources,
        };
        const verificationCandidates =
          buildVerificationCandidateSnapshot(selectedCandidates);
        await advance(context, 'verification', 4, statsPatch, {
          verificationCandidates,
        });
        run.progress.verificationCandidates = verificationCandidates;
        Object.assign(run.stats, statsPatch);
        stage = 'verification';
        continue;
      }

      if (stage === 'verification') {
        const { matches } = await loadCurrentDeck();
        if (!matches) return staleResult(context, 4);
        if (selectedCandidates === null) {
          selectedCandidates = parseVerificationCandidateSnapshot(
            run.progress.verificationCandidates,
          );
        }
        const verified = await dependencies.verifySuggestions(
          {
            runId: run.id,
            userId: run.userId,
            deckId: run.deckId,
            workerId: context.workerId,
            candidates: selectedCandidates.map(
              toVerificationSuggestionCandidate,
            ),
            attemptCount: run.attemptCount,
            maxAttempts: run.maxAttempts,
          },
          context.signal,
        );
        partial = verified.partial;
        const statsPatch = {
          verified: Math.max(
            numericStat(run.stats, 'verified'),
            verified.progress.verified,
          ),
          suggestions: verified.progress.suggestions,
          verifierRequests:
            numericStat(run.stats, 'verifierRequests') +
            verified.statsPatch.verifierRequests,
          verificationCacheHits:
            numericStat(run.stats, 'verificationCacheHits') +
            verified.cached,
          inputTokens: addTokenUsage(
            nullableTokenStat(run.stats, 'inputTokens'),
            verified.statsPatch.inputTokens,
          ),
          outputTokens: addTokenUsage(
            nullableTokenStat(run.stats, 'outputTokens'),
            verified.statsPatch.outputTokens,
          ),
          unresolved: verified.progress.unresolved,
          schemaInvalid:
            numericStat(run.stats, 'schemaInvalid') +
            verified.statsPatch.schemaInvalid,
          timeouts:
            numericStat(run.stats, 'timeouts') +
            verified.statsPatch.timeouts,
          providerErrors:
            numericStat(run.stats, 'providerErrors') +
            verified.statsPatch.providerErrors,
          missingRetries:
            numericStat(run.stats, 'missingRetries') +
            verified.statsPatch.missingRetries,
        };
        if (verified.retryableFailure !== null) {
          await advance(context, 'verification', 4, statsPatch, {
            verificationCandidates:
              run.progress.verificationCandidates,
          });
          Object.assign(run.stats, statsPatch);
          throw verified.retryableFailure;
        }
        await advance(context, 'persistence', 5, statsPatch);
        Object.assign(run.stats, statsPatch);
        stage = 'persistence';
        continue;
      }

      const { matches } = await loadCurrentDeck();
      if (!matches) return staleResult(context, 5);
      const statsPatch = terminalStats(run.stats);
      return {
        outcome: partial || statsPatch.unresolved > 0 ? 'partial' : 'completed',
        progress: progress(TOTAL_STAGES),
        statsPatch,
      };
    }
  };
}
