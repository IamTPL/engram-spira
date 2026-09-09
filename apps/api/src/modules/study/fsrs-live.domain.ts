import type { ReviewAction } from '../../shared/constants';
import { ConflictError, ValidationError } from '../../shared/errors';

const MAX_BATCH_SIZE = 100;
/**
 * Client clocks are untrusted and a grade is never rejected for one. The
 * client instant is clamped into `[receivedAt - 24 h, receivedAt]`: it only
 * refines sub-hour ordering (a re-queued grade retried minutes later, a
 * keepalive flush on page exit). Calendar facts (`study_daily_logs`) use the
 * server's `receivedAt` alone — see `groupReviewsByStudyDate`.
 */
const MAX_PAST_SKEW_MS = 24 * 60 * 60 * 1000;
const MAX_DURATION_MS = 60 * 60 * 1000;
const MIN_TIMEZONE_OFFSET_MINUTES = -840;
const MAX_TIMEZONE_OFFSET_MINUTES = 720;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/u;
const VALID_RATINGS = new Set<ReviewAction>([
  'again',
  'hard',
  'good',
  'easy',
]);
const VALID_STATES = new Set<PersistedFsrsState>([
  'learning',
  'review',
  'relearning',
]);

export type PersistedFsrsState = 'learning' | 'review' | 'relearning';

export interface ReviewEventInput {
  requestId: string;
  cardId: string;
  rating: ReviewAction;
  reviewedAt: string;
  durationMs?: number;
}

export interface NormalizedLiveReviewCommand {
  requestId: string;
  cardId: string;
  rating: ReviewAction;
  reviewedAt: string;
  receivedAt: string;
  durationMs: number | null;
  origin: 'live';
}

export interface LiveReviewEventSnapshot {
  requestId: string;
  cardId: string;
  rating: ReviewAction;
  reviewedAt: string | Date;
  durationMs: number | null;
  origin: 'live' | 'migration';
  learningCycle: number;
  sequence: number;
  afterState: PersistedFsrsState;
  afterDueAt: string | Date;
  afterStability: number;
  afterDifficulty: number;
  afterScheduledDays: number;
}

export interface ReviewEventResult {
  requestId: string;
  cardId: string;
  status: 'applied' | 'duplicate';
  learningCycle: number;
  sequence: number;
  state: PersistedFsrsState;
  nextReviewAt: string;
  stability: number;
  difficulty: number;
  scheduledDays: number;
}

export interface StudyDateReviewCount {
  studyDate: string;
  cardsReviewed: number;
}

export type ReviewPositionSource =
  | {
      state: {
        learningCycle: number;
        stateVersion: number;
      };
    }
  | {
      state: null;
      maxPriorLearningCycle: number | null;
    };

export interface ReviewPosition {
  learningCycle: number;
  sequence: number;
}

export function normalizeLiveReviewCommands(
  inputs: readonly unknown[],
  receivedAt: Date,
): NormalizedLiveReviewCommand[] {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_BATCH_SIZE) {
    throw new ValidationError(
      `Review batch must contain between 1 and ${MAX_BATCH_SIZE} events`,
    );
  }
  const receivedAtIso = canonicalInstant(receivedAt, 'receivedAt').iso;
  const receivedAtMs = receivedAt.getTime();
  const requestIds = new Set<string>();

  return inputs.map((rawInput, index) => {
    if (!isRecord(rawInput)) {
      throw new ValidationError(`Review event ${index + 1} must be an object`);
    }
    const requestId = canonicalUuid(
      rawInput.requestId,
      `Review event ${index + 1} requestId`,
    );
    const cardId = canonicalUuid(
      rawInput.cardId,
      `Review event ${index + 1} cardId`,
    );
    const rating = normalizeRating(
      rawInput.rating,
      `Review event ${index + 1} rating`,
    );
    if (typeof rawInput.reviewedAt !== 'string') {
      throw new ValidationError(
        `Review event ${index + 1} reviewedAt must be an ISO-8601 instant string`,
      );
    }
    const clientReviewedAt = canonicalInstant(
      rawInput.reviewedAt,
      `Review event ${index + 1} reviewedAt`,
    );
    const reviewedAt = clampInstant(
      clientReviewedAt,
      receivedAtMs - MAX_PAST_SKEW_MS,
      receivedAtMs,
    );
    const durationMs = normalizeDuration(
      rawInput.durationMs,
      `Review event ${index + 1} durationMs`,
    );

    if (requestIds.has(requestId)) {
      throw new ValidationError('Review batch contains a duplicate requestId');
    }
    requestIds.add(requestId);

    return {
      requestId,
      cardId,
      rating,
      reviewedAt: reviewedAt.iso,
      receivedAt: receivedAtIso,
      durationMs,
      origin: 'live',
    };
  });
}

