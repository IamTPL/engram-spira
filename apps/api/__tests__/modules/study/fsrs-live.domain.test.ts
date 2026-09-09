import { describe, expect, test } from 'bun:test';
import { ConflictError, ValidationError } from '../../../src/shared/errors';
import {
  assertMatchingLiveReviewRequest,
  clampReviewChronology,
  deriveNextReviewPosition,
  groupReviewsByStudyDate,
  normalizeLiveReviewCommands,
  orderReviewResults,
  reviewResultFromEvent,
  sortedUniqueCardIds,
  studyDateForReviewedAt,
  type LiveReviewEventSnapshot,
  type NormalizedLiveReviewCommand,
  type ReviewEventInput,
  type ReviewEventResult,
} from '../../../src/modules/study/fsrs-live.domain';

const REQUEST_1 = '00000000-0000-4000-8000-000000000001';
const REQUEST_2 = '00000000-0000-4000-8000-000000000002';
const REQUEST_3 = '00000000-0000-4000-8000-000000000003';
const CARD_1 = '10000000-0000-4000-8000-000000000001';
const CARD_2 = '10000000-0000-4000-8000-000000000002';
const CARD_3 = '10000000-0000-4000-8000-000000000003';

function reviewInput(
  overrides: Partial<ReviewEventInput> = {},
): ReviewEventInput {
  return {
    requestId: REQUEST_1,
    cardId: CARD_1,
    rating: 'good',
    reviewedAt: '2026-07-28T07:15:16.123Z',
    ...overrides,
  };
}

function normalize(
  input: ReviewEventInput = reviewInput(),
  receivedAt = new Date('2026-07-28T07:20:16.123Z'),
): NormalizedLiveReviewCommand {
  return normalizeLiveReviewCommands([input], receivedAt)[0]!;
}

function event(
  overrides: Partial<LiveReviewEventSnapshot> = {},
): LiveReviewEventSnapshot {
  return {
    requestId: REQUEST_1,
    cardId: CARD_1,
    rating: 'good',
    reviewedAt: new Date('2026-07-28T07:15:16.123Z'),
    durationMs: null,
    origin: 'live',
    learningCycle: 2,
    sequence: 4,
    afterState: 'review',
    afterDueAt: new Date('2026-08-03T07:15:16.123Z'),
    afterStability: 6.25,
    afterDifficulty: 4.75,
    afterScheduledDays: 6,
    ...overrides,
  };
}

function result(
  requestId: string,
  cardId: string,
): ReviewEventResult {
  return {
    requestId,
    cardId,
    status: 'applied',
    learningCycle: 1,
    sequence: 1,
    state: 'learning',
    nextReviewAt: '2026-07-28T07:16:16.123Z',
    stability: 0.5,
    difficulty: 5,
    scheduledDays: 0,
  };
}

