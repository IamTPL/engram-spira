import { describe, test, expect, beforeEach } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  resetMocks,
  setMockReturn,
  setMockReturnSequence,
  mockDbChain,
} from '../../helpers/db-mock';

import * as recommendationsService from '../../../src/modules/study/recommendations.service';

const dialect = new PgDialect();

/** The rendered SQL of the most recent `db.execute` call. */
function lastSql() {
  const calls = mockDbChain.execute.mock.calls;
  return dialect.sqlToQuery(calls[calls.length - 1]![0]).sql;
}

describe('recommendations.service', () => {
  beforeEach(() => resetMocks());

  describe('getSmartGroups', () => {
    test('returns no groups and skips the scoring query when no concepts', async () => {
      setMockReturn([]);

      const result = await recommendationsService.getSmartGroups('user-1');

      expect(result).toEqual({ groups: [] });
      expect(mockDbChain.execute).toHaveBeenCalledTimes(1);
    });

    test('maps counts, rounded retention and sample ids per concept', async () => {
      setMockReturnSequence([
        [
          { concept: 'ancestors', card_count: 7 },
          { concept: 'colours', card_count: 2 },
        ],
        [
          {
            concept: 'ancestors',
            avgRetention: 0.8126,
            sampleCardIds: ['card-a', 'card-b'],
          },
          {
            concept: 'colours',
            avgRetention: null,
            sampleCardIds: ['card-c'],
          },
        ],
      ]);

      const result = await recommendationsService.getSmartGroups('user-1');

      expect(result.groups).toEqual([
        {
          name: 'ancestors',
          cardCount: 7,
          avgRetention: 0.813,
          sampleCardIds: ['card-a', 'card-b'],
        },
        {
          name: 'colours',
          cardCount: 2,
          avgRetention: null,
          sampleCardIds: ['card-c'],
        },
      ]);
    });

    test('keeps the count order and defaults concepts the scoring query skipped', async () => {
      setMockReturnSequence([
        [
          { concept: 'ancestors', card_count: 7 },
          { concept: 'colours', card_count: 2 },
        ],
        [{ concept: 'colours', avgRetention: 0.5, sampleCardIds: null }],
      ]);

      const result = await recommendationsService.getSmartGroups('user-1');

      expect(result.groups.map((group) => group.name)).toEqual([
        'ancestors',
        'colours',
      ]);
      expect(result.groups[0]).toEqual({
        name: 'ancestors',
        cardCount: 7,
        avgRetention: null,
        sampleCardIds: [],
      });
      expect(result.groups[1]!.sampleCardIds).toEqual([]);
    });

    test('scores de-duplicated concept/card pairs from canonical FSRS state', async () => {
      setMockReturnSequence([
        [{ concept: 'ancestors', card_count: 7 }],
        [],
      ]);

      await recommendationsService.getSmartGroups('user-1');

      const sql = lastSql();
      expect(sql).toContain('SELECT DISTINCT');
      expect(sql).toMatch(/row_number\(\) over \(\s*partition by concept/i);
      expect(sql).toContain('fsrs_card_states');
      expect(sql).toContain('fsrs_retrievability');
      expect(sql).not.toContain('study_progress');
    });
  });
});
