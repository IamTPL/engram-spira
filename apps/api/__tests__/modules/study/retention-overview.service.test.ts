import { describe, expect, test } from 'bun:test';

import {
  getRetentionOverview,
  type RetentionOverviewCardRow,
  type RetentionOverviewLoaders,
} from '../../../src/modules/study/retention-overview.service';

const AS_OF = new Date('2026-07-28T00:00:00.000Z');

function row(
  cardId: string,
  sortOrder: number,
  overrides: Partial<RetentionOverviewCardRow> = {},
): RetentionOverviewCardRow {
  return {
    cardId,
    sortOrder,
    lastReviewedAt: new Date('2026-07-18T00:00:00.000Z'),
    nextReviewAt: new Date('2026-08-01T00:00:00.000Z'),
    stability: 10,
    ...overrides,
  };
}

function loaders(
  cards: RetentionOverviewCardRow[],
  options: {
    algorithm?: 'sm2' | 'fsrs';
    fsrsParams?: unknown;
    labels?: Map<string, string>;
    labelCalls?: string[][];
  } = {},
): RetentionOverviewLoaders {
  return {
    loadContext: async () => ({
      algorithm: options.algorithm ?? 'fsrs',
      fsrsParams: options.fsrsParams ?? {},
    }),
    loadCards: async () => cards,
    loadLabels: async (cardIds) => {
      options.labelCalls?.push(cardIds);
      return options.labels ?? new Map(cardIds.map((id) => [id, id]));
    },
  };
}

