import { describe, expect, test } from 'bun:test';
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type Grade,
} from 'ts-fsrs';
import { ValidationError } from '../../../src/shared/errors';
import {
  FSRS_ALGORITHM_VERSION,
  FSRS_LIBRARY_VERSION,
  FSRS_POLICY_VERSION,
  normalizeFsrsParameters,
  scheduleFsrsReview,
} from '../../../src/modules/study/fsrs.engine';

const DAY_MS = 86_400_000;
const REVIEWED_AT = new Date('2026-07-28T12:00:00.000Z');
const DEFAULT_POLICY_PARAMETERS = generatorParameters({
  enable_fuzz: false,
  learning_steps: ['1m', '15m'],
  relearning_steps: ['10m'],
});

const RATING_CASES = [
  ['again', Rating.Again],
  ['hard', Rating.Hard],
  ['good', Rating.Good],
  ['easy', Rating.Easy],
] as const;

function reviewCard(overrides: Partial<Card> = {}): Card {
  return {
    due: new Date(REVIEWED_AT),
    stability: 10,
    difficulty: 5,
    elapsed_days: 10,
    scheduled_days: 10,
    reps: 3,
    lapses: 0,
    learning_steps: 0,
    state: State.Review,
    last_review: new Date(REVIEWED_AT.getTime() - 10 * DAY_MS),
    ...overrides,
  };
}

function directNext(current: Card | null, rating: Grade, reviewedAt: Date) {
  const before = current
    ? {
        ...current,
        due: new Date(current.due),
        last_review: current.last_review
          ? new Date(current.last_review)
          : undefined,
      }
    : createEmptyCard(reviewedAt);
  return fsrs(DEFAULT_POLICY_PARAMETERS).next(before, reviewedAt, rating);
}

describe('FSRS adapter provenance', () => {
  test('identifies the algorithm, library revision, and policy revision', () => {
    expect(FSRS_ALGORITHM_VERSION).toBe('FSRS-6');
    expect(FSRS_LIBRARY_VERSION).toBe('ts-fsrs@5.4.1');
    expect(FSRS_POLICY_VERSION).toBe('engram-fsrs-v1');
  });
});

