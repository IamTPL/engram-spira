import { createHash } from 'node:crypto';
import { State, type Card, type FSRSParameters } from 'ts-fsrs';
import type { ReviewAction } from '../../shared/constants';
import { ValidationError } from '../../shared/errors';
import {
  FSRS_ALGORITHM_VERSION,
  FSRS_LIBRARY_VERSION,
  FSRS_POLICY_VERSION,
  normalizeFsrsParameters,
  scheduleFsrsReview,
} from './fsrs.engine';

export const FSRS_REPLAY_VERSION = 'engram-fsrs-replay-v1';
export const FSRS_REPLAY_UUID_NAMESPACE =
  '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SOURCE_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;
const SCHEDULER_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const RATINGS = new Set<ReviewAction>(['again', 'hard', 'good', 'easy']);

export type FsrsReplayScope =
  | { kind: 'all_users' }
  | { kind: 'user'; userId: string };

export interface FsrsReplayParameterRow {
  userId: string;
  parameters: unknown;
}

export interface FsrsReplayReviewFact {
  logId: string;
  userId: string;
  cardId: string;
  ownerUserId: string;
  rating: ReviewAction;
  legacyState: 'new' | 'learning' | 'review' | 'relearning';
  sourceReviewedAt: string;
  schedulerReviewedAt: string;
}

export interface FsrsReplayProgressIdentity {
  userId: string;
  cardId: string;
  ownerUserId: string;
}

export interface FsrsReplaySnapshot {
  scope: FsrsReplayScope;
  scopedUserIds: string[];
  legacyParameterRows: FsrsReplayParameterRow[];
  reviews: FsrsReplayReviewFact[];
  progress: FsrsReplayProgressIdentity[];
}

export interface FsrsReplayParameterRevision {
  id: string;
  userId: string;
  revision: 1;
  engineVersion: string;
  algorithmVersion: string;
  policyVersion: string;
  parameters: Record<string, unknown>;
  paramsHash: string;
  source: 'default' | 'migration';
}

export type PersistedFsrsState = 'learning' | 'review' | 'relearning';

export interface FsrsReplayEvent {
  id: string;
  requestId: string;
  sourceLogId: string;
  sourceReviewedAt: string;
  userId: string;
  cardId: string;
  learningCycle: number;
  sequence: number;
  rating: ReviewAction;
  reviewedAt: string;
  durationMs: null;
  parameterRevisionId: string;
  origin: 'migration';
  beforeState: PersistedFsrsState | null;
  beforeDueAt: string | null;
  beforeStability: number | null;
  beforeDifficulty: number | null;
  beforeScheduledDays: number | null;
  beforeLearningSteps: number | null;
  elapsedDays: number;
  afterState: PersistedFsrsState;
  afterDueAt: string;
  afterStability: number;
  afterDifficulty: number;
  afterScheduledDays: number;
  afterLearningSteps: number;
  afterReps: number;
  afterLapses: number;
  afterStateVersion: number;
}

export interface FsrsReplayCardState {
  userId: string;
  cardId: string;
  nextReviewAt: string;
  lastReviewedAt: string;
  stability: number;
  difficulty: number;
  state: PersistedFsrsState;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  parameterRevisionId: string;
  stateVersion: number;
  learningCycle: number;
}

export interface FsrsReplayAnomalies {
  progressWithoutHistory: Array<{ userId: string; cardId: string }>;
  sameTimestampReviews: Array<{
    userId: string;
    cardId: string;
    sourceReviewedAt: string;
    logIds: string[];
  }>;
  inferredResets: Array<{ userId: string; cardId: string }>;
  truncatedHistories: Array<{
    userId: string;
    cardId: string;
    firstLogId: string;
    legacyState: 'learning' | 'review' | 'relearning';
  }>;
}

export interface FsrsReplayCounts {
  users: number;
  reviews: number;
  progressRows: number;
  parameterRevisions: number;
  events: number;
  cardStates: number;
  progressWithoutHistory: number;
  sameTimestampReviewGroups: number;
  inferredResets: number;
  truncatedHistories: number;
}

export interface FsrsReplayManifest {
  replayVersion: string;
  engineVersion: string;
  algorithmVersion: string;
  policyVersion: string;
  scope: FsrsReplayScope;
  parameterRevisions: FsrsReplayParameterRevision[];
  events: FsrsReplayEvent[];
  cardStates: FsrsReplayCardState[];
  anomalies: FsrsReplayAnomalies;
  counts: FsrsReplayCounts;
  sourceChecksum: string;
  resultChecksum: string;
}

