import Elysia, { t } from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as decksService from './decks.service';

export const decksRoutes = new Elysia({ prefix: '/decks' })
  .use(requireAuth)
  .get('/by-folder/:folderId', ({ currentUser, params }) =>
    decksService.listByFolder(params.folderId, currentUser.id),
  )
  .post(
    '/by-folder/:folderId',
    ({ currentUser, params, body }) =>
      decksService.create(params.folderId, currentUser.id, body),
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        cardTemplateId: t.String({ format: 'uuid' }),
      }),
    },
  )
  .get('/:id', ({ currentUser, params }) =>
    decksService.getById(params.id, currentUser.id),
  )
  .patch(
    '/:id',
    ({ currentUser, params, body }) =>
      decksService.update(params.id, currentUser.id, body),
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
      }),
    },
  )
  .delete('/:id', async ({ currentUser, params }) => {
    await decksService.remove(params.id, currentUser.id);
    return { success: true };
  });
