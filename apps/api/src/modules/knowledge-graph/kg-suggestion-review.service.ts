import { ConflictError, ValidationError } from '../../shared/errors';
import { logger } from '../../shared/logger';
import type { VocabularyArtifact } from './vocabulary-artifact';
import type {
  ConfidenceBand,
  RelationDirection,
  RelationType,
} from './kg-verifier';

export type SuggestionStatus =
  | 'pending'
  | 'accepted'
  | 'dismissed'
  | 'superseded'
  | 'rejected';

export type SuggestionListStatus = Exclude<SuggestionStatus, 'rejected'>;

export type SuggestionCursor = {
  createdAt: Date;
  id: string;
};

export type SuggestionListRow = {
  id: string;
  runId: string;
  status: SuggestionStatus;
  sourceCardId: string | null;
  targetCardId: string | null;
  sourceSenseId: string | null;
  targetSenseId: string | null;
  sourceArtifact: VocabularyArtifact;
  targetArtifact: VocabularyArtifact;
  relationType: RelationType;
  direction: RelationDirection;
  confidenceBand: ConfidenceBand;
  reason: string;
  evidence: { source: string; target: string } | null;
  retrievalSimilarity: number | null;
  mutualKnn: boolean;
  acceptedRelationId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SuggestionAcceptResult =
  | { outcome: 'superseded' }
  | {
      outcome: 'accepted';
      suggestion: SuggestionListRow;
      relationId: string;
    };

export type SuggestionDismissResult = {
  id: string;
  runId: string;
  relationType: RelationType;
  confidenceBand: ConfidenceBand;
  status: 'dismissed';
  dismissedAt: Date;
};

export type SuggestionReviewEventLogger = {
  info(context: Record<string, unknown>, message: string): void;
};

export type SuggestionReviewRepository = {
  list(
    userId: string,
    runId: string,
    status: SuggestionListStatus,
    cursor: SuggestionCursor | null,
    limit: number,
  ): Promise<SuggestionListRow[]>;
  accept(userId: string, suggestionId: string): Promise<SuggestionAcceptResult>;
  dismiss(
    userId: string,
    suggestionId: string,
  ): Promise<SuggestionDismissResult>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SUGGESTION_STATUSES = new Set<SuggestionListStatus>([
  'pending',
  'accepted',
  'dismissed',
  'superseded',
]);
const suggestionReviewLogger = logger.child({
  module: 'kg-suggestion-review',
});

type EncodedSuggestionCursor = {
  createdAt: string;
  id: string;
};

function encodeCursor(row: Pick<SuggestionListRow, 'createdAt' | 'id'>): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: row.createdAt.toISOString(),
      id: row.id,
    } satisfies EncodedSuggestionCursor),
  ).toString('base64url');
}

function decodeCursor(cursor: string | undefined): SuggestionCursor | null {
  if (cursor === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) {
      throw new Error('Invalid base64url');
    }
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as unknown;
    if (
      decoded === null ||
      typeof decoded !== 'object' ||
      Array.isArray(decoded)
    ) {
      throw new Error('Invalid cursor shape');
    }
    const keys = Object.keys(decoded).sort();
    if (
      keys.length !== 2 ||
      keys[0] !== 'createdAt' ||
      keys[1] !== 'id'
    ) {
      throw new Error('Invalid cursor keys');
    }
    const value = decoded as Partial<EncodedSuggestionCursor>;
    if (
      typeof value.createdAt !== 'string' ||
      typeof value.id !== 'string' ||
      !UUID_PATTERN.test(value.id)
    ) {
      throw new Error('Invalid cursor value');
    }
    const createdAt = new Date(value.createdAt);
    if (
      !Number.isFinite(createdAt.getTime()) ||
      createdAt.toISOString() !== value.createdAt
    ) {
      throw new Error('Invalid cursor date');
    }
    return { createdAt, id: value.id };
  } catch {
    throw new ValidationError('Invalid suggestion cursor');
  }
}

async function resolveRepository(
  repository: SuggestionReviewRepository | undefined,
): Promise<SuggestionReviewRepository> {
  if (repository) return repository;
  const { getPostgresSuggestionReviewRepository } = await import(
    './kg-suggestion-review.repository'
  );
  return getPostgresSuggestionReviewRepository();
}

function publicSuggestion(row: SuggestionListRow) {
  return {
    id: row.id,
    runId: row.runId,
    status: row.status,
    source: {
      cardId: row.sourceCardId,
      senseId: row.sourceSenseId,
      artifact: row.sourceArtifact,
    },
    target: {
      cardId: row.targetCardId,
      senseId: row.targetSenseId,
      artifact: row.targetArtifact,
    },
    relationType: row.relationType,
    direction: row.direction,
    confidenceBand: row.confidenceBand,
    reason: row.reason,
    evidence: row.evidence,
    retrieval: {
      similarity: row.retrievalSimilarity,
      mutualKnn: row.mutualKnn,
    },
    acceptedRelationId: row.acceptedRelationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listKnowledgeGraphSuggestions(
  userId: string,
  runId: string,
  query: {
    status?: SuggestionListStatus;
    cursor?: string;
    limit?: number;
  },
  repository?: SuggestionReviewRepository,
) {
  const limit = query.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ValidationError('Suggestion limit must be between 1 and 50');
  }
  const status = query.status ?? 'pending';
  if (!SUGGESTION_STATUSES.has(status)) {
    throw new ValidationError('Invalid suggestion status');
  }
  const rows = await (
    await resolveRepository(repository)
  ).list(userId, runId, status, decodeCursor(query.cursor), limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    items: page.map(publicSuggestion),
    pageInfo: {
      nextCursor: hasMore && last ? encodeCursor(last) : null,
      truncated: hasMore,
    },
  };
}

export async function acceptKnowledgeGraphSuggestion(
  userId: string,
  suggestionId: string,
  repository?: SuggestionReviewRepository,
  eventLogger: SuggestionReviewEventLogger = suggestionReviewLogger,
) {
  const result = await (
    await resolveRepository(repository)
  ).accept(userId, suggestionId);
  if (result.outcome === 'superseded') {
    throw new ConflictError(
      'Suggestion was superseded because one or more cards changed',
    );
  }
  eventLogger.info(
    {
      event: 'kg_relation_suggestion_reviewed',
      action: 'accepted',
      userId,
      runId: result.suggestion.runId,
      suggestionId: result.suggestion.id,
      relationType: result.suggestion.relationType,
      confidenceBand: result.suggestion.confidenceBand,
    },
    'Knowledge graph relation suggestion accepted',
  );
  return {
    suggestionId: result.suggestion.id,
    status: 'accepted' as const,
    relationId: result.relationId,
  };
}

export async function dismissKnowledgeGraphSuggestion(
  userId: string,
  suggestionId: string,
  repository?: SuggestionReviewRepository,
  eventLogger: SuggestionReviewEventLogger = suggestionReviewLogger,
) {
  const result = await (
    await resolveRepository(repository)
  ).dismiss(userId, suggestionId);
  eventLogger.info(
    {
      event: 'kg_relation_suggestion_reviewed',
      action: 'dismissed',
      userId,
      runId: result.runId,
      suggestionId: result.id,
      relationType: result.relationType,
      confidenceBand: result.confidenceBand,
    },
    'Knowledge graph relation suggestion dismissed',
  );
  return {
    suggestionId: result.id,
    status: result.status,
    dismissedAt: result.dismissedAt.toISOString(),
  };
}
