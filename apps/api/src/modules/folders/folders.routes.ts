import Elysia, { t } from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as foldersService from './folders.service';

export const foldersRoutes = new Elysia({ prefix: '/folders' })
  .use(requireAuth)
  .get('/by-class/:classId', ({ currentUser, params }) =>
    foldersService.listByClass(params.classId, currentUser.id),
  )
  .post(
    '/by-class/:classId',
    ({ currentUser, params, body }) =>
      foldersService.create(params.classId, currentUser.id, body),
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
      }),
    },
  )
  .get('/:id', ({ currentUser, params }) =>
    foldersService.getById(params.id, currentUser.id),
  )
  .patch(
    '/:id',
    ({ currentUser, params, body }) =>
      foldersService.update(params.id, currentUser.id, body),
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
      }),
    },
  )
  .delete('/:id', async ({ currentUser, params }) => {
    await foldersService.remove(params.id, currentUser.id);
    return { success: true };
  })
  .patch(
    '/by-class/:classId/reorder',
    ({ currentUser, params, body }) =>
      foldersService.reorder(params.classId, currentUser.id, body.folderIds),
    {
      body: t.Object({
        folderIds: t.Array(t.String({ format: 'uuid' }), { minItems: 1 }),
      }),
    },
  );