interface NormalizedReviewFact extends FsrsReplayReviewFact {
  reviewedAtDate: Date;
}

export function createFsrsReplayPlan(
  input: FsrsReplaySnapshot,
): FsrsReplayManifest {
  try {
    const scopedUserIds = validateScope(input.scope, input.scopedUserIds);
    const scopedUsers = new Set(scopedUserIds);
    const parameterRows = normalizeParameterRows(
      input.legacyParameterRows,
      scopedUsers,
    );
    const progress = normalizeProgress(input.progress, scopedUsers);
    const reviews = normalizeReviews(input.reviews, scopedUsers, progress);
    const revisions = createParameterRevisions(
      scopedUserIds,
      parameterRows,
    );
    const revisionByUser = new Map(
      revisions.map((revision) => [revision.userId, revision]),
    );
    const anomalies = createAnomalies(reviews, progress);
    const { events, cardStates } = replayReviews(
      reviews,
      revisionByUser,
      progress,
    );
    const counts: FsrsReplayCounts = {
      users: scopedUserIds.length,
      reviews: reviews.length,
      progressRows: progress.length,
      parameterRevisions: revisions.length,
      events: events.length,
      cardStates: cardStates.length,
      progressWithoutHistory: anomalies.progressWithoutHistory.length,
      sameTimestampReviewGroups: anomalies.sameTimestampReviews.length,
      inferredResets: anomalies.inferredResets.length,
      truncatedHistories: anomalies.truncatedHistories.length,
    };
    const scope = cloneScope(input.scope);
    const provenance = {
      replayVersion: FSRS_REPLAY_VERSION,
      engineVersion: FSRS_LIBRARY_VERSION,
      algorithmVersion: FSRS_ALGORITHM_VERSION,
      policyVersion: FSRS_POLICY_VERSION,
    };
    const sourceChecksum = sha256Canonical({
      ...provenance,
      scope,
      scopedUserIds,
      parameters: revisions.map((revision) => ({
        userId: revision.userId,
        parameters: revision.parameters,
        paramsHash: revision.paramsHash,
        source: revision.source,
      })),
      reviews: projectTrustedReviewFacts(reviews),
      progress,
      anomalies,
      counts: {
        users: counts.users,
        reviews: counts.reviews,
        progressRows: counts.progressRows,
      },
    });
    const resultChecksum = sha256Canonical({
      ...provenance,
      scope,
      parameterRevisions: revisions,
      events: events.map(fsrsReplayPersistedEventPayload),
      cardStates,
      anomalies,
      counts,
    });

    return deepFreeze({
      ...provenance,
      scope,
      parameterRevisions: revisions,
      events,
      cardStates,
      anomalies,
      counts,
      sourceChecksum,
      resultChecksum,
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(
      error instanceof Error ? error.message : 'Invalid FSRS replay snapshot',
    );
  }
}

export function canonicalJson(value: unknown): string {
  return serializeCanonical(value, new WeakSet<object>());
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function uuidV5(name: string, namespace: string): string {
  if (typeof name !== 'string') {
    throw new ValidationError('UUIDv5 name must be a string');
  }
  validateUuid(namespace, 'UUIDv5 namespace');
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  const digest = createHash('sha1')
    .update(namespaceBytes)
    .update(Buffer.from(name, 'utf8'))
    .digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function validateScope(
  scope: FsrsReplayScope,
  userIds: readonly string[],
): string[] {
  if (
    !scope ||
    (scope.kind !== 'all_users' && scope.kind !== 'user')
  ) {
    throw new ValidationError('Replay scope is invalid');
  }
  const normalized = userIds.map((id) =>
    validateUuid(id, 'Scoped user id'),
  );
  ensureUnique(normalized, 'Scoped user id');
  normalized.sort(asciiCompare);

  if (scope.kind === 'user') {
    const scopedId = validateUuid(scope.userId, 'Replay scope user id');
    if (normalized.length !== 1 || normalized[0] !== scopedId) {
      throw new ValidationError(
        'User replay scope must contain exactly its declared user',
      );
    }
  }
  return normalized;
}

function normalizeParameterRows(
  rows: readonly FsrsReplayParameterRow[],
  scopedUsers: ReadonlySet<string>,
): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const source of rows) {
    try {
      const userId = validateUuid(source.userId, 'Parameter user id');
      if (!scopedUsers.has(userId)) {
        throw new ValidationError('Parameter row is outside replay scope');
      }
      if (result.has(userId)) {
        throw new ValidationError('Duplicate parameter row for replay user');
      }
      result.set(userId, source.parameters);
    } catch {
      throw new ValidationError(
        `Invalid FSRS parameters for user=${safeContextUuid(source.userId)}`,
      );
    }
  }
  return result;
}

function normalizeProgress(
  rows: readonly FsrsReplayProgressIdentity[],
  scopedUsers: ReadonlySet<string>,
): FsrsReplayProgressIdentity[] {
  const result: FsrsReplayProgressIdentity[] = [];
  const identities = new Set<string>();
  const cardOwners = new Map<string, string>();
  for (const source of rows) {
    try {
      const row = {
        userId: validateUuid(source.userId, 'Progress user id'),
        cardId: validateUuid(source.cardId, 'Progress card id'),
        ownerUserId: validateUuid(
          source.ownerUserId,
          'Progress owner user id',
        ),
      };
      if (!scopedUsers.has(row.userId)) {
        throw new ValidationError('Progress row is outside replay scope');
      }
      if (row.userId !== row.ownerUserId) {
        throw new ValidationError('Progress card ownership mismatch');
      }
      const identity = `${row.userId}/${row.cardId}`;
      if (identities.has(identity)) {
        throw new ValidationError('Duplicate progress identity');
      }
      identities.add(identity);
      validateCardOwner(cardOwners, row.cardId, row.ownerUserId);
      result.push(row);
    } catch {
      throw new ValidationError(
        `Invalid replay progress for user=${safeContextUuid(source.userId)} card=${safeContextUuid(source.cardId)}`,
      );
    }
  }
  return result.sort(compareUserCard);
}

function normalizeReviews(
  rows: readonly FsrsReplayReviewFact[],
  scopedUsers: ReadonlySet<string>,
  progress: readonly FsrsReplayProgressIdentity[],
): NormalizedReviewFact[] {
  const result: NormalizedReviewFact[] = [];
  const logIds = new Set<string>();
  const cardOwners = new Map(
    progress.map((row) => [row.cardId, row.ownerUserId]),
  );
  for (const source of rows) {
    try {
      const logId = validateUuid(source.logId, 'Review log id');
      if (logIds.has(logId)) {
        throw new ValidationError('Duplicate review log id');
      }
      logIds.add(logId);
      const userId = validateUuid(source.userId, 'Review user id');
      const cardId = validateUuid(source.cardId, 'Review card id');
      const ownerUserId = validateUuid(
        source.ownerUserId,
        'Review owner user id',
      );
      if (!scopedUsers.has(userId)) {
        throw new ValidationError('Review row is outside replay scope');
      }
      if (userId !== ownerUserId) {
        throw new ValidationError('Review card ownership mismatch');
      }
      validateCardOwner(cardOwners, cardId, ownerUserId);
      if (!RATINGS.has(source.rating)) {
        throw new ValidationError('Invalid replay review rating');
      }
      if (
        source.legacyState !== 'new' &&
        source.legacyState !== 'learning' &&
        source.legacyState !== 'review' &&
        source.legacyState !== 'relearning'
      ) {
        throw new ValidationError('Invalid legacy review state');
      }
      const { sourceReviewedAt, schedulerReviewedAt, reviewedAtDate } =
        validateReviewTimestamps(
          source.sourceReviewedAt,
          source.schedulerReviewedAt,
        );
      result.push({
        logId,
        userId,
        cardId,
        ownerUserId,
        rating: source.rating,
        legacyState: source.legacyState,
        sourceReviewedAt,
        schedulerReviewedAt,
        reviewedAtDate,
      });
    } catch (error) {
      throw new ValidationError(
        `Invalid replay review for user=${safeContextUuid(source.userId)} card=${safeContextUuid(source.cardId)} log=${safeContextUuid(source.logId)}: ${safeValidationReason(error)}`,
      );
    }
  }
  return result.sort(compareReviews);
}

function createParameterRevisions(
  scopedUserIds: readonly string[],
  parameterRows: ReadonlyMap<string, unknown>,
): FsrsReplayParameterRevision[] {
  return scopedUserIds.map((userId) => {
    const hasCustomParameters = parameterRows.has(userId);
    let parameters: Record<string, unknown>;
    try {
      parameters = plainParameters(
        normalizeFsrsParameters(
          hasCustomParameters ? parameterRows.get(userId) : undefined,
        ),
      );
    } catch {
      throw new ValidationError(
        `Invalid FSRS parameters for user=${userId}`,
      );
    }
    const paramsHash = sha256Canonical(parameters);
    const id = uuidV5(
      [
        'parameter-revision',
        userId,
        FSRS_LIBRARY_VERSION,
        FSRS_ALGORITHM_VERSION,
        FSRS_POLICY_VERSION,
        paramsHash,
      ].join('/'),
      FSRS_REPLAY_UUID_NAMESPACE,
    );
    return {
      id,
      userId,
      revision: 1,
      engineVersion: FSRS_LIBRARY_VERSION,
      algorithmVersion: FSRS_ALGORITHM_VERSION,
      policyVersion: FSRS_POLICY_VERSION,
      parameters,
      paramsHash,
      source: hasCustomParameters ? 'migration' : 'default',
    };
  });
}

function createAnomalies(
  reviews: readonly NormalizedReviewFact[],
  progress: readonly FsrsReplayProgressIdentity[],
): FsrsReplayAnomalies {
  const histories = new Set(
    reviews.map((review) => `${review.userId}/${review.cardId}`),
  );
  const progressWithoutHistory = progress
    .filter((row) => !histories.has(`${row.userId}/${row.cardId}`))
    .map((row) => ({ userId: row.userId, cardId: row.cardId }));
  const exactTimestampGroups = new Map<string, NormalizedReviewFact[]>();
  for (const review of reviews) {
    const key = [
      review.userId,
      review.cardId,
      review.sourceReviewedAt,
    ].join('/');
    const group = exactTimestampGroups.get(key) ?? [];
    group.push(review);
    exactTimestampGroups.set(key, group);
  }
  const sameTimestampReviews = [...exactTimestampGroups.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      userId: group[0]!.userId,
      cardId: group[0]!.cardId,
      sourceReviewedAt: group[0]!.sourceReviewedAt,
      logIds: group.map((review) => review.logId).sort(asciiCompare),
    }))
    .sort((left, right) =>
      compareTuple(
        [left.userId, left.cardId, left.sourceReviewedAt],
        [right.userId, right.cardId, right.sourceReviewedAt],
      ),
    );
  const progressIdentities = new Set(
    progress.map((row) => `${row.userId}/${row.cardId}`),
  );
  const groups = groupReviewsByCard(reviews);
  const inferredResets = [...groups.values()]
    .filter((group) =>
      !progressIdentities.has(`${group[0]!.userId}/${group[0]!.cardId}`),
    )
    .map((group) => ({
      userId: group[0]!.userId,
      cardId: group[0]!.cardId,
    }))
    .sort(compareUserCard);
  const truncatedHistories = [...groups.values()]
    .filter((group) => group[0]!.legacyState !== 'new')
    .map((group) => ({
      userId: group[0]!.userId,
      cardId: group[0]!.cardId,
      firstLogId: group[0]!.logId,
      legacyState: group[0]!.legacyState as
        | 'learning'
        | 'review'
        | 'relearning',
    }))
    .sort(compareUserCard);
  return {
    progressWithoutHistory,
    sameTimestampReviews,
    inferredResets,
    truncatedHistories,
  };
}

