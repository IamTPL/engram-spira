import { describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import { createStudyRoutes } from '../../../src/modules/study/study.routes';
import { AppError, UnauthorizedError } from '../../../src/shared/errors';

const DECK_ID = '11111111-1111-4111-8111-111111111111';
const CARD_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

function authForRoutes() {
  return new Elysia({ name: 'test-auth' }).derive({ as: 'scoped' }, ({ headers }) => {
    if (headers.authorization !== 'Bearer test-user') throw new UnauthorizedError();
    return {
      currentUser: {
        id: 'user-1',
        email: 'test@example.com',
        displayName: null,
        avatarUrl: null,
        emailVerified: true,
      },
      currentSession: {
        id: 'session-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    };
  });
}

function app(calls: unknown[]) {
  const services = {
    getRetentionOverview: async () => ({}),
    getRetentionDetails: async () => ({}),
    reviewBatch: async (userId: string, items: unknown[], tz: number) => {
      calls.push({ op: 'reviewBatch', userId, items, tz });
      return { applied: items.length, duplicates: 0, results: [] };
    },
    resetDeck: async (userId: string, deckId: string) => {
      calls.push({ op: 'resetDeck', userId, deckId });
      return 7;
    },
    resetCard: async (userId: string, cardId: string) => {
      calls.push({ op: 'resetCard', userId, cardId });
      return 1;
    },
  };
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (error instanceof AppError) {
        set.status = error.statusCode;
        return { error: error.message };
      }
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: error.all[0]?.summary ?? 'Validation failed' };
      }
      if (code === 'NOT_FOUND') {
        set.status = 404;
        return { error: 'Not Found' };
      }
      set.status = 500;
      return { error: error instanceof Error ? error.message : String(error) };
    })
    .use(
      createStudyRoutes(
        services as any,
        authForRoutes() as Parameters<typeof createStudyRoutes>[1],
      ),
    );
}

const headers = {
  authorization: 'Bearer test-user',
  'content-type': 'application/json',
  'x-timezone-offset': '-420',
};

describe('study write routes', () => {
  test('review-batch forwards items and the timezone offset to the live service', async () => {
    const calls: any[] = [];
    const response = await app(calls).handle(
      new Request('http://localhost/study/review-batch', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          items: [
            {
              requestId: REQUEST_ID,
              cardId: CARD_ID,
              rating: 'good',
              reviewedAt: '2026-09-08T10:00:00.000Z',
              durationMs: 1500,
            },
          ],
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: 1, duplicates: 0, results: [] });
    expect(calls).toEqual([
      {
        op: 'reviewBatch',
        userId: 'user-1',
        tz: -420,
        items: [
          {
            requestId: REQUEST_ID,
            cardId: CARD_ID,
            rating: 'good',
            reviewedAt: '2026-09-08T10:00:00.000Z',
            durationMs: 1500,
          },
        ],
      },
    ]);
  });

  test('review-batch rejects the legacy {cardId, action} shape with 422', async () => {
    const response = await app([]).handle(
      new Request('http://localhost/study/review-batch', {
        method: 'POST',
        headers,
        body: JSON.stringify({ items: [{ cardId: CARD_ID, action: 'good' }] }),
      }),
    );
    expect(response.status).toBe(422);
  });

  test('POST /study/review and /study/algorithm no longer exist', async () => {
    const review = await app([]).handle(
      new Request('http://localhost/study/review', {
        method: 'POST',
        headers,
        body: JSON.stringify({ cardId: CARD_ID, action: 'good' }),
      }),
    );
    const algorithm = await app([]).handle(
      new Request('http://localhost/study/algorithm', { headers }),
    );
    expect(review.status).toBe(404);
    expect(algorithm.status).toBe(404);
  });

  test('reset routes return counts from the live service', async () => {
    const calls: any[] = [];
    const deck = await app(calls).handle(
      new Request(`http://localhost/study/deck/${DECK_ID}/reset-progress`, {
        method: 'POST',
        headers,
      }),
    );
    const card = await app(calls).handle(
      new Request(`http://localhost/study/card/${CARD_ID}/reset-progress`, {
        method: 'POST',
        headers,
      }),
    );
    expect(await deck.json()).toEqual({ reset: 7 });
    expect(await card.json()).toEqual({ reset: 1 });
    expect(calls.map((c) => c.op)).toEqual(['resetDeck', 'resetCard']);
  });
});
