import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { resetMocks, setMockReturn, setMockReturnSequence } from '../../helpers/db-mock';
import { createCard, createDeck } from '../../helpers/fixtures';

// Mock embedding service (fire-and-forget calls)
mock.module('../../../src/modules/embedding/embedding.service', () => ({
  enqueueEmbedding: mock(() => {}),
  embedCardBatch: mock(async () => {}),
}));

mock.module('../../../src/db/schema', () => ({
  cards: { id: 'id', deckId: 'deckId', sortOrder: 'sortOrder', createdAt: 'createdAt' },
  cardFieldValues: { cardId: 'cardId', templateFieldId: 'templateFieldId', value: 'value' },
  decks: { id: 'id', userId: 'userId', cardTemplateId: 'cardTemplateId' },
  templateFields: { id: 'id', templateId: 'templateId', name: 'name', fieldType: 'fieldType', side: 'side', sortOrder: 'sortOrder' },
}));

import * as cardsService from '../../../src/modules/cards/cards.service';

describe('cards.service', () => {
  beforeEach(() => resetMocks());

  describe('create', () => {
    test('creates card after verifying deck ownership', async () => {
      const deck = createDeck();
      const card = createCard();
      setMockReturnSequence([
        [deck],  // verifyDeckOwnership
        [],      // lock deck (execute)
        [],      // existing sortOrder query
        [card],  // insert returning
      ]);
      const result = await cardsService.create('deck-1', 'user-1', {
        fieldValues: [],
      });
      expect(result.id).toBe('card-1');
    });

    test('throws NotFoundError if deck not owned', async () => {
      setMockReturn([]);
      await expect(
        cardsService.create('deck-1', 'wrong-user', { fieldValues: [] }),
      ).rejects.toThrow('Deck not found');
    });
  });

  describe('update', () => {
    test('throws NotFoundError if card not found', async () => {
      setMockReturn([]);
      await expect(
        cardsService.update('card-1', 'user-1', { fieldValues: [] }),
      ).rejects.toThrow('Card not found');
    });

    test('updates card field values', async () => {
      const card = createCard();
      setMockReturnSequence([
        [{ cardId: card.id, deckId: 'deck-1' }], // ownership check
        [],    // upsert field values
        [card], // select updated card
      ]);
      const result = await cardsService.update('card-1', 'user-1', {
        fieldValues: [{ templateFieldId: 'field-1', value: 'new value' }],
      });
      expect(result.id).toBe('card-1');
    });
  });

  describe('remove', () => {
    test('removes card after verifying ownership', async () => {
      setMockReturn([{ cardId: 'card-1' }]);
      await expect(
        cardsService.remove('card-1', 'user-1'),
      ).resolves.toBeUndefined();
    });

    test('throws NotFoundError if card not found', async () => {
      setMockReturn([]);
      await expect(
        cardsService.remove('card-1', 'user-1'),
      ).rejects.toThrow('Card not found');
    });
  });

  describe('removeBatch', () => {
    test('throws NotFoundError if count mismatch', async () => {
      const deck = createDeck();
      setMockReturnSequence([
        [deck],                        // verifyDeckOwnership
        [{ id: 'card-1' }],           // found only 1 of 2 requested
      ]);
      await expect(
        cardsService.removeBatch('deck-1', 'user-1', ['card-1', 'card-2']),
      ).rejects.toThrow('Card not found');
    });

    test('deletes matching cards', async () => {
      const deck = createDeck();
      setMockReturnSequence([
        [deck],                            // verifyDeckOwnership
        [{ id: 'card-1' }, { id: 'card-2' }], // found all
        [],                                // delete
      ]);
      const result = await cardsService.removeBatch('deck-1', 'user-1', [
        'card-1',
        'card-2',
      ]);
      expect(result.deleted).toBe(2);
    });
  });

  describe('searchByDeck', () => {
    test('returns empty for empty query', async () => {
      const deck = createDeck();
      setMockReturn([deck]);
      const result = await cardsService.searchByDeck('deck-1', 'user-1', '');
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    test('returns empty for whitespace query', async () => {
      const deck = createDeck();
      setMockReturn([deck]);
      const result = await cardsService.searchByDeck('deck-1', 'user-1', '   ');
      expect(result.items).toHaveLength(0);
    });
  });
});
