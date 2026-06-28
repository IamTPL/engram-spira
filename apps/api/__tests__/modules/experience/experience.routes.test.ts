import { describe, expect, test } from 'bun:test';
import Elysia from 'elysia';

import { createExperienceRoutes } from '../../../src/modules/experience/experience.routes';
import { AppError, UnauthorizedError } from '../../../src/shared/errors';

function authForRoutes() {
  return new Elysia({ name: 'test-auth' }).derive({ as: 'scoped' }, ({ headers }) => {
    if (headers.authorization !== 'Bearer test-user') {
      throw new UnauthorizedError();
    }

    return {
      currentUser: { id: 'user-1', email: 'test@example.com' },
      currentSession: { id: 'session-1', userId: 'user-1' },
    };
  });
}

function createAggregate(data: Record<string, unknown>, sectionKeys: string[]) {
  return {
    data,
    meta: {
      generatedAt: '2026-06-28T10:00:00.000Z',
      sections: Object.fromEntries(
        sectionKeys.map((key) => [key, { status: 'ok' }]),
      ),
    },
  };
}

function routeServices(overrides: Record<string, unknown> = {}) {
  return {
    getCommandCenter: async () =>
      createAggregate(
        {
          reviewQueue: {},
          streak: null,
          dueDecks: [],
          recent: { decks: [], cards: [] },
          weakAreas: [],
          forecast: null,
          pendingSuggestions: null,
          notifications: [],
        },
        [
          'reviewQueue',
          'streak',
          'dueDecks',
          'recent',
          'weakAreas',
          'forecast',
          'pendingSuggestions',
          'notifications',
        ],
      ),
    getStudyQueue: async (_userId: string, query: any) => {
      if (query.mode === 'deck' && !query.deckId) {
        throw new AppError(422, 'deckId is required');
      }
      if (query.mode === 'folder' && !query.folderId) {
        throw new AppError(422, 'folderId is required');
      }
      if (query.mode === 'class' && !query.classId) {
        throw new AppError(422, 'classId is required');
      }
      if (query.mode === 'smart-group' && !query.smartGroupId) {
        throw new AppError(422, 'smartGroupId is required');
      }
      if (
        (query.mode === 'deck' || query.mode === 'at-risk') &&
        query.deckId === 'missing'
      ) {
        throw new AppError(404, 'Deck not found');
      }
      if (query.mode === 'folder' && query.folderId === 'missing') {
        throw new AppError(404, 'Folder not found');
      }
      if (query.mode === 'class' && query.classId === 'missing') {
        throw new AppError(404, 'Class not found');
      }
      if (query.mode === 'smart-group' && query.smartGroupId === 'missing') {
        throw new AppError(404, 'Smart group not found');
      }
      return {
        mode: query.mode ?? 'due',
        title: 'Due cards',
        cards: [],
        summary: { total: 0, due: 0, new: 0, learning: 0, atRisk: 0 },
      };
    },
    getLibraryExplorer: async () =>
      createAggregate(
        { classes: [], recentDeckIds: [] },
        ['classes', 'recentDecks'],
      ),
    getDeckWorkspace: async (_userId: string, deckId: string) => {
      if (deckId === 'missing') throw new AppError(404, 'Deck not found');
      return createAggregate(
        {
          deck: {
            id: deckId,
            name: 'Test Deck',
            folderId: 'folder-1',
            cardTemplateId: 'template-1',
            cardCount: 0,
          },
          cards: { items: [], page: 1, pageSize: 50, total: 0 },
          study: null,
          analytics: null,
          counters: null,
        },
        ['deck', 'cards', 'study', 'analytics', 'counters'],
      );
    },
    getInsightsOverview: async () =>
      createAggregate(
        {
          forecast: null,
          weakAreas: [],
          atRiskCards: [],
          heatmap: null,
          trends: null,
        },
        ['forecast', 'weakAreas', 'atRiskCards', 'heatmap', 'trends'],
      ),
    ...overrides,
  };
}

function appWithExperience(services = routeServices()) {
  return new Elysia()
    .onError(({ error, set }) => {
      if (error instanceof AppError) {
        set.status = error.statusCode;
        return { error: error.message };
      }

      if (error instanceof Error && error.message === 'Unauthorized') {
        set.status = 401;
        return { error: 'Unauthorized' };
      }

      set.status = 500;
      return { error: error instanceof Error ? error.message : String(error) };
    })
    .use(createExperienceRoutes(services as any, authForRoutes()));
}

