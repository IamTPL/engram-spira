import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { resetMocks, setMockReturn, setMockReturnSequence } from '../../helpers/db-mock';
import { createCard, createDeck, createStudyProgress } from '../../helpers/fixtures';

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
    test('returns empty when deck has no cards', async () => {
      const deck = createDeck();
      setMockReturnSequence([
        [deck], // verifyDeckOwnership
        [{ count: 0 }], // count
        [], // due cards
      ]);
      const result = await studyService.getDueCards('deck-1', 'user-1');
      expect(result.cards).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    test('throws NotFoundError for non-owned deck', async () => {
      setMockReturn([]);
      await expect(
        studyService.getDueCards('deck-1', 'wrong-user'),
      ).rejects.toThrow('Deck not found');
    });
  });

  describe('getInterleavedDueCards', () => {
    test('returns empty for empty deckIds', async () => {
      const result = await studyService.getInterleavedDueCards('user-1', []);
      expect(result.cards).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.due).toBe(0);
    });
  });

  describe('reviewCardBatch', () => {
    test('returns reviewed:0 for empty items', async () => {
      const result = await studyService.reviewCardBatch('user-1', []);
      expect(result.reviewed).toBe(0);
    });
  });
});
