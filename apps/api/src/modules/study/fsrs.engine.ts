import {
  CLAMP_PARAMETERS,
  createEmptyCard,
  default_w,
  FSRS5_DEFAULT_DECAY,
  fsrs,
  generatorParameters,
  Rating,
  State,
  W17_W18_Ceiling,
  type Card,
  type Grade,
  type FSRSParameters,
  type ReviewLog,
} from 'ts-fsrs';
import type { ReviewAction } from '../../shared/constants';
import { ValidationError } from '../../shared/errors';

export const FSRS_ALGORITHM_VERSION = 'FSRS-6';
export const FSRS_LIBRARY_VERSION = 'ts-fsrs@5.4.1';
export const FSRS_POLICY_VERSION = 'engram-fsrs-v1';

const RATING_MAP: Record<ReviewAction, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export interface ScheduleFsrsReviewInput {
  current: Card | null;
  rating: ReviewAction;
  reviewedAt: Date;
  parameters?: unknown;
}

export interface ScheduleFsrsReviewResult {
  before: Card;
  after: Card;
  log: ReviewLog;
}

const DEFAULT_LEARNING_STEPS = ['1m', '15m'] as const;
const DEFAULT_RELEARNING_STEPS = ['10m'] as const;
const PARAMETER_KEYS = new Set([
  'request_retention',
  'maximum_interval',
  'w',
  'enable_fuzz',
  'enable_short_term',
  'learning_steps',
  'relearning_steps',
]);
const STEP_PATTERN = /^(?:[1-9]\d*)[mhd]$/u;

export function normalizeFsrsParameters(value?: unknown): FSRSParameters {
  try {
    if (value === undefined) {
      return createPolicyParameters({});
    }
    if (!isRecord(value)) {
      throw new Error('FSRS parameters must be an object');
    }

    for (const key of Object.keys(value)) {
      if (!PARAMETER_KEYS.has(key)) {
        throw new Error(`Unknown FSRS parameter: ${key}`);
      }
    }

    const parameters: Partial<FSRSParameters> = {};
    if ('request_retention' in value) {
      const retention = value.request_retention;
      if (
        typeof retention !== 'number' ||
        !Number.isFinite(retention) ||
        retention <= 0 ||
        retention > 1
      ) {
        throw new Error('request_retention must be in the range (0, 1]');
      }
      parameters.request_retention = retention;
    }
    if ('maximum_interval' in value) {
      const maximumInterval = value.maximum_interval;
      if (
        typeof maximumInterval !== 'number' ||
        !Number.isFinite(maximumInterval) ||
        !Number.isInteger(maximumInterval) ||
        maximumInterval <= 0 ||
        maximumInterval > 36_500
      ) {
        throw new Error(
          'maximum_interval must be an integer in the range [1, 36500]',
        );
      }
      parameters.maximum_interval = maximumInterval;
    }
    if ('enable_fuzz' in value && typeof value.enable_fuzz !== 'boolean') {
      throw new Error('enable_fuzz must be a boolean');
    }
    if ('enable_short_term' in value) {
      if (typeof value.enable_short_term !== 'boolean') {
        throw new Error('enable_short_term must be a boolean');
      }
      parameters.enable_short_term = value.enable_short_term;
    }
    if ('learning_steps' in value) {
      parameters.learning_steps = validateSteps(
        value.learning_steps,
        'learning_steps',
      );
    }
    if ('relearning_steps' in value) {
      parameters.relearning_steps = validateSteps(
        value.relearning_steps,
        'relearning_steps',
      );
    }
    if ('w' in value) {
      parameters.w = normalizeWeights(
        value.w,
        parameters.enable_short_term ?? true,
      );
    }

    return createPolicyParameters(parameters);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(
      error instanceof Error ? error.message : 'Invalid FSRS parameters',
    );
  }
}

export function scheduleFsrsReview(
  input: ScheduleFsrsReviewInput,
): ScheduleFsrsReviewResult {
  try {
    if (!isValidDate(input.reviewedAt)) {
      throw new Error('reviewedAt must be a valid Date');
    }
    if (!Object.hasOwn(RATING_MAP, input.rating)) {
      throw new Error('Invalid FSRS rating');
    }

    const reviewedAt = new Date(input.reviewedAt.getTime());
    const before =
      input.current === null
        ? createEmptyCard(reviewedAt)
        : validateAndCloneCard(input.current, reviewedAt);
    const scheduler = fsrs(normalizeFsrsParameters(input.parameters));
    const scheduled = scheduler.next(
      before,
      reviewedAt,
      RATING_MAP[input.rating],
    );

    return {
      before: cloneCard(before),
      after: cloneCard(scheduled.card),
      log: cloneReviewLog(scheduled.log),
    };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(
      error instanceof Error ? error.message : 'Invalid FSRS scheduling input',
    );
  }
}

function createPolicyParameters(
  parameters: Partial<FSRSParameters>,
): FSRSParameters {
  return generatorParameters({
    learning_steps: DEFAULT_LEARNING_STEPS,
    relearning_steps: DEFAULT_RELEARNING_STEPS,
    ...parameters,
    w: parameters.w ? [...parameters.w] : [...default_w],
    enable_fuzz: false,
  });
}

function validateSteps(
  value: unknown,
  name: string,
): FSRSParameters['learning_steps'] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (step): step is `${number}${'m' | 'h' | 'd'}` =>
        typeof step === 'string' && STEP_PATTERN.test(step),
    )
  ) {
    throw new Error(`${name} must contain valid positive FSRS steps`);
  }
  return [...value];
}

