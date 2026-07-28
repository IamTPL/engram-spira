import { describe, expect, test } from 'bun:test';

import {
  buildMemoryHealthStudyUrl,
  getMemoryHealthCalendarDate,
  getMemoryHealthPrimaryAction,
  getMemoryHealthPresentation,
  memoryHealthKeys,
  shouldLoadMemoryHealthDetails,
  type MemoryHealthOverview,
} from './memory-health-state';

function overview(
  overrides: Partial<MemoryHealthOverview> = {},
): MemoryHealthOverview {
  return {
    asOf: '2026-07-28T00:00:00.000Z',
    algorithm: 'fsrs',
    metric: {
      kind: 'predicted_recall',
      average: 0.91,
      target: 0.9,
    },
    summary: {
      total: 20,
      reviewed: 15,
      new: 5,
      due: 2,
      atRisk: 1,
      onTrack: 12,
      unavailable: 0,
    },
    distribution: {
      new: 5,
      due: 2,
      atRisk: 1,
      onTrack: 12,
      unavailable: 0,
    },
    attentionTotal: 3,
    attention: [],
    reviewCardIds: ['due-1', 'due-2'],
    ...overrides,
  };
}

describe('memory health state', () => {
  test('uses one deck prefix for overview and lazy details invalidation', () => {
    expect(memoryHealthKeys.all).toEqual(['memory-health']);
    expect(memoryHealthKeys.deck('deck-1')).toEqual([
      'memory-health',
      'deck',
      'deck-1',
    ]);
    expect(memoryHealthKeys.overview('deck-1', 'user-1')).toEqual([
      'memory-health',
      'deck',
      'deck-1',
      'overview',
      'user-1',
    ]);
    expect(memoryHealthKeys.details('deck-1', 'user-1', 30)).toEqual([
      'memory-health',
      'deck',
      'deck-1',
      'details',
      'user-1',
      30,
    ]);
  });

  test('normalizes string and Eden Date calendar values without shifting the day', () => {
    const fromString = getMemoryHealthCalendarDate('2026-07-28');
    const fromDate = getMemoryHealthCalendarDate(
      new Date('2026-07-28T00:00:00.000Z'),
    );

    for (const value of [fromString, fromDate]) {
      expect(value?.getFullYear()).toBe(2026);
      expect(value?.getMonth()).toBe(6);
      expect(value?.getDate()).toBe(28);
    }
    expect(getMemoryHealthCalendarDate('not-a-date')).toBeNull();
    expect(getMemoryHealthCalendarDate(new Date(Number.NaN))).toBeNull();
  });

  test('loads details only after expansion with an authenticated deck scope', () => {
    expect(shouldLoadMemoryHealthDetails(false, 'deck-1', 'user-1')).toBeFalse();
    expect(shouldLoadMemoryHealthDetails(true, '', 'user-1')).toBeFalse();
    expect(shouldLoadMemoryHealthDetails(true, 'deck-1', '')).toBeFalse();
    expect(shouldLoadMemoryHealthDetails(true, 'deck-1', 'user-1')).toBeTrue();
  });

  test('builds a stable selected-card study URL with unique IDs capped at 12', () => {
    const ids = [
      'card 1',
      'card-2',
      'card 1',
      ...Array.from({ length: 20 }, (_, index) => `card-${index + 3}`),
    ];

    const url = buildMemoryHealthStudyUrl('deck/one', ids);
    const parsed = new URL(url, 'https://example.test');

    expect(parsed.pathname).toBe('/study/deck%2Fone');
    expect(parsed.searchParams.get('mode')).toBe('all');
    expect(parsed.searchParams.get('cardIds')?.split(',')).toHaveLength(12);
    expect(parsed.searchParams.get('cardIds')?.split(',').slice(0, 2)).toEqual([
      'card 1',
      'card-2',
    ]);
  });

  test('prioritizes an automatic due-card cluster and never adds at-risk cards', () => {
    const result = getMemoryHealthPrimaryAction(
      'deck-1',
      overview({
        reviewCardIds: ['due-1', 'due-2'],
        attention: [
          {
            cardId: 'risk-1',
            label: 'Risk',
            status: 'at_risk',
            retention: 0.7,
            lastReviewedAt: '2026-07-20T00:00:00.000Z',
            nextReviewAt: '2026-07-30T00:00:00.000Z',
          },
        ],
      }),
    );

    expect(result).toEqual({
      kind: 'review_due',
      label: 'Review 2 now',
      cardCount: 2,
      href: '/study/deck-1?mode=all&cardIds=due-1%2Cdue-2',
    });
    expect(result?.href).not.toContain('risk-1');
  });

  test('falls back to starting the deck only when new cards remain', () => {
    expect(
      getMemoryHealthPrimaryAction(
        'deck-1',
        overview({
          reviewCardIds: [],
          summary: {
            total: 5,
            reviewed: 0,
            new: 5,
            due: 0,
            atRisk: 0,
            onTrack: 0,
            unavailable: 0,
          },
        }),
      ),
    ).toEqual({
      kind: 'start_learning',
      label: 'Start studying',
      cardCount: 5,
      href: '/study/deck-1',
    });

    expect(
      getMemoryHealthPrimaryAction(
        'deck-1',
        overview({
          reviewCardIds: [],
          summary: {
            total: 5,
            reviewed: 5,
            new: 0,
            due: 0,
            atRisk: 2,
            onTrack: 3,
            unavailable: 0,
          },
        }),
      ),
    ).toBeNull();
  });

  test('uses total due count for Review now versus Review first 12 copy', () => {
    expect(
      getMemoryHealthPrimaryAction(
        'deck-1',
        overview({
          summary: {
            total: 30,
            reviewed: 20,
            new: 10,
            due: 20,
            atRisk: 0,
            onTrack: 0,
            unavailable: 0,
          },
          reviewCardIds: Array.from(
            { length: 12 },
            (_, index) => `due-${index}`,
          ),
        }),
      )?.label,
    ).toBe('Review first 12');
  });

  test('derives truthful model copy, semantic counts, distribution, and five attention rows', () => {
    const input = overview({
      attention: Array.from({ length: 8 }, (_, index) => ({
        cardId: `card-${index}`,
        label: `Card ${index}`,
        status: index < 2 ? ('due' as const) : ('at_risk' as const),
        retention: 0.8,
        lastReviewedAt: '2026-07-20T00:00:00.000Z',
        nextReviewAt: '2026-07-30T00:00:00.000Z',
      })),
    });

    const result = getMemoryHealthPresentation(input);

    expect(result.metric).toEqual({
      label: 'Estimated recall',
      value: '91%',
      description: 'Prediction, not a test score',
    });
    expect(result.counts.map((item) => [item.label, item.count])).toEqual([
      ['Reviewed', 15],
      ['New', 5],
      ['Due now', 2],
      ['At risk', 1],
    ]);
    expect(result.distribution.reduce((sum, item) => sum + item.count, 0)).toBe(
      input.summary.total,
    );
    expect(
      result.distribution.reduce((sum, item) => sum + item.percentage, 0),
    ).toBeCloseTo(100, 5);
    expect(result.attention).toHaveLength(5);
    expect(input.attention).toHaveLength(8);
  });

  test('uses schedule language for SM-2 without a fake probability', () => {
    const result = getMemoryHealthPresentation(
      overview({
        algorithm: 'sm2',
        metric: {
          kind: 'schedule_status',
          average: null,
          target: null,
        },
      }),
    );

    expect(result.metric).toEqual({
      label: 'Schedule status',
      value: '2 due',
      description: 'SM-2 uses due dates, not a predicted recall percentage',
    });
  });
});
