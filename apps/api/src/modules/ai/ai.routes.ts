import Elysia, { t } from 'elysia';
import { rateLimit } from 'elysia-rate-limit';
import { requireAuth } from '../auth/auth.middleware';
import * as aiService from './ai.service';
import * as dupService from './duplicate-detection.service';

const toOptionalString = (v: unknown): string | undefined => {
  if (v == null) return undefined;
  if (typeof v === 'string') return v || undefined;
  if (Array.isArray(v)) return v.join('\n') || undefined;
  return String(v) || undefined;
};

// Rate-limit guard applied only to the expensive generate endpoint
const generateRateLimit = new Elysia().use(
  rateLimit({
    scoping: 'scoped',
    duration: 60 * 1000,
    max: 20,
    // Skip lifecycle events (req === undefined) and all read-only polling requests
    skip: (req) => !req || req.method === 'GET',
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
      JSON.stringify({ error: 'Too many AI requests, please retry later' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    ),
  }),
);

export const aiRoutes = new Elysia({ prefix: '/ai' })
  .use(requireAuth)

  // Generate flashcards from text — rate-limited (Gemini call is expensive)
  .use(generateRateLimit)
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
        // MIN: ~5 English words — below this there's no context for quality cards
        // MAX: ~3,000 English / ~6,000 Vietnamese words — beyond this output quality degrades
        // Keep in sync with AI_SOURCE_MIN_CHARS / AI_SOURCE_MAX_CHARS in frontend constants
        sourceText: t.String({ minLength: 10, maxLength: 10_000 }),
        backLanguage: t.Optional(t.Union([t.Literal('vi'), t.Literal('en')])),
      }),
    },
  )

  // Save generated cards from a job (with optional edits)
  // Optional fields accept any type — old jsonb data may have arrays, nulls, or objects
  .post(
    '/jobs/:jobId/save',
    ({ currentUser, params, body }) =>
      aiService.saveGeneratedCards(
        currentUser.id,
        params.jobId,
        body?.cards?.map((c) => ({
          front: c.front,
          back: c.back,
          ipa: toOptionalString(c.ipa),
          wordType: toOptionalString(c.wordType),
          examples: toOptionalString(c.examples),
        })),
      ),
    {
      body: t.Object({
        cards: t.Optional(
          t.Array(
            t.Object({
              front: t.String(),
              back: t.String(),
              // Accept any type — old stored cards may have arrays/nulls from older AI responses
              ipa: t.Optional(t.Any()),
              wordType: t.Optional(t.Any()),
              examples: t.Optional(t.Any()),
            }),
          ),
        ),
      }),
    },
  )

  // Get a specific job
  .get('/jobs/:jobId', ({ currentUser, params }) =>
    aiService.getJob(currentUser.id, params.jobId),
  )

  // List user's AI generation jobs
  .get(
    '/jobs',
    ({ currentUser, query }) =>
      aiService.listJobs(
        currentUser.id,
        query.limit ? Math.min(Number(query.limit), 50) : 20,
        query.status,
      ),
    {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        status: t.Optional(t.String()),
      }),
    },
  )

  // --------------- Duplicate Detection ---------------
  .post(
    '/check-duplicates',
    ({ currentUser, body }) => {
      if (body.cardId) {
        return dupService.checkDuplicatesByCardId(
          currentUser.id,
          body.cardId,
          body.threshold,
        );
      }
      return dupService.checkDuplicatesByText(
        currentUser.id,
        body.text ?? '',
        body.excludeCardId,
        body.threshold,
      );
    },
    {
      body: t.Object({
        cardId: t.Optional(t.String({ format: 'uuid' })),
        text: t.Optional(t.String()),
        excludeCardId: t.Optional(t.String({ format: 'uuid' })),
        threshold: t.Optional(
          t.Number({ minimum: 0.5, maximum: 1.0, default: 0.85 }),
        ),
      }),
    },
  )
  .post(
    '/deck-duplicates',
    ({ currentUser, body }) =>
      dupService.scanDeckDuplicates(
        currentUser.id,
        body.deckId,
        body.threshold,
      ),
    {
      body: t.Object({
        deckId: t.String({ format: 'uuid' }),
        threshold: t.Optional(
          t.Number({ minimum: 0.5, maximum: 1.0, default: 0.85 }),
        ),
      }),
    },
  );