/**
 * A retried `requestId` must describe the same review (card, rating, live
 * origin). `reviewedAt` and `durationMs` are deliberately not compared: the
 * server clamps `reviewedAt` against its own clock and the card's state, so a
 * byte-identical retry can legitimately differ from what was persisted.
 */
export function assertMatchingLiveReviewRequest(
  command: NormalizedLiveReviewCommand,
  existing: LiveReviewEventSnapshot,
): void {
  const samePayload =
    canonicalUuid(existing.requestId, 'Persisted review requestId') ===
      command.requestId &&
    canonicalUuid(existing.cardId, 'Persisted review cardId') ===
      command.cardId &&
    existing.rating === command.rating &&
    existing.origin === 'live';
  if (!samePayload) {
    throw new ConflictError(
      'Review requestId was already used with a different payload',
    );
  }
}

export function reviewResultFromEvent(
  event: LiveReviewEventSnapshot,
  status: ReviewEventResult['status'],
): ReviewEventResult {
  if (status !== 'applied' && status !== 'duplicate') {
    throw new ValidationError('Invalid review result status');
  }
  if (!VALID_STATES.has(event.afterState)) {
    throw new ValidationError('Persisted review has an invalid after state');
  }
  validatePositivePostgresInteger(
    event.learningCycle,
    'Persisted review learningCycle',
    false,
  );
  validatePositivePostgresInteger(
    event.sequence,
    'Persisted review sequence',
    false,
  );
  if (!Number.isFinite(event.afterStability) || event.afterStability <= 0) {
    throw new ValidationError(
      'Persisted review afterStability must be a positive finite number',
    );
  }
  if (
    !Number.isFinite(event.afterDifficulty) ||
    event.afterDifficulty < 1 ||
    event.afterDifficulty > 10
  ) {
    throw new ValidationError(
      'Persisted review afterDifficulty must be between 1 and 10',
    );
  }
  validateNonNegativePostgresInteger(
    event.afterScheduledDays,
    'Persisted review afterScheduledDays',
  );

  return {
    requestId: canonicalUuid(event.requestId, 'Persisted review requestId'),
    cardId: canonicalUuid(event.cardId, 'Persisted review cardId'),
    status,
    learningCycle: event.learningCycle,
    sequence: event.sequence,
    state: event.afterState,
    nextReviewAt: canonicalInstant(
      event.afterDueAt,
      'Persisted review afterDueAt',
    ).iso,
    stability: event.afterStability,
    difficulty: event.afterDifficulty,
    scheduledDays: event.afterScheduledDays,
  };
}

/**
 * A card's history is monotonic. A client instant earlier than the card's
 * `lastReviewedAt` (clock behind the server, or a 1-minute learning step
 * graded from a machine a few minutes slow) is clamped up to that instant
 * rather than rejected, so the grade is never lost.
 */
export function clampReviewChronology(
  reviewedAt: string | Date,
  lastReviewedAt: string | Date,
): string {
  const reviewed = canonicalInstant(reviewedAt, 'reviewedAt');
  const previous = canonicalInstant(lastReviewedAt, 'lastReviewedAt');
  return reviewed.milliseconds < previous.milliseconds
    ? previous.iso
    : reviewed.iso;
}