describe('live FSRS command normalization', () => {
  test('canonicalizes UUIDs and offset-equivalent instants without losing milliseconds', () => {
    const [command] = normalizeLiveReviewCommands(
      [
        reviewInput({
          requestId: REQUEST_1.toUpperCase(),
          cardId: CARD_1.toUpperCase(),
          reviewedAt: '2026-07-28T14:15:16.123000+07:00',
          durationMs: 12_345,
        }),
      ],
      new Date('2026-07-28T07:20:16.123Z'),
    );

    expect(command).toEqual({
      requestId: REQUEST_1,
      cardId: CARD_1,
      rating: 'good',
      reviewedAt: '2026-07-28T07:15:16.123Z',
      receivedAt: '2026-07-28T07:20:16.123Z',
      durationMs: 12_345,
      origin: 'live',
    });
  });

  test('normalizes an omitted duration to null', () => {
    expect(normalize().durationMs).toBeNull();
  });

  test('clamps an instant after receivedAt down to receivedAt (client clock ahead of the server)', () => {
    const command = normalize(
      reviewInput({ reviewedAt: '2026-07-28T07:25:16.124Z' }),
      new Date('2026-07-28T07:20:16.123Z'),
    );

    expect(command.receivedAt).toBe('2026-07-28T07:20:16.123Z');
    expect(command.reviewedAt).toBe('2026-07-28T07:20:16.123Z');
  });

  test('clamps an instant more than 24 h before receivedAt up to that bound (client clock far behind)', () => {
    expect(
      normalize(
        reviewInput({ reviewedAt: '2026-07-27T07:20:16.123Z' }),
        new Date('2026-07-28T07:20:16.123Z'),
      ).reviewedAt,
    ).toBe('2026-07-27T07:20:16.123Z');
    expect(
      normalize(
        reviewInput({ reviewedAt: '2026-07-27T07:20:16.122Z' }),
        new Date('2026-07-28T07:20:16.123Z'),
      ).reviewedAt,
    ).toBe('2026-07-27T07:20:16.123Z');
    expect(
      normalize(
        reviewInput({ reviewedAt: '2019-01-01T00:00:00.000Z' }),
        new Date('2026-07-28T07:20:16.123Z'),
      ).reviewedAt,
    ).toBe('2026-07-27T07:20:16.123Z');
  });

  test('rejects a lower timezone-crossing instant whose canonical UTC year is 0000', () => {
    expect(() =>
      normalize(
        reviewInput({ reviewedAt: '0001-01-01T00:00:00+14:00' }),
        new Date('0001-01-01T00:00:00.000Z'),
      ),
    ).toThrow('Review event 1 reviewedAt must be a valid ISO-8601 instant');
  });

  test('rejects an upper timezone-crossing instant whose canonical UTC year is 10000', () => {
    expect(() =>
      normalize(
        reviewInput({ reviewedAt: '9999-12-31T23:59:59-14:00' }),
        new Date('9999-12-31T23:59:59.000Z'),
      ),
    ).toThrow('Review event 1 reviewedAt must be a valid ISO-8601 instant');
  });

  test('rejects nonzero timestamp precision below a millisecond', () => {
    expect(() =>
      normalize(
        reviewInput({ reviewedAt: '2026-07-28T07:15:16.123001Z' }),
      ),
    ).toThrow(ValidationError);
  });

  test('rejects malformed UUID, rating, and ISO instant inputs', () => {
    const invalidInputs: ReviewEventInput[] = [
      reviewInput({ requestId: 'not-a-uuid' }),
      reviewInput({ cardId: 'not-a-uuid' }),
      reviewInput({
        requestId: '00000000-0000-0000-8000-000000000001',
      }),
      reviewInput({
        cardId: '10000000-0000-4000-7000-000000000001',
      }),
      reviewInput({ rating: 'perfect' as ReviewEventInput['rating'] }),
      reviewInput({ reviewedAt: '2026-07-28T07:15:16' }),
      reviewInput({ reviewedAt: '2026-02-30T07:15:16Z' }),
      reviewInput({ reviewedAt: '2026-07-28T07:15:16+14:01' }),
    ];

    for (const input of invalidInputs) {
      expect(() => normalize(input)).toThrow(ValidationError);
    }
  });

  test('rejects a Date object because the public reviewedAt contract is a string', () => {
    expect(() =>
      normalizeLiveReviewCommands(
        [
          {
            ...reviewInput(),
            reviewedAt: new Date('2026-07-28T07:15:16.123Z'),
          },
        ],
        new Date('2026-07-28T07:20:16.123Z'),
      ),
    ).toThrow(ValidationError);
  });

  test('rejects an invalid externally captured receivedAt', () => {
    expect(() => normalize(reviewInput(), new Date(Number.NaN))).toThrow(
      ValidationError,
    );
  });

  test('accepts duration boundaries and rejects non-integer or out-of-range durations', () => {
    expect(normalize(reviewInput({ durationMs: 0 })).durationMs).toBe(0);
    expect(
      normalize(reviewInput({ durationMs: 3_600_000 })).durationMs,
    ).toBe(3_600_000);

    for (const durationMs of [-1, 1.5, 3_600_001, Number.NaN]) {
      expect(() => normalize(reviewInput({ durationMs }))).toThrow(
        ValidationError,
      );
    }
  });

  test('rejects duplicate request IDs in a batch after UUID normalization', () => {
    expect(() =>
      normalizeLiveReviewCommands(
        [
          reviewInput(),
          reviewInput({
            requestId: REQUEST_1.toUpperCase(),
            cardId: CARD_2,
          }),
        ],
        new Date('2026-07-28T07:20:16.123Z'),
      ),
    ).toThrow(ValidationError);
  });

  test('allows sequential offline reviews of the same card in one batch', () => {
    const commands = normalizeLiveReviewCommands(
      [
        reviewInput(),
        reviewInput({
          requestId: REQUEST_2,
          cardId: CARD_1.toUpperCase(),
          reviewedAt: '2026-07-28T07:16:16.123Z',
        }),
      ],
      new Date('2026-07-28T07:20:16.123Z'),
    );

    expect(commands.map((command) => command.cardId)).toEqual([
      CARD_1,
      CARD_1,
    ]);
    expect(commands.map((command) => command.requestId)).toEqual([
      REQUEST_1,
      REQUEST_2,
    ]);
  });

  test('requires between one and one hundred events', () => {
    expect(() =>
      normalizeLiveReviewCommands(
        [],
        new Date('2026-07-28T07:20:16.123Z'),
      ),
    ).toThrow(ValidationError);

    const tooMany = Array.from({ length: 101 }, (_, index) =>
      reviewInput({
        requestId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        cardId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      }),
    );
    expect(() =>
      normalizeLiveReviewCommands(
        tooMany,
        new Date('2026-07-28T07:20:16.123Z'),
      ),
    ).toThrow(ValidationError);
  });
});

