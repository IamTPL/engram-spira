import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { resetMocks, setMockReturn } from '../../helpers/db-mock';

mock.module('../../../src/db/schema', () => ({
  cards: { id: 'id', deckId: 'deckId' },
  decks: { id: 'id', userId: 'userId', name: 'name' },
  studyProgress: { id: 'id', cardId: 'cardId', userId: 'userId', nextReviewAt: 'nextReviewAt' },
}));

import * as notificationsService from '../../../src/modules/notifications/notifications.service';

describe('notifications.service', () => {
  beforeEach(() => resetMocks());

  describe('getDueDecks', () => {
    test('returns due deck notifications', async () => {
      setMockReturn([
        { deckId: 'deck-1', deckName: 'Math Vocab', dueCount: 5 },
        { deckId: 'deck-2', deckName: 'Science', dueCount: 3 },
      ]);
      const result = await notificationsService.getDueDecks('user-1');
      expect(result).toHaveLength(2);
      expect(result[0].deckId).toBe('deck-1');
      expect(result[0].dueCount).toBe(5);
    });

    test('returns empty array when no due cards', async () => {
      setMockReturn([]);
      const result = await notificationsService.getDueDecks('user-1');
      expect(result).toHaveLength(0);
    });
  });

  describe('getTotalDueCount', () => {
    test('returns total count', async () => {
      setMockReturn([{ total: 42 }]);
      const result = await notificationsService.getTotalDueCount('user-1');
      expect(result).toBe(42);
    });

    test('returns 0 when no due cards', async () => {
      setMockReturn([{ total: 0 }]);
      const result = await notificationsService.getTotalDueCount('user-1');
      expect(result).toBe(0);
    });
  });
});
