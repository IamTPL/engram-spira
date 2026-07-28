import { and, asc, eq } from 'drizzle-orm';

import { db } from '../../db';
import {
  cards,
  decks,
  fsrsUserParams,
  studyProgress,
  users,
} from '../../db/schema';
import { getCardLabels } from '../../shared/embedding-utils';
import { NotFoundError } from '../../shared/errors';
import { MAX_STUDY_CLUSTER_CARDS } from './study-cluster';
import type {
  RetentionAlgorithm,
  RetentionStatus,
} from './retention-estimator';
import {
  assessRetention,
  createRetentionContext,
  type RetentionAssessment,
} from './retention-estimator';

export interface RetentionOverviewCardRow {
  cardId: string;
  sortOrder: number;
  lastReviewedAt: Date | null;
  nextReviewAt: Date | null;
  stability: number | null;
}

export interface RetentionOverviewLoaders {
  loadContext(
    userId: string,
    deckId: string,
  ): Promise<{
    algorithm: RetentionAlgorithm;
    fsrsParams: unknown;
  } | null>;
  loadCards(
    userId: string,
    deckId: string,
  ): Promise<RetentionOverviewCardRow[]>;
  loadLabels(cardIds: string[]): Promise<Map<string, string>>;
}

export interface RetentionOverviewResponse {
  asOf: string;
  algorithm: RetentionAlgorithm;
  metric: {
    kind: 'predicted_recall' | 'schedule_status';
    average: number | null;
    target: number | null;
  };
  summary: {
    total: number;
    reviewed: number;
    new: number;
    due: number;
    atRisk: number;
    onTrack: number;
    unavailable: number;
  };
  distribution: {
    new: number;
    due: number;
    atRisk: number;
    onTrack: number;
    unavailable: number;
  };
  attentionTotal: number;
  attention: Array<{
    cardId: string;
    label: string;
    status: Extract<RetentionStatus, 'due' | 'at_risk'>;
    retention: number | null;
    lastReviewedAt: string | null;
    nextReviewAt: string;
  }>;
  reviewCardIds: string[];
}

export async function getRetentionOverview(
  userId: string,
  deckId: string,
  loaders: RetentionOverviewLoaders = defaultRetentionOverviewLoaders,
  asOf: Date = new Date(),
): Promise<RetentionOverviewResponse> {
  const [sourceContext, rows] = await Promise.all([
    loaders.loadContext(userId, deckId),
    loaders.loadCards(userId, deckId),
  ]);
  if (!sourceContext) throw new NotFoundError('Deck');

  const context = createRetentionContext(
    sourceContext.algorithm,
    sourceContext.fsrsParams,
  );
  const counts = {
    new: 0,
    due: 0,
    atRisk: 0,
    onTrack: 0,
    unavailable: 0,
  };
  const selected: Array<{
    card: RetentionOverviewCardRow;
    assessment: RetentionAssessment & { status: 'due' | 'at_risk' };
  }> = [];
  let attentionTotal = 0;
  let retentionTotal = 0;
  let retentionCount = 0;

  for (const card of rows) {
    const assessment = assessRetention(
      context,
      {
        lastReviewedAt: card.lastReviewedAt,
        nextReviewAt: card.nextReviewAt,
        stability: card.stability,
      },
      asOf,
    );
    incrementCount(counts, assessment.status);
    if (assessment.retention !== null) {
      retentionTotal += assessment.retention;
      retentionCount++;
    }
    if (assessment.status === 'due' || assessment.status === 'at_risk') {
      attentionTotal++;
      insertAttentionCandidate(selected, {
        card,
        assessment: {
          ...assessment,
          status: assessment.status,
        },
      });
    }
  }

  const selectedIds = selected.map((item) => item.card.cardId);
  const labels = await loaders.loadLabels(selectedIds);

  const average =
    retentionCount === 0
      ? null
      : roundMetric(retentionTotal / retentionCount);

  return {
    asOf: asOf.toISOString(),
    algorithm: context.algorithm,
    metric: {
      kind:
        context.algorithm === 'fsrs'
          ? 'predicted_recall'
          : 'schedule_status',
      average: context.algorithm === 'fsrs' ? average : null,
      target: context.targetRetention,
    },
    summary: {
      total: rows.length,
      reviewed: rows.length - counts.new,
      ...counts,
    },
    distribution: { ...counts },
    attentionTotal,
    attention: selected.map(({ card, assessment }) => {
      const label = labels.get(card.cardId)?.trim();
      return {
        cardId: card.cardId,
        label: label || `Card ${card.sortOrder + 1}`,
        status: assessment.status,
        retention:
          assessment.retention === null
            ? null
            : roundMetric(assessment.retention),
        lastReviewedAt: card.lastReviewedAt?.toISOString() ?? null,
        nextReviewAt: card.nextReviewAt!.toISOString(),
      };
    }),
    reviewCardIds: selected.flatMap(({ card, assessment }) =>
      assessment.status === 'due' ? [card.cardId] : [],
    ),
  };
}

