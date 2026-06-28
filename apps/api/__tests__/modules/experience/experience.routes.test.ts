import { describe, expect, test } from 'bun:test';
import Elysia from 'elysia';

import { createExperienceRoutes } from '../../../src/modules/experience/experience.routes';
import {
  AppError,
  ConflictError,
  PayloadTooLargeError,
  UnauthorizedError,
  ValidationError,
} from '../../../src/shared/errors';

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
        (query.deckId === 'missing' || query.deckId === 'other-deck')
      ) {
        throw new AppError(404, 'Deck not found');
      }
      if (
        query.mode === 'folder' &&
        (query.folderId === 'missing' || query.folderId === 'other-folder')
      ) {
        throw new AppError(404, 'Folder not found');
      }
      if (
        query.mode === 'class' &&
        (query.classId === 'missing' || query.classId === 'other-class')
      ) {
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
      if (deckId === 'missing' || deckId === 'other-deck') {
        throw new AppError(404, 'Deck not found');
      }
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
    searchCommands: async (_userId: string, query: any) => ({
      groups: [
        {
          id: 'actions',
          label: 'Actions',
          results: [
            {
              id: 'open-deck',
              type: 'action',
              title: `Open ${query.q}`,
              subtitle: null,
              href: null,
              action: { id: 'open-deck', label: 'Open deck' },
              icon: null,
              keywords: ['deck'],
              disabledReason: null,
            },
          ],
        },
        { id: 'cards', label: 'Cards', results: [] },
        { id: 'decks', label: 'Decks', results: [] },
        { id: 'folders', label: 'Folders', results: [] },
        { id: 'classes', label: 'Classes', results: [] },
        { id: 'docs', label: 'Docs', results: [] },
        { id: 'settings', label: 'Settings', results: [] },
      ],
    }),
    createPreview: async (_userId: string, request: any) => {
      if (
        request.source === 'ai-paste' ||
        request.source === 'csv' ||
        request.source === 'json'
      ) {
        throw new PayloadTooLargeError(`${request.source} payload too large`);
      }
      if (!request.targetDeckId) throw new ValidationError('targetDeckId is required');
      return {
        previewId: 'preview-1',
        expiresAt: '2026-06-28T10:15:00.000Z',
        cards: [
          {
            clientId: 'client-1',
            fields: { Front: 'Question', Back: 'Answer' },
            validationErrors: [],
            duplicateCandidates: [],
            resolution: 'create',
          },
        ],
        summary: { total: 1, valid: 1, invalid: 0, possibleDuplicates: 0 },
      };
    },
    commitCreatePreview: async (_userId: string, request: any) => {
      if (!request.previewId) throw new ValidationError('previewId is required');
      const firstCard = request.cards?.[0];
      if (firstCard?.resolution === 'merge' && !firstCard.mergeTargetCardId) {
        throw new ValidationError('Merge target is required');
      }
      if (request.idempotencyKey === 'expired') {
        throw new ConflictError('Preview expired');
      }
      if (request.idempotencyKey === 'conflict') {
        throw new ConflictError('Idempotency key conflict');
      }
      if (request.idempotencyKey === 'unknown-client') {
        throw new ConflictError('Unknown preview record');
      }
      if (request.idempotencyKey === 'bad-merge') {
        throw new ConflictError('Merge target not found');
      }
      if (request.idempotencyKey === 'merge-conflict') {
        throw new ConflictError('Merge conflict: Front');
      }
      return {
        createdCardIds: ['card-1'],
        skippedClientIds: [],
        mergedCardIds: [],
      };
    },
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
      '/command/search?q=deck',
    ]) {
      const response = await app.handle(new Request(`http://test${path}`));

      expect(response.status).toBe(401);
      expect(await json(response)).toEqual({ error: 'Unauthorized' });
    }

    for (const [path, init] of [
      [
        '/create/preview',
        {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'content-type': 'application/json' },
        },
      ],
      [
        '/create/commit',
        {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'content-type': 'application/json' },
        },
      ],
    ] as const) {
      const response = await app.handle(new Request(`http://test${path}`, init));

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
      ['/study/queue?mode=deck&deckId=other-deck', 'Deck not found'],
      ['/study/queue?mode=folder&folderId=missing', 'Folder not found'],
      ['/study/queue?mode=folder&folderId=other-folder', 'Folder not found'],
      ['/study/queue?mode=class&classId=missing', 'Class not found'],
      ['/study/queue?mode=class&classId=other-class', 'Class not found'],
      [
        '/study/queue?mode=smart-group&smartGroupId=missing',
        'Smart group not found',
      ],
      ['/study/queue?mode=at-risk&deckId=missing', 'Deck not found'],
      ['/study/queue?mode=at-risk&deckId=other-deck', 'Deck not found'],
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

    const unauthorized = await app.handle(
      new Request('http://test/decks/other-deck/workspace', {
        headers: { authorization: 'Bearer test-user' },
      }),
    );

    expect(unauthorized.status).toBe(404);
    expect(await json(unauthorized)).toEqual({ error: 'Deck not found' });
  });

  test('GET experience routes reject malformed integer query values', async () => {
    const app = appWithExperience();

    for (const [path, error] of [
      ['/study/queue?mode=due&limit=abc', 'limit must be an integer'],
      ['/study/queue?mode=due&limit=1.5', 'limit must be an integer'],
      ['/decks/deck-1/workspace?cardPage=abc', 'cardPage must be an integer'],
      [
        '/decks/deck-1/workspace?cardPageSize=1.5',
        'cardPageSize must be an integer',
      ],
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

  test('GET /command/search returns grouped command results', async () => {
    const response = await appWithExperience().handle(
      new Request('http://test/command/search?q=deck&limit=10', {
        headers: { authorization: 'Bearer test-user' },
      }),
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.groups.map((group: any) => group.id)).toEqual([
      'actions',
      'cards',
      'decks',
      'folders',
      'classes',
      'docs',
      'settings',
    ]);
  });

  test('GET /command/search validates query and limit', async () => {
    const app = appWithExperience();

    const missingQuery = await app.handle(
      new Request('http://test/command/search?q=&limit=10', {
        headers: { authorization: 'Bearer test-user' },
      }),
    );
    expect(missingQuery.status).toBe(422);
    expect(await json(missingQuery)).toEqual({ error: 'Query is required' });

    const badLimit = await app.handle(
      new Request('http://test/command/search?q=deck&limit=100', {
        headers: { authorization: 'Bearer test-user' },
      }),
    );
    expect(badLimit.status).toBe(422);
    expect(await json(badLimit)).toEqual({
      error: 'Limit must be between 1 and 30',
    });
  });

  test('POST /create/preview returns preview contract', async () => {
    const response = await appWithExperience().handle(
      new Request('http://test/create/preview', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'manual',
          targetDeckId: 'deck-1',
          templateId: 'template-1',
          payload: { fields: { Front: 'Question', Back: 'Answer' } },
        }),
      }),
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      previewId: 'preview-1',
      expiresAt: '2026-06-28T10:15:00.000Z',
      cards: [{ clientId: 'client-1' }],
      summary: { total: 1 },
    });
    expect(body.cards[0].duplicateCandidates).toEqual([]);
  });

  test('oversized AI/CSV/JSON preview payloads return 413', async () => {
    const app = appWithExperience();

    for (const source of ['ai-paste', 'csv', 'json']) {
      const response = await app.handle(
        new Request('http://test/create/preview', {
          method: 'POST',
          headers: {
            authorization: 'Bearer test-user',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            source,
            targetDeckId: 'deck-1',
            templateId: 'template-1',
            payload: {},
          }),
        }),
      );

      expect(response.status).toBe(413);
      expect(await json(response)).toEqual({
        error: `${source} payload too large`,
      });
    }
  });

  test('missing or invalid create/commit payload fields return 422', async () => {
    const app = appWithExperience();

    const preview = await app.handle(
      new Request('http://test/create/preview', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'manual',
          templateId: 'template-1',
          payload: { fields: {} },
        }),
      }),
    );
    expect(preview.status).toBe(422);
    expect(await json(preview)).toEqual({ error: 'targetDeckId is required' });

    const commit = await app.handle(
      new Request('http://test/create/commit', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          idempotencyKey: 'key-1',
          cards: [],
        }),
      }),
    );
    expect(commit.status).toBe(422);
    expect(await json(commit)).toEqual({ error: 'previewId is required' });
  });

  test('POST /create/commit returns commit contract', async () => {
    const response = await appWithExperience().handle(
      new Request('http://test/create/commit', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          previewId: 'preview-1',
          idempotencyKey: 'key-1',
          cards: [{ clientId: 'client-1', resolution: 'create' }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      createdCardIds: ['card-1'],
      skippedClientIds: [],
      mergedCardIds: [],
    });
  });

  test('create commit conflict cases return 409', async () => {
    const app = appWithExperience();

    for (const [idempotencyKey, error] of [
      ['expired', 'Preview expired'],
      ['conflict', 'Idempotency key conflict'],
      ['unknown-client', 'Unknown preview record'],
      ['bad-merge', 'Merge target not found'],
      ['merge-conflict', 'Merge conflict: Front'],
    ]) {
      const response = await app.handle(
        new Request('http://test/create/commit', {
          method: 'POST',
          headers: {
            authorization: 'Bearer test-user',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            previewId: 'preview-1',
            idempotencyKey,
            cards: [{ clientId: 'client-1', resolution: 'create' }],
          }),
        }),
      );

      expect(response.status).toBe(409);
      expect(await json(response)).toEqual({ error });
    }
  });

  test('missing mergeTargetCardId returns 422', async () => {
    const response = await appWithExperience().handle(
      new Request('http://test/create/commit', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          previewId: 'preview-1',
          idempotencyKey: 'missing-merge-target',
          cards: [{ clientId: 'client-1', resolution: 'merge' }],
        }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await json(response)).toEqual({
      error: 'Merge target is required',
    });
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
