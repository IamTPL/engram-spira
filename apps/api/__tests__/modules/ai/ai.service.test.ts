import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  mockDbChain,
  resetMocks,
  setMockReturn,
  setMockReturnSequence,
} from '../../helpers/db-mock';

// Mock embedding service
mock.module('../../../src/modules/embedding/embedding.service', () => ({
  enqueueEmbedding: mock(() => {}),
  embedCardBatch: mock(async () => {}),
}));

import * as aiService from '../../../src/modules/ai/ai.service';
import type { GeminiProvider } from '../../../src/modules/ai/gemini-provider';

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

  describe('processAiGenerationJob', () => {
    test('preserves chunk concatenation and pending-job update protocol', async () => {
      setMockReturn([]);
      const requests: Array<{ prompt: string; timeoutMs?: number }> = [];
      const provider = {
        async generateTextStream(request: {
          prompt: string;
          timeoutMs?: number;
        }) {
          requests.push(request);
          return {
            stream: (async function* () {
              yield '[{"front":"Question",';
              yield '"back":"Answer"}]';
            })(),
            usage: Promise.resolve({
              inputTokens: null,
              outputTokens: null,
            }),
          };
        },
      } as Pick<GeminiProvider, 'generateTextStream'>;

      await aiService.processAiGenerationJob(
        'job-1',
        'qa',
        'source text',
        'en',
        provider,
      );

      expect(requests).toHaveLength(1);
      expect(requests[0].timeoutMs).toBe(3 * 60 * 1_000);
      expect(mockDbChain.set).toHaveBeenCalledWith({
        status: 'pending',
        generatedCards: [{ front: 'Question', back: 'Answer' }],
        cardCount: 1,
      });
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
