/**
 * AI Configuration — per-user rate limiting.
 *
 * Gemini client ownership lives in modules/ai/gemini-provider.ts.
 */
import { TooManyRequestsError } from '../shared/errors';

// ── Per-user rate limiting (in-memory, resets hourly) ──────────────────
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_HOUR = 30;

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

/** Check & consume one rate-limit token for the given user. */
export function checkAiRateLimit(userId: string): void {
  const now = Date.now();
  let bucket = buckets.get(userId);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    buckets.set(userId, bucket);
  }

  if (bucket.count >= MAX_REQUESTS_PER_HOUR) {
    throw new TooManyRequestsError(
      `AI rate limit exceeded. Max ${MAX_REQUESTS_PER_HOUR} requests per hour.`,
    );
  }

  bucket.count++;
}

// Cleanup stale buckets every 10 minutes
const rateBucketCleanupInterval = setInterval(
  () => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  },
  10 * 60 * 1000,
);
rateBucketCleanupInterval.unref();