function replayReviews(
  reviews: readonly NormalizedReviewFact[],
  revisionByUser: ReadonlyMap<string, FsrsReplayParameterRevision>,
  progress: readonly FsrsReplayProgressIdentity[],
): {
  events: FsrsReplayEvent[];
  cardStates: FsrsReplayCardState[];
} {
  const groups = groupReviewsByCard(reviews);
  const progressIdentities = new Set(
    progress.map((row) => `${row.userId}/${row.cardId}`),
  );

  const events: FsrsReplayEvent[] = [];
  const cardStates: FsrsReplayCardState[] = [];
  for (const group of groups.values()) {
    let current: Card | null = null;
    let finalEvent: FsrsReplayEvent | null = null;
    let learningCycle = 1;
    let sequence = 0;
    let resetTimestamp =
      group[0]!.legacyState === 'new'
        ? group[0]!.sourceReviewedAt
        : null;
    const revision = revisionByUser.get(group[0]!.userId);
    if (!revision) {
      throw new ValidationError('Missing replay parameter revision');
    }
    group.sort(compareReviews);
    group.forEach((review, index) => {
      if (
        index > 0 &&
        review.legacyState === 'new' &&
        review.sourceReviewedAt !== resetTimestamp
      ) {
        learningCycle += 1;
        sequence = 0;
        current = null;
        finalEvent = null;
        resetTimestamp = review.sourceReviewedAt;
      }
      sequence += 1;
      let scheduled: ReturnType<typeof scheduleFsrsReview>;
      try {
        scheduled = scheduleFsrsReview({
          current,
          rating: review.rating,
          reviewedAt: review.reviewedAtDate,
          parameters: revision.parameters,
        });
      } catch (error) {
        throw new ValidationError(
          `FSRS replay scheduling failed for user=${review.userId} card=${review.cardId} log=${review.logId}: ${safeValidationReason(error)}`,
        );
      }
      validateScheduledCard(scheduled.after, sequence, review.reviewedAtDate);
      if (
        !isNonNegativeInteger(scheduled.log.elapsed_days) ||
        scheduled.log.elapsed_days !== scheduled.after.elapsed_days
      ) {
        throw new ValidationError(
          'Adapter returned inconsistent elapsed-day fields',
        );
      }
      const event = mapReviewEvent(
        review,
        current,
        scheduled.after,
        scheduled.log.elapsed_days,
        sequence,
        revision.id,
        learningCycle,
      );
      if (finalEvent) validateSnapshotChain(finalEvent, event);
      events.push(event);
      finalEvent = event;
      current = scheduled.after;
    });
    if (!current || !finalEvent) {
      throw new ValidationError('Replay history produced no final state');
    }
    if (
      progressIdentities.has(`${group[0]!.userId}/${group[0]!.cardId}`)
    ) {
      cardStates.push(
        mapCardState(
          group[0]!,
          current,
          sequence,
          revision.id,
          learningCycle,
        ),
      );
    }
  }
  events.sort((left, right) =>
    compareTuple(
      [
        left.userId,
        left.cardId,
        padSequence(left.learningCycle),
        padSequence(left.sequence),
      ],
      [
        right.userId,
        right.cardId,
        padSequence(right.learningCycle),
        padSequence(right.sequence),
      ],
    ),
  );
  cardStates.sort(compareUserCard);
  return { events, cardStates };
}

