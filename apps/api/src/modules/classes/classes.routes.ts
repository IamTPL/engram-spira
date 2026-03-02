import Elysia, { t } from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as classesService from './classes.service';

export const classesRoutes = new Elysia({ prefix: '/classes' })
  .use(requireAuth)
  .get('/', ({ currentUser }) => classesService.listByUser(currentUser.id))
  .post(
    '/',
    ({ currentUser, body }) => classesService.create(currentUser.id, body),
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
      }),
    },
  )
  .get('/:id', ({ currentUser, params }) =>
    classesService.getById(params.id, currentUser.id),
  )
  .patch(
    '/:id',
    ({ currentUser, params, body }) =>
      classesService.update(params.id, currentUser.id, body),
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        description: t.Optional(t.String()),
      }),
    },
  )
  .delete('/:id', async ({ currentUser, params }) => {
    await classesService.remove(params.id, currentUser.id);
    return { success: true };
  });
