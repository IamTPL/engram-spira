import { describe, test, expect, beforeEach, mock } from 'bun:test';

// ── Mock external deps BEFORE importing the service ────────────────────────
import { mockArgon2, mockEmailModule, mockLogger } from '../../helpers/external-mocks';
mockArgon2();
mockEmailModule();
mockLogger();

// Mock DB
import { resetMocks, setMockReturn, setMockReturnSequence, mockDbChain } from '../../helpers/db-mock';

// Mock session utils
const mockGenerateSessionToken = mock(() => 'mock-session-token');
const mockCreateSession = mock(async (userId: string, token: string) => ({
  id: 'session-id',
  userId,
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
}));
const mockInvalidateSession = mock(async () => {});

mock.module('../../../src/modules/auth/session.utils', () => ({
  generateSessionToken: mockGenerateSessionToken,
  createSession: mockCreateSession,
  invalidateSession: mockInvalidateSession,
}));

// Mock oslojs encoding
mock.module('@oslojs/encoding', () => ({
  encodeHexLowerCase: mock((bytes: Uint8Array) => 'mock-hex-token'),
}));

// Mock oslojs crypto
mock.module('@oslojs/crypto/sha2', () => ({
  sha256: mock((data: Uint8Array) => new Uint8Array(32)),
}));

// Mock db/schema
mock.module('../../../src/db/schema', () => ({
  users: { id: 'id', email: 'email', passwordHash: 'passwordHash', displayName: 'displayName', avatarUrl: 'avatarUrl', emailVerified: 'emailVerified', emailVerificationToken: 'emailVerificationToken', emailTokenExpiresAt: 'emailTokenExpiresAt' },
  passwordResetTokens: { id: 'id', userId: 'userId', tokenHash: 'tokenHash', expiresAt: 'expiresAt' },
  sessions: { id: 'id', userId: 'userId', expiresAt: 'expiresAt' },
}));

import { createUser } from '../../helpers/fixtures';

// Now import the service under test
import * as authService from '../../../src/modules/auth/auth.service';

