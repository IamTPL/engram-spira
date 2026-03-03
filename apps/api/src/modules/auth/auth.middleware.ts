import Elysia from 'elysia';
import { validateSession } from './session.utils';
import { ENV } from '../../config/env';
import { UnauthorizedError } from '../../shared/errors';

export const requireAuth = new Elysia({ name: 'require-auth' }).derive(
  { as: 'scoped' },
  async ({ cookie }) => {
    const token = cookie[ENV.SESSION_COOKIE_NAME]?.value;

    if (!token || typeof token !== 'string') {
      throw new UnauthorizedError();
    }

    const result = await validateSession(token);

    if (!result.session || !result.user) {
      throw new UnauthorizedError();
    }

    return {
      currentUser: result.user,
      currentSession: result.session,
    };
  },
);
