import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { resetMocks, setMockReturn, setMockReturnSequence } from '../../helpers/db-mock';

mock.module('../../../src/db/schema', () => ({
  cardTemplates: { id: 'id', userId: 'userId', name: 'name', description: 'description', isSystem: 'isSystem' },
  templateFields: { id: 'id', templateId: 'templateId', name: 'name', fieldType: 'fieldType', side: 'side', sortOrder: 'sortOrder', isRequired: 'isRequired', config: 'config' },
  decks: { id: 'id', cardTemplateId: 'cardTemplateId' },
}));

import * as ctService from '../../../src/modules/card-templates/card-templates.service';

describe('card-templates.service', () => {
  beforeEach(() => {
    resetMocks();
    ctService.invalidateSystemTemplatesCache();
  });

  describe('getWithFields', () => {
    test('returns template with fields', async () => {
      const template = { id: 'tmpl-1', name: 'Vocab', isSystem: true, userId: null, description: null };
      const fields = [
        { id: 'f1', templateId: 'tmpl-1', name: 'Word', fieldType: 'text', side: 'front', sortOrder: 0 },
        { id: 'f2', templateId: 'tmpl-1', name: 'Meaning', fieldType: 'textarea', side: 'back', sortOrder: 0 },
      ];
      setMockReturnSequence([[template], fields]);
      const result = await ctService.getWithFields('tmpl-1');
      expect(result.name).toBe('Vocab');
      expect(result.fields).toHaveLength(2);
    });

    test('throws NotFoundError for non-existing template', async () => {
      setMockReturnSequence([[], []]);
      await expect(ctService.getWithFields('bad-id')).rejects.toThrow(
        'Card template not found',
      );
    });
  });

  describe('update', () => {
    test('throws NotFoundError for non-existing template', async () => {
      setMockReturn([]);
      await expect(
        ctService.update('user-1', 'bad-id', { name: 'X' }),
      ).rejects.toThrow('Card template not found');
    });

    test('throws ValidationError for system template', async () => {
      setMockReturn([
        { id: 'tmpl-1', isSystem: true, userId: null, name: 'System' },
      ]);
      await expect(
        ctService.update('user-1', 'tmpl-1', { name: 'Modified' }),
      ).rejects.toThrow('Cannot modify system templates');
    });

    test('throws NotFoundError if template belongs to another user', async () => {
      setMockReturn([
        { id: 'tmpl-1', isSystem: false, userId: 'other-user', name: 'Custom' },
      ]);
      await expect(
        ctService.update('user-1', 'tmpl-1', { name: 'Hijack' }),
      ).rejects.toThrow('Card template not found');
    });
  });

  describe('remove', () => {
    test('throws NotFoundError for non-existing template', async () => {
      setMockReturn([]);
      await expect(
        ctService.remove('user-1', 'bad-id'),
      ).rejects.toThrow('Card template not found');
    });

    test('throws ValidationError for system template', async () => {
      setMockReturn([
        { id: 'tmpl-1', isSystem: true, userId: null },
      ]);
      await expect(
        ctService.remove('user-1', 'tmpl-1'),
      ).rejects.toThrow('Cannot delete system templates');
    });

    test('throws ValidationError if template is in use', async () => {
      setMockReturnSequence([
        [{ id: 'tmpl-1', isSystem: false, userId: 'user-1' }], // find template
        [{ id: 'deck-1' }], // in use by a deck
      ]);
      await expect(
        ctService.remove('user-1', 'tmpl-1'),
      ).rejects.toThrow('Cannot delete template that is in use');
    });

    test('deletes template when not in use', async () => {
      setMockReturnSequence([
        [{ id: 'tmpl-1', isSystem: false, userId: 'user-1' }], // find template
        [], // not in use
        [], // delete
      ]);
      const result = await ctService.remove('user-1', 'tmpl-1');
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('invalidateSystemTemplatesCache', () => {
    test('invalidating cache does not throw', () => {
      expect(() => ctService.invalidateSystemTemplatesCache()).not.toThrow();
    });
  });
});
