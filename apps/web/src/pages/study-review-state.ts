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

export interface DueDeckLike {
  deckId: string;
  dueCount: number;
}

/**
 * Returns a new list with `by` subtracted from the deck's dueCount (floored
 * at 0); decks at 0 are removed. Used to optimistically update the
 * ['notifications'] cache after a review batch succeeds.
 */
export function applyReviewedCards<T extends DueDeckLike>(
  decks: T[],
  deckId: string,
  by: number,
): T[] {
  return decks.flatMap((deck) => {
    if (deck.deckId !== deckId) return [deck];
    const dueCount = Math.max(0, deck.dueCount - by);
    return dueCount === 0 ? [] : [{ ...deck, dueCount }];
  });
}
