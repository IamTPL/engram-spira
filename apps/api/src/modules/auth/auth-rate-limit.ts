import { rateLimit } from 'elysia-rate-limit';
import { ENV } from '../../config/env';

export const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export const AUTH_RATE_LIMIT_POLICIES = {
  '/auth/login': 10,
  '/auth/register': 5,
  '/auth/forgot-password': 3,
  '/auth/reset-password': 5,
  '/auth/verify-email': 20,
  '/auth/resend-verification': 3,
  '/auth/change-password': 5,
} as const;

type AuthRateLimitedPath = keyof typeof AUTH_RATE_LIMIT_POLICIES;

function normalizeAddress(address: string | undefined): string | null {
  const normalized = address?.trim();
  if (!normalized) return null;
  return normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
}

/**
 * Resolve the client address without trusting spoofable forwarding headers by
 * default. When proxies are explicitly trusted, walk the X-Forwarded-For chain
 * from right to left by the configured number of hops.
 */
export function resolveClientAddress(
  request: Request,
  directAddress: string | undefined,
  trustedProxyHops = ENV.TRUST_PROXY_HOPS,
): string {
  const direct = normalizeAddress(directAddress) ?? 'unknown';
  if (trustedProxyHops <= 0) return direct;

  const forwardedFor = request.headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((address) => normalizeAddress(address))
    .filter((address): address is string => address !== null);

  if (forwardedFor?.length) {
    const clientIndex = Math.max(0, forwardedFor.length - trustedProxyHops);
    return forwardedFor[clientIndex] ?? direct;
  }

  return normalizeAddress(request.headers.get('x-real-ip') ?? undefined) ?? direct;
}

function getRateLimitedPath(request: Request): AuthRateLimitedPath | null {
  const path = new URL(request.url).pathname;
  if (!(path in AUTH_RATE_LIMIT_POLICIES)) return null;

  const expectedMethod = path === '/auth/verify-email' ? 'GET' : 'POST';
  if (request.method !== expectedMethod) return null;

  return path as AuthRateLimitedPath;
}

export function createAuthRateLimit() {
  return rateLimit({
    scoping: 'scoped',
    duration: AUTH_RATE_LIMIT_WINDOW_MS,
    countFailedRequest: true,
    skip: (request) => getRateLimitedPath(request) === null,
    generator: async (request, server) => {
      const path = getRateLimitedPath(request);
      const directAddress = server?.requestIP(request)?.address;
      return `${path ?? 'unknown'}:${resolveClientAddress(request, directAddress)}`;
    },
    max: (_key, request) => {
      const path = getRateLimitedPath(request);
      return path === null ? 0 : AUTH_RATE_LIMIT_POLICIES[path];
    },
    errorResponse: new Response(
      JSON.stringify({ error: 'Too many requests, please try again later' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}