async function json(response: Response) {
  return response.json() as Promise<any>;
}

describe('experience aggregate routes', () => {
  test('unauthenticated aggregate endpoints return 401', async () => {
    const app = appWithExperience();

    for (const path of [
      '/dashboard/command-center',
      '/study/queue',
      '/library/explorer',
      '/decks/deck-1/workspace',
      '/insights/overview',
    ]) {
      const response = await app.handle(new Request(`http://test${path}`));

      expect(response.status).toBe(401);
      expect(await json(response)).toEqual({ error: 'Unauthorized' });
    }
  });

  test('GET /dashboard/command-center returns exact section keys', async () => {
    const response = await appWithExperience().handle(
      new Request('http://test/dashboard/command-center', {
        headers: { authorization: 'Bearer test-user' },
      }),
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(Object.keys(body.meta.sections)).toEqual([
      'reviewQueue',
      'streak',
      'dueDecks',
      'recent',
      'weakAreas',
      'forecast',
      'pendingSuggestions',
      'notifications',
    ]);
  });

  test('GET /study/queue returns 422 for missing scoped IDs', async () => {
    const app = appWithExperience();

    for (const [path, error] of [
      ['/study/queue?mode=deck', 'deckId is required'],
      ['/study/queue?mode=folder', 'folderId is required'],
      ['/study/queue?mode=class', 'classId is required'],
      ['/study/queue?mode=smart-group', 'smartGroupId is required'],
    ]) {
      const response = await app.handle(
        new Request(`http://test${path}`, {
          headers: { authorization: 'Bearer test-user' },
        }),
      );

      expect(response.status).toBe(422);
      expect(await json(response)).toEqual({ error });
    }
  });

  test('GET /study/queue returns 404 for invalid scoped IDs', async () => {
    const app = appWithExperience();

    for (const [path, error] of [
      ['/study/queue?mode=deck&deckId=missing', 'Deck not found'],
      ['/study/queue?mode=folder&folderId=missing', 'Folder not found'],
      ['/study/queue?mode=class&classId=missing', 'Class not found'],
      [
        '/study/queue?mode=smart-group&smartGroupId=missing',
        'Smart group not found',
      ],
      ['/study/queue?mode=at-risk&deckId=missing', 'Deck not found'],
    ]) {
      const response = await app.handle(
        new Request(`http://test${path}`, {
          headers: { authorization: 'Bearer test-user' },
        }),
      );

      expect(response.status).toBe(404);
      expect(await json(response)).toEqual({ error });
    }
  });

  test('GET /library/explorer returns aggregate envelope', async () => {
    const response = await appWithExperience().handle(
      new Request('http://test/library/explorer', {
        headers: { authorization: 'Bearer test-user' },
      }),
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.data.classes).toEqual([]);
    expect(body.meta.sections.classes).toEqual({ status: 'ok' });
  });

  test('GET /decks/:id/workspace returns aggregate and rejects missing deck', async () => {
    const app = appWithExperience();
    const success = await app.handle(
      new Request('http://test/decks/deck-1/workspace', {
        headers: { authorization: 'Bearer test-user' },
      }),
    );
    const successBody = await json(success);

    expect(success.status).toBe(200);
    expect(Object.keys(successBody.meta.sections)).toEqual([
      'deck',
      'cards',
      'study',
      'analytics',
      'counters',
    ]);

    const missing = await app.handle(
      new Request('http://test/decks/missing/workspace', {
        headers: { authorization: 'Bearer test-user' },
      }),
    );

    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ error: 'Deck not found' });
  });

  test('GET /insights/overview returns exact section keys', async () => {
    const response = await appWithExperience().handle(
      new Request('http://test/insights/overview', {
        headers: { authorization: 'Bearer test-user' },
      }),
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(Object.keys(body.meta.sections)).toEqual([
      'forecast',
      'weakAreas',
      'atRiskCards',
      'heatmap',
      'trends',
    ]);
  });

  test('injected required service failure returns 500 without partial envelope', async () => {
    const response = await appWithExperience(
      routeServices({
        getCommandCenter: async () => {
          throw new Error('Review queue exploded');
        },
      }),
    ).handle(
      new Request('http://test/dashboard/command-center', {
        headers: { authorization: 'Bearer test-user' },
      }),
    );
    const body = await json(response);

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Review queue exploded' });
    expect(body.meta).toBeUndefined();
  });
});
