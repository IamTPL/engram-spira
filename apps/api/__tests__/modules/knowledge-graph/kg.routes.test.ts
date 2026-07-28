import { describe, expect, test } from 'bun:test';
import Elysia from 'elysia';

import {
  createKnowledgeGraphRoutes,
  type KnowledgeGraphRouteServices,
} from '../../../src/modules/knowledge-graph/kg.routes';
import { AppError, UnauthorizedError } from '../../../src/shared/errors';

function authForRoutes() {
  return new Elysia({ name: 'kg-test-auth' }).derive({ as: 'scoped' }, ({ headers }) => {
    if (headers.authorization !== 'Bearer test-user') throw new UnauthorizedError();
    return {
      currentUser: {
        id: 'user-1',
        email: 'test@example.com',
        displayName: null,
        avatarUrl: null,
        emailVerified: true,
      },
      currentSession: { id: 'session-1', userId: 'user-1', expiresAt: new Date() },
    };
  });
}

function routeServices(
  services: Partial<KnowledgeGraphRouteServices>,
): KnowledgeGraphRouteServices {
  return services as KnowledgeGraphRouteServices;
}

describe('knowledge-graph routes', () => {
  test('exposes authenticated knowledge graph capabilities', async () => {
    const users: string[] = [];
    const app = new Elysia().use(
      createKnowledgeGraphRoutes(
        routeServices({
          getCapabilities: (userId) => {
            users.push(userId);
            return { v2Enabled: true };
          },
        }),
        authForRoutes() as Parameters<typeof createKnowledgeGraphRoutes>[1],
      ),
    );

    const unauthorized = await app.handle(
      new Request('http://test/knowledge-graph/capabilities'),
    );
    expect(unauthorized.status).not.toBe(200);
    expect(users).toEqual([]);

    const response = await app.handle(
      new Request('http://test/knowledge-graph/capabilities', {
        headers: { authorization: 'Bearer test-user' },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ v2Enabled: true });
    expect(users).toEqual(['user-1']);
  });

  test('exposes authenticated deck run creation, status, and cancellation', async () => {
    const calls: unknown[][] = [];
    const runResponse = {
      id: '00000000-0000-4000-8000-000000000020',
      type: 'deck_index' as const,
      status: 'queued' as const,
      stage: 'snapshot',
      progress: { completed: 0, total: 6 },
      stats: {
        cards: 0,
        indexedSenses: 0,
        candidates: 0,
        verified: 0,
        suggestions: 0,
        coveredNodes: 0,
        embeddingRequests: 0,
        verifierRequests: 0,
        inputTokens: null,
        outputTokens: null,
      },
      error: null,
    };
    const app = new Elysia().use(
      createKnowledgeGraphRoutes(
        routeServices({
          createDeckRun: async (userId, request) => {
            calls.push(['create', userId, request]);
            return {
              runId: runResponse.id,
              status: 'queued' as const,
              reused: false,
            };
          },
          getRun: async (userId, runId) => {
            calls.push(['get', userId, runId]);
            return runResponse;
          },
          cancelRun: async (userId, runId) => {
            calls.push(['cancel', userId, runId]);
            return { ...runResponse, status: 'cancelled' as const };
          },
        }),
        authForRoutes() as Parameters<typeof createKnowledgeGraphRoutes>[1],
      ),
    );

    const createResponse = await app.handle(
      new Request('http://test/knowledge-graph/runs/deck', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          deckId: '00000000-0000-4000-8000-000000000010',
          sourceLanguageTag: 'en',
          definitionLanguageTag: 'vi',
        }),
      }),
    );
    const getResponse = await app.handle(
      new Request(
        `http://test/knowledge-graph/runs/${runResponse.id}`,
        { headers: { authorization: 'Bearer test-user' } },
      ),
    );
    const cancelResponse = await app.handle(
      new Request(
        `http://test/knowledge-graph/runs/${runResponse.id}/cancel`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer test-user' },
        },
      ),
    );

    expect(createResponse.status).toBe(202);
    expect(await createResponse.json()).toEqual({
      runId: runResponse.id,
      status: 'queued',
      reused: false,
    });
    expect(getResponse.status).toBe(200);
    expect(cancelResponse.status).toBe(200);
    expect(calls).toEqual([
      [
        'create',
        'user-1',
        {
          deckId: '00000000-0000-4000-8000-000000000010',
          sourceLanguageTag: 'en',
          definitionLanguageTag: 'vi',
        },
      ],
      ['get', 'user-1', runResponse.id],
      ['cancel', 'user-1', runResponse.id],
    ]);
  });

  test('starts an authenticated sense-expansion run with a 202 response', async () => {
    const senseId = '00000000-0000-4000-8000-000000000040';
    const runId = '00000000-0000-4000-8000-000000000041';
    const calls: unknown[][] = [];
    const app = new Elysia().use(
      createKnowledgeGraphRoutes(
        routeServices({
          createSenseExpansionRun: async (userId, requestedSenseId) => {
            calls.push([userId, requestedSenseId]);
            return { runId, status: 'queued' as const, reused: false };
          },
        }),
        authForRoutes() as Parameters<typeof createKnowledgeGraphRoutes>[1],
      ),
    );

    const response = await app.handle(
      new Request(
        `http://test/knowledge-graph/senses/${senseId}/expansion-runs`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer test-user' },
        },
      ),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      runId,
      status: 'queued',
      reused: false,
    });
    expect(calls).toEqual([['user-1', senseId]]);
  });

  test('delegates suggestion dismissal to the ownership-safe service', async () => {
    const calls: Array<[string, string, string]> = [];
    const app = new Elysia()
      .onError(({ error, set }) => {
        if (error instanceof AppError) {
          set.status = error.statusCode;
          return { error: error.message };
        }
        throw error;
      })
      .use(
        createKnowledgeGraphRoutes(
          routeServices({
            dismissSuggestion: async (userId, sourceCardId, targetCardId) => {
              calls.push([userId, sourceCardId, targetCardId]);
              return { dismissed: true };
            },
          }),
          authForRoutes() as Parameters<typeof createKnowledgeGraphRoutes>[1],
        ),
      );

    const response = await app.handle(
      new Request('http://test/knowledge-graph/ai/dismiss', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sourceCardId: '00000000-0000-4000-8000-000000000001',
          targetCardId: '00000000-0000-4000-8000-000000000002',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([[
      'user-1',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]]);
  });

  test('lists and reviews typed suggestions through authenticated v2 routes', async () => {
    const runId = '00000000-0000-4000-8000-000000000020';
    const suggestionId = '00000000-0000-4000-8000-000000000021';
    const calls: unknown[][] = [];
    const app = new Elysia().use(
      createKnowledgeGraphRoutes(
        routeServices({
          listSuggestions: async (userId, requestedRunId, query) => {
            calls.push(['list', userId, requestedRunId, query]);
            return {
              items: [],
              pageInfo: { nextCursor: null, truncated: false },
            };
          },
          acceptSuggestion: async (userId, requestedSuggestionId) => {
            calls.push(['accept', userId, requestedSuggestionId]);
            return {
              suggestionId: requestedSuggestionId,
              status: 'accepted' as const,
              relationId: '00000000-0000-4000-8000-000000000022',
            };
          },
          dismissTypedSuggestion: async (
            userId,
            requestedSuggestionId,
          ) => {
            calls.push(['dismiss', userId, requestedSuggestionId]);
            return {
              suggestionId: requestedSuggestionId,
              status: 'dismissed' as const,
              dismissedAt: new Date(0).toISOString(),
            };
          },
        }),
        authForRoutes() as Parameters<typeof createKnowledgeGraphRoutes>[1],
      ),
    );

    const listResponse = await app.handle(
      new Request(
        `http://test/knowledge-graph/runs/${runId}/suggestions?status=pending&limit=20`,
        { headers: { authorization: 'Bearer test-user' } },
      ),
    );
    const acceptResponse = await app.handle(
      new Request(
        `http://test/knowledge-graph/suggestions/${suggestionId}/accept`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer test-user' },
        },
      ),
    );
    const dismissResponse = await app.handle(
      new Request(
        `http://test/knowledge-graph/suggestions/${suggestionId}/dismiss`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer test-user' },
        },
      ),
    );

    expect(listResponse.status).toBe(200);
    expect(acceptResponse.status).toBe(200);
    expect(dismissResponse.status).toBe(200);
    expect(calls).toEqual([
      ['list', 'user-1', runId, { status: 'pending', limit: 20 }],
      ['accept', 'user-1', suggestionId],
      ['dismiss', 'user-1', suggestionId],
    ]);
  });

  test('loads a focused neighborhood and maps a card to an owned sense', async () => {
    const cardId = '00000000-0000-4000-8000-000000000031';
    const senseId = '00000000-0000-4000-8000-000000000032';
    const calls: unknown[][] = [];
    const app = new Elysia().use(
      createKnowledgeGraphRoutes(
        routeServices({
          getNeighborhood: async (userId, requestedCardId, query) => {
            calls.push(['neighborhood', userId, requestedCardId, query]);
            return {
              focus: {
                id: senseId,
                lexemeId: '00000000-0000-4000-8000-000000000033',
                label: 'bank',
                languageTag: 'en',
                partOfSpeech: 'noun',
                definition: 'ngân hàng',
                mappedCardIds: [cardId],
                inCurrentDeck: true,
                retention: null,
                dueAt: null,
              },
              nodes: [],
              edges: [],
              summary: {
                deckCards: 1,
                connectedCards: 0,
                isolatedCards: 1,
                groupCounts: {
                  hierarchy: 0,
                  meaning: 0,
                  form: 0,
                  usage: 0,
                },
              },
              pageInfo: { nextCursor: null, truncated: false },
            };
          },
          mapCardSense: async (
            userId,
            requestedCardId,
            requestedSenseId,
          ) => {
            calls.push([
              'map',
              userId,
              requestedCardId,
              requestedSenseId,
            ]);
            return {
              cardId: requestedCardId,
              senseId: requestedSenseId,
              source: 'manual' as const,
              isPrimary: true,
              created: true,
            };
          },
        }),
        authForRoutes() as Parameters<typeof createKnowledgeGraphRoutes>[1],
      ),
    );

    const neighborhoodResponse = await app.handle(
      new Request(
        `http://test/knowledge-graph/cards/${cardId}/neighborhood?groups=hierarchy,meaning&limit=12`,
        { headers: { authorization: 'Bearer test-user' } },
      ),
    );
    const mappingResponse = await app.handle(
      new Request(
        `http://test/knowledge-graph/cards/${cardId}/senses/${senseId}`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer test-user' },
        },
      ),
    );

    expect(neighborhoodResponse.status).toBe(200);
    expect(mappingResponse.status).toBe(200);
    expect(calls).toEqual([
      [
        'neighborhood',
        'user-1',
        cardId,
        { groups: 'hierarchy,meaning', limit: 12 },
      ],
      ['map', 'user-1', cardId, senseId],
    ]);
  });
});