function mapReviewEvent(
  review: NormalizedReviewFact,
  before: Card | null,
  after: Card,
  elapsedDays: number,
  sequence: number,
  parameterRevisionId: string,
  learningCycle: number,
): FsrsReplayEvent {
  const beforeState = before ? persistedState(before.state) : null;
  return {
    id: uuidV5(
      `legacy-review-event/${review.logId}`,
      FSRS_REPLAY_UUID_NAMESPACE,
    ),
    requestId: uuidV5(
      `legacy-review-request/${review.logId}`,
      FSRS_REPLAY_UUID_NAMESPACE,
    ),
    sourceLogId: review.logId,
    sourceReviewedAt: review.sourceReviewedAt,
    userId: review.userId,
    cardId: review.cardId,
    learningCycle,
    sequence,
    rating: review.rating,
    reviewedAt: review.schedulerReviewedAt,
    durationMs: null,
    parameterRevisionId,
    origin: 'migration',
    beforeState,
    beforeDueAt: before ? before.due.toISOString() : null,
    beforeStability: before?.stability ?? null,
    beforeDifficulty: before?.difficulty ?? null,
    beforeScheduledDays: before?.scheduled_days ?? null,
    beforeLearningSteps: before?.learning_steps ?? null,
    elapsedDays,
    afterState: persistedState(after.state),
    afterDueAt: after.due.toISOString(),
    afterStability: after.stability,
    afterDifficulty: after.difficulty,
    afterScheduledDays: after.scheduled_days,
    afterLearningSteps: after.learning_steps,
    afterReps: after.reps,
    afterLapses: after.lapses,
    afterStateVersion: sequence,
  };
}