describe('live review idempotency', () => {
  test('uses the nearest accepted canonical timestamp in an immutable snapshot for an exact duplicate retry', () => {
    const command: NormalizedLiveReviewCommand = {
      requestId: REQUEST_1,
      cardId: CARD_1,
      rating: 'good',
      reviewedAt: '0001-01-01T00:00:00.000Z',
      receivedAt: '2026-07-28T07:20:16.123Z',
      durationMs: null,
      origin: 'live',
    };
    const stored = event({
      reviewedAt: '0001-01-01T00:00:00.000Z',
      afterDueAt: '0001-01-01T00:00:00.000Z',
    });

    expect(() => assertMatchingLiveReviewRequest(command, stored)).not.toThrow();
    expect(reviewResultFromEvent(stored, 'duplicate')).toMatchObject({
      status: 'duplicate',
      nextReviewAt: '0001-01-01T00:00:00.000Z',
    });
  });

  test('accepts the same normalized card, rating, instant, duration, and live origin', () => {
    const command = normalize(
      reviewInput({
        reviewedAt: '2026-07-28T14:15:16.123+07:00',
        durationMs: 900,
      }),
    );

    expect(() =>
      assertMatchingLiveReviewRequest(
        command,
        event({
          reviewedAt: '2026-07-28T07:15:16.123Z',
          durationMs: 900,
        }),
      ),
    ).not.toThrow();
  });

  test('tolerates reviewedAt and durationMs differences because the server clamps them', () => {
    const command = normalize();
    expect(() =>
      assertMatchingLiveReviewRequest(
        command,
        event({ reviewedAt: new Date('2026-07-28T07:15:16.124Z'), durationMs: 1 }),
      ),
    ).not.toThrow();
  });

  test('maps every semantic payload mismatch to ConflictError', () => {
    const command = normalize();
    const mismatches: LiveReviewEventSnapshot[] = [
      event({ requestId: REQUEST_2 }),
      event({ cardId: CARD_2 }),
      event({ rating: 'hard' }),
      event({ origin: 'migration' }),
    ];

    for (const existing of mismatches) {
      expect(() =>
        assertMatchingLiveReviewRequest(command, existing),
      ).toThrow(ConflictError);
    }
  });
});

