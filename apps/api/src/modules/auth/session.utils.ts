import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { sessions, users } from '../../db/schema';
import { SESSION } from '../../shared/constants';

export function generateSessionToken(): string {
  const bytes = new Uint8Array(SESSION.TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  // Encode as hex string for cookie transport
  return encodeHexLowerCase(bytes);
}

function hashToken(token: string): string {
  const encoded = new TextEncoder().encode(token);
  return encodeHexLowerCase(sha256(encoded));
}

export async function createSession(userId: string, token: string) {
  const sessionId = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION.MAX_AGE_MS);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  return { id: sessionId, userId, expiresAt };
}

export type SessionValidationResult =
  | {
      session: { id: string; userId: string; expiresAt: Date };
      user: {
        id: string;
        email: string;
        displayName: string | null;
        avatarUrl: string | null;
      };
    }
  | { session: null; user: null };

export async function validateSession(
  token: string,
): Promise<SessionValidationResult> {
  const sessionId = hashToken(token);

  const result = await db
    .select({
      session: {
        id: sessions.id,
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
      },
      user: {
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (result.length === 0) {
    return { session: null, user: null };
  }

  const { session, user } = result[0];

  // Session expired
  if (Date.now() >= session.expiresAt.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return { session: null, user: null };
  }

  // Refresh session if within threshold
  if (
    Date.now() >=
    session.expiresAt.getTime() - SESSION.REFRESH_THRESHOLD_MS
  ) {
    const newExpiresAt = new Date(Date.now() + SESSION.MAX_AGE_MS);
    await db
      .update(sessions)
      .set({ expiresAt: newExpiresAt })
      .where(eq(sessions.id, session.id));
    session.expiresAt = newExpiresAt;
  }

  return { session, user };
}

export async function invalidateSession(token: string): Promise<void> {
  const sessionId = hashToken(token);
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
