import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { resetMocks, setMockReturn } from '../../helpers/db-mock';

// Mock all schema tables
mock.module('../../../src/db/schema', () => ({
  studyProgress: { id: 'id', userId: 'userId', cardId: 'cardId', boxLevel: 'boxLevel', easeFactor: 'easeFactor', intervalDays: 'intervalDays', nextReviewAt: 'nextReviewAt', lastReviewedAt: 'lastReviewedAt', stability: 'stability', difficulty: 'difficulty', fsrsState: 'fsrsState', lastElapsedDays: 'lastElapsedDays', fsrsLearningSteps: 'fsrsLearningSteps' },
  studyDailyLogs: { userId: 'userId', studyDate: 'studyDate', cardsReviewed: 'cardsReviewed' },
  cards: { id: 'id', deckId: 'deckId', sortOrder: 'sortOrder' },
  cardFieldValues: { cardId: 'cardId', templateFieldId: 'templateFieldId', value: 'value' },
  templateFields: { id: 'id', name: 'name', fieldType: 'fieldType', side: 'side', sortOrder: 'sortOrder', templateId: 'templateId' },
  decks: { id: 'id', userId: 'userId', cardTemplateId: 'cardTemplateId', name: 'name' },
  reviewLogs: { userId: 'userId', cardId: 'cardId', rating: 'rating', state: 'state', elapsedDays: 'elapsedDays', scheduledDays: 'scheduledDays' },
  users: { id: 'id', srsAlgorithm: 'srsAlgorithm' },
  fsrsUserParams: { userId: 'userId', params: 'params' },
}));

// Mock notifications service
mock.module('../../../src/modules/notifications/notifications.service', () => ({
  getDueDecks: mock(async () => []),
}));

import * as studyService from '../../../src/modules/study/study.service';
import { createStudyDeckReadService } from '../../../src/modules/study/study.service';

function deckReadService(overrides: Record<string, unknown> = {}) {
  return createStudyDeckReadService({
    enrichCards: async () => [],
    getDueCards: async () => ({ cards: [], total: 0, due: 0 }),
    getDeckSchedule: async () => ({
      totalCards: 0,
      learnedCards: 0,
      upcoming: [],
      dueSoon: 0,
      nextReviewDate: null,
    }),
    getInterleavedDueCards: async () => ({ cards: [], total: 0, due: 0 }),
    getTopDueDeckIds: async () => [],
    ...overrides,
  } as never);
}

