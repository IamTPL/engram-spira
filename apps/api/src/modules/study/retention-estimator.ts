import {
  forgetting_curve,
  generatorParameters,
  type FSRSParameters,
} from 'ts-fsrs';

const DAY_MS = 86_400_000;
const FSRS_WEIGHT_LENGTHS = new Set([17, 19, 21]);
const FSRS_STEP_PATTERN = /^\d+(?:\.\d+)?[mhd]$/u;

export type RetentionAlgorithm = 'sm2' | 'fsrs';

export type RetentionStatus =
  | 'new'
  | 'due'
  | 'at_risk'
  | 'on_track'
  | 'unavailable';

export interface RetentionContext {
  algorithm: RetentionAlgorithm;
  targetRetention: number | null;
  fsrsWeights: readonly number[] | null;
}

export interface RetentionProgressInput {
  lastReviewedAt: Date | null;
  nextReviewAt: Date | null;
  stability: number | null;
}

export interface RetentionAssessment {
  status: RetentionStatus;
  retention: number | null;
}

export function createRetentionContext(
  algorithm: RetentionAlgorithm,
  rawFsrsParams: unknown,
): RetentionContext {
  if (algorithm === 'sm2') {
    return {
      algorithm,
      targetRetention: null,
      fsrsWeights: null,
    };
  }

  const parameters = generatorParameters(sanitizeFsrsParameters(rawFsrsParams));

  return {
    algorithm,
    targetRetention: parameters.request_retention,
    fsrsWeights: parameters.w,
  };
}

export function assessRetention(
  context: RetentionContext,
  progress: RetentionProgressInput | null,
  asOf: Date,
): RetentionAssessment {
  if (!progress || !isValidDate(progress.lastReviewedAt)) {
    return { status: 'new', retention: null };
  }

  const due =
    isValidDate(progress.nextReviewAt) &&
    progress.nextReviewAt.getTime() <= asOf.getTime();

  if (context.algorithm === 'sm2') {
    return { status: due ? 'due' : 'on_track', retention: null };
  }

  if (
    !Number.isFinite(progress.stability) ||
    progress.stability === null ||
    progress.stability <= 0 ||
    !context.fsrsWeights ||
    context.targetRetention === null ||
    !Number.isFinite(context.targetRetention) ||
    context.targetRetention <= 0 ||
    context.targetRetention > 1
  ) {
    return { status: due ? 'due' : 'unavailable', retention: null };
  }

  const elapsedDays = Math.max(
    0,
    (asOf.getTime() - progress.lastReviewedAt.getTime()) / DAY_MS,
  );
  let rawRetention: number;
  try {
    rawRetention = forgetting_curve(
      context.fsrsWeights,
      elapsedDays,
      progress.stability,
    );
  } catch {
    return { status: due ? 'due' : 'unavailable', retention: null };
  }
  if (!Number.isFinite(rawRetention)) {
    return { status: due ? 'due' : 'unavailable', retention: null };
  }

  const retention = Math.min(1, Math.max(0, rawRetention));
  return {
    status: due
      ? 'due'
      : retention < context.targetRetention
        ? 'at_risk'
        : 'on_track',
    retention,
  };
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function sanitizeFsrsParameters(
  value: unknown,
): Partial<FSRSParameters> {
  if (!isRecord(value)) return {};

  const sanitized: Partial<FSRSParameters> = {};
  if (
    typeof value.request_retention === 'number' &&
    Number.isFinite(value.request_retention) &&
    value.request_retention > 0 &&
    value.request_retention <= 1
  ) {
    sanitized.request_retention = value.request_retention;
  }
  if (
    typeof value.maximum_interval === 'number' &&
    Number.isFinite(value.maximum_interval) &&
    value.maximum_interval > 0
  ) {
    sanitized.maximum_interval = Math.floor(value.maximum_interval);
  }
  if (
    Array.isArray(value.w) &&
    FSRS_WEIGHT_LENGTHS.has(value.w.length) &&
    value.w.every(
      (weight): weight is number =>
        typeof weight === 'number' && Number.isFinite(weight),
    )
  ) {
    sanitized.w = [...value.w];
  }
  if (typeof value.enable_fuzz === 'boolean') {
    sanitized.enable_fuzz = value.enable_fuzz;
  }
  if (typeof value.enable_short_term === 'boolean') {
    sanitized.enable_short_term = value.enable_short_term;
  }

  const learningSteps = sanitizeSteps(value.learning_steps);
  if (learningSteps) sanitized.learning_steps = learningSteps;
  const relearningSteps = sanitizeSteps(value.relearning_steps);
  if (relearningSteps) sanitized.relearning_steps = relearningSteps;

  return sanitized;
}

function sanitizeSteps(
  value: unknown,
): FSRSParameters['learning_steps'] | null {
  if (
    !Array.isArray(value) ||
    !value.every(
      (step): step is `${number}${'m' | 'h' | 'd'}` =>
        typeof step === 'string' && FSRS_STEP_PATTERN.test(step),
    )
  ) {
    return null;
  }
  return [...value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