export function fsrsReplayPersistedEventPayload(event: FsrsReplayEvent) {
  const {
    sourceLogId: _sourceLogId,
    sourceReviewedAt: _sourceReviewedAt,
    ...payload
  } = event;
  return payload;
}

function mapCardState(
  review: NormalizedReviewFact,
  card: Card,
  sequence: number,
  parameterRevisionId: string,
  learningCycle: number,
): FsrsReplayCardState {
  if (!card.last_review) {
    throw new ValidationError('Replayed Card has no last review');
  }
  return {
    userId: review.userId,
    cardId: review.cardId,
    nextReviewAt: card.due.toISOString(),
    lastReviewedAt: card.last_review.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    state: persistedState(card.state),
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    parameterRevisionId,
    stateVersion: sequence,
    learningCycle,
  };
}

function groupReviewsByCard(
  reviews: readonly NormalizedReviewFact[],
): Map<string, NormalizedReviewFact[]> {
  const groups = new Map<string, NormalizedReviewFact[]>();
  for (const review of reviews) {
    const key = `${review.userId}/${review.cardId}`;
    const group = groups.get(key) ?? [];
    group.push(review);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.sort(compareReviews);
  return groups;
}

function projectTrustedReviewFacts(
  reviews: readonly NormalizedReviewFact[],
) {
  const seenCards = new Set<string>();
  const resetTimestampByCard = new Map<string, string>();
  return reviews.map((review) => {
    const {
      reviewedAtDate: _reviewedAtDate,
      legacyState,
      ...trusted
    } = review;
    const cardKey = `${review.userId}/${review.cardId}`;
    const first = !seenCards.has(cardKey);
    let startsNewCycle = false;
    if (first) {
      seenCards.add(cardKey);
      if (legacyState === 'new') {
        resetTimestampByCard.set(cardKey, review.sourceReviewedAt);
      }
    } else if (
      legacyState === 'new' &&
      resetTimestampByCard.get(cardKey) !== review.sourceReviewedAt
    ) {
      startsNewCycle = true;
      resetTimestampByCard.set(cardKey, review.sourceReviewedAt);
    }
    return { ...trusted, startsNewCycle };
  });
}

function safeContextUuid(value: unknown) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
    ? value
    : '<invalid>';
}

