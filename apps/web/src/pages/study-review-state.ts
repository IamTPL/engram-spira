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

export interface CardProgressLike {
  state: 'learning' | 'review' | 'relearning';
  stability: number;
  reps: number;
  lastReviewedAt: string;
}

export interface CardProgressSummary {
  label: 'New' | 'Learning' | 'Relearning' | 'Review';
  detail: string | null;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Each tier floors its own unit so a value just under a boundary never prints
// the next unit under the wrong label (59.7 min is "59 min", not "60 min").
function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE_MS) return 'just now';
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(ms / HOUR_MS);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(ms / DAY_MS)} days ago`;
}

// Stability is a magnitude, so each tier rounds — and a value that rounds up
// to the next unit is promoted into it (59.7 min → "1 h", 23.98 h → "1 d").
function formatStability(days: number): string {
  const minutes = Math.round(days * 24 * 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(days * 24);
  if (hours < 24) return `${hours} h`;
  return `${Math.max(1, Math.round(days))} d`;
}

/**
 * One-line provenance for the card being studied, so a card with replayed or
 * old history is never mistaken for a brand-new one (FSRS rewards recall
 * after a long gap with a much longer interval than a first Easy would).
 */
export function describeCardProgress(
  progress: CardProgressLike | null,
  now: Date,
): CardProgressSummary {
  if (progress === null) return { label: 'New', detail: null };
  const label =
    progress.state === 'review'
      ? 'Review'
      : progress.state === 'relearning'
        ? 'Relearning'
        : 'Learning';
  const age = now.getTime() - new Date(progress.lastReviewedAt).getTime();
  const reviews = `${progress.reps} review${progress.reps === 1 ? '' : 's'}`;
  return {
    label,
    detail: `Last seen ${formatAge(age)} · ${reviews} · stability ${formatStability(progress.stability)}`,
  };
}
