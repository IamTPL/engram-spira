import Elysia, { t } from 'elysia';
import { rateLimit } from 'elysia-rate-limit';
import { requireAuth } from '../auth/auth.middleware';
import * as searchService from './search.service';

export const searchRoutes = new Elysia({ prefix: '/search' })
  .use(
    rateLimit({
      scoping: 'scoped',
      duration: 60 * 1000,
      max: 60,
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
        JSON.stringify({ error: 'Too many search requests, please retry' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    }),
  )
  .use(requireAuth)
  .get(
    '/',
    ({ currentUser, query }) =>
      searchService.search(currentUser.id, query.q, {
        limit: query.limit ? Number(query.limit) : 20,
        deckId: query.deckId,
      }),
    {
      query: t.Object({
        q: t.String({ minLength: 1 }),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
        deckId: t.Optional(t.String({ format: 'uuid' })),
      }),
    },
  );
