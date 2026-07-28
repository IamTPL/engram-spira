import { ENV } from '../../config/env';
import { ConflictError } from '../../shared/errors';
import { createPostgresKgIndexingRepository } from './kg-indexing.repository';
import { createPostgresKgRunsRepository } from './kg-runs.repository';
import { createPostgresSenseExpansionRepository } from './kg-expansion.repository';
import { createSenseExpansionKnowledgeGraphRun } from './kg-expansion.service';
import {
  cancelKnowledgeGraphRun,
  createDeckKnowledgeGraphRun,
  getKnowledgeGraphRun,
} from './kg-runs.service';
import {
  getCardNeighborhood,
  mapCardToSense,
  type RelationGroup,
} from './kg-neighborhood.service';
import {
  acceptKnowledgeGraphSuggestion,
  dismissKnowledgeGraphSuggestion,
  listKnowledgeGraphSuggestions,
  type SuggestionListStatus,
} from './kg-suggestion-review.service';
import { requestKgWorker } from './kg-worker';

const indexingRepository = createPostgresKgIndexingRepository();
const runsRepository = createPostgresKgRunsRepository();
const expansionRepository = createPostgresSenseExpansionRepository();

export function assertKnowledgeGraphV2Enabled(
  enabled = ENV.KG_V2_ENABLED,
): void {
  if (!enabled) {
    throw new ConflictError('Knowledge graph v2 is disabled');
  }
}

export function getCapabilities(_userId: string) {
  return {
    v2Enabled: ENV.KG_V2_ENABLED,
  };
}

export function createDeckRun(
  userId: string,
  request: {
    deckId: string;
    sourceLanguageTag: string;
    definitionLanguageTag: string;
  },
) {
  assertKnowledgeGraphV2Enabled();
  return createDeckKnowledgeGraphRun(userId, request, {
    indexingRepository,
    runRepository: runsRepository,
    embeddingModel: ENV.GEMINI_EMBEDDING_MODEL,
    wakeWorker: requestKgWorker,
  });
}

export function createSenseExpansionRun(
  userId: string,
  senseId: string,
) {
  assertKnowledgeGraphV2Enabled();
  return createSenseExpansionKnowledgeGraphRun(userId, senseId, {
    sourceRepository: expansionRepository,
    runRepository: runsRepository,
    embeddingModel: ENV.GEMINI_EMBEDDING_MODEL,
    generationModel: ENV.GEMINI_MODEL,
    wakeWorker: requestKgWorker,
  });
}

export function getRun(userId: string, runId: string) {
  return getKnowledgeGraphRun(userId, runId, runsRepository);
}

export function cancelRun(userId: string, runId: string) {
  return cancelKnowledgeGraphRun(userId, runId, runsRepository);
}

export function listSuggestions(
  userId: string,
  runId: string,
  query: {
    status?: SuggestionListStatus;
    cursor?: string;
    limit?: number;
  },
) {
  return listKnowledgeGraphSuggestions(userId, runId, query);
}

export function acceptSuggestion(userId: string, suggestionId: string) {
  return acceptKnowledgeGraphSuggestion(userId, suggestionId);
}

export function dismissTypedSuggestion(userId: string, suggestionId: string) {
  return dismissKnowledgeGraphSuggestion(userId, suggestionId);
}

export function getNeighborhood(
  userId: string,
  cardId: string,
  query: {
    groups?: string;
    limit?: number;
    cursor?: string;
  },
) {
  const groups =
    query.groups === undefined
      ? undefined
      : (query.groups.split(',').map((group) => group.trim()) as RelationGroup[]);
  return getCardNeighborhood(userId, cardId, {
    ...(groups === undefined ? {} : { groups }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  });
}

export function mapCardSense(
  userId: string,
  cardId: string,
  senseId: string,
) {
  return mapCardToSense(userId, cardId, senseId);
}
