import { describe, expect, test } from 'bun:test';
import Elysia from 'elysia';

import { createStudyRoutes } from '../../../src/modules/study/study.routes';
import {
  AppError,
  UnauthorizedError,
} from '../../../src/shared/errors';

const DECK_ID = '11111111-1111-4111-8111-111111111111';

function authForRoutes() {
  return new Elysia({ name: 'test-auth' }).derive(
    { as: 'scoped' },
    ({ headers }) => {
      if (headers.authorization !== 'Bearer test-user') {
        throw new UnauthorizedError();
      }

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
          expiresAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      };
    },
  );
}

function routeServices() {
  return {
    getRetentionOverview: async (userId: string, deckId: string) => ({
      delegated: { userId, deckId },
    }),
    getRetentionDetails: async (
      userId: string,
      deckId: string,
      days: number,
      timezoneOffsetMinutes: number,
    ) => ({
      delegated: { userId, deckId, days, timezoneOffsetMinutes },
    }),
  };
}

function appWithStudy() {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (error instanceof AppError) {
        set.status = error.statusCode;
        return { error: error.message };
      }

      if (code === 'VALIDATION') {
        set.status = 422;
        return {
          error:
            error.all[0]?.summary ??
            error.all[0]?.message ??
            'Validation failed',
        };
      }

      set.status = 500;
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    })
    .use(
      createStudyRoutes(
        routeServices() as any,
        authForRoutes() as Parameters<typeof createStudyRoutes>[1],
      ),
    );
}

async function json(response: Response) {
  return response.json() as Promise<any>;
}

describe('memory health routes', () => {
  test('rejects unauthenticated overview and details requests', async () => {
    const app = appWithStudy();

    for (const path of [
      `/study/retention-overview?deckId=${DECK_ID}`,
      `/study/retention-details?deckId=${DECK_ID}`,
    ]) {
      const response = await app.handle(new Request(`http://test${path}`));

      expect(response.status).toBe(401);
      expect(await json(response)).toEqual({ error: 'Unauthorized' });
    }
  });

  test('validates the deck UUID before delegating', async () => {
    const app = appWithStudy();

    for (const path of [
      '/study/retention-overview?deckId=not-a-uuid',
      '/study/retention-details?deckId=not-a-uuid',
    ]) {
      const response = await app.handle(
        new Request(`http://test${path}`, {
          headers: { authorization: 'Bearer test-user' },
        }),
      );
      const body = await json(response);

      expect(response.status).toBe(422);
      expect(Object.keys(body)).toEqual(['error']);
      expect(typeof body.error).toBe('string');
    }
  });

  test('validates details day boundaries', async () => {
    const app = appWithStudy();

    for (const days of [6, 91]) {
      const response = await app.handle(
        new Request(
          `http://test/study/retention-details?deckId=${DECK_ID}&days=${days}`,
          { headers: { authorization: 'Bearer test-user' } },
        ),
      );
      const body = await json(response);

      expect(response.status).toBe(422);
      expect(Object.keys(body)).toEqual(['error']);
      expect(typeof body.error).toBe('string');
    }
  });

  test('delegates authenticated overview and default details inputs', async () => {
    const app = appWithStudy();
    const overview = await app.handle(
      new Request(
        `http://test/study/retention-overview?deckId=${DECK_ID}`,
        { headers: { authorization: 'Bearer test-user' } },
      ),
    );
    const details = await app.handle(
      new Request(
        `http://test/study/retention-details?deckId=${DECK_ID}`,
        {
          headers: {
            authorization: 'Bearer test-user',
            'x-timezone-offset': '330',
          },
        },
      ),
    );

    expect(overview.status).toBe(200);
    expect(await json(overview)).toEqual({
      delegated: { userId: 'user-1', deckId: DECK_ID },
    });
    expect(details.status).toBe(200);
    expect(await json(details)).toEqual({
      delegated: {
        userId: 'user-1',
        deckId: DECK_ID,
        days: 30,
        timezoneOffsetMinutes: 330,
      },
    });
  });

  test('rejects partial timezone offsets and clamps signed integers', async () => {
    const app = appWithStudy();

    for (const [rawOffset, expectedOffset] of [
      ['60junk', 0],
      ['+900', 840],
      ['-900', -720],
    ] as const) {
      const response = await app.handle(
        new Request(
          `http://test/study/retention-details?deckId=${DECK_ID}&days=7`,
          {
            headers: {
              authorization: 'Bearer test-user',
              'x-timezone-offset': rawOffset,
            },
          },
        ),
      );

      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({
        delegated: {
          userId: 'user-1',
          deckId: DECK_ID,
          days: 7,
          timezoneOffsetMinutes: expectedOffset,
        },
      });
    }
  });
});
