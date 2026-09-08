export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewItem {
  requestId: string;
  cardId: string;
  rating: ReviewRating;
  reviewedAt: string;
  durationMs?: number;
}

export interface ReviewBatchResult {
  applied: number;
  duplicates: number;
  results: Array<{ requestId: string; cardId: string; status: 'applied' | 'duplicate' }>;
}

const MAX_DURATION_MS = 60 * 60 * 1000;

/**
 * One review event. `requestId` makes retries idempotent on the server, so it
 * must be generated once per grade, never per request attempt.
 */
export function buildReviewItem(
  cardId: string,
  rating: ReviewRating,
  shownAtMs: number | null,
  now: Date = new Date(),
  requestId: string = crypto.randomUUID(),
): ReviewItem {
  const item: ReviewItem = {
    requestId,
    cardId,
    rating,
    reviewedAt: now.toISOString(),
  };
  if (shownAtMs !== null) {
    const duration = now.getTime() - shownAtMs;
    if (duration >= 0 && duration <= MAX_DURATION_MS) item.durationMs = duration;
  }
  return item;
}
