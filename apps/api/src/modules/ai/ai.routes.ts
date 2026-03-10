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
        body.cardCount,
      ),
    {
      body: t.Object({
        deckId: t.String({ format: 'uuid' }),
        sourceText: t.String({ minLength: 10, maxLength: 10000 }),
        cardCount: t.Optional(
          t.Number({ minimum: 1, maximum: 50, default: 10 }),
        ),
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
  )

  // Improve a single card
  .post(
    '/improve',
    ({ currentUser, body }) =>
      aiService.improveCard(currentUser.id, body.front, body.back),
    {
      body: t.Object({
        front: t.String({ minLength: 1 }),
        back: t.String({ minLength: 1 }),
      }),
    },
  )

  // Check for duplicate cards in a deck
  .post(
    '/check-duplicates',
    ({ currentUser, body }) =>
      aiService.checkDuplicates(
        currentUser.id,
        body.deckId,
        body.text,
        body.threshold,
      ),
    {
      body: t.Object({
        deckId: t.String({ format: 'uuid' }),
        text: t.String({ minLength: 1 }),
        threshold: t.Optional(
          t.Number({ minimum: 0.5, maximum: 0.99, default: 0.85 }),
        ),
      }),
    },
  )

  // Quality score for a card
  .post(
    '/quality-score',
    ({ currentUser, body }) =>
      aiService.qualityScore(currentUser.id, body.front, body.back),
    {
      body: t.Object({
        front: t.String({ minLength: 1 }),
        back: t.String({ minLength: 1 }),
      }),
    },
  );
