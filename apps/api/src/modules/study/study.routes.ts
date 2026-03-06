import Elysia, { t } from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as studyService from './study.service';
import { REVIEW_ACTIONS, STREAK } from '../../shared/constants';

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
  .get('/streak', ({ currentUser }) =>
    studyService.getUserStreak(currentUser.id),
  )
  .get(
    '/activity',
    ({ currentUser, query }) =>
      studyService.getUserActivity(
        currentUser.id,
        Number(query.days ?? STREAK.ACTIVITY_DEFAULT_DAYS),
      ),
    {
      query: t.Object({
        days: t.Optional(
          t.Numeric({ minimum: 1, maximum: STREAK.ACTIVITY_MAX_DAYS }),
        ),
      }),
    },
  )
  .get('/stats', ({ currentUser }) => studyService.getUserStats(currentUser.id))
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
  )
  // --------------- Reset Progress ---------------
  .post('/deck/:deckId/reset-progress', ({ currentUser, params }) =>
    studyService.resetDeckProgress(params.deckId, currentUser.id),
  )
  .post('/card/:cardId/reset-progress', ({ currentUser, params }) =>
    studyService.resetCardProgress(params.cardId, currentUser.id),
  )
  // --------------- Interleaved Practice ---------------
  .post(
    '/interleaved',
    ({ currentUser, body }) =>
      studyService.getInterleavedDueCards(
        currentUser.id,
        body.deckIds,
        body.limit,
      ),
    {
      body: t.Object({
        deckIds: t.Array(t.String({ format: 'uuid' }), {
          minItems: 1,
          maxItems: 20,
        }),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 200, default: 50 })),
      }),
    },
  )
  .get(
    '/interleaved/auto',
    ({ currentUser, query }) =>
      studyService.getAutoInterleavedCards(
        currentUser.id,
        query.topN ? Number(query.topN) : 5,
        query.limit ? Number(query.limit) : 50,
      ),
    {
      query: t.Object({
        topN: t.Optional(t.Numeric({ minimum: 1, maximum: 20 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
      }),
    },
  );
