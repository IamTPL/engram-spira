import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { resetMocks, setMockReturn, setMockReturnSequence } from '../../helpers/db-mock';
import { createFolder, createClass } from '../../helpers/fixtures';

mock.module('../../../src/db/schema', () => ({
  folders: { id: 'id', classId: 'classId', name: 'name', sortOrder: 'sortOrder', createdAt: 'createdAt' },
  classes: { id: 'id', userId: 'userId' },
}));

import * as foldersService from '../../../src/modules/folders/folders.service';

describe('folders.service', () => {
  beforeEach(() => resetMocks());

  describe('listByClass', () => {
    test('returns folders for class', async () => {
      const cls = createClass();
      const folders = [createFolder(), createFolder({ id: 'folder-2', name: 'Folder 2' })];
      setMockReturnSequence([[cls], folders]);
      const result = await foldersService.listByClass('class-1', 'user-1');
      expect(result).toHaveLength(2);
    });

    test('throws NotFoundError if class not owned', async () => {
      setMockReturn([]);
      await expect(
        foldersService.listByClass('class-1', 'wrong-user'),
      ).rejects.toThrow('Class not found');
    });
  });

  describe('getById', () => {
    test('returns folder when found', async () => {
      const folder = createFolder();
      setMockReturn([{ folders: folder }]);
      const result = await foldersService.getById('folder-1', 'user-1');
      expect(result.name).toBe('Test Folder');
    });

    test('throws NotFoundError when not found', async () => {
      setMockReturn([]);
      await expect(
        foldersService.getById('nonexistent', 'user-1'),
      ).rejects.toThrow('Folder not found');
    });
  });

  describe('create', () => {
    test('creates folder after verifying class ownership', async () => {
      const cls = createClass();
      const folder = createFolder({ name: 'New Folder' });
      setMockReturnSequence([[cls], [folder]]);
      const result = await foldersService.create('class-1', 'user-1', {
        name: 'New Folder',
      });
      expect(result.name).toBe('New Folder');
    });

    test('throws NotFoundError if class not owned', async () => {
      setMockReturn([]);
      await expect(
        foldersService.create('class-1', 'wrong-user', { name: 'F' }),
      ).rejects.toThrow('Class not found');
    });
  });

  describe('update', () => {
    test('updates folder name', async () => {
      const folder = createFolder();
      const updated = createFolder({ name: 'Updated Folder' });
      setMockReturnSequence([[{ folders: folder }], [updated]]);
      const result = await foldersService.update('folder-1', 'user-1', {
        name: 'Updated Folder',
      });
      expect(result.name).toBe('Updated Folder');
    });
  });

  describe('remove', () => {
    test('removes folder after verifying ownership', async () => {
      const folder = createFolder();
      setMockReturn([{ folders: folder }]);
      await expect(
        foldersService.remove('folder-1', 'user-1'),
      ).resolves.toBeUndefined();
    });

    test('throws NotFoundError for non-owned folder', async () => {
      setMockReturn([]);
      await expect(
        foldersService.remove('folder-1', 'wrong-user'),
      ).rejects.toThrow('Folder not found');
    });
  });

  describe('reorder', () => {
    test('throws NotFoundError if folder not in class', async () => {
      const cls = createClass();
      setMockReturnSequence([
        [cls],                              // verifyClassOwnership
        [createFolder({ id: 'folder-1' })], // existing folders
      ]);
      await expect(
        foldersService.reorder('class-1', 'user-1', ['folder-1', 'folder-unknown']),
      ).rejects.toThrow('Folder not found');
    });
  });
});
