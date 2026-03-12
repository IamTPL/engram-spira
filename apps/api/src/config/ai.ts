/**
 * AI Configuration — Google Gemini client + per-user rate limiting.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ENV } from './env';
import { TooManyRequestsError } from '../shared/errors';

let _genAI: GoogleGenerativeAI | null = null;

/** Lazy-init Gemini client (only if key is configured). */
export function getGenAI(): GoogleGenerativeAI {
  if (!ENV.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  if (!_genAI) {
    _genAI = new GoogleGenerativeAI(ENV.GEMINI_API_KEY);
  }
  return _genAI;
}

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
setInterval(
  () => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  },
  10 * 60 * 1000,
);
