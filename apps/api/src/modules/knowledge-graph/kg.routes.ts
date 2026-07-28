import Elysia, { t } from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as kgService from './kg.service';
import * as kgAiService from './kg-ai.service';
import * as kgApiService from './kg-api.service';

export type KnowledgeGraphRouteServices = {
  createLink: typeof kgService.createLink;
  deleteLink: typeof kgService.deleteLink;
  getCardLinks: typeof kgService.getCardLinks;
  getDeckGraph: typeof kgService.getDeckGraph;
  searchCardsForLinking: typeof kgService.searchCardsForLinking;
  dismissSuggestion: typeof kgService.dismissSuggestion;
  detectRelationships: typeof kgAiService.detectRelationships;
  getCapabilities: typeof kgApiService.getCapabilities;
  createDeckRun: typeof kgApiService.createDeckRun;
  createSenseExpansionRun: typeof kgApiService.createSenseExpansionRun;
  getRun: typeof kgApiService.getRun;
  cancelRun: typeof kgApiService.cancelRun;
  listSuggestions: typeof kgApiService.listSuggestions;
  acceptSuggestion: typeof kgApiService.acceptSuggestion;
  dismissTypedSuggestion: typeof kgApiService.dismissTypedSuggestion;
  getNeighborhood: typeof kgApiService.getNeighborhood;
  mapCardSense: typeof kgApiService.mapCardSense;
};

const defaultKnowledgeGraphRouteServices: KnowledgeGraphRouteServices = {
  createLink: kgService.createLink,
  deleteLink: kgService.deleteLink,
  getCardLinks: kgService.getCardLinks,
  getDeckGraph: kgService.getDeckGraph,
  searchCardsForLinking: kgService.searchCardsForLinking,
  dismissSuggestion: kgService.dismissSuggestion,
  detectRelationships: kgAiService.detectRelationships,
  getCapabilities: kgApiService.getCapabilities,
  createDeckRun: kgApiService.createDeckRun,
  createSenseExpansionRun: kgApiService.createSenseExpansionRun,
  getRun: kgApiService.getRun,
  cancelRun: kgApiService.cancelRun,
  listSuggestions: kgApiService.listSuggestions,
  acceptSuggestion: kgApiService.acceptSuggestion,
  dismissTypedSuggestion: kgApiService.dismissTypedSuggestion,
  getNeighborhood: kgApiService.getNeighborhood,
  mapCardSense: kgApiService.mapCardSense,
};