describe('study.service', () => {
  beforeEach(() => resetMocks());

  describe('getUserStreak', () => {
    test('returns zeros when no study logs', async () => {
      setMockReturn([]);
      const result = await studyService.getUserStreak('user-1');
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(0);
      expect(result.totalStudyDays).toBe(0);
      expect(result.studiedToday).toBe(false);
    });

    test('returns studiedToday:true when today is in logs', async () => {
      const today = new Date().toISOString().slice(0, 10);
      setMockReturn([{ studyDate: today }]);
      const result = await studyService.getUserStreak('user-1');
      expect(result.studiedToday).toBe(true);
      expect(result.currentStreak).toBe(1);
    });

    test('computes correct streak for consecutive days', async () => {
      const dates = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dates.push({ studyDate: d.toISOString().slice(0, 10) });
      }
      setMockReturn(dates);
      const result = await studyService.getUserStreak('user-1');
      expect(result.currentStreak).toBe(5);
      expect(result.longestStreak).toBe(5);
    });

    test('handles gap in streak', async () => {
      const today = new Date();
      const dates = [
        { studyDate: today.toISOString().slice(0, 10) },
        // skip yesterday
        {
          studyDate: new Date(today.getTime() - 3 * 86400000)
            .toISOString()
            .slice(0, 10),
        },
        {
          studyDate: new Date(today.getTime() - 4 * 86400000)
            .toISOString()
            .slice(0, 10),
        },
      ];
      setMockReturn(dates);
      const result = await studyService.getUserStreak('user-1');
      expect(result.currentStreak).toBe(1); // only today
      expect(result.longestStreak).toBe(2); // 2 consecutive days (3-4 days ago)
    });
  });

  describe('getUserActivity', () => {
    test('returns activity data', async () => {
      setMockReturn([
        { studyDate: '2026-01-01', cardsReviewed: 10 },
        { studyDate: '2026-01-02', cardsReviewed: 5 },
      ]);
      const result = await studyService.getUserActivity('user-1', 30);
      expect(result.activity).toHaveLength(2);
      expect(result.days).toBe(30);
    });

    test('clamps days to max 365', async () => {
      setMockReturn([]);
      const result = await studyService.getUserActivity('user-1', 500);
      expect(result.days).toBe(365);
    });
  });

  describe('getUserStats', () => {
    test('returns zeros when no data', async () => {
      setMockReturn([{ totalCardsReviewed: 0, totalStudyDays: 0 }]);
      const result = await studyService.getUserStats('user-1');
      expect(result.totalCardsReviewed).toBe(0);
      expect(result.totalStudyDays).toBe(0);
    });

    test('returns aggregated stats', async () => {
      setMockReturn([{ totalCardsReviewed: 150, totalStudyDays: 10 }]);
      const result = await studyService.getUserStats('user-1');
      expect(result.totalCardsReviewed).toBe(150);
      expect(result.totalStudyDays).toBe(10);
    });
  });

  describe('getDueCards', () => {
    const firstCardId = '11111111-1111-4111-8111-111111111111';
    const secondCardId = '22222222-2222-4222-8222-222222222222';

    test('returns empty when deck has no cards', async () => {
      const service = deckReadService();
      const result = await service.getDueCards('deck-1', 'user-1');
      expect(result.cards).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    test('throws NotFoundError for non-owned deck', async () => {
      const service = deckReadService({
        getDueCards: async () => {
          throw new Error('Deck not found');
        },
      });
      await expect(
        service.getDueCards('deck-1', 'wrong-user'),
      ).rejects.toThrow('Deck not found');
    });

    test('returns only the selected same-deck cards in requested order', async () => {
      let requestedCardIds: readonly string[] | undefined;
      const service = deckReadService({
        getDueCards: async (input: { selectedCardIds?: readonly string[] }) => {
          requestedCardIds = input.selectedCardIds;
          return {
            cards: [
              { id: secondCardId },
              { id: firstCardId },
            ],
            total: 2,
            due: 2,
          };
        },
      });
      const result = await service.getDueCards(
        'deck-1',
        'user-1',
        false,
        [secondCardId, firstCardId],
      );

      expect(result.cards.map((card) => card.id)).toEqual([
        secondCardId,
        firstCardId,
      ]);
      expect(result.total).toBe(2);
      expect(result.due).toBe(2);
      expect(requestedCardIds).toEqual([secondCardId, firstCardId]);
    });

    test('does not expose a selected card outside the owned deck', async () => {
      const service = deckReadService({
        getDueCards: async () => {
          throw new Error('Card not found');
        },
      });

      await expect(
        service.getDueCards('deck-1', 'user-1', false, [
          firstCardId,
          secondCardId,
        ]),
      ).rejects.toThrow('Card not found');
    });

    test('rejects a study cluster larger than 12 cards', async () => {
      const service = deckReadService();
      const cardIds = Array.from(
        { length: 13 },
        (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      );

      await expect(
        service.getDueCards('deck-1', 'user-1', false, cardIds),
      ).rejects.toThrow('Study cluster cannot contain more than 12 cards');
    });

    test('captures one explicit asOf before delegating a due-card read', async () => {
      let observedAsOf: Date | undefined;
      const service = deckReadService({
        getDueCards: async (input: { asOf: Date }) => {
          observedAsOf = input.asOf;
          return { cards: [], total: 0, due: 0 };
        },
      });

      await service.getDueCards('deck-1', 'user-1');

      expect(observedAsOf).toBeInstanceOf(Date);
      expect(observedAsOf?.getTime()).toBeGreaterThan(0);
    });
  });

  describe('getAutoInterleavedCards', () => {
    test('returns an empty session when no deck has due cards', async () => {
      const service = deckReadService({ getTopDueDeckIds: async () => [] });
      await expect(service.getAutoInterleavedCards('user-1')).resolves.toEqual({
        cards: [],
        total: 0,
        due: 0,
        deckIds: [],
      });
    });
  });
});
