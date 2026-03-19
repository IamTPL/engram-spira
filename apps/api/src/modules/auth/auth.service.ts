import { hash, verify } from '@node-rs/argon2';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';
import { eq, and, gt } from 'drizzle-orm';
import { db } from '../../db';
import { users, passwordResetTokens } from '../../db/schema';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../shared/errors';
import { PASSWORD } from '../../shared/constants';
import {
  createSession,
  generateSessionToken,
  invalidateSession,
} from './session.utils';
import { sendVerificationEmail } from '../../shared/email';
import { logger } from '../../shared/logger';

const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function register(email: string, password: string) {
  if (!email || !email.includes('@')) {
    throw new ValidationError('Invalid email address');
  }
  if (
    password.length < PASSWORD.MIN_LENGTH ||
    password.length > PASSWORD.MAX_LENGTH
  ) {
    throw new ValidationError(
      `Password must be between ${PASSWORD.MIN_LENGTH} and ${PASSWORD.MAX_LENGTH} characters`,
    );
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (existing.length > 0) {
    throw new ConflictError('Email already registered');
  }

  const passwordHash = await hash(password);

  // Generate verification token before insert so it's stored atomically
  const verifyToken = encodeHexLowerCase(
    crypto.getRandomValues(new Uint8Array(32)),
  );

  const [user] = await db
    .insert(users)
    .values({
      email: email.toLowerCase(),
      passwordHash,
      emailVerificationToken: verifyToken,
      emailTokenExpiresAt: new Date(Date.now() + VERIFY_TOKEN_EXPIRY_MS),
    })
    .returning({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      emailVerified: users.emailVerified,
    });

  // Fire-and-forget: send verification email without blocking register response
  sendVerificationEmail(user.email, verifyToken).catch((err) =>
    logger.warn(
      { err: err.message, email: user.email },
      'Failed to send verification email',
    ),
  );

  const token = generateSessionToken();
  const session = await createSession(user.id, token);

  return { user, token, session };
}

export async function login(email: string, password: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const validPassword = await verify(user.passwordHash, password);
  if (!validPassword) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const token = generateSessionToken();
  const session = await createSession(user.id, token);

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    },
    token,
    session,
  };
}

export async function logout(token: string) {
  await invalidateSession(token);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  if (
    newPassword.length < PASSWORD.MIN_LENGTH ||
    newPassword.length > PASSWORD.MAX_LENGTH
  ) {
    throw new ValidationError(
      `Password must be between ${PASSWORD.MIN_LENGTH} and ${PASSWORD.MAX_LENGTH} characters`,
    );
  }

  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const validPassword = await verify(user.passwordHash, currentPassword);
  if (!validPassword) {
    throw new ValidationError('Current password is incorrect');
  }

  const newPasswordHash = await hash(newPassword);

  await db
    .update(users)
    .set({ passwordHash: newPasswordHash })
    .where(eq(users.id, userId));

  return { success: true };
}

/**
 * Generate a password reset token and return it.
 * In production, this should be emailed. Returns the raw token for the email to include.
 * Always returns success (even if email not found) to prevent enumeration.
 */
export async function forgotPassword(email: string) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!user) {
    // Don't reveal whether account exists
    return { success: true };
  }

  // Delete any existing tokens for this user
  await db
    .delete(passwordResetTokens)
    .where(eq(passwordResetTokens.userId, user.id));

  // Generate a random token
  const rawToken = encodeHexLowerCase(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  const tokenHash = encodeHexLowerCase(
    sha256(new TextEncoder().encode(rawToken)),
  );

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + RESET_TOKEN_EXPIRY_MS),
  });

  // Return raw token — caller (route) will send the email
  return { success: true, token: rawToken, userId: user.id };
}

/**
 * Verify email address using the token sent during registration.
 */
export async function verifyEmail(token: string) {
  const [user] = await db
    .select({
      id: users.id,
      emailVerified: users.emailVerified,
      emailTokenExpiresAt: users.emailTokenExpiresAt,
    })
    .from(users)
    .where(
      and(
        eq(users.emailVerificationToken, token),
        gt(users.emailTokenExpiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!user) {
    throw new ValidationError('Invalid or expired verification token');
  }

  if (user.emailVerified) {
    return { success: true, alreadyVerified: true };
  }

  await db
    .update(users)
    .set({
      emailVerified: true,
      emailVerificationToken: null,
      emailTokenExpiresAt: null,
    })
    .where(eq(users.id, user.id));

  return { success: true, alreadyVerified: false };
}

/**
 * Resend verification email. Generates a fresh token.
 */
export async function resendVerification(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw new NotFoundError('User');

  if (user.emailVerified) {
    return { success: true, alreadyVerified: true };
  }

  const verifyToken = encodeHexLowerCase(
    crypto.getRandomValues(new Uint8Array(32)),
  );

  await db
    .update(users)
    .set({
      emailVerificationToken: verifyToken,
      emailTokenExpiresAt: new Date(Date.now() + VERIFY_TOKEN_EXPIRY_MS),
    })
    .where(eq(users.id, userId));

  // Fire-and-forget
  sendVerificationEmail(user.email, verifyToken).catch((err) =>
    logger.warn(
      { err: err.message, email: user.email },
      'Failed to resend verification email',
    ),
  );

  return { success: true, alreadyVerified: false };
}

export async function resetPassword(token: string, newPassword: string) {
  if (
    newPassword.length < PASSWORD.MIN_LENGTH ||
    newPassword.length > PASSWORD.MAX_LENGTH
  ) {
    throw new ValidationError(
      `Password must be between ${PASSWORD.MIN_LENGTH} and ${PASSWORD.MAX_LENGTH} characters`,
    );
  }

  const tokenHash = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));

  const [record] = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      expiresAt: passwordResetTokens.expiresAt,
    })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!record) {
    throw new ValidationError('Invalid or expired reset token');
  }

  const newPasswordHash = await hash(newPassword);

  await Promise.all([
    db
      .update(users)
      .set({ passwordHash: newPasswordHash })
      .where(eq(users.id, record.userId)),
    db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, record.userId)),
  ]);

  return { success: true };
}
