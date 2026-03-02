import Elysia, { t } from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as studyService from './study.service';
import { REVIEW_ACTIONS } from '../../shared/constants';

const VALID_ACTIONS = Object.values(REVIEW_ACTIONS);
const reviewActionSchema = t.Union(VALID_ACTIONS.map((a) => t.Literal(a)));

export const studyRoutes = new Elysia({ prefix: '/study' })
  .use(requireAuth)
  .get('/deck/:deckId', ({ currentUser, params, query }) =>
    studyService.getDueCards(
      params.deckId,
      currentUser.id,
      query.mode === 'all',
    ),
  )
  .get('/deck/:deckId/schedule', ({ currentUser, params }) =>
    studyService.getDeckSchedule(params.deckId, currentUser.id),
  )
  .post(
    '/review',
    ({ currentUser, body }) =>
      studyService.reviewCard(body.cardId, currentUser.id, body.action),
    {
      body: t.Object({
        cardId: t.String({ format: 'uuid' }),
        action: reviewActionSchema,
      }),
    },
  )
  .post(
    '/review-batch',
    ({ currentUser, body }) =>
      studyService.reviewCardBatch(currentUser.id, body.items),
    {
      body: t.Object({
        items: t.Array(
          t.Object({
            cardId: t.String({ format: 'uuid' }),
            action: reviewActionSchema,
          }),
          { minItems: 1, maxItems: 100 },
        ),
      }),
    },
  );
