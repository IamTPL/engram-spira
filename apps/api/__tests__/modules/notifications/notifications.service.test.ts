import { describe, test, expect, beforeEach } from 'bun:test';
import { resetMocks, setMockReturn, mockDbChain } from '../../helpers/db-mock';
import * as notificationsService from '../../../src/modules/notifications/notifications.service';

describe('notifications.service', () => {
  beforeEach(() => resetMocks());

  test('getDueDecks maps rows and issues exactly one statement', async () => {
    setMockReturn([{ deckId: 'deck-1', deckName: 'Math Vocab', dueCount: 5 }]);
    const result = await notificationsService.getDueDecks('user-1');
    expect(result).toEqual([{ deckId: 'deck-1', deckName: 'Math Vocab', dueCount: 5 }]);
    expect(mockDbChain.execute).toHaveBeenCalledTimes(1);
  });

  test('getDueDecks returns an empty array', async () => {
    setMockReturn([]);
    expect(await notificationsService.getDueDecks('user-1')).toEqual([]);
  });

  test('getTotalDueCount returns the total and 0 for no rows', async () => {
    setMockReturn([{ total: 42 }]);
    expect(await notificationsService.getTotalDueCount('user-1')).toBe(42);
    setMockReturn([]);
    expect(await notificationsService.getTotalDueCount('user-1')).toBe(0);
  });
});
