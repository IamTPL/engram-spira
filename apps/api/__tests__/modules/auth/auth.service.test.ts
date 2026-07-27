import { describe, test, expect, beforeEach, mock } from 'bun:test';

// ── Mock external deps BEFORE importing the service ────────────────────────
import { mockArgon2 } from '../../helpers/external-mocks';
mockArgon2();

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
  users: { id: 'id', email: 'email', passwordHash: 'passwordHash', displayName: 'displayName', avatarUrl: 'avatarUrl', emailVerified: 'emailVerified', emailVerificationToken: 'emailVerificationToken', emailTokenExpiresAt: 'emailTokenExpiresAt', emailVerificationVersion: 'emailVerificationVersion' },
  passwordResetTokens: { id: 'id', userId: 'userId', tokenHash: 'tokenHash', expiresAt: 'expiresAt' },
  sessions: { id: 'id', userId: 'userId', expiresAt: 'expiresAt' },
}));

import { createUser } from '../../helpers/fixtures';
import { ConflictError } from '../../../src/shared/errors';

// Now import the service under test
import * as authService from '../../../src/modules/auth/auth.service';

const FIXED_NOW = new Date('2026-07-27T12:00:00.000Z');
const mockEnqueueVerificationEmail = mock(
  async (_executor: any, _userId: string, _tokenVersion: number) => ({
    jobId: 'verification-job-id',
  }),
);
const mockCancelVerificationEmail = mock(
  async (_executor: any, _userId: string, _tokenVersion: number) => true,
);
const mockRequestVerificationEmailProcessing = mock(() => {});
const verificationQueueDependencies = {
  enqueue: mockEnqueueVerificationEmail,
  cancel: mockCancelVerificationEmail,
  requestProcessing: mockRequestVerificationEmailProcessing,
  now: () => new Date(FIXED_NOW),
};

