import { sql, type SQL } from 'drizzle-orm';

import { db } from '../../db';
import { getCardLabels } from '../../shared/embedding-utils';
import { NotFoundError } from '../../shared/errors';
import {
  fsrsAsOf,
  fsrsAtRisk,
  fsrsRetrievability,
  fsrsStateJoin,
} from './fsrs-sql';
import { MAX_STUDY_CLUSTER_CARDS } from './study-cluster';

export type RetentionStatus = 'new' | 'due' | 'at_risk' | 'on_track';

export interface RetentionOverviewAttentionRow {
  cardId: string;
  sortOrder: number;
  status: Extract<RetentionStatus, 'due' | 'at_risk'>;
  retention: number | null;
  lastReviewedAt: string;
  nextReviewAt: string;
}

// A type alias (not an interface) so it satisfies `db.execute`'s
// `Record<string, unknown>` constraint through TypeScript's implicit index
// signature.
export type RetentionOverviewAggregate = {
  owned: boolean;
  total: number;
  newCount: number;
  dueCount: number;
  atRiskCount: number;
  onTrackCount: number;
  /** AVG predicted recall over the cards that have an FSRS state row. */
  averageRetention: number | null;
  /** Active parameter revision's `request_retention`, null when none exists. */
  targetRetention: number | null;
  attentionTotal: number;
  attention: RetentionOverviewAttentionRow[];
};

export interface RetentionOverviewLoaders {
  loadAggregate(
    userId: string,
    deckId: string,
    asOf: Date,
  ): Promise<RetentionOverviewAggregate>;
  loadLabels(cardIds: string[]): Promise<Map<string, string>>;
}

export interface RetentionOverviewResponse {
  asOf: string;
  metric: {
    kind: 'predicted_recall';
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
    unavailable: 0;
  };
  distribution: {
    new: number;
    due: number;
    atRisk: number;
    onTrack: number;
    unavailable: 0;
  };
  attentionTotal: number;
  attention: Array<{
    cardId: string;
    label: string;
    status: Extract<RetentionStatus, 'due' | 'at_risk'>;
    retention: number | null;
    lastReviewedAt: string;
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
  const aggregate = await loaders.loadAggregate(userId, deckId, asOf);
  if (!aggregate.owned) throw new NotFoundError('Deck');

  const labels = await loaders.loadLabels(
    aggregate.attention.map((item) => item.cardId),
  );
  const counts = {
    new: aggregate.newCount,
    due: aggregate.dueCount,
    atRisk: aggregate.atRiskCount,
    onTrack: aggregate.onTrackCount,
    unavailable: 0 as const,
  };

  return {
    asOf: asOf.toISOString(),
    metric: {
      kind: 'predicted_recall',
      average:
        aggregate.averageRetention === null
          ? null
          : roundMetric(aggregate.averageRetention),
      target: aggregate.targetRetention,
    },
    summary: {
      total: aggregate.total,
      reviewed: aggregate.total - aggregate.newCount,
      ...counts,
    },
    distribution: { ...counts },
    attentionTotal: aggregate.attentionTotal,
    attention: aggregate.attention.map((item) => ({
      cardId: item.cardId,
      label: labels.get(item.cardId)?.trim() || `Card ${item.sortOrder + 1}`,
      status: item.status,
      retention: item.retention === null ? null : roundMetric(item.retention),
      lastReviewedAt: item.lastReviewedAt,
      nextReviewAt: item.nextReviewAt,
    })),
    reviewCardIds: aggregate.attention.flatMap((item) =>
      item.status === 'due' ? [item.cardId] : [],
    ),
  };
}

/**
 * The whole memory-health aggregate in one canonical statement: per-card status
 * and predicted recall are derived in SQL from `fsrs_card_states` +
 * `fsrs_parameter_revisions`, then rolled up into counts, the AVG metric, the
 * active target retention and the top attention list.
 *
 * The attention ordering is deterministic and identical in the CTE's `LIMIT`
 * and the `json_agg`: due first, then lowest retention, then soonest due, then
 * sort order, then id.
 */
export function retentionOverviewSql(
  userId: string,
  deckId: string,
  asOf: Date,
): SQL {
  return sql`
    WITH scored AS (
      SELECT
        c.id,
        c.sort_order,
        CASE
          WHEN s.id IS NULL THEN 'new'
          WHEN s.next_review_at <= ${fsrsAsOf(asOf)} THEN 'due'
          WHEN ${fsrsAtRisk(asOf)} THEN 'at_risk'
          ELSE 'on_track'
        END AS status,
        ${fsrsRetrievability(asOf)} AS retention,
        s.last_reviewed_at,
        s.next_review_at
      FROM cards c
      JOIN decks d ON d.id = c.deck_id AND d.user_id = ${userId}::uuid
      ${fsrsStateJoin(userId)}
      WHERE c.deck_id = ${deckId}::uuid
    ),
    attention AS (
      SELECT id, sort_order, status, retention, last_reviewed_at, next_review_at
      FROM scored
      WHERE status IN ('due', 'at_risk')
      ORDER BY
        (status = 'due') DESC,
        retention ASC NULLS LAST,
        next_review_at ASC,
        sort_order ASC,
        id ASC
      LIMIT ${MAX_STUDY_CLUSTER_CARDS}
    )
    SELECT
      EXISTS (
        SELECT 1 FROM decks
        WHERE id = ${deckId}::uuid AND user_id = ${userId}::uuid
      ) AS owned,
      (SELECT COUNT(*)::int FROM scored) AS total,
      (SELECT COUNT(*)::int FROM scored WHERE status = 'new') AS "newCount",
      (SELECT COUNT(*)::int FROM scored WHERE status = 'due') AS "dueCount",
      (SELECT COUNT(*)::int FROM scored WHERE status = 'at_risk')
        AS "atRiskCount",
      (SELECT COUNT(*)::int FROM scored WHERE status = 'on_track')
        AS "onTrackCount",
      (SELECT AVG(retention)::double precision FROM scored)
        AS "averageRetention",
      -- The user's ACTIVE revision target -- what the header renders. It is
      -- deliberately NOT what classifies a card: fsrsAtRisk compares each card
      -- against ITS OWN revision's request_retention (COALESCE 0.9), so a card
      -- still scheduled by a retired revision is judged by that revision's
      -- target. The two can legitimately differ after a parameter change; do
      -- not "fix" one to drive the other.
      (
        SELECT (r.parameters->>'request_retention')::double precision
        FROM fsrs_parameter_revisions r
        WHERE r.user_id = ${userId}::uuid AND r.retired_at IS NULL
        LIMIT 1
      ) AS "targetRetention",
      (SELECT COUNT(*)::int FROM scored WHERE status IN ('due', 'at_risk'))
        AS "attentionTotal",
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'cardId', id::text,
            'sortOrder', sort_order,
            'status', status,
            'retention', retention,
            'lastReviewedAt', to_char(
              last_reviewed_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'nextReviewAt', to_char(
              next_review_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
          )
          ORDER BY
            (status = 'due') DESC,
            retention ASC NULLS LAST,
            next_review_at ASC,
            sort_order ASC,
            id ASC
        )
        FROM attention
      ), '[]'::json) AS attention`;
}

export const defaultRetentionOverviewLoaders: RetentionOverviewLoaders = {
  async loadAggregate(userId, deckId, asOf) {
    const [row] = await db.execute<RetentionOverviewAggregate>(
      retentionOverviewSql(userId, deckId, asOf),
    );
    return row!;
  },
  loadLabels: getCardLabels,
};

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}
