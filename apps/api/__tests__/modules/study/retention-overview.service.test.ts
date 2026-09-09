import { describe, expect, test } from 'bun:test';

import {
  getRetentionOverview,
  type RetentionOverviewAggregate,
  type RetentionOverviewLoaders,
} from '../../../src/modules/study/retention-overview.service';
import { NotFoundError } from '../../../src/shared/errors';

const AS_OF = new Date('2026-07-28T00:00:00.000Z');

function aggregate(
  overrides: Partial<RetentionOverviewAggregate> = {},
): RetentionOverviewAggregate {
  return {
    owned: true,
    total: 6,
    newCount: 1,
    dueCount: 2,
    atRiskCount: 1,
    onTrackCount: 2,
    averageRetention: 0.8123456,
    targetRetention: 0.9,
    attentionTotal: 3,
    attention: [
      {
        cardId: 'due-first',
        sortOrder: 1,
        status: 'due',
        retention: 0.5,
        lastReviewedAt: '2026-07-18T00:00:00.000Z',
        nextReviewAt: '2026-07-26T00:00:00.000Z',
      },
      {
        cardId: 'due-later',
        sortOrder: 2,
        status: 'due',
        retention: 0.7,
        lastReviewedAt: '2026-07-18T00:00:00.000Z',
        nextReviewAt: '2026-07-27T20:00:00.000Z',
      },
      {
        cardId: 'at-risk',
        sortOrder: 3,
        status: 'at_risk',
        retention: 0.61234,
        lastReviewedAt: '2026-07-26T00:00:00.000Z',
        nextReviewAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function loaders(
  agg: RetentionOverviewAggregate,
  labels = new Map<string, string>(),
): RetentionOverviewLoaders {
  return {
    loadAggregate: async () => agg,
    loadLabels: async (ids) =>
      new Map(ids.map((id) => [id, labels.get(id) ?? id])),
  };
}

describe('retention overview service', () => {
  test('projects the aggregate into the response, rounding metrics to 3 decimals', async () => {
    const result = await getRetentionOverview(
      'user-1',
      'deck-1',
      loaders(aggregate(), new Map([['due-first', 'First']])),
      AS_OF,
    );

    expect(result.asOf).toBe('2026-07-28T00:00:00.000Z');
    expect(result.metric).toEqual({
      kind: 'predicted_recall',
      average: 0.812,
      target: 0.9,
    });
    expect(result.summary).toEqual({
      total: 6,
      reviewed: 5,
      new: 1,
      due: 2,
      atRisk: 1,
      onTrack: 2,
      unavailable: 0,
    });
    expect(result.distribution).toEqual({
      new: 1,
      due: 2,
      atRisk: 1,
      onTrack: 2,
      unavailable: 0,
    });
    expect(
      result.attention.map((item) => [
        item.cardId,
        item.label,
        item.status,
        item.retention,
      ]),
    ).toEqual([
      ['due-first', 'First', 'due', 0.5],
      ['due-later', 'due-later', 'due', 0.7],
      ['at-risk', 'at-risk', 'at_risk', 0.612],
    ]);
    expect(result.attention[0]).toEqual({
      cardId: 'due-first',
      label: 'First',
      status: 'due',
      retention: 0.5,
      lastReviewedAt: '2026-07-18T00:00:00.000Z',
      nextReviewAt: '2026-07-26T00:00:00.000Z',
    });
    expect(result.reviewCardIds).toEqual(['due-first', 'due-later']);
    expect(result.attentionTotal).toBe(3);
  });

  test('falls back to "Card N" labels and null metrics', async () => {
    const result = await getRetentionOverview(
      'user-1',
      'deck-1',
      loaders(
        aggregate({ averageRetention: null, targetRetention: null }),
        new Map([['due-first', '   ']]),
      ),
      AS_OF,
    );

    expect(result.metric.average).toBeNull();
    expect(result.metric.target).toBeNull();
    expect(result.attention[0]!.label).toBe('Card 2');
  });

  test('throws NotFoundError for an unowned deck without leaking existence', async () => {
    const labelCalls: string[][] = [];
    const agg = aggregate({ owned: false, total: 0 });
    const tracked: RetentionOverviewLoaders = {
      loadAggregate: async () => agg,
      loadLabels: async (ids) => {
        labelCalls.push(ids);
        return new Map();
      },
    };

    await expect(
      getRetentionOverview('user-1', 'deck-1', tracked, AS_OF),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(labelCalls).toEqual([]);
  });
});
