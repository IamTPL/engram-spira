import {
  forgetting_curve,
  type FSRSParameters,
} from 'ts-fsrs';
import { ValidationError } from '../../shared/errors';
import { canonicalUuid } from './fsrs-live.domain';
import {
  validateFsrsParameterRevisionIdentity,
  type FsrsParameterRevisionIdentity,
} from './fsrs-revision';

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const PERSISTED_STATES = new Set<PersistedFsrsReadState>([
  'learning',
  'review',
  'relearning',
]);
const DAY_MS = 86_400_000;

export type PersistedFsrsReadState =
  | 'learning'
  | 'review'
  | 'relearning';

export interface CanonicalFsrsCardState {
  id: string;
  userId: string;
  cardId: string;
  nextReviewAt: Date;
  lastReviewedAt: Date;
  stability: number;
  difficulty: number;
  state: PersistedFsrsReadState;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  parameterRevisionId: string;
  stateVersion: number;
  learningCycle: number;
  updatedAt: Date;
}

export interface CanonicalFsrsParameterRevision
  extends FsrsParameterRevisionIdentity {
  userId: string;
  parameters: Record<string, unknown>;
  source: 'default' | 'manual' | 'optimized' | 'migration';
  createdAt: Date;
  activatedAt: Date;
  retiredAt: Date | null;
}

export interface CanonicalFsrsRead {
  state: CanonicalFsrsCardState;
  revision: CanonicalFsrsParameterRevision;
}

/**
 * Returns continuous-time FSRS-6 retrievability for a canonical state using
 * the pinned ts-fsrs forgetting curve.
 *
 * New cards are represented by a null read model and return null. `asOf`
 * earlier than the persisted review is rejected; callers must choose an
 * explicit historical policy rather than receiving a silent clamp.
 */
export function calculateCanonicalFsrsRetrievability(
  input: CanonicalFsrsRead | null,
  asOf: Date,
): number | null {
  const canonicalAsOf = validDate(asOf, 'asOf');
  if (input === null) return null;

  const validated = validateCanonicalFsrsRead(input);
  if (
    canonicalAsOf.getTime() <
    validated.state.lastReviewedAt.getTime()
  ) {
    throw new ValidationError(
      'asOf cannot be before the canonical state lastReviewedAt',
    );
  }

  const state = validated.state;
  const elapsedDays =
    (canonicalAsOf.getTime() - state.lastReviewedAt.getTime()) /
    DAY_MS;

  let retrievability: number;
  try {
    const parameters =
      validated.revision.parameters as unknown as FSRSParameters;
    retrievability = forgetting_curve(
      parameters.w,
      elapsedDays,
      Number(state.stability.toFixed(8)),
    );
  } catch (error) {
    throw new ValidationError(
      error instanceof Error
        ? error.message
        : 'Unable to calculate canonical FSRS retrievability',
    );
  }
  if (
    !Number.isFinite(retrievability) ||
    retrievability < 0 ||
    retrievability > 1
  ) {
    throw new ValidationError(
      'Canonical FSRS retrievability is outside [0, 1]',
    );
  }
  return retrievability;
}

