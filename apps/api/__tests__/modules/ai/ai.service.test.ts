import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { resetMocks, setMockReturn, setMockReturnSequence } from '../../helpers/db-mock';

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
});