describe('scheduleFsrsReview', () => {
  test('schedules the ten-day Review golden cases deterministically', () => {
    const current = reviewCard();
    const cases = [
      ['hard', 23.24687511, 23],
      ['good', 32.02672948, 32],
      ['easy', 51.25386165, 51],
    ] as const;

    for (const [rating, stability, scheduledDays] of cases) {
      const result = scheduleFsrsReview({
        current,
        rating,
        reviewedAt: REVIEWED_AT,
      });

      expect(result.after.stability).toBeCloseTo(stability, 8);
      expect(result.after.scheduled_days).toBe(scheduledDays);
      expect(result.after.due).toEqual(
        new Date(REVIEWED_AT.getTime() + scheduledDays * DAY_MS),
      );
    }
  });

  test('derives ten elapsed days from last_review when persisted elapsed_days is stale', () => {
    const result = scheduleFsrsReview({
      current: reviewCard({ elapsed_days: 0 }),
      rating: 'hard',
      reviewedAt: REVIEWED_AT,
    });

    expect(result.before.elapsed_days).toBe(0);
    expect(result.log.elapsed_days).toBe(10);
    expect(result.after.stability).toBeCloseTo(23.24687511, 8);
    expect(result.after.scheduled_days).toBe(23);
  });

  test('round-trips every Card field for Learning, Relearning, and Review', () => {
    const cases: Card[] = [
      reviewCard({
        due: new Date('2026-07-28T12:15:00.000Z'),
        stability: 1.2931,
        difficulty: 5.5,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: 1,
        lapses: 0,
        learning_steps: 1,
        state: State.Learning,
        last_review: new Date('2026-07-28T12:00:00.000Z'),
      }),
      reviewCard({
        due: new Date('2026-07-28T12:10:00.000Z'),
        stability: 2.5,
        difficulty: 6,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: 8,
        lapses: 2,
        learning_steps: 0,
        state: State.Relearning,
        last_review: new Date('2026-07-28T11:55:00.000Z'),
      }),
      reviewCard(),
    ];

    for (const current of cases) {
      const result = scheduleFsrsReview({
        current,
        rating: 'good',
        reviewedAt: REVIEWED_AT,
      });
      expect(result.before).toEqual(current);
    }
  });

  test('models New as absent persisted state at the explicit review time', () => {
    const result = scheduleFsrsReview({
      current: null,
      rating: 'good',
      reviewedAt: REVIEWED_AT,
    });

    expect(result.before).toEqual(createEmptyCard(REVIEWED_AT));
    expect(result.before.last_review).toBeUndefined();
    expect(result.log.state).toBe(State.New);
  });

  test('maps every app rating to the matching ts-fsrs grade', () => {
    for (const [rating, grade] of RATING_CASES) {
      const result = scheduleFsrsReview({
        current: reviewCard(),
        rating,
        reviewedAt: REVIEWED_AT,
      });
      expect(result.log.rating).toBe(grade);
    }
  });

  test('matches direct ts-fsrs.next after every step in a review sequence', () => {
    let adapterCard: Card | null = null;
    let directCard: Card | null = null;
    let reviewedAt = new Date(REVIEWED_AT);
    const ratings = RATING_CASES.map(([rating, grade]) => ({ rating, grade }));

    for (const { rating, grade } of ratings) {
      const adapter = scheduleFsrsReview({
        current: adapterCard,
        rating,
        reviewedAt,
      });
      const direct = directNext(directCard, grade, reviewedAt);

      expect(adapter.after).toEqual(direct.card);
      expect(adapter.log).toEqual(direct.log);
      adapterCard = adapter.after;
      directCard = direct.card;
      reviewedAt = new Date(adapter.after.due);
    }
  });

  test('keeps Again then Good in Learning at the second learning step', () => {
    const again = scheduleFsrsReview({
      current: null,
      rating: 'again',
      reviewedAt: REVIEWED_AT,
    });
    const good = scheduleFsrsReview({
      current: again.after,
      rating: 'good',
      reviewedAt: again.after.due,
    });

    expect(good.after.state).toBe(State.Learning);
    expect(good.after.learning_steps).toBe(1);
    expect(good.after.due).toEqual(
      new Date(again.after.due.getTime() + 15 * 60_000),
    );
  });

  test('keeps Hard then Good in Learning at the second learning step', () => {
    const hard = scheduleFsrsReview({
      current: null,
      rating: 'hard',
      reviewedAt: REVIEWED_AT,
    });
    const good = scheduleFsrsReview({
      current: hard.after,
      rating: 'good',
      reviewedAt: hard.after.due,
    });

    expect(good.after.state).toBe(State.Learning);
    expect(good.after.learning_steps).toBe(1);
    expect(good.after.due).toEqual(
      new Date(hard.after.due.getTime() + 15 * 60_000),
    );
  });

  test('preserves direct next behavior for a same-day Review', () => {
    const current = reviewCard({
      due: new Date(REVIEWED_AT),
      elapsed_days: 0,
      last_review: new Date(REVIEWED_AT.getTime() - 5 * 60_000),
    });
    const adapter = scheduleFsrsReview({
      current,
      rating: 'again',
      reviewedAt: REVIEWED_AT,
    });
    const direct = directNext(current, Rating.Again, REVIEWED_AT);

    expect(adapter.after).toEqual(direct.card);
    expect(adapter.log).toEqual(direct.log);
    expect(adapter.log.elapsed_days).toBe(0);
  });

  test('does not mutate caller Card or Date objects', () => {
    const current = reviewCard();
    const due = current.due;
    const lastReview = current.last_review!;
    const reviewedAt = new Date(REVIEWED_AT);
    const snapshot = structuredClone(current);

    const result = scheduleFsrsReview({
      current,
      rating: 'good',
      reviewedAt,
    });

    expect(current).toEqual(snapshot);
    expect(current.due).toBe(due);
    expect(current.last_review).toBe(lastReview);
    expect(reviewedAt).toEqual(REVIEWED_AT);
    expect(result.before).not.toBe(current);
    expect(result.before.due).not.toBe(current.due);
    expect(result.before.last_review).not.toBe(current.last_review);
    expect(result.after.due).not.toBe(reviewedAt);
    expect(result.log.review).not.toBe(reviewedAt);
  });

  test('wraps invalid reviewedAt, rating, and Card fields in ValidationError', () => {
    const invalidCases = [
      {
        current: reviewCard(),
        rating: 'good',
        reviewedAt: new Date(Number.NaN),
      },
      {
        current: reviewCard(),
        rating: 'invalid',
        reviewedAt: REVIEWED_AT,
      },
      {
        current: reviewCard({ stability: Number.NaN }),
        rating: 'good',
        reviewedAt: REVIEWED_AT,
      },
      {
        current: reviewCard({ reps: -1 }),
        rating: 'good',
        reviewedAt: REVIEWED_AT,
      },
      {
        current: reviewCard({ state: State.New }),
        rating: 'good',
        reviewedAt: REVIEWED_AT,
      },
    ];

    for (const input of invalidCases) {
      expect(() =>
        scheduleFsrsReview(
          input as Parameters<typeof scheduleFsrsReview>[0],
        ),
      ).toThrow(ValidationError);
    }
  });

  test('rejects every non-null runtime current value that is not a Card', () => {
    for (const current of [0, false, '', [], {}]) {
      expect(() =>
        scheduleFsrsReview({
          current: current as Card,
          rating: 'good',
          reviewedAt: REVIEWED_AT,
        }),
      ).toThrow(ValidationError);
    }
  });

  test('wraps library failures in ValidationError at the public boundary', () => {
    expect(() =>
      scheduleFsrsReview({
        current: reviewCard({
          last_review: new Date(REVIEWED_AT.getTime() + DAY_MS),
        }),
        rating: 'good',
        reviewedAt: REVIEWED_AT,
      }),
    ).toThrow(ValidationError);
  });
});

