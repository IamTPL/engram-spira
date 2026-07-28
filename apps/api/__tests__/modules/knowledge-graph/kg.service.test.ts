import { describe, test, expect, beforeEach } from 'bun:test';
import {
  mockDbChain,
  resetMocks,
  setMockReturn,
  setMockReturnSequence,
} from '../../helpers/db-mock';

import * as kgService from '../../../src/modules/knowledge-graph/kg.service';
import { ValidationError } from '../../../src/shared/errors';

describe('knowledge-graph.service', () => {
  beforeEach(() => resetMocks());

  describe('getDeckGraph', () => {
    test('throws NotFoundError for non-owned deck', async () => {
      setMockReturn([]);
      await expect(
        kgService.getDeckGraph('deck-1', 'wrong-user'),
      ).rejects.toThrow('Deck not found');
    });

    test('returns graph data for owned deck', async () => {
      const deck = { id: 'deck-1', cardTemplateId: 'tmpl-1' };
      setMockReturnSequence([
        [deck],  // verifyDeckOwnership
        [],      // cards
        [],      // links
      ]);
      const result = await kgService.getDeckGraph('deck-1', 'user-1');
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
    });
  });

  describe('deleteLink', () => {
    test('throws NotFoundError if link not found', async () => {
      setMockReturn([]);
      await expect(
        kgService.deleteLink('user-1', 'link-1'),
      ).rejects.toThrow('not found');
    });
  });

  describe('dismissSuggestion', () => {
    test('rejects a self-dismissal with an application validation error', async () => {
      const operation = kgService.dismissSuggestion(
        'user-1',
        'card-a',
        'card-a',
      );

      await expect(operation).rejects.toBeInstanceOf(ValidationError);
      await expect(operation).rejects.toMatchObject({
        statusCode: 422,
        message: 'A card cannot be dismissed against itself',
      });
      expect(mockDbChain.select).not.toHaveBeenCalled();
    });

    test('rejects a dismissal when the source card is not owned by the user', async () => {
      setMockReturnSequence([
        [],
        [{ id: 'card-b' }],
      ]);

      await expect(
        kgService.dismissSuggestion('user-1', 'card-a', 'card-b'),
      ).rejects.toThrow('Card not found');
    });

    test('rejects a dismissal when the target card is not owned by the user', async () => {
      if (!kgService.dismissSuggestion) {
        expect(kgService.dismissSuggestion).toBeTypeOf('function');
        return;
      }

      setMockReturnSequence([
        [{ id: 'card-a' }],
        [],
      ]);

      await expect(
        kgService.dismissSuggestion('user-1', 'card-a', 'card-b'),
      ).rejects.toThrow('Card not found');
    });

    test('stores dismissals in canonical pair order', async () => {
      if (!kgService.dismissSuggestion) {
        expect(kgService.dismissSuggestion).toBeTypeOf('function');
        return;
      }

      setMockReturnSequence([
        [{ id: 'card-a' }],
        [{ id: 'card-b' }],
      ]);

      await kgService.dismissSuggestion('user-1', 'card-b', 'card-a');

      expect(mockDbChain.values).toHaveBeenCalledWith({
        userId: 'user-1',
        sourceCardId: 'card-a',
        targetCardId: 'card-b',
      });
    });

    test('does not create a canonical dismissal when a reverse legacy row exists', async () => {
      setMockReturnSequence([
        [{ id: 'card-a' }],
        [{ id: 'card-b' }],
        [{ id: 'dismissed-reverse' }],
      ]);

      await kgService.dismissSuggestion('user-1', 'card-a', 'card-b');

      expect(mockDbChain.insert).not.toHaveBeenCalled();
    });
  });

  describe('createLink', () => {
    test('rejects a self-link with an application validation error', async () => {
      const operation = kgService.createLink('user-1', 'card-a', 'card-a');

      await expect(operation).rejects.toBeInstanceOf(ValidationError);
      await expect(operation).rejects.toMatchObject({
        statusCode: 422,
        message: 'A card cannot be linked to itself',
      });
      expect(mockDbChain.select).not.toHaveBeenCalled();
    });

    test('does not create a canonical link when a reverse legacy row exists', async () => {
      setMockReturnSequence([
        [{ id: 'card-a' }],
        [{ id: 'card-b' }],
        [{
          id: 'link-reverse',
          sourceCardId: 'card-b',
          targetCardId: 'card-a',
          linkType: 'related',
          createdAt: new Date(),
        }],
      ]);

      const result = await kgService.createLink('user-1', 'card-a', 'card-b');

      expect(result.id).toBe('link-reverse');
      expect(mockDbChain.insert).not.toHaveBeenCalled();
    });
  });
});