function safeValidationReason(error: unknown) {
  return error instanceof ValidationError
    ? error.message
    : 'Invalid replay data';
}

function validateScheduledCard(
  card: Card,
  sequence: number,
  reviewedAt: Date,
) {
  if (
    !(card.due instanceof Date) ||
    !Number.isFinite(card.due.getTime()) ||
    !(card.last_review instanceof Date) ||
    card.last_review.getTime() !== reviewedAt.getTime()
  ) {
    throw new ValidationError('Adapter returned invalid Card timestamps');
  }
  const finiteFields = [
    card.stability,
    card.difficulty,
    card.elapsed_days,
    card.scheduled_days,
    card.learning_steps,
    card.reps,
    card.lapses,
  ];
  if (finiteFields.some((value) => !Number.isFinite(value))) {
    throw new ValidationError('Adapter returned non-finite Card fields');
  }
  if (
    card.stability <= 0 ||
    card.difficulty < 1 ||
    card.difficulty > 10 ||
    !isNonNegativeInteger(card.elapsed_days) ||
    !isNonNegativeInteger(card.scheduled_days) ||
    !isNonNegativeInteger(card.learning_steps) ||
    card.reps !== sequence ||
    !isNonNegativeInteger(card.lapses) ||
    card.lapses > card.reps
  ) {
    throw new ValidationError('Adapter result violates persistence invariants');
  }
  persistedState(card.state);
}

function validateSnapshotChain(
  previous: FsrsReplayEvent,
  current: FsrsReplayEvent,
) {
  if (
    current.beforeState !== previous.afterState ||
    current.beforeDueAt !== previous.afterDueAt ||
    current.beforeStability !== previous.afterStability ||
    current.beforeDifficulty !== previous.afterDifficulty ||
    current.beforeScheduledDays !== previous.afterScheduledDays ||
    current.beforeLearningSteps !== previous.afterLearningSteps
  ) {
    throw new ValidationError('Replay event snapshots are not contiguous');
  }
}

