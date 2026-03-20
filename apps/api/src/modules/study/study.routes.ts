import Elysia, { t } from 'elysia';
import { eq } from 'drizzle-orm';
import { rateLimit } from 'elysia-rate-limit';
import { requireAuth } from '../auth/auth.middleware';
import * as studyService from './study.service';
import * as forecastService from './forecast.service';
import * as recommendationsService from './recommendations.service';
import { REVIEW_ACTIONS, STREAK } from '../../shared/constants';
import { db } from '../../db';
import { users } from '../../db/schema';

const VALID_ACTIONS = Object.values(REVIEW_ACTIONS);
const reviewActionSchema = t.Union(VALID_ACTIONS.map((a) => t.Literal(a)));

function getTimezoneOffsetMinutes(headers: Record<string, string | undefined>) {
  const raw = headers['x-timezone-offset'];
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(-720, Math.min(840, parsed));
}

export const studyRoutes = new Elysia({ prefix: '/study' })
  .use(
    rateLimit({
      scoping: 'scoped',
      duration: 60 * 1000,
      max: 180,
      skip: (req) => !req,
      generator: async (req, server) => {
        if (!req) return 'anonymous';
        return (
          req.headers.get('x-forwarded-for') ??
          req.headers.get('x-real-ip') ??
          server?.requestIP(req)?.address ??
          'anonymous'
        );
      },
      errorResponse: new Response(
        JSON.stringify({ error: 'Too many study requests, please retry' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    }),
  )
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
  .get('/streak', ({ currentUser, headers }) => {
    const tzOffset = getTimezoneOffsetMinutes(headers);
    return studyService.getUserStreak(currentUser.id, tzOffset);
  })
  .get(
    '/activity',
    ({ currentUser, query, headers }) => {
      const tzOffset = getTimezoneOffsetMinutes(headers);
      return studyService.getUserActivity(
        currentUser.id,
        Number(query.days ?? STREAK.ACTIVITY_DEFAULT_DAYS),
        tzOffset,
      );
    },
    {
      query: t.Object({
        days: t.Optional(
          t.Numeric({ minimum: 1, maximum: STREAK.ACTIVITY_MAX_DAYS }),
        ),
      }),
    },
  )
  .get('/stats', ({ currentUser }) => studyService.getUserStats(currentUser.id))
  .get('/dashboard-snapshot', ({ currentUser, headers }) => {
    const tzOffset = getTimezoneOffsetMinutes(headers);
    return studyService.getDashboardSnapshot(currentUser.id, tzOffset);
  })
  .post(
    '/review',
    ({ currentUser, body, headers }) => {
      const tzOffset = getTimezoneOffsetMinutes(headers);
      return studyService.reviewCard(
        body.cardId,
        currentUser.id,
        body.action,
        tzOffset,
      );
    },
    {
      body: t.Object({
        cardId: t.String({ format: 'uuid' }),
        action: reviewActionSchema,
      }),
    },
  )
  .post(
    '/review-batch',
    ({ currentUser, body, headers }) => {
      const tzOffset = getTimezoneOffsetMinutes(headers);
      return studyService.reviewCardBatch(currentUser.id, body.items, tzOffset);
    },
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
  )
  // --------------- Forecast & Retention ---------------
  .get(
    '/forecast',
    ({ currentUser, query }) =>
      forecastService.getForecast(
        currentUser.id,
        query.days ? Number(query.days) : 14,
      ),
    {
      query: t.Object({
        days: t.Optional(t.Numeric({ minimum: 1, maximum: 90 })),
      }),
    },
  )
  .get(
    '/retention-heatmap',
    ({ currentUser, query }) =>
      forecastService.getRetentionHeatmap(currentUser.id, query.deckId),
    {
      query: t.Object({
        deckId: t.String({ format: 'uuid' }),
      }),
    },
  )
  .get(
    '/at-risk-cards',
    ({ currentUser, query }) =>
      forecastService.getAtRiskCards(
        currentUser.id,
        query.threshold ? Number(query.threshold) : 0.8,
        query.limit ? Number(query.limit) : 20,
      ),
    {
      query: t.Object({
        threshold: t.Optional(t.Numeric({ minimum: 0.1, maximum: 1.0 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
      }),
    },
  )
  // --------------- Recommendations & Smart Groups ---------------
  .get(
    '/recommendations/:cardId',
    ({ currentUser, params, query }) =>
      recommendationsService.getRelatedCards(
        currentUser.id,
        params.cardId,
        query.limit ? Number(query.limit) : 5,
      ),
    {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 20 })),
      }),
    },
  )
  // --------------- Algorithm Selection ---------------
  .get('/algorithm', async ({ currentUser }) => {
    const [row] = await db
      .select({ srsAlgorithm: users.srsAlgorithm })
      .from(users)
      .where(eq(users.id, currentUser.id))
      .limit(1);
    return { algorithm: row?.srsAlgorithm ?? 'sm2' };
  })
  .patch(
    '/algorithm',
    async ({ currentUser, body }) => {
      await db
        .update(users)
        .set({ srsAlgorithm: body.algorithm })
        .where(eq(users.id, currentUser.id));
      return { algorithm: body.algorithm };
    },
    {
      body: t.Object({
        algorithm: t.Union([t.Literal('sm2'), t.Literal('fsrs')]),
      }),
    },
  );
