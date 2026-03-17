import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
  type Grade,
  type FSRSParameters,
} from 'ts-fsrs';
import type { ReviewAction } from '../../shared/constants';

const RATING_MAP: Record<ReviewAction, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export interface FsrsState {
  stability: number;
  difficulty: number;
  fsrsState: string;
  lastElapsedDays: number;
}

export interface FsrsResult {
  nextReviewAt: Date;
  stability: number;
  difficulty: number;
  fsrsState: string;
  lastElapsedDays: number;
  intervalDays: number;
}

/**
 * Calculate FSRS review result using ts-fsrs v5.
 *
 * Unlike SM-2 (integer intervalDays → truncation), FSRS stores
 * stability/difficulty as floats and computes precise Date for nextReviewAt,
 * eliminating the original truncation bug.
 */
export function calculateFsrsReview(
  action: ReviewAction,
  current: Partial<FsrsState> | null,
  params?: Partial<FSRSParameters>,
): FsrsResult {
  const f = fsrs(params ? generatorParameters(params) : generatorParameters());

  // Build card state from current progress or empty
  const card: Card = current?.stability
    ? {
        due: new Date(),
        stability: current.stability,
        difficulty: current.difficulty ?? 0,
        elapsed_days: current.lastElapsedDays ?? 0,
        scheduled_days: 0,
        learning_steps: 0,
        reps: 0,
        lapses: 0,
        state: mapStateFromString(current.fsrsState ?? 'new'),
        last_review: new Date(),
      }
    : createEmptyCard();

  const now = new Date();
  const scheduling = f.repeat(card, now);
  const result = scheduling[RATING_MAP[action]];

  return {
    nextReviewAt: result.card.due, // Date — precise, no integer truncation
    stability: result.card.stability,
    difficulty: result.card.difficulty,
    fsrsState: mapStateToString(result.card.state),
    lastElapsedDays: result.card.elapsed_days,
    intervalDays: Math.ceil(result.card.scheduled_days), // for display only
  };
}

function mapStateFromString(state: string): number {
  switch (state) {
    case 'new':
      return 0;
    case 'learning':
      return 1;
    case 'review':
      return 2;
    case 'relearning':
      return 3;
    default:
      return 0;
  }
}

function mapStateToString(state: number): string {
  switch (state) {
    case 0:
      return 'new';
    case 1:
      return 'learning';
    case 2:
      return 'review';
    case 3:
      return 'relearning';
    default:
      return 'new';
  }
}