export const defaultRetentionOverviewLoaders: RetentionOverviewLoaders = {
  async loadContext(userId, deckId) {
    const [row] = await db
      .select({
        algorithm: users.srsAlgorithm,
        fsrsParams: fsrsUserParams.params,
      })
      .from(decks)
      .innerJoin(users, eq(decks.userId, users.id))
      .leftJoin(fsrsUserParams, eq(fsrsUserParams.userId, users.id))
      .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
      .limit(1);
    if (!row) return null;
    return {
      algorithm: row.algorithm === 'fsrs' ? 'fsrs' : 'sm2',
      fsrsParams: row.fsrsParams ?? {},
    };
  },
  loadCards(userId, deckId) {
    return db
      .select({
        cardId: cards.id,
        sortOrder: cards.sortOrder,
        lastReviewedAt: studyProgress.lastReviewedAt,
        nextReviewAt: studyProgress.nextReviewAt,
        stability: studyProgress.stability,
      })
      .from(cards)
      .innerJoin(decks, eq(cards.deckId, decks.id))
      .leftJoin(
        studyProgress,
        and(
          eq(studyProgress.cardId, cards.id),
          eq(studyProgress.userId, userId),
        ),
      )
      .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
      .orderBy(asc(cards.sortOrder), asc(cards.id));
  },
  loadLabels: getCardLabels,
};

function incrementCount(
  counts: RetentionOverviewResponse['distribution'],
  status: RetentionStatus,
): void {
  if (status === 'new') counts.new++;
  if (status === 'due') counts.due++;
  if (status === 'at_risk') counts.atRisk++;
  if (status === 'on_track') counts.onTrack++;
  if (status === 'unavailable') counts.unavailable++;
}

function compareAttention(
  left: {
    card: RetentionOverviewCardRow;
    assessment: RetentionAssessment & { status: 'due' | 'at_risk' };
  },
  right: {
    card: RetentionOverviewCardRow;
    assessment: RetentionAssessment & { status: 'due' | 'at_risk' };
  },
): number {
  if (left.assessment.status !== right.assessment.status) {
    return left.assessment.status === 'due' ? -1 : 1;
  }

  if (
    left.assessment.status === 'at_risk' &&
    right.assessment.status === 'at_risk'
  ) {
    const retentionDiff =
      (left.assessment.retention ?? 1) -
      (right.assessment.retention ?? 1);
    if (retentionDiff !== 0) return retentionDiff;
  }

  const dueDiff =
    (left.card.nextReviewAt?.getTime() ?? Number.POSITIVE_INFINITY) -
    (right.card.nextReviewAt?.getTime() ?? Number.POSITIVE_INFINITY);
  if (dueDiff !== 0) return dueDiff;

  const orderDiff = left.card.sortOrder - right.card.sortOrder;
  if (orderDiff !== 0) return orderDiff;
  return left.card.cardId.localeCompare(right.card.cardId);
}

function insertAttentionCandidate(
  selected: Array<{
    card: RetentionOverviewCardRow;
    assessment: RetentionAssessment & { status: 'due' | 'at_risk' };
  }>,
  candidate: {
    card: RetentionOverviewCardRow;
    assessment: RetentionAssessment & { status: 'due' | 'at_risk' };
  },
): void {
  selected.push(candidate);
  selected.sort(compareAttention);
  if (selected.length > MAX_STUDY_CLUSTER_CARDS) selected.pop();
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}
