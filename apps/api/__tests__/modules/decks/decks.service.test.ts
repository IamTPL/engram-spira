import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { resetMocks, setMockReturn, setMockReturnSequence } from '../../helpers/db-mock';
import { createDeck, createFolder } from '../../helpers/fixtures';

// Mock db/schema
mock.module('../../../src/db/schema', () => ({
  decks: { id: 'id', userId: 'userId', folderId: 'folderId', cardTemplateId: 'cardTemplateId', name: 'name', createdAt: 'createdAt' },
  folders: { id: 'id', classId: 'classId' },
  classes: { id: 'id', userId: 'userId' },
  cards: { id: 'id', deckId: 'deckId' },
}));

import * as decksService from '../../../src/modules/decks/decks.service';

describe('decks.service', () => {
  beforeEach(() => resetMocks());

  describe('getById', () => {
    test('returns deck when found and owned', async () => {
      const deck = createDeck();
      setMockReturn([deck]);
      const result = await decksService.getById('deck-1', 'user-1');
      expect(result.id).toBe('deck-1');
      expect(result.name).toBe('Test Deck');
    });

    test('throws NotFoundError when deck not found', async () => {
      setMockReturn([]);
      await expect(
        decksService.getById('nonexistent', 'user-1'),
      ).rejects.toThrow('Deck not found');
    });
  });

  describe('create', () => {
    test('creates deck after verifying folder ownership', async () => {
      const folder = createFolder();
      const deck = createDeck();
      setMockReturnSequence([
        [folder],  // verifyFolderOwnership
        [deck],    // insert returning
      ]);

      const result = await decksService.create('folder-1', 'user-1', {
        name: 'New Deck',
        cardTemplateId: 'template-1',
      });
      expect(result.id).toBe('deck-1');
    });

    test('throws NotFoundError if folder not owned', async () => {
      setMockReturn([]);
      await expect(
        decksService.create('bad-folder', 'user-1', {
          name: 'Deck',
          cardTemplateId: 'template-1',
        }),
      ).rejects.toThrow('Folder not found');
    });
  });

  describe('update', () => {
    test('updates deck name', async () => {
      const deck = createDeck();
      const updated = createDeck({ name: 'Updated Name' });
      setMockReturnSequence([
        [deck],    // getById
        [updated], // update returning
      ]);
      const result = await decksService.update('deck-1', 'user-1', {
        name: 'Updated Name',
      });
      expect(result.name).toBe('Updated Name');
    });

    test('throws NotFoundError for non-owned deck', async () => {
      setMockReturn([]);
      await expect(
        decksService.update('deck-1', 'wrong-user', { name: 'X' }),
      ).rejects.toThrow('Deck not found');
    });
  });

  describe('remove', () => {
    test('deletes deck after verifying ownership', async () => {
      const deck = createDeck();
      setMockReturn([deck]);
      await expect(
        decksService.remove('deck-1', 'user-1'),
      ).resolves.toBeUndefined();
    });

    test('throws NotFoundError for non-owned deck', async () => {
      setMockReturn([]);
      await expect(
        decksService.remove('deck-1', 'wrong-user'),
      ).rejects.toThrow('Deck not found');
    });
  });

  describe('move', () => {
    test('moves deck to a new folder', async () => {
      const deck = createDeck();
      const targetFolder = createFolder({ id: 'folder-2' });
      const movedDeck = createDeck({ folderId: 'folder-2' });
      setMockReturnSequence([
        [deck],         // getById
        [targetFolder], // verifyFolderOwnership
        [movedDeck],    // update returning
      ]);
      const result = await decksService.move('deck-1', 'user-1', 'folder-2');
      expect(result.folderId).toBe('folder-2');
    });

    test('throws NotFoundError if deck not owned', async () => {
      setMockReturn([]);
      await expect(
        decksService.move('deck-1', 'wrong-user', 'folder-2'),
      ).rejects.toThrow('Deck not found');
    });
  });
});
