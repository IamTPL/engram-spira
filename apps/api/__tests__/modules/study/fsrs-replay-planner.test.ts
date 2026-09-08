import { describe, expect, test } from 'bun:test';
import type { Card } from 'ts-fsrs';
import {
  FSRS_ALGORITHM_VERSION,
  FSRS_LIBRARY_VERSION,
  FSRS_POLICY_VERSION,
  normalizeFsrsParameters,
  scheduleFsrsReview,
} from '../../../src/modules/study/fsrs.engine';
import { ValidationError } from '../../../src/shared/errors';
import {
  FSRS_REPLAY_UUID_NAMESPACE,
  FSRS_REPLAY_VERSION,
  canonicalJson,
  createFsrsReplayPlan,
  fsrsReplayPersistedEventPayload,
  sha256Canonical,
  uuidV5,
  type FsrsReplaySnapshot,
} from '../../../src/modules/study/fsrs-replay-planner';

const USER_1 = '00000000-0000-4000-8000-000000000001';
const USER_2 = '00000000-0000-4000-8000-000000000002';
const CARD_1 = '10000000-0000-4000-8000-000000000001';
const CARD_2 = '10000000-0000-4000-8000-000000000002';
const CARD_3 = '10000000-0000-4000-8000-000000000003';
const LOG_1 = '20000000-0000-4000-8000-000000000001';
const LOG_2 = '20000000-0000-4000-8000-000000000002';
const LOG_3 = '20000000-0000-4000-8000-000000000003';
const LOG_4 = '20000000-0000-4000-8000-000000000004';

