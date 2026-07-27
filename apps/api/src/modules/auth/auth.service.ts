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
import {
  cancelVerificationEmail,
  enqueueVerificationEmail,
  requestVerificationEmailProcessing,
} from './verification-email-outbox';

const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const INITIAL_VERIFICATION_VERSION = 1;

type VerificationQueueDependencies = {
  enqueue: typeof enqueueVerificationEmail;
  cancel: typeof cancelVerificationEmail;
  requestProcessing: typeof requestVerificationEmailProcessing;
  now: () => Date;
};

const verificationQueueDependencies: VerificationQueueDependencies = {
  enqueue: enqueueVerificationEmail,
  cancel: cancelVerificationEmail,
  requestProcessing: requestVerificationEmailProcessing,
  now: () => new Date(),
};

export async function register(
  email: string,
  password: string,
  dependencies = verificationQueueDependencies,
) {
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

  const user = await db.transaction(async (tx) => {
    const [createdUser] = await tx
      .insert(users)
      .values({
        email: email.toLowerCase(),
        passwordHash,
        emailVerificationToken: verifyToken,
        emailTokenExpiresAt: new Date(
          dependencies.now().getTime() + VERIFY_TOKEN_EXPIRY_MS,
        ),
        emailVerificationVersion: INITIAL_VERIFICATION_VERSION,
      })
      .returning({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        emailVerified: users.emailVerified,
      });

    await dependencies.enqueue(
      tx,
      createdUser.id,
      INITIAL_VERIFICATION_VERSION,
    );
    return createdUser;
  });

  dependencies.requestProcessing();

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
      emailVerified: users.emailVerified,
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
      emailVerified: user.emailVerified,
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
export async function verifyEmail(
  token: string,
  dependencies = verificationQueueDependencies,
) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        id: users.id,
        emailVerified: users.emailVerified,
        emailTokenExpiresAt: users.emailTokenExpiresAt,
      })
      .from(users)
      .where(
        and(
          eq(users.emailVerificationToken, token),
          gt(users.emailTokenExpiresAt, dependencies.now()),
        ),
      )
      .limit(1);

    if (!user) {
      throw new ValidationError('Invalid or expired verification token');
    }

    if (user.emailVerified) {
      return { success: true, alreadyVerified: true };
    }

    const [verifiedUser] = await tx
      .update(users)
      .set({
        emailVerified: true,
        emailVerificationToken: null,
        emailTokenExpiresAt: null,
      })
      .where(
        and(
          eq(users.id, user.id),
          eq(users.emailVerified, false),
          eq(users.emailVerificationToken, token),
        ),
      )
      .returning({
        tokenVersion: users.emailVerificationVersion,
      });

    if (!verifiedUser) {
      throw new ValidationError('Invalid or expired verification token');
    }

    await dependencies.cancel(tx, user.id, verifiedUser.tokenVersion);
    return { success: true, alreadyVerified: false };
  });
}

/**
 * Queue a verification email and return as soon as the request is durable.
 */
export async function resendVerification(
  userId: string,
  dependencies = verificationQueueDependencies,
) {
  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({
        id: users.id,
        emailVerified: users.emailVerified,
        emailVerificationToken: users.emailVerificationToken,
        emailTokenExpiresAt: users.emailTokenExpiresAt,
        emailVerificationVersion: users.emailVerificationVersion,
      })
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);

    if (!user) throw new NotFoundError('User');

    if (user.emailVerified) {
      return { success: true, alreadyVerified: true, queued: false };
    }

    const now = dependencies.now();
    const canReuseToken =
      user.emailVerificationToken !== null &&
      user.emailTokenExpiresAt !== null &&
      user.emailTokenExpiresAt.getTime() > now.getTime();
    const verifyToken = canReuseToken
      ? user.emailVerificationToken
      : encodeHexLowerCase(crypto.getRandomValues(new Uint8Array(32)));
    const tokenExpiresAt = canReuseToken
      ? user.emailTokenExpiresAt
      : new Date(now.getTime() + VERIFY_TOKEN_EXPIRY_MS);
    const tokenVersion = user.emailVerificationVersion + 1;

    const [claimed] = await tx
      .update(users)
      .set({
        emailVerificationToken: verifyToken,
        emailTokenExpiresAt: tokenExpiresAt,
        emailVerificationVersion: tokenVersion,
      })
      .where(
        and(
          eq(users.id, userId),
          eq(users.emailVerified, false),
          eq(
            users.emailVerificationVersion,
            user.emailVerificationVersion,
          ),
        ),
      )
      .returning({ id: users.id });

    if (!claimed) {
      throw new ConflictError(
        'Verification state changed. Please refresh and try again.',
      );
    }

    await dependencies.enqueue(tx, user.id, tokenVersion);
    return { success: true, alreadyVerified: false, queued: true };
  });

  if (result.queued) {
    dependencies.requestProcessing();
  }

  return {
    success: result.success,
    alreadyVerified: result.alreadyVerified,
  };
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
