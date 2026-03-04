import Elysia, { t } from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as usersService from './users.service';

export const usersRoutes = new Elysia({ prefix: '/users' })
  /**
   * GET /users/avatars
   * Returns a list of avatar URLs from the ava_colect directory.
   * No auth required — the frontend needs the avatar picker on the settings page,
   * and listing static image filenames is not sensitive.
   */
  .get('/avatars', async () => {
    return usersService.getAvatarCollection();
  })

  /**
   * PATCH /users/profile
   * Updates the display name and/or avatar URL of the currently authenticated user.
   * Only fields that are explicitly provided will be updated (partial update).
   */
  .use(requireAuth)
  .patch(
    '/profile',
    async ({ currentUser, body }) => {
      return usersService.updateProfile(currentUser.id, body);
    },
    {
      body: t.Object({
        displayName: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
        avatarUrl: t.Optional(t.String()),
      }),
    },
  );
