import { createHash } from 'node:crypto';

import type { DeckIndexSnapshot, DeckIndexingRepository } from './kg-indexing.service';
import { snapshotDeckForIndexing } from './kg-indexing.service';
import { canonicalizeLanguageTag } from './vocabulary-normalization';
import {
  KG_PROMPT_VERSION,
  KG_REPRESENTATION_VERSION,
  KG_TAXONOMY_VERSION,
} from './kg-versions';

export type KgRunStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'stale';

export type KgRunRecord = {
  id: string;
  userId: string;
  runType: 'deck_index' | 'sense_expansion';
  deckId: string | null;
  focusSenseId: string | null;
  status: KgRunStatus;
  stage:
    | 'snapshot'
    | 'indexing'
    | 'embeddings'
    | 'candidates'
    | 'verification'
    | 'persistence';
  fingerprint: string;
  representationVersion: string;
  embeddingModel: string;
  promptVersion: string;
  taxonomyVersion: string;
  sourceLanguageTag: string;
  definitionLanguageTag: string;
  snapshot: Record<string, unknown>;
  progress: Record<string, unknown>;
  stats: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date | string;
};

export type EnqueueDeckRunInput = {
  userId: string;
  deckId: string;
  fingerprint: string;
  representationVersion: typeof KG_REPRESENTATION_VERSION;
  embeddingModel: string;
  promptVersion: string;
  taxonomyVersion: string;
  sourceLanguageTag: string;
  definitionLanguageTag: string;
  snapshot: DeckIndexSnapshot;
};

export type EnqueueSenseExpansionRunInput = {
  userId: string;
  focusSenseId: string;
  fingerprint: string;
  representationVersion: typeof KG_REPRESENTATION_VERSION;
  embeddingModel: string;
  promptVersion: string;
  taxonomyVersion: string;
  sourceLanguageTag: string;
  definitionLanguageTag: string;
  snapshot: Record<string, unknown>;
};

export type KgRunRepository = {
  enqueueDeckRun(
    input: EnqueueDeckRunInput,
  ): Promise<{ run: KgRunRecord; reused: boolean }>;
  enqueueSenseExpansionRun(
    input: EnqueueSenseExpansionRunInput,
  ): Promise<{ run: KgRunRecord; reused: boolean }>;
  getOwnedRun(userId: string, runId: string): Promise<KgRunRecord>;
  cancelOwnedRun(userId: string, runId: string): Promise<KgRunRecord>;
};

export type CreateDeckRunDependencies = {
  indexingRepository: DeckIndexingRepository;
  runRepository: KgRunRepository;
  embeddingModel: string;
  wakeWorker(): void;
};

export type KgRunResponse = {
  id: string;
  type: 'deck_index' | 'sense_expansion';
  status: KgRunStatus;
  stage: string;
  progress: {
    completed: number;
    total: number;
  };
  stats: {
    cards: number;
    indexedSenses: number;
    candidates: number;
    verified: number;
    suggestions: number;
    coveredNodes: number;
    embeddingRequests: number;
    verifierRequests: number;
    inputTokens: number | null;
    outputTokens: number | null;
  };
  error: {
    code: string;
    message: string;
  } | null;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildDeckRunFingerprint(input: EnqueueDeckRunInput): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        kind: 'kg-deck-run-v1',
        userId: input.userId,
        deckId: input.deckId,
        snapshot: input.snapshot,
        embeddingModel: input.embeddingModel,
        representationVersion: input.representationVersion,
        promptVersion: input.promptVersion,
        taxonomyVersion: input.taxonomyVersion,
        sourceLanguageTag: input.sourceLanguageTag,
        definitionLanguageTag: input.definitionLanguageTag,
      }),
    )
    .digest('hex');
}

function finiteCount(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function nullableCount(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

export function toKgRunResponse(run: KgRunRecord): KgRunResponse {
  return {
    id: run.id,
    type: run.runType,
    status: run.status,
    stage: run.stage,
    progress: {
      completed: finiteCount(run.progress, 'completed'),
      total: finiteCount(run.progress, 'total'),
    },
    stats: {
      cards: finiteCount(run.stats, 'cards'),
      indexedSenses: finiteCount(run.stats, 'indexedSenses'),
      candidates: finiteCount(run.stats, 'candidates'),
      verified: finiteCount(run.stats, 'verified'),
      suggestions: finiteCount(run.stats, 'suggestions'),
      coveredNodes: finiteCount(run.stats, 'coveredNodes'),
      embeddingRequests: finiteCount(run.stats, 'embeddingRequests'),
      verifierRequests: finiteCount(run.stats, 'verifierRequests'),
      inputTokens: nullableCount(run.stats, 'inputTokens'),
      outputTokens: nullableCount(run.stats, 'outputTokens'),
    },
    error:
      run.errorCode !== null && run.errorMessage !== null
        ? { code: run.errorCode, message: run.errorMessage }
        : null,
  };
}

export async function createDeckKnowledgeGraphRun(
  userId: string,
  request: {
    deckId: string;
    sourceLanguageTag: string;
    definitionLanguageTag: string;
  },
  dependencies: CreateDeckRunDependencies,
): Promise<{
  runId: string;
  status: KgRunStatus;
  reused: boolean;
}> {
  const sourceLanguageTag = canonicalizeLanguageTag(
    request.sourceLanguageTag,
  );
  const definitionLanguageTag = canonicalizeLanguageTag(
    request.definitionLanguageTag,
  );
  const { snapshot } = await snapshotDeckForIndexing(
    {
      userId,
      deckId: request.deckId,
      sourceLanguageTag,
      definitionLanguageTag,
    },
    dependencies.indexingRepository,
  );
  const enqueueInput: EnqueueDeckRunInput = {
    userId,
    deckId: request.deckId,
    fingerprint: '',
    representationVersion: KG_REPRESENTATION_VERSION,
    embeddingModel: dependencies.embeddingModel,
    promptVersion: KG_PROMPT_VERSION,
    taxonomyVersion: KG_TAXONOMY_VERSION,
    sourceLanguageTag,
    definitionLanguageTag,
    snapshot,
  };
  enqueueInput.fingerprint = buildDeckRunFingerprint(enqueueInput);
  const result = await dependencies.runRepository.enqueueDeckRun(enqueueInput);
  if (!result.reused) dependencies.wakeWorker();
  return {
    runId: result.run.id,
    status: result.run.status,
    reused: result.reused,
  };
}

export async function getKnowledgeGraphRun(
  userId: string,
  runId: string,
  repository: KgRunRepository,
): Promise<KgRunResponse> {
  return toKgRunResponse(await repository.getOwnedRun(userId, runId));
}

export async function cancelKnowledgeGraphRun(
  userId: string,
  runId: string,
  repository: KgRunRepository,
): Promise<KgRunResponse> {
  return toKgRunResponse(await repository.cancelOwnedRun(userId, runId));
}
