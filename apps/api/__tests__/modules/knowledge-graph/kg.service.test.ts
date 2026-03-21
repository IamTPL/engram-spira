import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { resetMocks, setMockReturn, setMockReturnSequence } from '../../helpers/db-mock';

mock.module('../../../src/config/ai', () => ({
  getGenAI: mock(() => ({
    getGenerativeModel: mock(() => ({
      generateContent: mock(async () => ({
        response: { text: () => '[]' },
      })),
    })),
  })),
  checkAiRateLimit: mock(() => {}),
}));

import * as kgService from '../../../src/modules/knowledge-graph/kg.service';

describe('knowledge-graph.service', () => {
  beforeEach(() => resetMocks());

  describe('getDeckGraph', () => {
    test('throws NotFoundError for non-owned deck', async () => {
      setMockReturn([]);
      await expect(
        kgService.getDeckGraph('deck-1', 'wrong-user'),
      ).rejects.toThrow('Deck not found');
    });

    test('returns graph data for owned deck', async () => {
      const deck = { id: 'deck-1', cardTemplateId: 'tmpl-1' };
      setMockReturnSequence([
        [deck],  // verifyDeckOwnership
        [],      // cards
        [],      // links
      ]);
      const result = await kgService.getDeckGraph('deck-1', 'user-1');
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
    });
  });

  describe('deleteLink', () => {
    test('throws NotFoundError if link not found', async () => {
      setMockReturn([]);
      await expect(
        kgService.deleteLink('user-1', 'link-1'),
      ).rejects.toThrow('not found');
    });
  });
});