export function createKnowledgeGraphRoutes(
  services: KnowledgeGraphRouteServices = defaultKnowledgeGraphRouteServices,
  authPlugin: typeof requireAuth = requireAuth,
) {
  return new Elysia({ prefix: '/knowledge-graph' })
    .use(authPlugin)

    // ── Language Knowledge Graph v2 runs ─────────────────────────
    .get(
      '/capabilities',
      ({ currentUser }) => services.getCapabilities(currentUser.id),
      {
        response: t.Object({
          v2Enabled: t.Boolean(),
        }),
      },
    )
    .post(
      '/runs/deck',
      async ({ currentUser, body, status }) =>
        status(
          202,
          await services.createDeckRun(currentUser.id, {
            deckId: body.deckId,
            sourceLanguageTag: body.sourceLanguageTag,
            definitionLanguageTag: body.definitionLanguageTag,
          }),
        ),
      {
        body: t.Object({
          deckId: t.String({ format: 'uuid' }),
          sourceLanguageTag: t.String({ minLength: 2, maxLength: 35 }),
          definitionLanguageTag: t.String({ minLength: 2, maxLength: 35 }),
        }),
      },
    )
    .post(
      '/senses/:senseId/expansion-runs',
      async ({ currentUser, params, status }) =>
        status(
          202,
          await services.createSenseExpansionRun(
            currentUser.id,
            params.senseId,
          ),
        ),
      {
        params: t.Object({
          senseId: t.String({ format: 'uuid' }),
        }),
      },
    )
    .get(
      '/runs/:runId',
      ({ currentUser, params }) =>
        services.getRun(currentUser.id, params.runId),
      {
        params: t.Object({
          runId: t.String({ format: 'uuid' }),
        }),
      },
    )
    .post(
      '/runs/:runId/cancel',
      ({ currentUser, params }) =>
        services.cancelRun(currentUser.id, params.runId),
      {
        params: t.Object({
          runId: t.String({ format: 'uuid' }),
        }),
      },
    )
    .get(
      '/runs/:runId/suggestions',
      ({ currentUser, params, query }) =>
        services.listSuggestions(currentUser.id, params.runId, {
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
        }),
      {
        params: t.Object({
          runId: t.String({ format: 'uuid' }),
        }),
        query: t.Object({
          status: t.Optional(
            t.Union([
              t.Literal('pending'),
              t.Literal('accepted'),
              t.Literal('dismissed'),
              t.Literal('superseded'),
            ]),
          ),
          cursor: t.Optional(t.String({ minLength: 1, maxLength: 1024 })),
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
        }),
      },
    )
    .post(
      '/suggestions/:id/accept',
      ({ currentUser, params }) =>
        services.acceptSuggestion(currentUser.id, params.id),
      {
        params: t.Object({
          id: t.String({ format: 'uuid' }),
        }),
      },
    )
    .post(
      '/suggestions/:id/dismiss',
      ({ currentUser, params }) =>
        services.dismissTypedSuggestion(currentUser.id, params.id),
      {
        params: t.Object({
          id: t.String({ format: 'uuid' }),
        }),
      },
    )
    .get(
      '/cards/:id/neighborhood',
      ({ currentUser, params, query }) =>
        services.getNeighborhood(currentUser.id, params.id, {
          ...(query.groups === undefined ? {} : { groups: query.groups }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        }),
      {
        params: t.Object({
          id: t.String({ format: 'uuid' }),
        }),
        query: t.Object({
          groups: t.Optional(
            t.String({
              pattern:
                '^(hierarchy|meaning|form|usage)(,(hierarchy|meaning|form|usage))*$',
            }),
          ),
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 24 })),
          cursor: t.Optional(t.String({ minLength: 1, maxLength: 2048 })),
        }),
      },
    )
    .post(
      '/cards/:id/senses/:senseId',
      ({ currentUser, params }) =>
        services.mapCardSense(
          currentUser.id,
          params.id,
          params.senseId,
        ),
      {
        params: t.Object({
          id: t.String({ format: 'uuid' }),
          senseId: t.String({ format: 'uuid' }),
        }),
      },
    )

    // ── Links CRUD ───────────────────────────────────────────────
    .post(
    '/links',
    ({ currentUser, body }) =>
      services.createLink(
        currentUser.id,
        body.sourceCardId,
        body.targetCardId,
        body.linkType,
      ),
    {
      body: t.Object({
        sourceCardId: t.String({ format: 'uuid' }),
        targetCardId: t.String({ format: 'uuid' }),
        linkType: t.Optional(
          t.Literal('related'),
        ),
      }),
    },
    )
    .delete('/links/:id', ({ currentUser, params }) =>
      services.deleteLink(currentUser.id, params.id),
    )
    .get('/cards/:id/links', ({ currentUser, params }) =>
      services.getCardLinks(currentUser.id, params.id),
    )

    // ── Deck graph ───────────────────────────────────────────────
    .get('/decks/:id/graph', ({ currentUser, params }) =>
      services.getDeckGraph(currentUser.id, params.id),
    )

    // ── Search for link targets ──────────────────────────────────
    .get(
    '/search',
    ({ currentUser, query }) =>
      services.searchCardsForLinking(
        currentUser.id,
        query.q,
        query.exclude,
        query.limit ? Number(query.limit) : 10,
      ),
    {
      query: t.Object({
        q: t.String({ minLength: 1 }),
        exclude: t.Optional(t.String({ format: 'uuid' })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 30 })),
      }),
    },
    )

    // ── AI Relationship Detection ────────────────────────────────
    .post(
    '/ai/detect',
    ({ currentUser, body }) =>
      services.detectRelationships(
        currentUser.id,
        body.deckId,
        body.threshold,
      ),
    {
      body: t.Object({
        deckId: t.String({ format: 'uuid' }),
        threshold: t.Optional(
          t.Number({ minimum: 0.5, maximum: 1.0, default: 0.75 }),
        ),
      }),
    },
    )

    // ── Dismiss Suggestion ────────────────────────────────────
    .post(
    '/ai/dismiss',
    ({ currentUser, body }) =>
      services.dismissSuggestion(
        currentUser.id,
        body.sourceCardId,
        body.targetCardId,
      ),
    {
      body: t.Object({
        sourceCardId: t.String({ format: 'uuid' }),
        targetCardId: t.String({ format: 'uuid' }),
      }),
    },
  );
}

export const kgRoutes = createKnowledgeGraphRoutes();
