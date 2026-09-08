import { sql, type SQL } from 'drizzle-orm';

/**
 * Shared vocabulary for canonical FSRS reads through `db.execute(sql\`…\`)`.
 * Aliases are fixed: `c` cards, `s` fsrs_card_states, `r` fsrs_parameter_revisions.
 * `asOf` is bound once per request as ISO text (the client is drizzle-wrapped:
 * a JS Date would not serialise — see src/db/pg-codecs.ts).
 */
export function fsrsAsOf(asOf: Date): SQL {
  return sql`${asOf.toISOString()}::timestamptz`;
}

export function fsrsStateJoin(userId: string): SQL {
  return sql`
    LEFT JOIN fsrs_card_states s
      ON s.card_id = c.id AND s.user_id = ${userId}::uuid
    LEFT JOIN fsrs_parameter_revisions r
      ON r.id = s.parameter_revision_id`;
}

export const FSRS_NEW: SQL = sql`s.id IS NULL`;
export const FSRS_LEARNING: SQL = sql`s.state IN ('learning', 'relearning')`;
export const FSRS_REVIEW: SQL = sql`s.state = 'review'`;

export function fsrsDue(asOf: Date): SQL {
  return sql`(s.id IS NULL OR s.next_review_at <= ${fsrsAsOf(asOf)})`;
}

export function fsrsDueLater(asOf: Date): SQL {
  return sql`(s.id IS NOT NULL AND s.next_review_at > ${fsrsAsOf(asOf)})`;
}

export function fsrsTargetRetention(): SQL {
  return sql`COALESCE((r.parameters->>'request_retention')::double precision, 0.9)`;
}

export function fsrsRetrievability(asOf: Date): SQL {
  return sql`
    CASE WHEN s.id IS NULL THEN NULL
    ELSE fsrs_retrievability(
      s.stability,
      EXTRACT(EPOCH FROM (${fsrsAsOf(asOf)} - s.last_reviewed_at)),
      r.decay,
      r.factor
    ) END`;
}

export function fsrsAtRisk(asOf: Date): SQL {
  return sql`(
    ${FSRS_REVIEW}
    AND ${fsrsDueLater(asOf)}
    AND ${fsrsRetrievability(asOf)} < ${fsrsTargetRetention()}
  )`;
}
