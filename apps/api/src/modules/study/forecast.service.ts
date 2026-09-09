import { sql, type SQL } from 'drizzle-orm';

import { db } from '../../db';
import {
  FSRS_REVIEW,
  fsrsAsOf,
  fsrsDueLater,
  fsrsRetrievability,
  fsrsStateJoin,
  fsrsTargetRetention,
} from './fsrs-sql';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ForecastDay {
  date: string;
  atRiskCount: number;
  avgRetention: number;
}

export interface HeatmapCard {
  cardId: string;
  retention: number;
  lastReviewed: string | null;
  nextReview: string;
  stability: number | null;
}

export interface AtRiskCard {
  cardId: string;
  deckId: string;
  deckName: string;
  retention: number;
  fields: { fieldName: string; side: string; value: unknown }[];
}

// `db.execute` constrains its row type to `Record<string, unknown>`, which
// only object type aliases satisfy through TypeScript's implicit index
// signature — interfaces do not.
type ForecastRow = {
  offset: number;
  atRiskCount: number;
  avgRetention: number | null;
};

// `retention` and `stability` are non-null here: the statement keeps only rows
// that have an `fsrs_card_states` row, whose `stability`, `last_reviewed_at`
// and (FK) revision `decay`/`factor` are all NOT NULL.
type HeatmapRow = {
  cardId: string;
  retention: number;
  lastReviewed: Date | string;
  nextReview: Date | string;
  stability: number;
};

type AtRiskRow = {
  cardId: string;
  deckId: string;
  deckName: string;
  retention: number;
  total: number;
  fields: { fieldName: string; side: string; value: unknown }[];
};

// ── Forecast endpoint ────────────────────────────────────────────────────────

/**
 * Predicted recall per horizon day, computed entirely in SQL from
 * `fsrs_card_states` + `fsrs_parameter_revisions`.
 *
 * `LEFT JOIN LATERAL … ON true` keeps every horizon day in the result even
 * when the user has no canonical state rows, and the per-revision
 * `request_retention` (not a hardcoded 0.8) decides what counts as at risk.
 * `day_offset` is spelled out because `offset` is a reserved word — only the
 * output alias is quoted, so the row key stays `offset`.
 */
export function forecastSql(userId: string, days: number, asOf: Date): SQL {
  return sql`
    WITH states AS (
      SELECT s.stability, s.last_reviewed_at, r.decay, r.factor,
        ${fsrsTargetRetention()} AS target
      FROM fsrs_card_states s
      JOIN fsrs_parameter_revisions r ON r.id = s.parameter_revision_id
      WHERE s.user_id = ${userId}::uuid
    ),
    horizon AS (SELECT generate_series(0, ${days - 1}) AS day_offset)
    SELECT
      h.day_offset AS "offset",
      COUNT(x.retention) FILTER (WHERE x.retention < x.target)::int
        AS "atRiskCount",
      AVG(x.retention)::double precision AS "avgRetention"
    FROM horizon h
    LEFT JOIN LATERAL (
      SELECT fsrs_retrievability(
               st.stability,
               EXTRACT(EPOCH FROM (
                 (${fsrsAsOf(asOf)} + h.day_offset * interval '1 day')
                 - st.last_reviewed_at
               )),
               st.decay,
               st.factor
             ) AS retention,
             st.target
      FROM states st
    ) x ON true
    GROUP BY h.day_offset
    ORDER BY h.day_offset`;
}

export async function getForecast(
  userId: string,
  days: number,
  asOf: Date = new Date(),
): Promise<{ forecast: ForecastDay[] }> {
  const clampedDays = Math.min(Math.max(days, 1), 90);
  const rows = await db.execute<ForecastRow>(
    forecastSql(userId, clampedDays, asOf),
  );

  const byOffset = new Map(rows.map((row) => [Number(row.offset), row]));
  const forecast: ForecastDay[] = [];
  for (let offset = 0; offset < clampedDays; offset += 1) {
    const row = byOffset.get(offset);
    forecast.push({
      date: new Date(asOf.getTime() + offset * 86_400_000)
        .toISOString()
        .slice(0, 10),
      atRiskCount: row?.atRiskCount ?? 0,
      avgRetention:
        row?.avgRetention == null ? 1 : roundMetric(row.avgRetention),
    });
  }

  return { forecast };
}

