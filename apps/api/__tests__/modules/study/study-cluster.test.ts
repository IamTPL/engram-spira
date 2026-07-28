import { describe, expect, test } from 'bun:test';
import Elysia from 'elysia';

import {
  parseStudyCardIds,
  studyDeckQuerySchema,
} from '../../../src/modules/study/study-cluster';

const firstCardId = '11111111-1111-4111-8111-111111111111';
const secondCardId = '22222222-2222-4222-8222-222222222222';

describe('study cluster query', () => {
  test('preserves root-first card order from the URL query', () => {
    expect(parseStudyCardIds(`${secondCardId},${firstCardId}`)).toEqual([
      secondCardId,
      firstCardId,
    ]);
    expect(parseStudyCardIds(undefined)).toBeUndefined();
  });

  test('TypeBox rejects more than 12 card IDs before the handler', async () => {
    const app = new Elysia().get('/', ({ query }) => query, {
      query: studyDeckQuerySchema,
    });
    const thirteenIds = Array.from(
      { length: 13 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    ).join(',');

    const response = await app.handle(
      new Request(`http://localhost/?cardIds=${thirteenIds}`),
    );

    expect(response.status).toBe(422);
  });

  test('TypeBox accepts an ordered list of up to 12 UUIDs', async () => {
    const app = new Elysia().get('/', ({ query }) => query, {
      query: studyDeckQuerySchema,
    });

    const response = await app.handle(
      new Request(
        `http://localhost/?mode=all&cardIds=${secondCardId},${firstCardId}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: 'all',
      cardIds: `${secondCardId},${firstCardId}`,
    });
  });
});