export function validateCanonicalFsrsRead(
  input: CanonicalFsrsRead,
): CanonicalFsrsRead {
  if (!isRecord(input) || !isRecord(input.state) || !isRecord(input.revision)) {
    throw new ValidationError(
      'Canonical FSRS read must contain a state and parameter revision',
    );
  }

  const persisted = input.state;
  const revision = input.revision;
  const stateUserId = canonicalPersistedUuid(
    persisted.userId,
    'FSRS state user id',
  );
  const revisionUserId = canonicalPersistedUuid(
    revision.userId,
    'FSRS parameter revision user id',
  );
  const parameterRevisionId = canonicalPersistedUuid(
    persisted.parameterRevisionId,
    'FSRS state parameter revision id',
  );
  const revisionId = canonicalPersistedUuid(
    revision.id,
    'FSRS parameter revision id',
  );
  canonicalPersistedUuid(persisted.id, 'FSRS state id');
  canonicalPersistedUuid(persisted.cardId, 'FSRS state card id');

  if (stateUserId !== revisionUserId) {
    throw new ValidationError(
      'FSRS state and parameter revision owners do not match',
    );
  }
  if (parameterRevisionId !== revisionId) {
    throw new ValidationError(
      'FSRS state parameter revision id does not match its revision',
    );
  }

  const nextReviewAt = validDate(
    persisted.nextReviewAt,
    'FSRS state nextReviewAt',
  );
  const lastReviewedAt = validDate(
    persisted.lastReviewedAt,
    'FSRS state lastReviewedAt',
  );
  const updatedAt = validDate(persisted.updatedAt, 'FSRS state updatedAt');
  if (nextReviewAt.getTime() < lastReviewedAt.getTime()) {
    throw new ValidationError(
      'FSRS state nextReviewAt cannot be before lastReviewedAt',
    );
  }
  finiteRange(persisted.stability, 'FSRS state stability', 0, undefined, true);
  finiteRange(persisted.difficulty, 'FSRS state difficulty', 1, 10);
  if (!PERSISTED_STATES.has(persisted.state)) {
    throw new ValidationError('FSRS state value is invalid');
  }
  nonNegativeInteger(persisted.elapsedDays, 'FSRS state elapsedDays');
  nonNegativeInteger(persisted.scheduledDays, 'FSRS state scheduledDays');
  nonNegativeInteger(persisted.learningSteps, 'FSRS state learningSteps');
  positiveInteger(persisted.reps, 'FSRS state reps');
  nonNegativeInteger(persisted.lapses, 'FSRS state lapses');
  if (persisted.lapses > persisted.reps) {
    throw new ValidationError('FSRS state lapses cannot exceed reps');
  }
  positiveInteger(persisted.stateVersion, 'FSRS state stateVersion');
  if (persisted.stateVersion !== persisted.reps) {
    throw new ValidationError('FSRS state stateVersion must equal reps');
  }
  positiveInteger(persisted.learningCycle, 'FSRS state learningCycle');

  const parameters = validateFsrsParameterRevisionIdentity(
    revisionUserId,
    revision,
  );
  const createdAt = validDate(
    revision.createdAt,
    'FSRS parameter revision createdAt',
  );
  const activatedAt = validDate(
    revision.activatedAt,
    'FSRS parameter revision activatedAt',
  );
  const retiredAt =
    revision.retiredAt === null
      ? null
      : validDate(
          revision.retiredAt,
          'FSRS parameter revision retiredAt',
        );
  if (
    createdAt.getTime() > activatedAt.getTime() ||
    (retiredAt !== null &&
      activatedAt.getTime() > retiredAt.getTime())
  ) {
    throw new ValidationError(
      'FSRS parameter revision timestamps are inconsistent',
    );
  }

  return {
    state: {
      ...persisted,
      nextReviewAt,
      lastReviewedAt,
      updatedAt,
    },
    revision: {
      ...revision,
      parameters,
      createdAt,
      activatedAt,
      retiredAt,
    },
  };
}

function canonicalPersistedUuid(value: unknown, name: string): string {
  const canonical = canonicalUuid(value, name);
  if (canonical !== value) {
    throw new ValidationError(`${name} must be a canonical lowercase UUID`);
  }
  return canonical;
}

function validDate(value: unknown, name: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ValidationError(`${name} must be a valid Date`);
  }
  const result = new Date(value.getTime());
  if (result.getUTCFullYear() < 1 || result.getUTCFullYear() > 9999) {
    throw new ValidationError(`${name} must be a valid Date`);
  }
  return result;
}

function finiteRange(
  value: unknown,
  name: string,
  minimum: number,
  maximum?: number,
  exclusiveMinimum = false,
) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (exclusiveMinimum ? value <= minimum : value < minimum) ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new ValidationError(`${name} is outside its valid range`);
  }
}

function nonNegativeInteger(value: unknown, name: string) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_POSTGRES_INTEGER
  ) {
    throw new ValidationError(`${name} must be a non-negative integer`);
  }
}

function positiveInteger(value: unknown, name: string) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_POSTGRES_INTEGER
  ) {
    throw new ValidationError(`${name} must be a positive integer`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