describe('immutable event response projection', () => {
  test('builds an applied or duplicate result only from the immutable event after-snapshot', () => {
    const stored = event({
      afterState: 'relearning',
      afterDueAt: '2026-08-03T14:15:16.123+07:00',
      afterStability: 3.5,
      afterDifficulty: 7.25,
      afterScheduledDays: 6,
    });

    expect(reviewResultFromEvent(stored, 'duplicate')).toEqual({
      requestId: REQUEST_1,
      cardId: CARD_1,
      status: 'duplicate',
      learningCycle: 2,
      sequence: 4,
      state: 'relearning',
      nextReviewAt: '2026-08-03T07:15:16.123Z',
      stability: 3.5,
      difficulty: 7.25,
      scheduledDays: 6,
    });
    expect(reviewResultFromEvent(stored, 'applied').status).toBe('applied');
  });

  test('fails closed on invalid immutable-event counters and FSRS metrics', () => {
    const invalidEvents: LiveReviewEventSnapshot[] = [
      event({ learningCycle: 0 }),
      event({ sequence: 0 }),
      event({ afterStability: 0 }),
      event({ afterStability: Number.POSITIVE_INFINITY }),
      event({ afterDifficulty: 0.99 }),
      event({ afterDifficulty: 10.01 }),
      event({ afterScheduledDays: -1 }),
      event({ afterScheduledDays: 1.5 }),
    ];

    for (const stored of invalidEvents) {
      expect(() => reviewResultFromEvent(stored, 'duplicate')).toThrow(
        ValidationError,
      );
    }
  });
});

describe('review chronology', () => {
  test('keeps a review at or after the current state instant', () => {
    expect(
      clampReviewChronology(
        '2026-07-28T07:15:16.123Z',
        new Date('2026-07-28T07:15:16.123Z'),
      ),
    ).toBe('2026-07-28T07:15:16.123Z');
    expect(
      clampReviewChronology(
        '2026-07-28T07:15:17.000Z',
        new Date('2026-07-28T07:15:16.123Z'),
      ),
    ).toBe('2026-07-28T07:15:17.000Z');
  });

  test('clamps a review older than the current state up to the state instant', () => {
    expect(
      clampReviewChronology(
        '2026-07-28T07:15:16.122Z',
        new Date('2026-07-28T07:15:16.123Z'),
      ),
    ).toBe('2026-07-28T07:15:16.123Z');
  });
});

describe('local study dates', () => {
  test('applies Date.getTimezoneOffset sign and supports UTC+14 and UTC-12 bounds', () => {
    expect(
      studyDateForReviewedAt('2026-01-01T10:30:00.000Z', -840),
    ).toBe('2026-01-02');
    expect(
      studyDateForReviewedAt('2026-01-01T11:30:00.000Z', 720),
    ).toBe('2025-12-31');
  });

  test('rejects timezone offsets outside [-840, 720] or non-integer offsets', () => {
    for (const offset of [-841, 721, 1.5, Number.NaN]) {
      expect(() =>
        studyDateForReviewedAt('2026-01-01T10:30:00.000Z', offset),
      ).toThrow(ValidationError);
    }
  });

  test('groups newly applied reviews by the local date of the server receivedAt, never the client instant', () => {
    const late = normalizeLiveReviewCommands(
      [
        reviewInput({
          requestId: REQUEST_1,
          cardId: CARD_1,
          reviewedAt: '2026-07-28T06:30:00.000Z',
        }),
      ],
      new Date('2026-07-29T01:00:00.000Z'),
    );
    const early = normalizeLiveReviewCommands(
      [
        reviewInput({
          requestId: REQUEST_2,
          cardId: CARD_2,
          reviewedAt: '2026-07-28T06:30:00.000Z',
        }),
        reviewInput({
          requestId: REQUEST_3,
          cardId: CARD_3,
          // Client clock ahead: clamped to receivedAt, same local date.
          reviewedAt: '2026-07-29T05:00:00.000Z',
        }),
      ],
      new Date('2026-07-28T06:59:59.999Z'),
    );

    expect(groupReviewsByStudyDate([...late, ...early], 420)).toEqual([
      { studyDate: '2026-07-27', cardsReviewed: 2 },
      { studyDate: '2026-07-28', cardsReviewed: 1 },
    ]);
  });
});

