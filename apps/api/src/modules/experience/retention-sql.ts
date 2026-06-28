import { sql, type SQL } from 'drizzle-orm';

export const AT_RISK_RETENTION_THRESHOLD = 0.8;

export function retentionEstimateSql(): SQL {
  return sql`
    LEAST(
      1,
      EXP(
        GREATEST(
          -50,
          -(
            EXTRACT(EPOCH FROM (NOW() - sp.last_reviewed_at)) / 86400
          ) / GREATEST(
            COALESCE(sp.stability, sp.interval_days::real * (sp.ease_factor / 2.5), 1),
            1
          )
        )
      )
    )
  `;
}

export function retentionEstimateSelectSql(): SQL {
  return sql`
    CASE
      WHEN sp.last_reviewed_at IS NULL THEN NULL
      ELSE ${retentionEstimateSql()}::real
    END
  `;
}

export function atRiskRetentionFilterSql(): SQL {
  return sql`
    sp.id IS NOT NULL
      AND sp.next_review_at > NOW()
      AND sp.last_reviewed_at IS NOT NULL
      AND ${retentionEstimateSql()} < ${AT_RISK_RETENTION_THRESHOLD}
  `;
}