// ── Retention heatmap ────────────────────────────────────────────────────────

/**
 * Per-card predicted recall for one owned deck. Ownership is folded into the
 * join, so an unowned (or missing) deck yields zero rows — the empty array the
 * endpoint has always returned.
 */
export function heatmapSql(userId: string, deckId: string, asOf: Date): SQL {
  return sql`
    SELECT c.id::text AS "cardId",
      ${fsrsRetrievability(asOf)} AS retention,
      s.last_reviewed_at AS "lastReviewed",
      s.next_review_at AS "nextReview",
      s.stability
    FROM cards c
    JOIN decks d ON d.id = c.deck_id AND d.user_id = ${userId}::uuid
    ${fsrsStateJoin(userId)}
    WHERE c.deck_id = ${deckId}::uuid AND s.id IS NOT NULL
    ORDER BY retention ASC, c.id`;
}

export async function getRetentionHeatmap(
  userId: string,
  deckId: string,
  asOf: Date = new Date(),
): Promise<{ cards: HeatmapCard[] }> {
  const rows = await db.execute<HeatmapRow>(heatmapSql(userId, deckId, asOf));

  return {
    cards: rows.map((row) => ({
      cardId: row.cardId,
      retention: roundMetric(row.retention),
      lastReviewed: toIso(row.lastReviewed),
      nextReview: toIso(row.nextReview),
      stability: row.stability,
    })),
  };
}

// ── At-risk cards ────────────────────────────────────────────────────────────

/**
 * Cards not yet due whose predicted recall has already decayed below target —
 * "silently decaying" cards. `threshold` of `null` uses each state's own
 * revision `request_retention`; a number overrides it for every card.
 *
 * `total` is the pre-`LIMIT` count from `COUNT(*) OVER ()`, so zero matching
 * rows naturally yield `total: 0`. Fields are tie-broken by `tf.id` because
 * `sort_order` repeats across the front/back sides of a template.
 */
export function atRiskCardsSql(
  userId: string,
  asOf: Date,
  threshold: number | null,
  limit: number,
): SQL {
  const target =
    threshold === null
      ? fsrsTargetRetention()
      : sql`${threshold}::double precision`;
  return sql`
    WITH scored AS (
      SELECT c.id, c.deck_id, d.name AS deck_name,
        ${fsrsRetrievability(asOf)} AS retention,
        COUNT(*) OVER () AS total
      FROM cards c
      JOIN decks d ON d.id = c.deck_id AND d.user_id = ${userId}::uuid
      ${fsrsStateJoin(userId)}
      WHERE ${FSRS_REVIEW} AND ${fsrsDueLater(asOf)}
        AND ${fsrsRetrievability(asOf)} < ${target}
    )
    SELECT sc.id::text AS "cardId", sc.deck_id::text AS "deckId",
      sc.deck_name AS "deckName",
      sc.retention, sc.total::int AS total,
      COALESCE(
        json_agg(
          json_build_object(
            'fieldName', tf.name,
            'side', tf.side,
            'value', cfv.value
          )
          ORDER BY tf.sort_order, tf.id
        ) FILTER (WHERE tf.id IS NOT NULL),
        '[]'::json
      ) AS fields
    FROM scored sc
    LEFT JOIN card_field_values cfv ON cfv.card_id = sc.id
    LEFT JOIN template_fields tf ON tf.id = cfv.template_field_id
    GROUP BY sc.id, sc.deck_id, sc.deck_name, sc.retention, sc.total
    ORDER BY sc.retention ASC, sc.id
    LIMIT ${limit}`;
}

export async function getAtRiskCards(
  userId: string,
  threshold: number | null = null,
  limit = 20,
  asOf: Date = new Date(),
): Promise<{ atRisk: AtRiskCard[]; total: number }> {
  const rows = await db.execute<AtRiskRow>(
    atRiskCardsSql(userId, asOf, threshold, limit),
  );

  return {
    atRisk: rows.map((row) => ({
      cardId: row.cardId,
      deckId: row.deckId,
      deckName: row.deckName,
      retention: roundMetric(row.retention),
      fields: (row.fields ?? []).map((field) => ({
        fieldName: field.fieldName,
        side: field.side,
        value: field.value,
      })),
    })),
    total: rows[0]?.total ?? 0,
  };
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
