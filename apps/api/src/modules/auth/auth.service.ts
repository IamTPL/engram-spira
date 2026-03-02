import { hash, verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users } from '../../db/schema';
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from '../../shared/errors';
import { PASSWORD } from '../../shared/constants';
import {
  createSession,
  generateSessionToken,
  invalidateSession,
} from './session.utils';

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

  const [user] = await db
    .insert(users)
    .values({
      email: email.toLowerCase(),
      passwordHash,
    })
    .returning({ id: users.id, email: users.email });

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
    user: { id: user.id, email: user.email },
    token,
    session,
  };
}

export async function logout(token: string) {
  await invalidateSession(token);
}
