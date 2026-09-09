import Elysia, { t } from 'elysia';
import { rateLimit } from 'elysia-rate-limit';
import { requireAuth } from '../auth/auth.middleware';
import * as studyService from './study.service';
import * as forecastService from './forecast.service';
import * as recommendationsService from './recommendations.service';
import * as retentionOverviewService from './retention-overview.service';
import * as retentionDetailsService from './retention-details.service';
import { REVIEW_ACTIONS, STREAK } from '../../shared/constants';
import {
  parseStudyCardIds,
  studyDeckQuerySchema,
} from './study-cluster';
import { studyRateLimitKey } from './study-rate-limit';

const reviewRatingSchema = t.Union(
  Object.values(REVIEW_ACTIONS).map((rating) => t.Literal(rating)),
);
const reviewEventSchema = t.Object({
  requestId: t.String({ format: 'uuid' }),
  cardId: t.String({ format: 'uuid' }),
  rating: reviewRatingSchema,
  reviewedAt: t.String({ format: 'date-time' }),
  durationMs: t.Optional(t.Integer({ minimum: 0, maximum: 60 * 60 * 1000 })),
});

function getTimezoneOffsetMinutes(headers: Record<string, string | undefined>) {
  const raw = headers['x-timezone-offset'];
  if (!raw) return 0;
  const normalized = raw.trim();
  if (!/^[+-]?\d+$/u.test(normalized)) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  // Real `Date.prototype.getTimezoneOffset()` range: UTC+14 yields -840,
  // UTC-12 yields +720. `fsrs-live.domain.ts` validates the same bounds — both
  // sides subtract the offset, so the conventions already agree.
  return Math.max(-840, Math.min(720, parsed));
}

export type StudyRouteServices = {
  getRetentionOverview: typeof retentionOverviewService.getRetentionOverview;
  getRetentionDetails: typeof retentionDetailsService.getRetentionDetails;
  reviewBatch: typeof studyService.fsrsLiveService.reviewBatch;
  resetDeck: typeof studyService.fsrsLiveService.resetDeck;
  resetCard: typeof studyService.fsrsLiveService.resetCard;
};

const defaultStudyRouteServices: StudyRouteServices = {
  getRetentionOverview: retentionOverviewService.getRetentionOverview,
  getRetentionDetails: retentionDetailsService.getRetentionDetails,
  reviewBatch: studyService.fsrsLiveService.reviewBatch,
  resetDeck: studyService.fsrsLiveService.resetDeck,
  resetCard: studyService.fsrsLiveService.resetCard,
};

export function createStudyRoutes(
  services: StudyRouteServices = defaultStudyRouteServices,
  authPlugin: typeof requireAuth = requireAuth,
) {
  return new Elysia({ prefix: '/study' })
    .use(
      rateLimit({
        scoping: 'scoped',
        duration: 60 * 1000,
        max: 180,
        skip: (req) => !req,
        // Per user (then session), not per IP: each grade is its own request.
        generator: async (req, server, derived: { currentUser?: { id?: string } }) =>
          studyRateLimitKey(req, req && server?.requestIP(req)?.address, {
            userId: derived?.currentUser?.id,
          }),
        errorResponse: new Response(
          JSON.stringify({ error: 'Too many study requests, please retry' }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        ),
      }),
    )
    .use(authPlugin)
    .get(
      '/deck/:deckId',
      ({ currentUser, params, query }) =>
        studyService.getDueCards(
          params.deckId,
          currentUser.id,
          query.mode === 'all',
          parseStudyCardIds(query.cardIds),
        ),
      {
        params: t.Object({
          deckId: t.String({ format: 'uuid' }),
        }),
        query: studyDeckQuerySchema,
      },
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
      '/review-batch',
      ({ currentUser, body, headers }) => {
        const tzOffset = getTimezoneOffsetMinutes(headers);
        return services.reviewBatch(currentUser.id, body.items, tzOffset);
      },
      {
        body: t.Object({
          items: t.Array(reviewEventSchema, { minItems: 1, maxItems: 100 }),
        }),
      },
    )
    // --------------- Reset Progress ---------------
    .post(
      '/deck/:deckId/reset-progress',
      async ({ currentUser, params }) => ({
        reset: await services.resetDeck(currentUser.id, params.deckId),
      }),
      { params: t.Object({ deckId: t.String({ format: 'uuid' }) }) },
    )
    .post(
      '/card/:cardId/reset-progress',
      async ({ currentUser, params }) => ({
        reset: await services.resetCard(currentUser.id, params.cardId),
      }),
      { params: t.Object({ cardId: t.String({ format: 'uuid' }) }) },
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
      '/retention-overview',
      ({ currentUser, query }) =>
        services.getRetentionOverview(
          currentUser.id,
          query.deckId,
        ),
      {
        query: t.Object({
          deckId: t.String({ format: 'uuid' }),
        }),
      },
    )
    .get(
      '/retention-details',
      ({ currentUser, query, headers }) =>
        services.getRetentionDetails(
          currentUser.id,
          query.deckId,
          Number(query.days ?? 30),
          getTimezoneOffsetMinutes(headers),
        ),
      {
        query: t.Object({
          deckId: t.String({ format: 'uuid' }),
          days: t.Optional(t.Numeric({ minimum: 7, maximum: 90 })),
        }),
      },
    )
    .get(
      '/at-risk-cards',
      ({ currentUser, query }) =>
        forecastService.getAtRiskCards(
          currentUser.id,
          query.threshold === undefined ? null : Number(query.threshold),
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
    );
}

export const studyRoutes = createStudyRoutes();
