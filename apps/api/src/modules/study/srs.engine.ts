import { SM2 } from '../../shared/constants';
import type { ReviewAction } from '../../shared/constants';

export interface SrsState {
  boxLevel: number; // repetitions count (0 = never reviewed / forgotten)
  easeFactor: number; // interval growth multiplier for this card (min 1.3)
  intervalDays: number; // current scheduled interval in days
}

export interface SrsResult extends SrsState {
  nextReviewAt: Date;
}

/**
 * SM-2 Algorithm (SuperMemo 2) — adaptive spaced repetition.
 *
 * Unlike Leitner Box (fixed intervals per level), SM-2 computes the next
 * interval based on the card's *ease factor* (how easy/hard THIS specific
 * card is for THIS user), making it personalized and more accurate.
 *
 * Key insight: interval(n+1) = interval(n) × easeFactor
 *
 * easeFactor adjusts per review:
 *   AGAIN: big penalty (-0.2), reset interval to 1 day
 *   HARD:  small penalty (-0.15), interval grows sluggishly
 *   GOOD:  neutral (0), interval grows normally by easeFactor
 *
 * Example for a card a user finds easy (ef stays at 2.5):
 *   1st GOOD → 1d, 2nd GOOD → 6d, 3rd GOOD → 15d, 4th GOOD → 37d
 *
 * vs Leitner Box (same for everyone): 1d → 3d → 7d → 14d → 30d
 */
export function calculateNextReview(
  action: ReviewAction,
  current: Partial<SrsState> = {},
): SrsResult {
  const reps = current.boxLevel ?? 0;
  const ef = current.easeFactor ?? SM2.DEFAULT_EASE_FACTOR;
  const interval = current.intervalDays ?? 1;
  const now = new Date();

  switch (action) {
    case 'again': {
      // Card forgotten — reset repetitions, penalize ease factor
      // Due again after a short relearning delay
      const newEf = Math.max(SM2.MIN_EASE_FACTOR, ef + SM2.AGAIN_EF_DELTA);
      const relearnMs = SM2.AGAIN_RELEARN_MINUTES * 60 * 1000;
      return {
        boxLevel: 0,
        easeFactor: Math.round(newEf * 100) / 100,
        intervalDays: 0,
        nextReviewAt: new Date(now.getTime() + relearnMs),
      };
    }

    case 'hard': {
      // Answered with difficulty — small EF penalty, interval grows slowly
      // Graduate from "new" (reps 0→1) but don't advance further
      const newEf = Math.max(SM2.MIN_EASE_FACTOR, ef + SM2.HARD_EF_DELTA);
      const newReps = Math.max(1, reps); // at least graduate to 1
      const newInterval =
        newReps <= 1
          ? SM2.FIRST_INTERVAL_DAYS
          : Math.max(interval + 1, Math.round(interval * 1.2));
      return {
        boxLevel: newReps,
        easeFactor: Math.round(newEf * 100) / 100,
        intervalDays: newInterval,
        nextReviewAt: new Date(
          now.getTime() + newInterval * 24 * 60 * 60 * 1000,
        ),
      };
    }

    case 'good': {
      // Standard SM-2 progression
      const newReps = reps + 1;
      const newInterval =
        newReps === 1
          ? SM2.FIRST_INTERVAL_DAYS
          : newReps === 2
            ? SM2.SECOND_INTERVAL_DAYS
            : Math.round(interval * ef);
      return {
        boxLevel: newReps,
        easeFactor: ef, // unchanged on GOOD
        intervalDays: newInterval,
        nextReviewAt: new Date(
          now.getTime() + newInterval * 24 * 60 * 60 * 1000,
        ),
      };
    }

    case 'easy': {
      // Easy recall — EF bonus + extra interval multiplier
      const newEf = ef + SM2.EASY_EF_DELTA;
      const newReps = reps + 1;
      const newInterval =
        newReps === 1
          ? SM2.FIRST_INTERVAL_DAYS
          : newReps === 2
            ? Math.round(SM2.SECOND_INTERVAL_DAYS * SM2.EASY_INTERVAL_BONUS)
            : Math.round(interval * newEf * SM2.EASY_INTERVAL_BONUS);
      return {
        boxLevel: newReps,
        easeFactor: Math.round(newEf * 100) / 100,
        intervalDays: newInterval,
        nextReviewAt: new Date(
          now.getTime() + newInterval * 24 * 60 * 60 * 1000,
        ),
      };
    }

    default:
      throw new Error(`Invalid review action: ${action}`);
  }
}
