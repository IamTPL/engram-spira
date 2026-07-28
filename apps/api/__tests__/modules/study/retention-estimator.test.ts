import { describe, expect, test } from 'bun:test';
import { generatorParameters } from 'ts-fsrs';

import {
  assessRetention,
  createRetentionContext,
} from '../../../src/modules/study/retention-estimator';

const AS_OF = new Date('2026-07-28T00:00:00.000Z');

function reviewedProgress(overrides: {
  lastReviewedAt?: Date | null;
  nextReviewAt?: Date | null;
  stability?: number | null;
} = {}) {
  return {
    lastReviewedAt: Object.hasOwn(overrides, 'lastReviewedAt')
      ? overrides.lastReviewedAt!
      : new Date('2026-07-18T00:00:00.000Z'),
    nextReviewAt: Object.hasOwn(overrides, 'nextReviewAt')
      ? overrides.nextReviewAt!
      : new Date('2026-08-01T00:00:00.000Z'),
    stability: Object.hasOwn(overrides, 'stability')
      ? overrides.stability!
      : 10,
  };
}

describe('retention estimator', () => {
  test('matches FSRS retrievability at zero elapsed time and at stability', () => {
    const context = createRetentionContext('fsrs', {});

    const atReview = assessRetention(
      context,
      reviewedProgress({
        lastReviewedAt: AS_OF,
        stability: 10,
      }),
      AS_OF,
    );
    const atStability = assessRetention(
      context,
      reviewedProgress({ stability: 10 }),
      AS_OF,
    );

    expect(atReview.retention).toBeCloseTo(1, 12);
    expect(atReview.status).toBe('on_track');
    expect(atStability.retention).toBeCloseTo(0.9, 10);
    expect(atStability.status).toBe('on_track');
  });

  test('normalizes legacy weights and matches non-trivial FSRS retrievability values', () => {
    const defaults = generatorParameters();
    const expectedAtFiveDays = new Map([
      [17, 0.946059],
      [19, 0.946059],
      [21, 0.94034429],
    ]);

    for (const length of [17, 19, 21]) {
      const context = createRetentionContext('fsrs', {
        w: defaults.w.slice(0, length),
      });

      expect(context.fsrsWeights).toHaveLength(21);
      expect(context.targetRetention).toBe(defaults.request_retention);
      expect(
        assessRetention(
          context,
          reviewedProgress({
            lastReviewedAt: new Date('2026-07-23T00:00:00.000Z'),
            stability: 10,
          }),
          AS_OF,
        ).retention,
      ).toBeCloseTo(expectedAtFiveDays.get(length)!, 8);
    }
  });

  test('sanitizes malformed persisted FSRS parameters before calling the library', () => {
    expect(() =>
      createRetentionContext('fsrs', {
        w: null,
        request_retention: 2,
        maximum_interval: Number.NaN,
        enable_fuzz: 'yes',
      }),
    ).not.toThrow();

    const context = createRetentionContext('fsrs', {
      w: Array.from({ length: 21 }, () => Number.NaN),
      request_retention: -1,
      relearning_steps: [null],
    });

    expect(context.targetRetention).toBe(0.9);
    expect(context.fsrsWeights).toHaveLength(21);
    expect(context.fsrsWeights?.every(Number.isFinite)).toBe(true);
  });

  test('clamps future review timestamps to zero elapsed time', () => {
    const result = assessRetention(
      createRetentionContext('fsrs', {}),
      reviewedProgress({
        lastReviewedAt: new Date('2026-07-29T00:00:00.000Z'),
      }),
      AS_OF,
    );

    expect(result).toEqual({ status: 'on_track', retention: 1 });
  });

  test('classifies new, due, unavailable, at-risk, and on-track states disjointly', () => {
    const context = createRetentionContext('fsrs', {});

    expect(assessRetention(context, null, AS_OF)).toEqual({
      status: 'new',
      retention: null,
    });
    expect(
      assessRetention(
        context,
        reviewedProgress({ lastReviewedAt: null }),
        AS_OF,
      ),
    ).toEqual({ status: 'new', retention: null });
    expect(
      assessRetention(
        context,
        reviewedProgress({
          nextReviewAt: new Date('2026-07-27T00:00:00.000Z'),
          stability: null,
        }),
        AS_OF,
      ),
    ).toEqual({ status: 'due', retention: null });
    expect(
      assessRetention(
        context,
        reviewedProgress({ stability: Number.NaN }),
        AS_OF,
      ),
    ).toEqual({ status: 'unavailable', retention: null });
    for (const stability of [null, 0, -1, Number.POSITIVE_INFINITY]) {
      expect(
        assessRetention(
          context,
          reviewedProgress({ stability }),
          AS_OF,
        ),
      ).toEqual({ status: 'unavailable', retention: null });
    }

    const atRisk = assessRetention(
      context,
      reviewedProgress({
        lastReviewedAt: new Date('2026-07-26T00:00:00.000Z'),
        stability: 1,
      }),
      AS_OF,
    );
    expect(atRisk.status).toBe('at_risk');
    expect(atRisk.retention).toBeLessThan(context.targetRetention!);

    const onTrack = assessRetention(
      context,
      reviewedProgress({
        lastReviewedAt: new Date('2026-07-27T18:00:00.000Z'),
        stability: 10,
      }),
      AS_OF,
    );
    expect(onTrack.status).toBe('on_track');
    expect(onTrack.retention).toBeGreaterThan(context.targetRetention!);
  });

  test('keeps a valid FSRS estimate when due status takes precedence', () => {
    const result = assessRetention(
      createRetentionContext('fsrs', {}),
      reviewedProgress({
        nextReviewAt: new Date('2026-07-27T00:00:00.000Z'),
        stability: 10,
      }),
      AS_OF,
    );

    expect(result.status).toBe('due');
    expect(result.retention).toBeCloseTo(0.9, 10);
  });

  test('keeps due priority even when a corrupted context cannot produce a curve', () => {
    const corruptedContext = {
      algorithm: 'fsrs',
      targetRetention: 0.9,
      fsrsWeights: Array.from({ length: 21 }, () => Number.NaN),
    } as const;

    expect(
      assessRetention(
        corruptedContext,
        reviewedProgress({
          nextReviewAt: new Date('2026-07-27T00:00:00.000Z'),
        }),
        AS_OF,
      ),
    ).toEqual({ status: 'due', retention: null });
  });

  test('SM-2 ignores stale FSRS stability and never claims recall probability', () => {
    const context = createRetentionContext('sm2', {
      w: generatorParameters().w,
    });

    expect(context).toEqual({
      algorithm: 'sm2',
      targetRetention: null,
      fsrsWeights: null,
    });
    expect(
      assessRetention(
        context,
        reviewedProgress({ stability: 500 }),
        AS_OF,
      ),
    ).toEqual({ status: 'on_track', retention: null });
    expect(
      assessRetention(
        context,
        reviewedProgress({
          nextReviewAt: new Date('2026-07-28T00:00:00.000Z'),
          stability: 500,
        }),
        AS_OF,
      ),
    ).toEqual({ status: 'due', retention: null });
  });
});
