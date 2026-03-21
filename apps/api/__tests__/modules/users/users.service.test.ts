import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { resetMocks, setMockReturn } from '../../helpers/db-mock';
import { createUser } from '../../helpers/fixtures';

mock.module('../../../src/db/schema', () => ({
  users: { id: 'id', email: 'email', displayName: 'displayName', avatarUrl: 'avatarUrl' },
}));

import * as usersService from '../../../src/modules/users/users.service';

describe('users.service', () => {
  beforeEach(() => resetMocks());

  describe('updateProfile', () => {
    test('updates display name', async () => {
      const updated = createUser({ displayName: 'New Name' });
      setMockReturn([updated]);
      const result = await usersService.updateProfile('user-1', {
        displayName: 'New Name',
      });
      expect(result.user.displayName).toBe('New Name');
    });

    test('throws ValidationError for empty display name', async () => {
      await expect(
        usersService.updateProfile('user-1', { displayName: '   ' }),
      ).rejects.toThrow('Display name cannot be empty');
    });

    test('updates avatar URL', async () => {
      const updated = createUser({ avatarUrl: '/ava_colect/cat.png' });
      setMockReturn([updated]);
      const result = await usersService.updateProfile('user-1', {
        avatarUrl: '/ava_colect/cat.png',
      });
      expect(result.user.avatarUrl).toBe('/ava_colect/cat.png');
    });

    test('clears avatar with empty string', async () => {
      const updated = createUser({ avatarUrl: null });
      setMockReturn([updated]);
      const result = await usersService.updateProfile('user-1', {
        avatarUrl: '',
      });
      expect(result.user.avatarUrl).toBeNull();
    });
  });

  describe('getAvatarCollection', () => {
    test('returns array of avatar URLs (may be empty if dir not found)', async () => {
      const result = await usersService.getAvatarCollection();
      expect(result).toHaveProperty('avatars');
      expect(Array.isArray(result.avatars)).toBe(true);
    });
  });
});