export function studyDateForReviewedAt(
  reviewedAt: string | Date,
  timezoneOffsetMinutes: number,
): string {
  validateTimezoneOffset(timezoneOffsetMinutes);
  const reviewed = canonicalInstant(reviewedAt, 'reviewedAt');
  return new Date(
    reviewed.milliseconds - timezoneOffsetMinutes * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
}

/**
 * Daily activity is a calendar fact, so it follows the server clock
 * (`receivedAt`) — the same clock `getUserStreak` compares against. Grouping
 * by the client instant would let a slow client clock write a days-old row
 * and silently break the streak it just extended.
 */
export function groupReviewsByStudyDate(
  commands: readonly NormalizedLiveReviewCommand[],
  timezoneOffsetMinutes: number,
): StudyDateReviewCount[] {
  validateTimezoneOffset(timezoneOffsetMinutes);
  const counts = new Map<string, number>();
  for (const command of commands) {
    const studyDate = studyDateForReviewedAt(
      command.receivedAt,
      timezoneOffsetMinutes,
    );
    counts.set(studyDate, (counts.get(studyDate) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => compareCanonicalText(left, right))
    .map(([studyDate, cardsReviewed]) => ({ studyDate, cardsReviewed }));
}

export function deriveNextReviewPosition(
  source: ReviewPositionSource,
): ReviewPosition {
  if (source.state !== null) {
    validatePositivePostgresInteger(
      source.state.learningCycle,
      'learningCycle',
      false,
    );
    validatePositivePostgresInteger(
      source.state.stateVersion,
      'stateVersion',
      true,
    );
    return {
      learningCycle: source.state.learningCycle,
      sequence: source.state.stateVersion + 1,
    };
  }

  if (source.maxPriorLearningCycle === null) {
    return { learningCycle: 1, sequence: 1 };
  }
  validatePositivePostgresInteger(
    source.maxPriorLearningCycle,
    'maxPriorLearningCycle',
    true,
  );
  return {
    learningCycle: source.maxPriorLearningCycle + 1,
    sequence: 1,
  };
}

export function sortedUniqueCardIds(
  commands: readonly NormalizedLiveReviewCommand[],
): string[] {
  return [...new Set(commands.map((command) => command.cardId))].sort(
    compareCanonicalText,
  );
}

export function orderReviewResults(
  commands: readonly NormalizedLiveReviewCommand[],
  results: readonly ReviewEventResult[],
): ReviewEventResult[] {
  if (commands.length !== results.length) {
    throw new ValidationError(
      'Review results do not contain exactly one result per command',
    );
  }
  const commandsByRequestId = new Map(
    commands.map((command) => [command.requestId, command]),
  );
  const resultsByRequestId = new Map<string, ReviewEventResult>();

  for (const result of results) {
    const requestId = canonicalUuid(result.requestId, 'Review result requestId');
    const command = commandsByRequestId.get(requestId);
    if (!command) {
      throw new ValidationError('Review results contain an unknown requestId');
    }
    if (resultsByRequestId.has(requestId)) {
      throw new ValidationError('Review results contain a duplicate requestId');
    }
    if (
      canonicalUuid(result.cardId, 'Review result cardId') !== command.cardId
    ) {
      throw new ValidationError(
        'Review result cardId does not match its command',
      );
    }
    resultsByRequestId.set(requestId, result);
  }

  return commands.map((command) => {
    const result = resultsByRequestId.get(command.requestId);
    if (!result) {
      throw new ValidationError(
        'Review results are missing a command result',
      );
    }
    return result;
  });
}

function normalizeRating(value: unknown, name: string): ReviewAction {
  if (typeof value !== 'string' || !VALID_RATINGS.has(value as ReviewAction)) {
    throw new ValidationError(
      `${name} must be one of again, hard, good, or easy`,
    );
  }
  return value as ReviewAction;
}

function normalizeDuration(value: unknown, name: string): number | null {
  if (value === undefined) return null;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_DURATION_MS
  ) {
    throw new ValidationError(
      `${name} must be an integer between 0 and ${MAX_DURATION_MS}`,
    );
  }
  return value;
}

export function canonicalUuid(value: unknown, name: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }
  return value.toLowerCase();
}

function clampInstant(
  instant: { iso: string; milliseconds: number },
  minimumMs: number,
  maximumMs: number,
): { iso: string; milliseconds: number } {
  if (instant.milliseconds < minimumMs) {
    return { iso: new Date(minimumMs).toISOString(), milliseconds: minimumMs };
  }
  if (instant.milliseconds > maximumMs) {
    return { iso: new Date(maximumMs).toISOString(), milliseconds: maximumMs };
  }
  return instant;
}

function canonicalInstant(
  value: unknown,
  name: string,
): { iso: string; milliseconds: number } {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    if (!Number.isFinite(milliseconds)) {
      throw new ValidationError(`${name} must be a valid instant`);
    }
    const canonical = new Date(milliseconds);
    if (canonical.getUTCFullYear() < 1 || canonical.getUTCFullYear() > 9999) {
      throw new ValidationError(`${name} must be a valid instant`);
    }
    return {
      iso: canonical.toISOString(),
      milliseconds,
    };
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${name} must be an ISO-8601 instant`);
  }

  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match) {
    throw new ValidationError(`${name} must be an ISO-8601 instant`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? '';
  const timezone = match[8]!;
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new ValidationError(`${name} must be a valid ISO-8601 instant`);
  }
  if (fraction.length > 3 && /[1-9]/u.test(fraction.slice(3))) {
    throw new ValidationError(
      `${name} must not contain nonzero precision below a millisecond`,
    );
  }

  const millisecond = Number(`${fraction}000`.slice(0, 3));
  let timezoneOffset = 0;
  if (timezone !== 'Z') {
    const offsetHour = Number(match[10]);
    const offsetMinute = Number(match[11]);
    if (
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      throw new ValidationError(`${name} has an invalid timezone offset`);
    }
    const direction = match[9] === '+' ? 1 : -1;
    timezoneOffset = direction * (offsetHour * 60 + offsetMinute);
  }

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millisecond);
  const milliseconds = local.getTime() - timezoneOffset * 60 * 1000;
  if (!Number.isFinite(milliseconds)) {
    throw new ValidationError(`${name} must be a valid ISO-8601 instant`);
  }
  const canonical = new Date(milliseconds);
  if (canonical.getUTCFullYear() < 1 || canonical.getUTCFullYear() > 9999) {
    throw new ValidationError(`${name} must be a valid ISO-8601 instant`);
  }
  return {
    iso: canonical.toISOString(),
    milliseconds,
  };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validateTimezoneOffset(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < MIN_TIMEZONE_OFFSET_MINUTES ||
    value > MAX_TIMEZONE_OFFSET_MINUTES
  ) {
    throw new ValidationError(
      `timezoneOffsetMinutes must be an integer between ${MIN_TIMEZONE_OFFSET_MINUTES} and ${MAX_TIMEZONE_OFFSET_MINUTES}`,
    );
  }
}

function validatePositivePostgresInteger(
  value: number,
  name: string,
  requiresIncrement: boolean,
): void {
  const maximum = requiresIncrement
    ? MAX_POSTGRES_INTEGER - 1
    : MAX_POSTGRES_INTEGER;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ValidationError(
      `${name} must be a positive integer${requiresIncrement ? ' with room to increment' : ''}`,
    );
  }
}

function validateNonNegativePostgresInteger(
  value: number,
  name: string,
): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_POSTGRES_INTEGER
  ) {
    throw new ValidationError(`${name} must be a non-negative integer`);
  }
}

function compareCanonicalText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
