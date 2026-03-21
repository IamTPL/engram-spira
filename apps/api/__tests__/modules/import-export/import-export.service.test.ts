import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { resetMocks, setMockReturn } from '../../helpers/db-mock';

// Mock embedding
mock.module('../../../src/modules/embedding/embedding.service', () => ({
  enqueueEmbedding: mock(() => {}),
  embedCardBatch: mock(async () => {}),
}));

import * as importExportService from '../../../src/modules/import-export/import-export.service';

describe('import-export.service', () => {
  beforeEach(() => resetMocks());

  describe('exportCSV', () => {
    test('throws NotFoundError for non-owned deck', async () => {
      setMockReturn([]);
      await expect(
        importExportService.exportCSV('deck-1', 'wrong-user'),
      ).rejects.toThrow('Deck not found');
    });
  });

  describe('exportJSON', () => {
    test('throws NotFoundError for non-owned deck', async () => {
      setMockReturn([]);
      await expect(
        importExportService.exportJSON('deck-1', 'wrong-user'),
      ).rejects.toThrow('Deck not found');
    });
  });
});