describe('auth.service', () => {
  beforeEach(() => {
    resetMocks();
    mockGenerateSessionToken.mockClear();
    mockCreateSession.mockClear();
    mockInvalidateSession.mockClear();
    mockEnqueueVerificationEmail.mockClear();
    mockEnqueueVerificationEmail.mockImplementation(
      async () => ({ jobId: 'verification-job-id' }),
    );
    mockCancelVerificationEmail.mockClear();
    mockCancelVerificationEmail.mockImplementation(async () => true);
    mockRequestVerificationEmailProcessing.mockClear();
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

      const result = await authService.register(
        'test@test.com',
        'password123',
        verificationQueueDependencies,
      );
      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('session');
      expect(mockCreateSession).toHaveBeenCalled();
      expect(mockEnqueueVerificationEmail).toHaveBeenCalledWith(
        mockDbChain,
        user.id,
        1,
      );
      expect(mockRequestVerificationEmailProcessing).toHaveBeenCalledTimes(1);
    });

    test('waits only until the verification request is durably queued', async () => {
      const user = createUser();
      setMockReturnSequence([
        [],
        [
          {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            emailVerified: false,
          },
        ],
      ]);

      let resolveEnqueue!: () => void;
      let markEnqueueStarted!: () => void;
      const enqueueStarted = new Promise<void>((resolve) => {
        markEnqueueStarted = resolve;
      });
      mockEnqueueVerificationEmail.mockImplementationOnce(
        () =>
          new Promise<{ jobId: string }>((resolve) => {
            resolveEnqueue = () => resolve({ jobId: 'verification-job-id' });
            markEnqueueStarted();
          }),
      );

      let registrationCompleted = false;
      const registration = authService
        .register(
          'test@test.com',
          'password123',
          verificationQueueDependencies,
        )
        .then((result) => {
          registrationCompleted = true;
          return result;
        });

      await enqueueStarted;
      expect(registrationCompleted).toBe(false);
      expect(mockRequestVerificationEmailProcessing).not.toHaveBeenCalled();

      resolveEnqueue();
      const result = await registration;
      expect(result.user.id).toBe(user.id);
      expect(mockRequestVerificationEmailProcessing).toHaveBeenCalledTimes(1);
    });

    test('does not report success when the durable enqueue fails', async () => {
      const user = createUser();
      setMockReturnSequence([
        [],
        [
          {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            emailVerified: false,
          },
        ],
      ]);
      mockEnqueueVerificationEmail.mockRejectedValueOnce(
        new Error('outbox unavailable'),
      );

      await expect(
        authService.register(
          'test@test.com',
          'password123',
          verificationQueueDependencies,
        ),
      ).rejects.toThrow('outbox unavailable');
      expect(mockCreateSession).not.toHaveBeenCalled();
      expect(mockRequestVerificationEmailProcessing).not.toHaveBeenCalled();
    });

    test('stores a 24-hour token and initial queue version atomically', async () => {
      const user = createUser();
      setMockReturnSequence([
        [],
        [
          {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            emailVerified: false,
          },
        ],
      ]);

      await authService.register(
        user.email,
        'password123',
        verificationQueueDependencies,
      );

      expect(mockDbChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          emailVerificationToken: 'mock-hex-token',
          emailVerificationVersion: 1,
          emailTokenExpiresAt: new Date(
            FIXED_NOW.getTime() + 24 * 60 * 60 * 1000,
          ),
        }),
      );
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
      setMockReturn([
        createUser({
          passwordHash: '$mock_hash$password123',
          emailVerified: true,
        }),
      ]);
      const result = await authService.login('test@test.com', 'password123');
      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('token');
      expect(result.user.email).toBe('test@example.com');
      expect(result.user.emailVerified).toBe(true);
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
      await expect(
        authService.verifyEmail('bad-token', verificationQueueDependencies),
      ).rejects.toThrow('Invalid or expired verification token');
      expect(mockCancelVerificationEmail).not.toHaveBeenCalled();
    });

    test('returns alreadyVerified if already verified', async () => {
      setMockReturn([
        { id: 'user-1', emailVerified: true, emailTokenExpiresAt: new Date(Date.now() + 10000) },
      ]);
      const result = await authService.verifyEmail(
        'good-token',
        verificationQueueDependencies,
      );
      expect(result).toEqual({ success: true, alreadyVerified: true });
      expect(mockCancelVerificationEmail).not.toHaveBeenCalled();
    });

    test('verifies email and cancels the matching queued delivery atomically', async () => {
      setMockReturnSequence([
        [
          {
            id: 'user-1',
            emailVerified: false,
            emailTokenExpiresAt: new Date(FIXED_NOW.getTime() + 10_000),
          },
        ],
        [{ tokenVersion: 3 }],
      ]);
      const result = await authService.verifyEmail(
        'good-token',
        verificationQueueDependencies,
      );
      expect(result).toEqual({ success: true, alreadyVerified: false });
      expect(mockCancelVerificationEmail).toHaveBeenCalledWith(
        mockDbChain,
        'user-1',
        3,
      );
    });
  });

  // ── resendVerification ─────────────────────────────────
  describe('resendVerification', () => {
    test('queues immediately and reuses an unexpired token', async () => {
      const previousExpiry = new Date(FIXED_NOW.getTime() + 60_000);
      const user = createUser({
        emailVerified: false,
        emailVerificationToken: 'previous-token',
        emailTokenExpiresAt: previousExpiry,
        emailVerificationVersion: 4,
      });
      setMockReturnSequence([[user], [{ id: user.id }]]);

      const result = await authService.resendVerification(
        user.id,
        verificationQueueDependencies,
      );

      expect(mockDbChain.set).toHaveBeenCalledWith({
        emailVerificationToken: 'previous-token',
        emailTokenExpiresAt: previousExpiry,
        emailVerificationVersion: 5,
      });
      expect(mockEnqueueVerificationEmail).toHaveBeenCalledWith(
        mockDbChain,
        user.id,
        5,
      );
      expect(mockRequestVerificationEmailProcessing).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, alreadyVerified: false });
    });

    test('generates a fresh token when the previous token expired', async () => {
      const user = createUser({
        emailVerified: false,
        emailVerificationToken: 'previous-token',
        emailTokenExpiresAt: new Date(FIXED_NOW.getTime() - 1),
        emailVerificationVersion: 2,
      });
      setMockReturnSequence([[user], [{ id: user.id }]]);

      await authService.resendVerification(
        user.id,
        verificationQueueDependencies,
      );

      expect(mockDbChain.set).toHaveBeenCalledWith({
        emailVerificationToken: 'mock-hex-token',
        emailTokenExpiresAt: new Date(
          FIXED_NOW.getTime() + 24 * 60 * 60 * 1000,
        ),
        emailVerificationVersion: 3,
      });
    });

    test('does not report success when the durable enqueue fails', async () => {
      const user = createUser({
        emailVerified: false,
        emailVerificationToken: 'previous-token',
        emailTokenExpiresAt: new Date(FIXED_NOW.getTime() + 60_000),
        emailVerificationVersion: 1,
      });
      setMockReturnSequence([[user], [{ id: user.id }]]);
      mockEnqueueVerificationEmail.mockRejectedValueOnce(
        new Error('outbox unavailable'),
      );

      await expect(
        authService.resendVerification(
          user.id,
          verificationQueueDependencies,
        ),
      ).rejects.toThrow('outbox unavailable');
      expect(mockRequestVerificationEmailProcessing).not.toHaveBeenCalled();
    });

    test('rejects when verification state changes before the update', async () => {
      const user = createUser({
        emailVerified: false,
        emailVerificationToken: 'previous-token',
        emailTokenExpiresAt: new Date(FIXED_NOW.getTime() + 60_000),
        emailVerificationVersion: 7,
      });
      setMockReturnSequence([[user], []]);

      await expect(
        authService.resendVerification(
          user.id,
          verificationQueueDependencies,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(mockEnqueueVerificationEmail).not.toHaveBeenCalled();
      expect(mockRequestVerificationEmailProcessing).not.toHaveBeenCalled();
    });

    test('returns without queueing when the email is already verified', async () => {
      const user = createUser({
        emailVerified: true,
        emailVerificationVersion: 2,
      });
      setMockReturn([user]);

      await expect(
        authService.resendVerification(
          user.id,
          verificationQueueDependencies,
        ),
      ).resolves.toEqual({
        success: true,
        alreadyVerified: true,
      });
      expect(mockEnqueueVerificationEmail).not.toHaveBeenCalled();
      expect(mockRequestVerificationEmailProcessing).not.toHaveBeenCalled();
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