function validateReviewTimestamps(
  source: string,
  scheduler: string,
): {
  sourceReviewedAt: string;
  schedulerReviewedAt: string;
  reviewedAtDate: Date;
} {
  if (
    typeof source !== 'string' ||
    !SOURCE_TIMESTAMP_PATTERN.test(source)
  ) {
    throw new ValidationError(
      'Source review timestamp must be fixed-width UTC microseconds',
    );
  }
  if (
    typeof scheduler !== 'string' ||
    !SCHEDULER_TIMESTAMP_PATTERN.test(scheduler)
  ) {
    throw new ValidationError(
      'Scheduler review timestamp must be fixed-width UTC milliseconds',
    );
  }
  const expectedScheduler = `${source.slice(0, 23)}Z`;
  if (scheduler !== expectedScheduler) {
    throw new ValidationError(
      'Scheduler timestamp is inconsistent with source timestamp',
    );
  }
  const reviewedAtDate = new Date(scheduler);
  if (
    !Number.isFinite(reviewedAtDate.getTime()) ||
    reviewedAtDate.toISOString() !== scheduler
  ) {
    throw new ValidationError('Review timestamp is not a valid UTC instant');
  }
  return {
    sourceReviewedAt: source,
    schedulerReviewedAt: scheduler,
    reviewedAtDate,
  };
}

function persistedState(value: State): PersistedFsrsState {
  switch (value) {
    case State.Learning:
      return 'learning';
    case State.Review:
      return 'review';
    case State.Relearning:
      return 'relearning';
    default:
      throw new ValidationError('New is not a persisted FSRS Card state');
  }
}

function plainParameters(
  value: FSRSParameters,
): Record<string, unknown> {
  return JSON.parse(canonicalJson(value)) as Record<string, unknown>;
}

function validateCardOwner(
  owners: Map<string, string>,
  cardId: string,
  ownerUserId: string,
) {
  const knownOwner = owners.get(cardId);
  if (knownOwner && knownOwner !== ownerUserId) {
    throw new ValidationError('Card has conflicting replay owners');
  }
  owners.set(cardId, ownerUserId);
}

function validateUuid(value: unknown, name: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ValidationError(`${name} must be a canonical lowercase UUID`);
  }
  return value;
}

function ensureUnique(values: readonly string[], name: string) {
  if (new Set(values).size !== values.length) {
    throw new ValidationError(`Duplicate ${name}`);
  }
}

function compareReviews(
  left: NormalizedReviewFact,
  right: NormalizedReviewFact,
): number {
  return compareTuple(
    [
      left.userId,
      left.cardId,
      left.sourceReviewedAt,
      left.logId,
    ],
    [
      right.userId,
      right.cardId,
      right.sourceReviewedAt,
      right.logId,
    ],
  );
}

function compareUserCard(
  left: { userId: string; cardId: string },
  right: { userId: string; cardId: string },
): number {
  return compareTuple(
    [left.userId, left.cardId],
    [right.userId, right.cardId],
  );
}

function compareTuple(
  left: readonly string[],
  right: readonly string[],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const compared = asciiCompare(left[index]!, right[index]!);
    if (compared !== 0) return compared;
  }
  return 0;
}

function asciiCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function padSequence(value: number): string {
  return value.toString().padStart(12, '0');
}

function cloneScope(scope: FsrsReplayScope): FsrsReplayScope {
  return scope.kind === 'all_users'
    ? { kind: 'all_users' }
    : { kind: 'user', userId: scope.userId };
}

function serializeCanonical(
  value: unknown,
  ancestors: WeakSet<object>,
): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new ValidationError('Canonical JSON requires finite numbers');
      }
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'undefined':
    case 'bigint':
    case 'symbol':
    case 'function':
      throw new ValidationError('Canonical JSON contains unsupported values');
    case 'object':
      break;
  }

  const objectValue = value as object;
  if (ancestors.has(objectValue)) {
    throw new ValidationError('Canonical JSON cannot contain cycles');
  }
  ancestors.add(objectValue);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new ValidationError(
            'Canonical JSON cannot contain sparse arrays',
          );
        }
      }
      return `[${value
        .map((item) => serializeCanonical(item, ancestors))
        .join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ValidationError(
        'Canonical JSON requires plain objects',
      );
    }
    const record = value as Record<string, unknown>;
    const ownKeys = Reflect.ownKeys(record);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      throw new ValidationError(
        'Canonical JSON cannot contain symbol keys',
      );
    }
    for (const key of ownKeys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw new ValidationError(
          'Canonical JSON requires enumerable data properties',
        );
      }
    }
    const keys = Object.keys(record).sort(asciiCompare);
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serializeCanonical(
            record[key],
            ancestors,
          )}`,
      )
      .join(',')}}`;
  } finally {
    ancestors.delete(objectValue);
  }
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
  }
  return value;
}
