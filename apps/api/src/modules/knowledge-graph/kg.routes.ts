import Elysia, { t } from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import * as kgService from './kg.service';
import * as kgAiService from './kg-ai.service';

export const kgRoutes = new Elysia({ prefix: '/knowledge-graph' })
  .use(requireAuth)

  // ── Links CRUD ───────────────────────────────────────────────
  .post(
    '/links',
    ({ currentUser, body }) =>
      kgService.createLink(
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
          t.Union([t.Literal('prerequisite'), t.Literal('related')]),
        ),
      }),
    },
  )
  .delete('/links/:id', ({ currentUser, params }) =>
    kgService.deleteLink(currentUser.id, params.id),
  )
  .get('/cards/:id/links', ({ currentUser, params }) =>
    kgService.getCardLinks(currentUser.id, params.id),
  )

  // ── Deck graph ───────────────────────────────────────────────
  .get('/decks/:id/graph', ({ currentUser, params }) =>
    kgService.getDeckGraph(currentUser.id, params.id),
  )

  // ── Search for link targets ──────────────────────────────────
  .get(
    '/search',
    ({ currentUser, query }) =>
      kgService.searchCardsForLinking(
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

  // ── Concepts ─────────────────────────────────────────────────
  .post(
    '/cards/:id/concepts',
    ({ currentUser, params, body }) =>
      kgService.addConcepts(currentUser.id, params.id, body.concepts),
    {
      body: t.Object({
        concepts: t.Array(t.String({ minLength: 1 }), {
          minItems: 1,
          maxItems: 20,
        }),
      }),
    },
  )
  .get('/cards/:id/concepts', ({ currentUser, params }) =>
    kgService.getCardConcepts(currentUser.id, params.id),
  )

  // ── AI Relationship Detection ────────────────────────────────
  .post(
    '/ai/detect',
    ({ currentUser, body }) =>
      kgAiService.detectRelationships(
        currentUser.id,
        body.deckId,
        body.threshold,
      ),
    {
      body: t.Object({
        deckId: t.String({ format: 'uuid' }),
        threshold: t.Optional(
          t.Number({ minimum: 0.5, maximum: 1.0, default: 0.7 }),
        ),
      }),
    },
  );