describe('learning-cycle position', () => {
  test('continues the current cycle at stateVersion plus one', () => {
    expect(
      deriveNextReviewPosition({
        state: { learningCycle: 3, stateVersion: 7 },
      }),
    ).toEqual({ learningCycle: 3, sequence: 8 });
  });

  test('starts cycle one for a card with no state or prior event', () => {
    expect(
      deriveNextReviewPosition({ state: null, maxPriorLearningCycle: null }),
    ).toEqual({ learningCycle: 1, sequence: 1 });
  });

  test('starts exactly one new cycle after any number of resets', () => {
    expect(
      deriveNextReviewPosition({ state: null, maxPriorLearningCycle: 4 }),
    ).toEqual({ learningCycle: 5, sequence: 1 });
    expect(
      deriveNextReviewPosition({ state: null, maxPriorLearningCycle: 4 }),
    ).toEqual({ learningCycle: 5, sequence: 1 });
  });

  test('rejects invalid persisted counters instead of producing unsafe positions', () => {
    expect(() =>
      deriveNextReviewPosition({
        state: { learningCycle: 0, stateVersion: 1 },
      }),
    ).toThrow(ValidationError);
    expect(() =>
      deriveNextReviewPosition({
        state: null,
        maxPriorLearningCycle: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(ValidationError);
  });
});

describe('deterministic batch primitives', () => {
  test('returns unique card IDs in ascending canonical order', () => {
    const commands = normalizeLiveReviewCommands(
      [
        reviewInput({ requestId: REQUEST_2, cardId: CARD_2 }),
        reviewInput({ requestId: REQUEST_1, cardId: CARD_1 }),
        reviewInput({
          requestId: REQUEST_3,
          cardId: CARD_1,
          reviewedAt: '2026-07-28T07:16:16.123Z',
        }),
      ],
      new Date('2026-07-28T07:20:16.123Z'),
    );

    expect(sortedUniqueCardIds(commands)).toEqual([CARD_1, CARD_2]);
  });

  test('restores repository results to input order', () => {
    const commands = normalizeLiveReviewCommands(
      [
        reviewInput({ requestId: REQUEST_2, cardId: CARD_2 }),
        reviewInput({ requestId: REQUEST_1, cardId: CARD_1 }),
      ],
      new Date('2026-07-28T07:20:16.123Z'),
    );
    const result1 = result(REQUEST_1, CARD_1);
    const result2 = result(REQUEST_2, CARD_2);

    expect(orderReviewResults(commands, [result1, result2])).toEqual([
      result2,
      result1,
    ]);
  });

  test('rejects missing, duplicate, or unknown results rather than returning a partial batch', () => {
    const commands = normalizeLiveReviewCommands(
      [
        reviewInput({ requestId: REQUEST_1, cardId: CARD_1 }),
        reviewInput({ requestId: REQUEST_2, cardId: CARD_2 }),
      ],
      new Date('2026-07-28T07:20:16.123Z'),
    );
    const result1 = result(REQUEST_1, CARD_1);

    expect(() => orderReviewResults(commands, [result1])).toThrow(
      ValidationError,
    );
    expect(() =>
      orderReviewResults(commands, [result1, result1]),
    ).toThrow(ValidationError);
    expect(() =>
      orderReviewResults(commands, [
        result1,
        result(REQUEST_3, CARD_3),
      ]),
    ).toThrow(ValidationError);
  });
});
