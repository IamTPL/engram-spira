import { describe, expect, test } from 'bun:test';

import {
  getRetentionDetails,
  type RetentionDetailsLoaders,
  type RetentionOutcomeBucketRow,
  type RetentionRecentReviewRow,
  type RetentionWorkloadRow,
} from '../../../src/modules/study/retention-details.service';

const AS_OF = new Date('2026-07-28T12:00:00.000Z');

function loaders(
  options: {
    owned?: boolean;
    outcomes?: RetentionOutcomeBucketRow[];
    workload?: RetentionWorkloadRow[];
    recent?: RetentionRecentReviewRow[];
  } = {},
): RetentionDetailsLoaders {
  return {
    loadOwnedDeck: async () => options.owned ?? true,
    loadOutcomeBuckets: async () => options.outcomes ?? [],
    loadWorkload: async () => options.workload ?? [],
    loadRecentReviews: async () => options.recent ?? [],
  };
}

describe('retention details service', () => {
  test('summarizes reliable ratings and returns chronologically sorted daily outcomes', async () => {
    const result = await getRetentionDetails(
      'user-1',
      'deck-1',
      30,
      -420,
      loaders({
        outcomes: [
          { date: '2026-07-27', rating: 'good', count: 3 },
          { date: '2026-07-26', rating: 'again', count: 2 },
          { date: '2026-07-27', rating: 'hard', count: 1 },
          { date: '2026-07-26', rating: 'easy', count: 4 },
          { date: '2026-07-26', rating: 'invalid', count: 99 },
        ],
      }),
      AS_OF,
    );

    expect(result.outcomes).toEqual({
      total: 10,
      recalled: 8,
      recallRate: 0.8,
      again: 2,
      hard: 1,
      good: 3,
      easy: 4,
    });
    expect(result.dailyOutcomes).toEqual([
      { date: '2026-07-26', total: 6, recalled: 4 },
      { date: '2026-07-27', total: 4, recalled: 4 },
    ]);
    expect(result.asOf).toBe(AS_OF.toISOString());
    expect(result.rangeDays).toBe(30);
  });

  test('uses null rather than a misleading zero recall rate without reviews', async () => {
    const result = await getRetentionDetails(
      'user-1',
      'deck-1',
      30,
      0,
      loaders(),
      AS_OF,
    );

    expect(result.outcomes).toEqual({
      total: 0,
      recalled: 0,
      recallRate: null,
      again: 0,
      hard: 0,
      good: 0,
      easy: 0,
    });
  });

  test('zero-fills the full 14-day workload in the user local calendar', async () => {
    const result = await getRetentionDetails(
      'user-1',
      'deck-1',
      30,
      -420,
      loaders({
        workload: [
          { date: '2026-07-29', count: 3 },
          { date: '2026-08-10', count: 2 },
        ],
      }),
      AS_OF,
    );

    expect(result.workload).toHaveLength(14);
    expect(result.workload[0]).toEqual({ date: '2026-07-28', count: 0 });
    expect(result.workload[1]).toEqual({ date: '2026-07-29', count: 3 });
    expect(result.workload[13]).toEqual({ date: '2026-08-10', count: 2 });
  });

  test('sanitizes, orders, and caps recent review history at 20 rows', async () => {
    const recent = Array.from({ length: 22 }, (_, index) => ({
      id: `review-${index.toString().padStart(2, '0')}`,
      cardId: `card-${index}`,
      sortOrder: index,
      label: index === 0 ? '   ' : `Word ${index}`,
      rating: index === 1 ? 'invalid' : index % 2 === 0 ? 'good' : 'again',
      reviewedAt: new Date(AS_OF.getTime() - index * 60_000),
      elapsedDays: index,
      scheduledDays: index + 1,
    })) satisfies RetentionRecentReviewRow[];

    const result = await getRetentionDetails(
      'user-1',
      'deck-1',
      30,
      0,
      loaders({ recent: [...recent].reverse() }),
      AS_OF,
    );

    expect(result.recentReviews).toHaveLength(20);
    expect(result.recentReviews[0]).toMatchObject({
      id: 'review-00',
      label: 'Card 1',
      rating: 'good',
      reviewedAt: AS_OF.toISOString(),
    });
    expect(result.recentReviews.some((row) => row.id === 'review-01')).toBe(
      false,
    );
    expect(result.recentReviews.at(-1)?.id).toBe('review-20');
  });

  test('starts ownership, outcomes, workload, and recent reads in one parallel wave', async () => {
    const started: string[] = [];
    let resolveOwned!: (value: boolean) => void;
    let resolveOutcomes!: (value: RetentionOutcomeBucketRow[]) => void;
    let resolveWorkload!: (value: RetentionWorkloadRow[]) => void;
    let resolveRecent!: (value: RetentionRecentReviewRow[]) => void;

    const pending = getRetentionDetails(
      'user-1',
      'deck-1',
      30,
      0,
      {
        loadOwnedDeck: () => {
          started.push('owned');
          return new Promise((resolve) => {
            resolveOwned = resolve;
          });
        },
        loadOutcomeBuckets: () => {
          started.push('outcomes');
          return new Promise((resolve) => {
            resolveOutcomes = resolve;
          });
        },
        loadWorkload: () => {
          started.push('workload');
          return new Promise((resolve) => {
            resolveWorkload = resolve;
          });
        },
        loadRecentReviews: () => {
          started.push('recent');
          return new Promise((resolve) => {
            resolveRecent = resolve;
          });
        },
      },
      AS_OF,
    );

    await Promise.resolve();
    expect(started).toEqual(['owned', 'outcomes', 'workload', 'recent']);
    resolveOwned(true);
    resolveOutcomes([]);
    resolveWorkload([]);
    resolveRecent([]);

    await expect(pending).resolves.toMatchObject({ rangeDays: 30 });
  });

  test('clamps range and timezone inputs at the service boundary', async () => {
    const outcomeCalls: Array<{
      from: Date;
      until: Date;
      tzOffset: number;
    }> = [];

    const result = await getRetentionDetails(
      'user-1',
      'deck-1',
      999,
      -9_999,
      {
        ...loaders(),
        loadOutcomeBuckets: async (_userId, _deckId, from, until, tzOffset) => {
          outcomeCalls.push({ from, until, tzOffset });
          return [];
        },
      },
      AS_OF,
    );

    expect(result.rangeDays).toBe(90);
    expect(outcomeCalls).toHaveLength(1);
    expect(outcomeCalls[0]?.tzOffset).toBe(-720);
    expect(outcomeCalls[0]?.until).toEqual(AS_OF);
    expect(outcomeCalls[0]?.from.toISOString()).toBe(
      '2026-04-30T12:00:00.000Z',
    );
  });

  test('uses exactly the requested local calendar days across timezone offsets', async () => {
    const boundaryAsOf = new Date('2026-07-28T23:30:00.000Z');
    const cases = [
      { tzOffset: -120, expected: '2026-07-22T22:00:00.000Z' },
      { tzOffset: 300, expected: '2026-07-22T05:00:00.000Z' },
    ];

    for (const testCase of cases) {
      let capturedFrom: Date | undefined;
      const result = await getRetentionDetails(
        'user-1',
        'deck-1',
        7,
        testCase.tzOffset,
        {
          ...loaders(),
          loadOutcomeBuckets: async (_userId, _deckId, from) => {
            capturedFrom = from;
            return [];
          },
        },
        boundaryAsOf,
      );

      expect(result.rangeDays).toBe(7);
      expect(capturedFrom?.toISOString()).toBe(testCase.expected);
    }
  });

  test('returns a non-leaking not-found error for an unowned deck', async () => {
    const pending = getRetentionDetails(
      'user-1',
      'foreign-deck',
      30,
      0,
      loaders({ owned: false }),
      AS_OF,
    );

    await expect(pending).rejects.toThrow('Deck not found');
  });
});