describe('auth.service', () => {
  beforeEach(() => {
    resetMocks();
    mockGenerateSessionToken.mockClear();
    mockCreateSession.mockClear();
    mockInvalidateSession.mockClear();
  });

  // ── register ───────────────────────────────────────────
  describe('register', () => {
    test('throws ValidationError for invalid email', async () => {
      await expect(authService.register('invalid', 'password123')).rejects.toThrow(
        'Invalid email',
      );
    });

    test('throws ValidationError for empty email', async () => {
      await expect(authService.register('', 'password123')).rejects.toThrow(
        'Invalid email',
      );
    });

    test('throws ValidationError for short password', async () => {
      await expect(authService.register('test@test.com', 'short')).rejects.toThrow(
        'Password must be between',
      );
    });

    test('throws ValidationError for long password', async () => {
      const longPassword = 'a'.repeat(129);
      await expect(authService.register('test@test.com', longPassword)).rejects.toThrow(
        'Password must be between',
      );
    });

    test('throws ConflictError for duplicate email', async () => {
      setMockReturn([{ id: 'existing-user' }]);
      await expect(authService.register('test@test.com', 'password123')).rejects.toThrow(
        'Email already registered',
      );
    });

    test('registers successfully with valid inputs', async () => {
      const user = createUser();
      // First call: check existing user → empty
      // Second call: insert → returns new user
      setMockReturnSequence([
        [], // select existing — none found
        [{ id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl, emailVerified: false }], // insert returning
      ]);

      const result = await authService.register('test@test.com', 'password123');
      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('session');
      expect(mockCreateSession).toHaveBeenCalled();
    });
  });

  // ── login ──────────────────────────────────────────────
  describe('login', () => {
    test('throws UnauthorizedError for non-existing user', async () => {
      setMockReturn([]);
      await expect(authService.login('nobody@test.com', 'pass123')).rejects.toThrow(
        'Invalid email or password',
      );
    });

    test('throws UnauthorizedError for wrong password', async () => {
      setMockReturn([
        createUser({ passwordHash: '$mock_hash$wrong_password' }),
      ]);
      await expect(
        authService.login('test@test.com', 'password123'),
      ).rejects.toThrow('Invalid email or password');
    });

    test('returns user and session on valid login', async () => {
      setMockReturn([createUser({ passwordHash: '$mock_hash$password123' })]);
      const result = await authService.login('test@test.com', 'password123');
      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('token');
      expect(result.user.email).toBe('test@example.com');
    });
  });

  // ── logout ─────────────────────────────────────────────
  describe('logout', () => {
    test('calls invalidateSession', async () => {
      await authService.logout('some-token');
      expect(mockInvalidateSession).toHaveBeenCalledWith('some-token');
    });
  });

  // ── changePassword ─────────────────────────────────────
  describe('changePassword', () => {
    test('throws ValidationError for short new password', async () => {
      await expect(
        authService.changePassword('user-1', 'oldpass', 'short'),
      ).rejects.toThrow('Password must be between');
    });

    test('throws UnauthorizedError if user not found', async () => {
      setMockReturn([]);
      await expect(
        authService.changePassword('user-1', 'oldpass', 'newpass123'),
      ).rejects.toThrow('User not found');
    });

    test('throws ValidationError for wrong current password', async () => {
      setMockReturn([
        createUser({ passwordHash: '$mock_hash$different' }),
      ]);
      await expect(
        authService.changePassword('user-1', 'wrongpass', 'newpass123'),
      ).rejects.toThrow('Current password is incorrect');
    });

    test('succeeds with valid inputs', async () => {
      setMockReturn([
        createUser({ passwordHash: '$mock_hash$oldpass12' }),
      ]);
      const result = await authService.changePassword('user-1', 'oldpass12', 'newpass123');
      expect(result).toEqual({ success: true });
    });
  });

  // ── verifyEmail ────────────────────────────────────────
  describe('verifyEmail', () => {
    test('throws ValidationError for invalid token', async () => {
      setMockReturn([]);
      await expect(authService.verifyEmail('bad-token')).rejects.toThrow(
        'Invalid or expired verification token',
      );
    });

    test('returns alreadyVerified if already verified', async () => {
      setMockReturn([
        { id: 'user-1', emailVerified: true, emailTokenExpiresAt: new Date(Date.now() + 10000) },
      ]);
      const result = await authService.verifyEmail('good-token');
      expect(result).toEqual({ success: true, alreadyVerified: true });
    });

    test('verifies email successfully', async () => {
      setMockReturn([
        { id: 'user-1', emailVerified: false, emailTokenExpiresAt: new Date(Date.now() + 10000) },
      ]);
      const result = await authService.verifyEmail('good-token');
      expect(result).toEqual({ success: true, alreadyVerified: false });
    });
  });

  // ── forgotPassword ─────────────────────────────────────
  describe('forgotPassword', () => {
    test('returns success even if email not found (prevents enumeration)', async () => {
      setMockReturn([]);
      const result = await authService.forgotPassword('nobody@test.com');
      expect(result.success).toBe(true);
    });

    test('returns token for existing user', async () => {
      setMockReturnSequence([
        [{ id: 'user-1' }], // find user
        [],                  // delete old tokens
        [],                  // insert new token
      ]);
      const result = await authService.forgotPassword('test@test.com');
      expect(result.success).toBe(true);
    });
  });

  // ── resetPassword ──────────────────────────────────────
  describe('resetPassword', () => {
    test('throws ValidationError for short new password', async () => {
      await expect(
        authService.resetPassword('token', 'short'),
      ).rejects.toThrow('Password must be between');
    });

    test('throws ValidationError for invalid/expired token', async () => {
      setMockReturn([]);
      await expect(
        authService.resetPassword('bad-token', 'newpassword123'),
      ).rejects.toThrow('Invalid or expired reset token');
    });

    test('succeeds with valid token', async () => {
      setMockReturnSequence([
        [{ id: 'reset-1', userId: 'user-1', expiresAt: new Date(Date.now() + 10000) }], // find token
        [], // update password
        [], // delete tokens
      ]);
      const result = await authService.resetPassword('valid-token', 'newpassword123');
      expect(result).toEqual({ success: true });
    });
  });
});
