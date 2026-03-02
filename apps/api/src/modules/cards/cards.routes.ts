import Elysia, { t } from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as cardsService from './cards.service';

export const cardsRoutes = new Elysia({ prefix: '/cards' })
  .use(requireAuth)
  .get('/by-deck/:deckId', ({ currentUser, params, query }) =>
    cardsService.listByDeck(params.deckId, currentUser.id, {
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Math.min(Number(query.limit), 200) : 50,
    }),
  )
  .post(
    '/by-deck/:deckId',
    ({ currentUser, params, body }) =>
      cardsService.create(params.deckId, currentUser.id, body),
    {
      body: t.Object({
        fieldValues: t.Array(
          t.Object({
            templateFieldId: t.String({ format: 'uuid' }),
            value: t.Unknown(),
          }),
        ),
      }),
    },
  )
  .patch(
    '/:id',
    ({ currentUser, params, body }) =>
      cardsService.update(params.id, currentUser.id, body),
    {
      body: t.Object({
        fieldValues: t.Array(
          t.Object({
            templateFieldId: t.String({ format: 'uuid' }),
            value: t.Unknown(),
          }),
        ),
      }),
    },
  )
  .delete('/:id', async ({ currentUser, params }) => {
    await cardsService.remove(params.id, currentUser.id);
    return { success: true };
  });