describe('retention overview service', () => {
  test('includes every card and produces disjoint, explainable FSRS totals', async () => {
    const cards = [
      row('new-card', 0, {
        lastReviewedAt: null,
        nextReviewAt: null,
        stability: null,
      }),
      row('due-later', 2, {
        nextReviewAt: new Date('2026-07-27T20:00:00.000Z'),
      }),
      row('due-first', 1, {
        nextReviewAt: new Date('2026-07-26T00:00:00.000Z'),
        stability: null,
      }),
      row('at-risk', 3, {
        lastReviewedAt: new Date('2026-07-26T00:00:00.000Z'),
        stability: 1,
      }),
      row('on-track', 4, {
        lastReviewedAt: new Date('2026-07-27T18:00:00.000Z'),
      }),
      row('unavailable', 5, { stability: null }),
    ];
    const labelCalls: string[][] = [];

    const result = await getRetentionOverview(
      'user-1',
      'deck-1',
      loaders(cards, {
        labels: new Map([
          ['due-first', 'First due'],
          ['due-later', 'Later due'],
          ['at-risk', 'Risk word'],
        ]),
        labelCalls,
      }),
      AS_OF,
    );

    expect(result.algorithm).toBe('fsrs');
    expect(result.metric.kind).toBe('predicted_recall');
    expect(result.metric.target).toBeCloseTo(0.9, 10);
    expect(result.metric.average).not.toBeNull();
    expect(result.summary).toEqual({
      total: 6,
      reviewed: 5,
      new: 1,
      due: 2,
      atRisk: 1,
      onTrack: 1,
      unavailable: 1,
    });
    expect(
      result.summary.new +
        result.summary.due +
        result.summary.atRisk +
        result.summary.onTrack +
        result.summary.unavailable,
    ).toBe(result.summary.total);
    expect(result.distribution).toEqual({
      new: 1,
      due: 2,
      atRisk: 1,
      onTrack: 1,
      unavailable: 1,
    });
    expect(result.attention.map((card) => card.cardId)).toEqual([
      'due-first',
      'due-later',
      'at-risk',
    ]);
    expect(result.attention.map((card) => card.label)).toEqual([
      'First due',
      'Later due',
      'Risk word',
    ]);
    expect(result.reviewCardIds).toEqual(['due-first', 'due-later']);
    expect(labelCalls).toEqual([['due-first', 'due-later', 'at-risk']]);
  });

  test('SM-2 ignores stale stability and returns schedule status without a fake average', async () => {
    const result = await getRetentionOverview(
      'user-1',
      'deck-1',
      loaders(
        [
          row('scheduled', 0, { stability: 999 }),
          row('due', 1, {
            stability: 999,
            nextReviewAt: new Date('2026-07-27T00:00:00.000Z'),
          }),
        ],
        { algorithm: 'sm2' },
      ),
      AS_OF,
    );

    expect(result.metric).toEqual({
      kind: 'schedule_status',
      average: null,
      target: null,
    });
    expect(result.summary.atRisk).toBe(0);
    expect(result.summary.onTrack).toBe(1);
    expect(result.summary.due).toBe(1);
    expect(result.reviewCardIds).toEqual(['due']);
  });

  test('caps attention and automatic review IDs at 12 before loading labels', async () => {
    const labelCalls: string[][] = [];
    const cards = Array.from({ length: 15 }, (_, index) =>
      row(`card-${index.toString().padStart(2, '0')}`, index, {
        nextReviewAt: new Date(
          AS_OF.getTime() - (15 - index) * 60_000,
        ),
      }),
    );

    const result = await getRetentionOverview(
      'user-1',
      'deck-1',
      loaders(cards, { labelCalls }),
      AS_OF,
    );

    expect(result.attentionTotal).toBe(15);
    expect(result.attention).toHaveLength(12);
    expect(result.reviewCardIds).toHaveLength(12);
    expect(result.reviewCardIds).toEqual(
      cards.slice(0, 12).map((card) => card.cardId),
    );
    expect(labelCalls).toEqual([result.reviewCardIds]);
  });

  test('uses stable sort-order and card-ID ties and falls back to a readable label', async () => {
    const cards = [
      row('card-b', 4, {
        nextReviewAt: new Date('2026-07-27T00:00:00.000Z'),
      }),
      row('card-a', 4, {
        nextReviewAt: new Date('2026-07-27T00:00:00.000Z'),
      }),
    ];

    const result = await getRetentionOverview(
      'user-1',
      'deck-1',
      loaders(cards, { labels: new Map([['card-a', '   ']]) }),
      AS_OF,
    );

    expect(result.attention.map((card) => card.cardId)).toEqual([
      'card-a',
      'card-b',
    ]);
    expect(result.attention.map((card) => card.label)).toEqual([
      'Card 5',
      'Card 5',
    ]);
  });

  test('starts owned context and cards reads in parallel', async () => {
    const started: string[] = [];
    let resolveContext!: (
      value: { algorithm: 'sm2'; fsrsParams: unknown },
    ) => void;
    let resolveCards!: (value: RetentionOverviewCardRow[]) => void;

    const contextPromise = new Promise<{
      algorithm: 'sm2';
      fsrsParams: unknown;
    }>((resolve) => {
      resolveContext = resolve;
    });
    const cardsPromise = new Promise<RetentionOverviewCardRow[]>((resolve) => {
      resolveCards = resolve;
    });

    const pending = getRetentionOverview(
      'user-1',
      'deck-1',
      {
        loadContext: () => {
          started.push('context');
          return contextPromise;
        },
        loadCards: () => {
          started.push('cards');
          return cardsPromise;
        },
        loadLabels: async () => new Map(),
      },
      AS_OF,
    );

    await Promise.resolve();
    expect(started).toEqual(['context', 'cards']);
    resolveContext({ algorithm: 'sm2', fsrsParams: {} });
    resolveCards([]);

    await expect(pending).resolves.toMatchObject({
      summary: { total: 0 },
    });
  });

  test('returns a non-leaking not-found error for an unowned deck', async () => {
    let labelsLoaded = false;

    const pending = getRetentionOverview(
      'user-1',
      'foreign-deck',
      {
        loadContext: async () => null,
        loadCards: async () => [],
        loadLabels: async () => {
          labelsLoaded = true;
          return new Map();
        },
      },
      AS_OF,
    );

    await expect(pending).rejects.toThrow('Deck not found');
    expect(labelsLoaded).toBe(false);
  });
});