describe('normalizeFsrsParameters', () => {
  const legacy17 = [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722,
    0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729,
  ];
  const legacy19 = [...legacy17, 0.5425, 0.0912];

  test('normalizes legacy 17 weights into the complete 21-weight revision', () => {
    expect(normalizeFsrsParameters({ w: legacy17 }).w).toEqual([
      0.212, 1.2931, 2.3065, 8.2956, 8.0801, 0.4176067, 3.5194, 0.001,
      1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
      1.8729, 0, 0, 0.01, 0.5,
    ]);
  });

  test('normalizes legacy 19 weights into the complete 21-weight revision', () => {
    expect(normalizeFsrsParameters({ w: legacy19 }).w).toEqual([
      ...legacy19,
      0.01,
      0.5,
    ]);
  });

  test('accepts valid custom parameters and always disables fuzz', () => {
    const normalized = normalizeFsrsParameters({
      request_retention: 0.85,
      maximum_interval: 730,
      enable_fuzz: true,
      enable_short_term: true,
      learning_steps: ['2m', '20m'],
      relearning_steps: ['5m'],
    });

    expect(normalized.request_retention).toBe(0.85);
    expect(normalized.maximum_interval).toBe(730);
    expect(normalized.enable_fuzz).toBeFalse();
    expect(normalized.enable_short_term).toBeTrue();
    expect(normalized.learning_steps).toEqual(['2m', '20m']);
    expect(normalized.relearning_steps).toEqual(['5m']);
    expect(normalized.w).toHaveLength(21);
  });

  test('uses normalized custom parameters with direct next parity', () => {
    const parameters = {
      request_retention: 0.85,
      maximum_interval: 730,
      learning_steps: ['2m', '20m'],
      relearning_steps: ['5m'],
    };
    const normalized = normalizeFsrsParameters(parameters);
    const current = reviewCard();
    const adapter = scheduleFsrsReview({
      current,
      rating: 'good',
      reviewedAt: REVIEWED_AT,
      parameters,
    });
    const direct = fsrs(normalized).next(
      current,
      REVIEWED_AT,
      Rating.Good,
    );

    expect(adapter.after).toEqual(direct.card);
    expect(adapter.log).toEqual(direct.log);
  });

  test('rejects malformed parameter containers and fields', () => {
    const malformed = [
      null,
      [],
      'fsrs',
      { unknown: true },
      { request_retention: '0.9' },
      { maximum_interval: 365.5 },
      { enable_short_term: 'yes' },
      { enable_fuzz: 0 },
      { learning_steps: '1m' },
      { learning_steps: ['1m', 'later'] },
      { relearning_steps: [10] },
    ];

    for (const parameters of malformed) {
      expect(() => normalizeFsrsParameters(parameters)).toThrow(
        ValidationError,
      );
    }
  });

  test('rejects invalid numeric ranges and non-finite parameter values', () => {
    const invalid = [
      { request_retention: 0 },
      { request_retention: 1.01 },
      { request_retention: Number.NaN },
      { request_retention: Number.POSITIVE_INFINITY },
      { maximum_interval: 0 },
      { maximum_interval: 36_501 },
      { maximum_interval: Number.POSITIVE_INFINITY },
      { w: [...legacy17.slice(0, 4), 10.1, ...legacy17.slice(5)] },
      { w: [...legacy19.slice(0, 17), 2.1, legacy19[18]] },
      {
        w: legacy17.map((weight, index) =>
          index === 4 ? 10 : index === 5 ? 4 : weight,
        ),
      },
      { w: [...legacy19.slice(0, 5), Number.NaN, ...legacy19.slice(6)] },
      {
        w: [
          ...legacy19.slice(0, 5),
          Number.POSITIVE_INFINITY,
          ...legacy19.slice(6),
        ],
      },
    ];

    for (const parameters of invalid) {
      expect(() => normalizeFsrsParameters(parameters)).toThrow(
        ValidationError,
      );
    }
  });

  test('rejects unsupported weight lengths and malformed weight elements', () => {
    const invalid = [
      { w: legacy17.slice(0, 16) },
      { w: [...legacy19, 0] },
      { w: [...legacy19, 0, 0.5, 0.2] },
      { w: legacy17.map((weight, index) => (index === 3 ? '8.2' : weight)) },
    ];

    for (const parameters of invalid) {
      expect(() => normalizeFsrsParameters(parameters)).toThrow(
        ValidationError,
      );
    }
  });

  test('rejects legacy weights whose migrated values exceed 21-weight ranges', () => {
    const transformOverflow = legacy17.map((weight, index) =>
      index === 4 ? 10 : index === 5 ? 4 : weight,
    );

    expect(() => normalizeFsrsParameters({ w: transformOverflow })).toThrow(
      ValidationError,
    );
  });
});