function review(
  overrides: Partial<FsrsReplaySnapshot['reviews'][number]> = {},
): FsrsReplaySnapshot['reviews'][number] {
  return {
    logId: LOG_1,
    userId: USER_1,
    cardId: CARD_1,
    ownerUserId: USER_1,
    rating: 'again',
    legacyState: 'new',
    sourceReviewedAt: '2026-01-01T00:00:00.123456Z',
    schedulerReviewedAt: '2026-01-01T00:00:00.123Z',
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<FsrsReplaySnapshot> = {},
): FsrsReplaySnapshot {
  return {
    scope: { kind: 'all_users' },
    scopedUserIds: [USER_1],
    legacyParameterRows: [],
    reviews: [review()],
    progress: [
      { userId: USER_1, cardId: CARD_1, ownerUserId: USER_1 },
    ],
    ...overrides,
  };
}

describe('canonical replay serialization', () => {
  test('sorts object keys recursively and normalizes negative zero', () => {
    expect(
      canonicalJson({
        z: -0,
        nested: { beta: 2, alpha: 1 },
        array: [{ z: 2, a: 1 }],
      }),
    ).toBe(
      '{"array":[{"a":1,"z":2}],"nested":{"alpha":1,"beta":2},"z":0}',
    );
    expect(sha256Canonical({ b: 2, a: 1 })).toBe(
      sha256Canonical({ a: 1, b: 2 }),
    );
  });

  test('rejects ambiguous or unsupported JSON values', () => {
    const sparse = [1, 2] as unknown[];
    delete sparse[0];
    const symbolKeyed = { [Symbol('hidden')]: 1 };
    const accessor = {};
    Object.defineProperty(accessor, 'unstable', {
      enumerable: true,
      get: () => 1,
    });

    for (const value of [
      { missing: undefined },
      sparse,
      Number.POSITIVE_INFINITY,
      Number.NaN,
      1n,
      new Date('2026-01-01T00:00:00.000Z'),
      symbolKeyed,
      accessor,
    ]) {
      expect(() => canonicalJson(value)).toThrow(ValidationError);
    }
  });
});

describe('UUIDv5 replay identities', () => {
  test('matches RFC 4122 and pinned application goldens', () => {
    expect(
      uuidV5(
        'www.widgets.com',
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      ),
    ).toBe('21f7f8de-8051-5b89-8680-0195ef798b6a');
    expect(
      uuidV5(`legacy-review-event/${LOG_1}`, FSRS_REPLAY_UUID_NAMESPACE),
    ).toBe('3bafbd20-08c7-5bf5-b3e4-a5ad05205d54');
    expect(
      uuidV5(`legacy-review-request/${LOG_1}`, FSRS_REPLAY_UUID_NAMESPACE),
    ).toBe('34940655-1591-5878-8e36-ad35e3d582cf');

    const value = uuidV5('variant-check', FSRS_REPLAY_UUID_NAMESPACE);
    expect(value[14]).toBe('5');
    expect(['8', '9', 'a', 'b']).toContain(value[19]!);
  });
});

describe('createFsrsReplayPlan', () => {
  test('replays all ratings with exact adapter parity and snapshot chaining', () => {
    const reviews = [
      review(),
      review({
        logId: LOG_2,
        rating: 'hard',
        legacyState: 'learning',
        sourceReviewedAt: '2026-01-01T00:10:00.000000Z',
        schedulerReviewedAt: '2026-01-01T00:10:00.000Z',
      }),
      review({
        logId: LOG_3,
        rating: 'good',
        legacyState: 'review',
        sourceReviewedAt: '2026-01-02T00:10:00.000000Z',
        schedulerReviewedAt: '2026-01-02T00:10:00.000Z',
      }),
      review({
        logId: LOG_4,
        rating: 'easy',
        legacyState: 'review',
        sourceReviewedAt: '2026-01-04T00:10:00.000000Z',
        schedulerReviewedAt: '2026-01-04T00:10:00.000Z',
      }),
    ];
    const plan = createFsrsReplayPlan(snapshot({ reviews }));

    let current: Card | null = null;
    plan.events.forEach((event, index) => {
      const direct = scheduleFsrsReview({
        current,
        rating: reviews[index]!.rating,
        reviewedAt: new Date(reviews[index]!.schedulerReviewedAt),
      });

      expect(event.sequence).toBe(index + 1);
      expect(event.learningCycle).toBe(1);
      expect(event.afterReps).toBe(index + 1);
      expect(event.afterStateVersion).toBe(index + 1);
      expect(event.afterDueAt).toBe(direct.after.due.toISOString());
      expect(event.afterStability).toBe(direct.after.stability);
      expect(event.afterDifficulty).toBe(direct.after.difficulty);
      expect(event.elapsedDays).toBe(direct.log.elapsed_days);
      expect(event.elapsedDays).toBe(direct.after.elapsed_days);
      if (index === 0) {
        expect(event.beforeState).toBeNull();
        expect(event.beforeDueAt).toBeNull();
        expect(event.beforeStability).toBeNull();
      } else {
        expect(event.beforeState).toBe(plan.events[index - 1]!.afterState);
        expect(event.beforeDueAt).toBe(plan.events[index - 1]!.afterDueAt);
        expect(event.beforeStability).toBe(
          plan.events[index - 1]!.afterStability,
        );
      }
      current = direct.after;
    });

    const finalEvent = plan.events.at(-1)!;
    const finalState = plan.cardStates[0]!;
    expect(finalState.state).toBe(finalEvent.afterState);
    expect(finalState.nextReviewAt).toBe(finalEvent.afterDueAt);
    expect(finalState.stability).toBe(finalEvent.afterStability);
    expect(finalState.difficulty).toBe(finalEvent.afterDifficulty);
    expect(finalState.lastReviewedAt).toBe(finalEvent.reviewedAt);
    expect(finalState.elapsedDays).toBe(finalEvent.elapsedDays);
    expect(finalState.scheduledDays).toBe(finalEvent.afterScheduledDays);
    expect(finalState.learningSteps).toBe(finalEvent.afterLearningSteps);
    expect(finalState.reps).toBe(finalEvent.afterReps);
    expect(finalState.lapses).toBe(finalEvent.afterLapses);
    expect(finalState.stateVersion).toBe(finalEvent.afterStateVersion);
  });

  test('is independent of source row order and ignores extra legacy derived fields', () => {
    const rows = [
      review({
        logId: LOG_2,
        rating: 'good',
        legacyState: 'learning',
        sourceReviewedAt: '2026-01-02T00:00:00.000000Z',
        schedulerReviewedAt: '2026-01-02T00:00:00.000Z',
      }),
      {
        ...review(),
        boxLevel: 9,
        intervalDays: 999,
        stability: 999,
        legacyAlgorithm: 'sm2',
      },
    ];
    const first = createFsrsReplayPlan(
      snapshot({
        scopedUserIds: [USER_2, USER_1],
        reviews: rows,
        legacyParameterRows: [
          { userId: USER_2, parameters: { request_retention: 0.88 } },
        ],
      }),
    );
    const second = createFsrsReplayPlan(
      snapshot({
        scopedUserIds: [USER_1, USER_2],
        reviews: [...rows].reverse(),
        legacyParameterRows: [
          {
            userId: USER_2,
            parameters: { request_retention: 0.88 },
            algorithm: 'sm2',
          } as FsrsReplaySnapshot['legacyParameterRows'][number] & {
            algorithm: string;
          },
        ],
      }),
    );

    expect(canonicalJson(first)).toBe(canonicalJson(second));
  });

  test('hashes only trusted legacy-state reset semantics', () => {
    const continuing = [
      review(),
      review({
        logId: LOG_2,
        rating: 'good',
        legacyState: 'learning',
        sourceReviewedAt: '2026-01-02T00:00:00.000000Z',
        schedulerReviewedAt: '2026-01-02T00:00:00.000Z',
      }),
    ];
    const irrelevantStateChange = [
      continuing[0]!,
      { ...continuing[1]!, legacyState: 'review' as const },
    ];
    const resetBoundary = [
      continuing[0]!,
      { ...continuing[1]!, legacyState: 'new' as const },
    ];

    const first = createFsrsReplayPlan(snapshot({ reviews: continuing }));
    const irrelevant = createFsrsReplayPlan(
      snapshot({ reviews: irrelevantStateChange }),
    );
    const reset = createFsrsReplayPlan(
      snapshot({ reviews: resetBoundary }),
    );

    expect(canonicalJson(irrelevant)).toBe(canonicalJson(first));
    expect(reset.sourceChecksum).not.toBe(first.sourceChecksum);
    expect(reset.resultChecksum).not.toBe(first.resultChecksum);
    expect(reset.events[1]).toMatchObject({
      learningCycle: 2,
      sequence: 1,
    });
  });

  test('orders by exact microseconds, then lowercase UUID for exact ties', () => {
    const plan = createFsrsReplayPlan(
      snapshot({
        reviews: [
          review({
            logId: LOG_3,
            rating: 'easy',
            sourceReviewedAt: '2026-01-01T00:00:00.123456Z',
          }),
          review({
            logId: LOG_2,
            rating: 'good',
            sourceReviewedAt: '2026-01-01T00:00:00.123123Z',
          }),
          review({
            logId: LOG_1,
            rating: 'hard',
            sourceReviewedAt: '2026-01-01T00:00:00.123456Z',
          }),
        ],
      }),
    );

    expect(plan.events.map((event) => event.sourceLogId)).toEqual([
      LOG_2,
      LOG_1,
      LOG_3,
    ]);
    expect(plan.anomalies.sameTimestampReviews).toEqual([
      {
        userId: USER_1,
        cardId: CARD_1,
        sourceReviewedAt: '2026-01-01T00:00:00.123456Z',
        logIds: [LOG_1, LOG_3],
      },
    ]);
    expect(plan.counts.sameTimestampReviewGroups).toBe(1);
  });

  test('preserves sub-millisecond source changes in the source checksum', () => {
    const first = createFsrsReplayPlan(snapshot());
    const second = createFsrsReplayPlan(
      snapshot({
        reviews: [
          review({
            sourceReviewedAt: '2026-01-01T00:00:00.123789Z',
          }),
        ],
      }),
    );

    expect(second.events[0]!.reviewedAt).toBe(first.events[0]!.reviewedAt);
    expect(second.sourceChecksum).not.toBe(first.sourceChecksum);
    expect(second.resultChecksum).toBe(first.resultChecksum);
  });

  test('creates a revision for every scoped user using default or custom parameters', () => {
    const plan = createFsrsReplayPlan(
      snapshot({
        scopedUserIds: [USER_2, USER_1],
        reviews: [],
        legacyParameterRows: [
          { userId: USER_2, parameters: { request_retention: 0.87 } },
        ],
      }),
    );

    expect(plan.parameterRevisions.map((revision) => revision.userId)).toEqual([
      USER_1,
      USER_2,
    ]);
    expect(canonicalJson(plan.parameterRevisions[0]!.parameters)).toBe(
      canonicalJson(normalizeFsrsParameters()),
    );
    expect(plan.parameterRevisions[0]!.source).toBe('default');
    expect(plan.parameterRevisions[0]!.id).toBe(
      'c21e402d-8965-5412-a695-087e9ede3488',
    );
    expect(canonicalJson(plan.parameterRevisions[1]!.parameters)).toBe(
      canonicalJson(normalizeFsrsParameters({ request_retention: 0.87 })),
    );
    expect(plan.parameterRevisions[1]!.source).toBe('migration');
    for (const revision of plan.parameterRevisions) {
      expect(revision.revision).toBe(1);
      expect(revision.engineVersion).toBe(FSRS_LIBRARY_VERSION);
      expect(revision.algorithmVersion).toBe(FSRS_ALGORITHM_VERSION);
      expect(revision.policyVersion).toBe(FSRS_POLICY_VERSION);
      expect(revision.paramsHash).toBe(
        sha256Canonical(revision.parameters),
      );
    }
  });

  test('retains default versus migrated parameter provenance without changing revision identity', () => {
    const missing = createFsrsReplayPlan(
      snapshot({ reviews: [], legacyParameterRows: [] }),
    );
    const explicit = createFsrsReplayPlan(
      snapshot({
        reviews: [],
        legacyParameterRows: [
          { userId: USER_1, parameters: normalizeFsrsParameters() },
        ],
      }),
    );

    expect(explicit.parameterRevisions[0]!.id).toBe(
      missing.parameterRevisions[0]!.id,
    );
    expect(explicit.parameterRevisions[0]!.paramsHash).toBe(
      missing.parameterRevisions[0]!.paramsHash,
    );
    expect(explicit.parameterRevisions[0]!.source).toBe('migration');
    expect(missing.parameterRevisions[0]!.source).toBe('default');
    expect(explicit.sourceChecksum).not.toBe(missing.sourceChecksum);
    expect(explicit.resultChecksum).not.toBe(missing.resultChecksum);
  });

  test('schedules each user history with that user canonical parameters', () => {
    const parameters = { maximum_interval: 1 };
    const reviews = [
      review({ rating: 'good' }),
      review({
        logId: LOG_2,
        rating: 'good',
        legacyState: 'learning',
        sourceReviewedAt: '2026-01-01T00:15:00.123456Z',
        schedulerReviewedAt: '2026-01-01T00:15:00.123Z',
      }),
    ];
    const plan = createFsrsReplayPlan(
      snapshot({
        legacyParameterRows: [{ userId: USER_1, parameters }],
        reviews,
      }),
    );
    let current: Card | null = null;

    reviews.forEach((row, index) => {
      const direct = scheduleFsrsReview({
        current,
        rating: row.rating,
        reviewedAt: new Date(row.schedulerReviewedAt),
        parameters,
      });
      expect(plan.events[index]!.afterDueAt).toBe(
        direct.after.due.toISOString(),
      );
      expect(plan.events[index]!.parameterRevisionId).toBe(
        plan.parameterRevisions[0]!.id,
      );
      current = direct.after;
    });
  });

  test('keeps progress without trusted history New and audits it', () => {
    const plan = createFsrsReplayPlan(
      snapshot({
        reviews: [],
        progress: [
          { userId: USER_1, cardId: CARD_2, ownerUserId: USER_1 },
          { userId: USER_1, cardId: CARD_1, ownerUserId: USER_1 },
        ],
      }),
    );

    expect(plan.cardStates).toEqual([]);
    expect(plan.events).toEqual([]);
    expect(plan.anomalies.progressWithoutHistory).toEqual([
      { userId: USER_1, cardId: CARD_1 },
      { userId: USER_1, cardId: CARD_2 },
    ]);
    expect(plan.counts.progressWithoutHistory).toBe(2);
  });

  test('starts a new learning cycle from trusted legacy new-state boundaries', () => {
    const rows = [
      { ...review(), legacyState: 'new' },
      {
        ...review({
          logId: LOG_2,
          rating: 'good',
          sourceReviewedAt: '2026-01-01T00:15:00.000000Z',
          schedulerReviewedAt: '2026-01-01T00:15:00.000Z',
        }),
        legacyState: 'learning',
      },
      {
        ...review({
          logId: LOG_3,
          sourceReviewedAt: '2026-02-01T00:00:00.000000Z',
          schedulerReviewedAt: '2026-02-01T00:00:00.000Z',
        }),
        legacyState: 'new',
      },
      {
        ...review({
          logId: LOG_4,
          rating: 'hard',
          sourceReviewedAt: '2026-02-01T00:00:00.000000Z',
          schedulerReviewedAt: '2026-02-01T00:00:00.000Z',
        }),
        legacyState: 'new',
      },
    ] as FsrsReplaySnapshot['reviews'];
    const plan = createFsrsReplayPlan(
      snapshot({
        reviews: rows,
        progress: [
          { userId: USER_1, cardId: CARD_1, ownerUserId: USER_1 },
        ],
      }),
    );

    expect(plan.events.map((event) => [
      event.learningCycle,
      event.sequence,
      event.afterReps,
    ])).toEqual([
      [1, 1, 1],
      [1, 2, 2],
      [2, 1, 1],
      [2, 2, 2],
    ]);
    expect(plan.cardStates[0]).toMatchObject({
      learningCycle: 2,
      stateVersion: 2,
      reps: 2,
    });
  });

  test('keeps reset history as events but omits current state without progress', () => {
    const plan = createFsrsReplayPlan(
      snapshot({
        reviews: [{ ...review(), legacyState: 'new' }] as FsrsReplaySnapshot['reviews'],
        progress: [],
      }),
    );

    expect(plan.events).toHaveLength(1);
    expect(plan.cardStates).toEqual([]);
    expect(plan.anomalies.inferredResets).toEqual([
      { userId: USER_1, cardId: CARD_1 },
    ]);
    expect(plan.counts.inferredResets).toBe(1);
  });

  test('audits history whose first retained event is not new', () => {
    const plan = createFsrsReplayPlan(
      snapshot({
        reviews: [
          { ...review(), legacyState: 'review' },
        ] as FsrsReplaySnapshot['reviews'],
        progress: [
          { userId: USER_1, cardId: CARD_1, ownerUserId: USER_1 },
        ],
      }),
    );

    expect(plan.anomalies.truncatedHistories).toEqual([
      {
        userId: USER_1,
        cardId: CARD_1,
        firstLogId: LOG_1,
        legacyState: 'review',
      },
    ]);
    expect(plan.counts.truncatedHistories).toBe(1);
  });

  test('uses pinned replay provenance and deterministic event identities', () => {
    const plan = createFsrsReplayPlan(snapshot());
    const event = plan.events[0]!;

    expect(plan.replayVersion).toBe(FSRS_REPLAY_VERSION);
    expect(plan.engineVersion).toBe(FSRS_LIBRARY_VERSION);
    expect(plan.algorithmVersion).toBe(FSRS_ALGORITHM_VERSION);
    expect(plan.policyVersion).toBe(FSRS_POLICY_VERSION);
    expect(event.id).toBe(
      uuidV5(`legacy-review-event/${LOG_1}`, FSRS_REPLAY_UUID_NAMESPACE),
    );
    expect(event.requestId).toBe(
      uuidV5(`legacy-review-request/${LOG_1}`, FSRS_REPLAY_UUID_NAMESPACE),
    );
    expect(event.origin).toBe('migration');
    expect(fsrsReplayPersistedEventPayload(event)).not.toHaveProperty(
      'sourceLogId',
    );
    expect(fsrsReplayPersistedEventPayload(event)).not.toHaveProperty(
      'sourceReviewedAt',
    );
  });

  test('does not retain mutable input references or Date objects', () => {
    const parameters = { request_retention: 0.87 };
    const input = snapshot({
      legacyParameterRows: [{ userId: USER_1, parameters }],
    });
    const plan = createFsrsReplayPlan(input);
    const original = canonicalJson(plan);

    parameters.request_retention = 0.91;
    input.reviews[0]!.rating = 'easy';

    expect(canonicalJson(plan)).toBe(original);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.parameterRevisions[0]!.parameters)).toBe(true);
    expect(canonicalJson(plan)).not.toContain('Date');
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });

  test('supports an empty all-users snapshot', () => {
    const plan = createFsrsReplayPlan(
      snapshot({
        scopedUserIds: [],
        reviews: [],
        progress: [],
      }),
    );

    expect(plan.parameterRevisions).toEqual([]);
    expect(plan.events).toEqual([]);
    expect(plan.cardStates).toEqual([]);
    expect(plan.counts.users).toBe(0);
  });

  test('fails closed for invalid custom parameters', () => {
    expect(() =>
      createFsrsReplayPlan(
        snapshot({
          legacyParameterRows: [
            { userId: USER_1, parameters: { request_retention: 2 } },
          ],
        }),
      ),
    ).toThrow(ValidationError);
  });

  test('fails closed for identity, ownership, rating, timestamp, and duplicate violations', () => {
    const cases: FsrsReplaySnapshot[] = [
      snapshot({ scopedUserIds: [USER_1, USER_1] }),
      snapshot({
        legacyParameterRows: [
          { userId: USER_1, parameters: {} },
          { userId: USER_1, parameters: {} },
        ],
      }),
      snapshot({
        legacyParameterRows: [{ userId: USER_2, parameters: {} }],
      }),
      snapshot({
        reviews: [review({ logId: 'not-a-uuid' })],
      }),
      snapshot({
        reviews: [review({ userId: 'not-a-uuid' })],
      }),
      snapshot({
        reviews: [review({ cardId: 'not-a-uuid' })],
      }),
      snapshot({
        reviews: [review({ ownerUserId: USER_2 })],
      }),
      snapshot({
        reviews: [review({ rating: 'perfect' as 'good' })],
      }),
      snapshot({
        reviews: [
          review({
            legacyState: 'graduated' as 'review',
          }),
        ],
      }),
      snapshot({
        reviews: [
          review({
            sourceReviewedAt: '2026-01-01T00:00:00.123456+00:00',
          }),
        ],
      }),
      snapshot({
        reviews: [
          review({
            schedulerReviewedAt: '2026-01-01T00:00:00.124Z',
          }),
        ],
      }),
      snapshot({
        reviews: [review(), review()],
      }),
      snapshot({
        progress: [
          { userId: USER_1, cardId: CARD_3, ownerUserId: USER_2 },
        ],
      }),
      snapshot({
        progress: [
          { userId: USER_1, cardId: CARD_3, ownerUserId: USER_1 },
          { userId: USER_1, cardId: CARD_3, ownerUserId: USER_1 },
        ],
      }),
      snapshot({
        scope: { kind: 'user', userId: USER_2 },
      }),
    ];

    for (const input of cases) {
      expect(() => createFsrsReplayPlan(input)).toThrow(ValidationError);
    }
  });
});
