import Elysia, { t } from 'elysia';
import { rateLimit } from 'elysia-rate-limit';
import { requireAuth } from './auth.middleware';
import { validateSession } from './session.utils';
import * as authService from './auth.service';
import { ENV } from '../../config/env';
import { SESSION } from '../../shared/constants';
import { sendPasswordResetEmail } from '../../shared/email';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: ENV.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION.MAX_AGE_MS / 1000,
};

export const authRoutes = new Elysia({ prefix: '/auth' })
  .use(
    rateLimit({
      scoping: 'scoped',
      duration: 60 * 1000,
      max: 5,
      errorResponse: new Response(
        JSON.stringify({ error: 'Too many requests, please try again later' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    }),
  )
  .post(
    '/register',
    async ({ body, cookie }) => {
      const { user, token } = await authService.register(
        body.email,
        body.password,
      );

      cookie[ENV.SESSION_COOKIE_NAME].set({
        value: token,
        ...COOKIE_OPTIONS,
      });

      return { user };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String(),
      }),
    },
  )
  .post(
    '/login',
    async ({ body, cookie }) => {
      const { user, token } = await authService.login(
        body.email,
        body.password,
      );

      cookie[ENV.SESSION_COOKIE_NAME].set({
        value: token,
        ...COOKIE_OPTIONS,
      });

      return { user };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String(),
      }),
    },
  )
  .post('/logout', async ({ cookie }) => {
    const token = cookie[ENV.SESSION_COOKIE_NAME]?.value;
    if (token && typeof token === 'string') {
      await authService.logout(token);
      cookie[ENV.SESSION_COOKIE_NAME].remove();
    }
    return { success: true };
  })
  .get('/me', async ({ cookie }) => {
    const token = cookie[ENV.SESSION_COOKIE_NAME]?.value;
    if (!token || typeof token !== 'string') {
      return { user: null };
    }
    const result = await validateSession(token);
    if (!result.user) {
      return { user: null };
    }
    return { user: result.user };
  })
  .post(
    '/forgot-password',
    async ({ body }) => {
      const result = await authService.forgotPassword(body.email);
      // Send email if token was generated (user exists)
      if (result.token) {
        try {
          await sendPasswordResetEmail(body.email, result.token);
        } catch (e) {
          console.error('[auth] Failed to send reset email:', e);
        }
      }
      // Always return success to prevent email enumeration
      return { success: true };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
      }),
    },
  )
  .post(
    '/reset-password',
    ({ body }) => authService.resetPassword(body.token, body.newPassword),
    {
      body: t.Object({
        token: t.String({ minLength: 1 }),
        newPassword: t.String({ minLength: 8, maxLength: 128 }),
      }),
    },
  )
  .use(requireAuth)
  .post(
    '/change-password',
    ({ currentUser, body }) =>
      authService.changePassword(
        currentUser.id,
        body.currentPassword,
        body.newPassword,
      ),
    {
      body: t.Object({
        currentPassword: t.String({ minLength: 1 }),
        newPassword: t.String({ minLength: 8, maxLength: 128 }),
      }),
    },
  );
