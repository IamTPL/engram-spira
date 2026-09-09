import { ENV } from '../../config/env';

export interface StudyRateLimitKeyOptions {
  /** `currentUser.id` from the auth derive when it has already run. */
  userId?: string | null;
  cookieName?: string;
}

/**
 * Rate-limit key for `/study/*`. Every grade is its own `POST /review-batch`
 * (see docs/agents/performance.md), so several people behind one NAT would
 * exhaust a per-IP bucket during ordinary review. Precedence:
 *
 * 1. `user:<id>` — one bucket per account, however many sessions it opens.
 *    Elysia runs `derive` (transform phase) before the limiter's
 *    `beforeHandle`, so the generator's `derived` argument already carries
 *    `currentUser` for an authenticated request.
 * 2. `session:<hash>` — the session cookie, hashed so the raw token never sits
 *    in the limiter's map.
 * 3. `ip:<addr>` — unauthenticated traffic only (it fails auth anyway).
 */
export function studyRateLimitKey(
  req: Request | undefined,
  socketIp: string | undefined,
  options: StudyRateLimitKeyOptions = {},
): string {
  if (!req) return 'anonymous';
  if (options.userId) return `user:${options.userId}`;
  const cookieName = options.cookieName ?? ENV.SESSION_COOKIE_NAME;
  const token = sessionCookie(req.headers.get('cookie'), cookieName);
  if (token) return `session:${Bun.hash(token).toString(36)}`;
  const forwarded = req.headers.get('x-forwarded-for');
  const ip =
    forwarded?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    socketIp;
  return ip ? `ip:${ip}` : 'anonymous';
}

function sessionCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const prefix = `${name}=`;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    const value = trimmed.slice(prefix.length);
    return value.length > 0 ? value : null;
  }
  return null;
}
