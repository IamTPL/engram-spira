import { ENV } from '../../config/env';

/**
 * Rate-limit key for `/study/*`. Every grade is its own `POST /review-batch`
 * (see docs/agents/performance.md), so several people behind one NAT would
 * exhaust a per-IP bucket during ordinary review. An authenticated request is
 * keyed by its session cookie (hashed — the raw token never sits in the
 * limiter's map); only unauthenticated traffic falls back to the IP.
 *
 * This runs before `requireAuth`, so the cookie is read straight off the
 * request; an invalid token still gets its own bucket and then a 401.
 */
export function studyRateLimitKey(
  req: Request | undefined,
  socketIp: string | undefined,
  cookieName: string = ENV.SESSION_COOKIE_NAME,
): string {
  if (!req) return 'anonymous';
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
