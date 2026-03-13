import Elysia, { t } from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as cardsService from './cards.service';

export const cardsRoutes = new Elysia({ prefix: '/cards' })
  .use(requireAuth)
  .get('/by-deck/:deckId', ({ currentUser, params, query }) =>
    cardsService.listByDeck(params.deckId, currentUser.id, {
      cursor: query.cursor !== undefined ? Number(query.cursor) : undefined,
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
  })
  .delete(
    '/by-deck/:deckId/batch',
    ({ currentUser, params, body }) =>
      cardsService.removeBatch(params.deckId, currentUser.id, body.cardIds),
    {
      body: t.Object({
        cardIds: t.Array(t.String({ format: 'uuid' }), {
          minItems: 1,
          maxItems: 200,
        }),
      }),
    },
  )
  .post(
    '/by-deck/:deckId/batch',
    ({ currentUser, params, body }) =>
      cardsService.createBatch(params.deckId, currentUser.id, body.cards),
    {
      body: t.Object({
        cards: t.Array(
          t.Object({
            fieldValues: t.Array(
              t.Object({
                templateFieldId: t.String({ format: 'uuid' }),
                value: t.Unknown(),
              }),
            ),
          }),
          { minItems: 1, maxItems: 100 },
        ),
      }),
    },
  )
  .patch(
    '/by-deck/:deckId/reorder',
    ({ currentUser, params, body }) =>
      cardsService.reorder(params.deckId, currentUser.id, body.cardIds),
    {
      body: t.Object({
        cardIds: t.Array(t.String({ format: 'uuid' }), { minItems: 1 }),
      }),
    },
  );