function normalizeWeights(value: unknown, enableShortTerm: boolean): number[] {
  if (
    !Array.isArray(value) ||
    ![17, 19, 21].includes(value.length) ||
    !value.every(
      (weight): weight is number =>
        typeof weight === 'number' && Number.isFinite(weight),
    )
  ) {
    throw new Error('FSRS weights must contain 17, 19, or 21 finite numbers');
  }

  validateWeightRanges(value, enableShortTerm);

  if (value.length === 21) return [...value];
  const shortTermWeight = enableShortTerm ? 0.01 : 0;
  if (value.length === 19) {
    const migrated = [...value, shortTermWeight, FSRS5_DEFAULT_DECAY];
    validateWeightRanges(migrated, enableShortTerm);
    return migrated;
  }

  const migrated = [...value];
  migrated[4] = roundToEight(migrated[5]! * 2 + migrated[4]!);
  migrated[5] = roundToEight(Math.log(migrated[5]! * 3 + 1) / 3);
  migrated[6] = roundToEight(migrated[6]! + 0.5);
  const complete = [
    ...migrated,
    0,
    0,
    shortTermWeight,
    FSRS5_DEFAULT_DECAY,
  ];
  validateWeightRanges(complete, enableShortTerm);
  return complete;
}

function validateWeightRanges(
  weights: readonly number[],
  enableShortTerm: boolean,
) {
  const ranges = CLAMP_PARAMETERS(W17_W18_Ceiling, enableShortTerm);
  weights.forEach((weight, index) => {
    const [minimum, maximum] = ranges[index]!;
    if (weight < minimum || weight > maximum) {
      throw new Error(`FSRS weight ${index} is outside its valid range`);
    }
  });
}

function roundToEight(value: number): number {
  return Number(value.toFixed(8));
}

function validateAndCloneCard(card: Card, reviewedAt: Date): Card {
  if (!isValidDate(card.due)) {
    throw new Error('Card due must be a valid Date');
  }
  if (!isValidDate(card.last_review)) {
    throw new Error('Persisted Card last_review must be a valid Date');
  }
  if (card.last_review.getTime() > reviewedAt.getTime()) {
    throw new Error('Card last_review cannot be after reviewedAt');
  }
  if (
    ![State.Learning, State.Review, State.Relearning].includes(card.state)
  ) {
    throw new Error('New cards must not have persisted Card state');
  }
  validateFiniteRange(card.stability, 'stability', 0.001, 36_500);
  validateFiniteRange(card.difficulty, 'difficulty', 1, 10);
  validateNonNegativeInteger(card.elapsed_days, 'elapsed_days');
  validateNonNegativeInteger(card.scheduled_days, 'scheduled_days');
  validateNonNegativeInteger(card.reps, 'reps');
  validateNonNegativeInteger(card.lapses, 'lapses');
  validateNonNegativeInteger(card.learning_steps, 'learning_steps');
  return cloneCard(card);
}

function validateFiniteRange(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Card ${name} is outside its valid range`);
  }
}

function validateNonNegativeInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Card ${name} must be a non-negative integer`);
  }
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneCard(card: Card): Card {
  return {
    ...card,
    due: new Date(card.due.getTime()),
    last_review: card.last_review
      ? new Date(card.last_review.getTime())
      : undefined,
  };
}

function cloneReviewLog(log: ReviewLog): ReviewLog {
  return {
    ...log,
    due: new Date(log.due.getTime()),
    review: new Date(log.review.getTime()),
  };
}

export interface FsrsState {
  stability: number;
  difficulty: number;
  fsrsState: string;
  lastElapsedDays: number;
  learningSteps: number;
}

export interface FsrsResult {
  nextReviewAt: Date;
  stability: number;
  difficulty: number;
  fsrsState: string;
  lastElapsedDays: number;
  intervalDays: number;
  learningSteps: number;
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
  // Default: 1 min first step, 15 min second step (graduation threshold)
  const defaultParams = generatorParameters({
    learning_steps: ['1m', '15m'],
    relearning_steps: ['10m'],
  });
  const f = fsrs(
    params
      ? generatorParameters({ ...defaultParams, ...params })
      : defaultParams,
  );

  // Build card state from current progress or empty.
  // learning_steps MUST be restored — it tracks which step the card is on.
  // Without it every Learning review restarts at step 1 and Good can never graduate.
  const card: Card = current?.stability
    ? {
        due: new Date(),
        stability: current.stability,
        difficulty: current.difficulty ?? 0,
        elapsed_days: current.lastElapsedDays ?? 0,
        scheduled_days: 0,
        learning_steps: current.learningSteps ?? 0,
        reps: 0,
        lapses: 0,
        state: mapStateFromString(current.fsrsState ?? 'new'),
        last_review: new Date(),
      }
    : createEmptyCard();

  const now = new Date();
  const result = f.next(card, now, RATING_MAP[action]);

  return {
    nextReviewAt: result.card.due, // Date — precise, no integer truncation
    stability: result.card.stability,
    difficulty: result.card.difficulty,
    fsrsState: mapStateToString(result.card.state),
    lastElapsedDays: result.card.elapsed_days,
    intervalDays: Math.ceil(result.card.scheduled_days), // for display only
    learningSteps: result.card.learning_steps,
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
