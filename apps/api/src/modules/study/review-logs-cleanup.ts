import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { logger } from '../../shared/logger';

const RETENTION_DAYS = 730; // 2 years — sufficient for FSRS optimization + analytics
const BATCH_SIZE = 5000; // Delete in batches to avoid long table locks
const BATCH_YIELD_MS = 100; // Yield to event loop between batches

const cleanupLogger = logger.child({ module: 'review-logs-cleanup' });

/**
 * Delete review_logs older than RETENTION_DAYS.
 * Runs in batches to minimize lock contention and memory usage.
 * Index idx_rl_user_reviewed_at ensures efficient range scan.
 */
export async function cleanupOldReviewLogs(): Promise<number> {
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 86_400_000,
  ).toISOString();
  let totalDeleted = 0;

  while (true) {
    const result = await db.execute<{ n: number }>(sql`
      WITH batch AS (
        SELECT id FROM review_logs
        WHERE reviewed_at < ${cutoff}::timestamptz
        LIMIT ${sql.raw(String(BATCH_SIZE))}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM review_logs
      WHERE id IN (SELECT id FROM batch)
      RETURNING 1
    `);

    const batchCount = result.length;
    totalDeleted += batchCount;

    if (batchCount < BATCH_SIZE) break;

    // Yield to event loop between batches — prevent starving other requests
    await new Promise((resolve) => setTimeout(resolve, BATCH_YIELD_MS));
  }

  if (totalDeleted > 0) {
    cleanupLogger.info(
      { totalDeleted, retentionDays: RETENTION_DAYS },
      'Review logs cleanup completed',
    );
  }

  return totalDeleted;
}
