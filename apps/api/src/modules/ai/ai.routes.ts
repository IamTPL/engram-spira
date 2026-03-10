import Elysia, { t } from 'elysia';
import { rateLimit } from 'elysia-rate-limit';
import { requireAuth } from '../auth/auth.middleware';
import * as aiService from './ai.service';

export const aiRoutes = new Elysia({ prefix: '/ai' })
  .use(
    rateLimit({
      duration: 60 * 1000,
      max: 20,
      errorResponse: new Response(
        JSON.stringify({ error: 'Too many AI requests, please retry later' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    }),
  )
  .use(requireAuth)

  // Generate flashcards from text (returns preview)
  .post(
    '/generate',
    ({ currentUser, body }) =>
      aiService.generateCardsFromText(
        currentUser.id,
        body.deckId,
        body.sourceText,
        body.backLanguage,
      ),
    {
      body: t.Object({
        deckId: t.String({ format: 'uuid' }),
        sourceText: t.String({ minLength: 10, maxLength: 10000 }),
        backLanguage: t.Optional(t.Union([t.Literal('vi'), t.Literal('en')])),
      }),
    },
  )

  // Save generated cards from a job (with optional edits)
  .post(
    '/jobs/:jobId/save',
    ({ currentUser, params, body }) =>
      aiService.saveGeneratedCards(currentUser.id, params.jobId, body?.cards),
    {
      body: t.Optional(
        t.Object({
          cards: t.Array(
            t.Object({
              front: t.String(),
              back: t.String(),
              ipa: t.Optional(t.String()),
              wordType: t.Optional(t.String()),
              examples: t.Optional(t.String()),
            }),
          ),
        }),
      ),
    },
  )

  // Get a specific job
  .get('/jobs/:jobId', ({ currentUser, params }) =>
    aiService.getJob(currentUser.id, params.jobId),
  )

  // List user's AI generation jobs
  .get('/jobs', ({ currentUser, query }) =>
    aiService.listJobs(
      currentUser.id,
      query.limit ? Math.min(Number(query.limit), 50) : 20,
    ),
  );
