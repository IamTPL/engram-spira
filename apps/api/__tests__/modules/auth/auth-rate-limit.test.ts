import { describe, expect, test } from 'bun:test';
import Elysia from 'elysia';

import {
  AUTH_RATE_LIMIT_POLICIES,
  AUTH_RATE_LIMIT_WINDOW_MS,
  createAuthRateLimit,
  resolveClientAddress,
} from '../../../src/modules/auth/auth-rate-limit';

type TestAppOptions = {
  failingLogin?: boolean;
};

function createRateLimitedTestApp(options: TestAppOptions = {}) {
  const auth = new Elysia({ prefix: '/auth' })
    .use(createAuthRateLimit())
    .get('/me', () => ({ success: true }))
    .post('/login', () => {
      if (options.failingLogin) {
        throw new Error('Invalid credentials');
      }

      return { success: true };
    })
    .post('/logout', () => ({ success: true }))
    .post('/register', () => ({ success: true }))
    .post('/forgot-password', () => ({ success: true }))
    .post('/reset-password', () => ({ success: true }))
    .get('/verify-email', () => ({ success: true }))
    .post('/resend-verification', () => ({ success: true }))
    .post('/change-password', () => ({ success: true }));

  return new Elysia()
    .onError(({ error, set }) => {
      if (error instanceof Error && error.message === 'Invalid credentials') {
        set.status = 401;
        return { error: error.message };
      }

      set.status = 500;
      return { error: error instanceof Error ? error.message : String(error) };
    })
    .use(auth);
}

function request(
  app: ReturnType<typeof createRateLimitedTestApp>,
  path: string,
  method: 'GET' | 'POST' = 'POST',
) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
    }),
  );
}

describe('auth rate limiting', () => {
  test('defines endpoint-specific policies in one 15-minute window', () => {
    expect(AUTH_RATE_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(AUTH_RATE_LIMIT_POLICIES).toEqual({
      '/auth/login': 10,
      '/auth/register': 5,
      '/auth/forgot-password': 3,
      '/auth/reset-password': 5,
      '/auth/verify-email': 20,
      '/auth/resend-verification': 3,
      '/auth/change-password': 5,
    });
  });

  test('allows the normal me-login-logout-register-logout-login flow', async () => {
    const app = createRateLimitedTestApp();
    const flow = [
      ['GET', '/auth/me'],
      ['POST', '/auth/login'],
      ['POST', '/auth/logout'],
      ['POST', '/auth/register'],
      ['POST', '/auth/logout'],
      ['POST', '/auth/login'],
    ] as const;

    for (const [method, path] of flow) {
      const response = await request(app, path, method);
      expect(response.status).toBe(200);
    }
  });

  test('does not rate-limit session reads or logout', async () => {
    const app = createRateLimitedTestApp();

    for (let attempt = 0; attempt < 25; attempt++) {
      const meResponse = await request(app, '/auth/me', 'GET');
      const logoutResponse = await request(app, '/auth/logout');
      expect(meResponse.status).toBe(200);
      expect(logoutResponse.status).toBe(200);
      expect(meResponse.headers.get('ratelimit-limit')).toBeNull();
      expect(logoutResponse.headers.get('ratelimit-limit')).toBeNull();
    }
  });

  test('keeps endpoint buckets independent and enforces each maximum', async () => {
    const app = createRateLimitedTestApp();

    for (
      let attempt = 0;
      attempt < AUTH_RATE_LIMIT_POLICIES['/auth/login'];
      attempt++
    ) {
      expect((await request(app, '/auth/login')).status).toBe(200);
    }
    const limitedLogin = await request(app, '/auth/login');
    expect(limitedLogin.status).toBe(429);
    expect(limitedLogin.headers.get('ratelimit-limit')).toBe('10');
    expect(limitedLogin.headers.get('ratelimit-remaining')).toBe('0');
    expect(limitedLogin.headers.get('retry-after')).toBe('900');
    expect(await limitedLogin.json()).toEqual({
      error: 'Too many requests, please try again later',
    });

    for (
      let attempt = 0;
      attempt < AUTH_RATE_LIMIT_POLICIES['/auth/register'];
      attempt++
    ) {
      expect((await request(app, '/auth/register')).status).toBe(200);
    }
    expect((await request(app, '/auth/register')).status).toBe(429);
  });

  test('counts failed login attempts toward the login limit', async () => {
    const app = createRateLimitedTestApp({ failingLogin: true });

    for (
      let attempt = 0;
      attempt < AUTH_RATE_LIMIT_POLICIES['/auth/login'];
      attempt++
    ) {
      expect((await request(app, '/auth/login')).status).toBe(401);
    }

    expect((await request(app, '/auth/login')).status).toBe(429);
  });

  test('ignores spoofed forwarded addresses when no proxy hops are trusted', () => {
    const spoofedRequest = new Request('http://localhost/auth/login', {
      headers: {
        'x-forwarded-for': '198.51.100.24',
      },
    });

    expect(resolveClientAddress(spoofedRequest, '203.0.113.8', 0)).toBe(
      '203.0.113.8',
    );
  });

  test('selects the correct address from a trusted proxy chain', () => {
    const proxiedRequest = new Request('http://localhost/auth/login', {
      headers: {
        'x-forwarded-for': '198.51.100.24, 203.0.113.8',
      },
    });

    expect(resolveClientAddress(proxiedRequest, '10.0.0.5', 1)).toBe(
      '203.0.113.8',
    );
    expect(resolveClientAddress(proxiedRequest, '10.0.0.5', 2)).toBe(
      '198.51.100.24',
    );
  });
});
