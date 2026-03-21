import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { resetMocks, setMockReturn, setMockReturnSequence } from '../../helpers/db-mock';
import { createClass } from '../../helpers/fixtures';

mock.module('../../../src/db/schema', () => ({
  classes: { id: 'id', userId: 'userId', name: 'name', description: 'description', sortOrder: 'sortOrder', createdAt: 'createdAt' },
}));

import * as classesService from '../../../src/modules/classes/classes.service';

describe('classes.service', () => {
  beforeEach(() => resetMocks());

  describe('listByUser', () => {
    test('returns user classes', async () => {
      const classes = [createClass(), createClass({ id: 'class-2', name: 'Class 2' })];
      setMockReturn(classes);
      const result = await classesService.listByUser('user-1');
      expect(result).toHaveLength(2);
    });

    test('returns empty array for user with no classes', async () => {
      setMockReturn([]);
      const result = await classesService.listByUser('user-1');
      expect(result).toHaveLength(0);
    });
  });

  describe('getById', () => {
    test('returns class when found', async () => {
      setMockReturn([createClass()]);
      const result = await classesService.getById('class-1', 'user-1');
      expect(result.name).toBe('Test Class');
    });

    test('throws NotFoundError when not found', async () => {
      setMockReturn([]);
      await expect(
        classesService.getById('nonexistent', 'user-1'),
      ).rejects.toThrow('Class not found');
    });
  });

  describe('create', () => {
    test('creates class with name', async () => {
      const cls = createClass({ name: 'Math' });
      setMockReturn([cls]);
      const result = await classesService.create('user-1', { name: 'Math' });
      expect(result.name).toBe('Math');
    });

    test('creates class with description', async () => {
      const cls = createClass({ name: 'Math', description: 'Mathematics class' });
      setMockReturn([cls]);
      const result = await classesService.create('user-1', {
        name: 'Math',
        description: 'Mathematics class',
      });
      expect(result.description).toBe('Mathematics class');
    });
  });

  describe('update', () => {
    test('updates class name', async () => {
      const cls = createClass();
      const updated = createClass({ name: 'Updated' });
      setMockReturnSequence([[cls], [updated]]);
      const result = await classesService.update('class-1', 'user-1', {
        name: 'Updated',
      });
      expect(result.name).toBe('Updated');
    });

    test('throws NotFoundError for non-owned class', async () => {
      setMockReturn([]);
      await expect(
        classesService.update('class-1', 'wrong-user', { name: 'X' }),
      ).rejects.toThrow('Class not found');
    });
  });

  describe('remove', () => {
    test('removes class after verifying ownership', async () => {
      setMockReturn([createClass()]);
      await expect(
        classesService.remove('class-1', 'user-1'),
      ).resolves.toBeUndefined();
    });

    test('throws NotFoundError for non-owned class', async () => {
      setMockReturn([]);
      await expect(
        classesService.remove('class-1', 'wrong-user'),
      ).rejects.toThrow('Class not found');
    });
  });

  describe('reorder', () => {
    test('throws NotFoundError if class not owned by user', async () => {
      setMockReturn([createClass({ id: 'class-1' })]);
      await expect(
        classesService.reorder('user-1', ['class-1', 'class-unknown']),
      ).rejects.toThrow('Class not found');
    });
  });
});
