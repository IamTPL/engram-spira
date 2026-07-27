import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  mockDbChain,
  resetMocks,
  setMockReturn,
  setMockReturnSequence,
} from '../../helpers/db-mock';

mock.module('../../../src/config/ai', () => ({
  getGenAI: mock(() => ({
    getGenerativeModel: mock(() => ({
      generateContent: mock(async () => ({
        response: { text: () => '[]' },
      })),
      generateContentStream: mock(async () => ({
        stream: (async function* () {
          yield { text: () => '[]' };
        })(),
      })),
    })),
  })),
  checkAiRateLimit: mock(() => {}),
}));

// Mock embedding service
mock.module('../../../src/modules/embedding/embedding.service', () => ({
  enqueueEmbedding: mock(() => {}),
  embedCardBatch: mock(async () => {}),
}));

import * as aiService from '../../../src/modules/ai/ai.service';

describe('ai.service', () => {
  beforeEach(() => resetMocks());

  describe('listJobs', () => {
    test('returns empty array when no jobs', async () => {
      setMockReturn([]);
      const result = await aiService.listJobs('user-1');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getJob', () => {
    test('throws NotFoundError for non-existing job', async () => {
      setMockReturn([]);
      await expect(
        aiService.getJob('user-1', 'non-existing'),
      ).rejects.toThrow('not found');
    });
  });

  describe('saveGeneratedCards', () => {
    test('batch inserts cards and field values while preserving card order', async () => {
      setMockReturnSequence([
        [
          {
            id: 'job-1',
            userId: 'user-1',
            deckId: 'deck-1',
            status: 'pending',
            generatedCards: [
              { front: 'Question 1', back: 'Answer 1' },
              { front: 'Question 2', back: 'Answer 2' },
            ],
          },
        ],
        [{ id: 'deck-1', cardTemplateId: 'template-1' }],
        [
          { id: 'front-field', name: 'Front', side: 'front', sortOrder: 0 },
          { id: 'back-field', name: 'Back', side: 'back', sortOrder: 1 },
        ],
        [],
        [{ sortOrder: -1 }],
        [
          { id: 'card-2', deckId: 'deck-1', sortOrder: 1 },
          { id: 'card-1', deckId: 'deck-1', sortOrder: 0 },
        ],
        [],
        [],
      ]);

      const result = await aiService.saveGeneratedCards('user-1', 'job-1');

      expect(result).toEqual({
        saved: 2,
        cards: [
          { id: 'card-1', front: 'Question 1', back: 'Answer 1' },
          { id: 'card-2', front: 'Question 2', back: 'Answer 2' },
        ],
      });
      expect(mockDbChain.insert).toHaveBeenCalledTimes(2);
      expect(mockDbChain.values.mock.calls[1]?.[0]).toEqual([
        {
          cardId: 'card-1',
          templateFieldId: 'front-field',
          value: 'Question 1',
        },
        {
          cardId: 'card-1',
          templateFieldId: 'back-field',
          value: 'Answer 1',
        },
        {
          cardId: 'card-2',
          templateFieldId: 'front-field',
          value: 'Question 2',
        },
        {
          cardId: 'card-2',
          templateFieldId: 'back-field',
          value: 'Answer 2',
        },
      ]);
    });
  });
});
