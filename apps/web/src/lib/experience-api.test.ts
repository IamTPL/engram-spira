import { describe, expect, test } from 'bun:test';
import {
  createExperienceApi,
  experienceQueryKeys,
} from './experience-api';

const aggregate = {
  data: { reviewQueue: { dueCount: 1 } },
  meta: {
    generatedAt: '2026-06-28T00:00:00.000Z',
    sections: { reviewQueue: { status: 'ok' } },
  },
};

describe('experience api wrappers', () => {
  test('returns aggregate envelopes unchanged', async () => {
    const client = {
      dashboard: {
        'command-center': {
          get: async () => ({ data: aggregate, error: null }),
        },
      },
    };

    const api = createExperienceApi(client as any);
    const result = await api.getCommandCenter();

    expect(result).toBe(aggregate as any);
  });

  test('passes command search query params unchanged', async () => {
    const calls: unknown[] = [];
    const response = { groups: [] };
    const client = {
      command: {
        search: {
          get: async (options: unknown) => {
            calls.push(options);
            return { data: response, error: null };
          },
        },
      },
    };

    const api = createExperienceApi(client as any);

    await expect(
      api.searchCommands({
        q: 'deck',
        currentRoute: '/',
        deckId: 'deck-1',
        limit: 12,
      }),
    ).resolves.toBe(response);
    expect(calls).toEqual([
      {
        query: {
          q: 'deck',
          currentRoute: '/',
          deckId: 'deck-1',
          limit: 12,
        },
      },
    ]);
  });

  test('throws normalized server errors', async () => {
    const client = {
      command: {
        search: {
          get: async () => ({
            data: null,
            error: { value: { error: 'Query is required' } },
          }),
        },
      },
    };

    const api = createExperienceApi(client as any);

    await expect(api.searchCommands({ q: '' })).rejects.toThrow(
      'Query is required',
    );
  });

  test('exposes stable query keys', () => {
    expect(experienceQueryKeys.commandCenter()).toEqual(['command-center']);
    expect(
      experienceQueryKeys.deckWorkspace('deck-1', {
        cardPage: 2,
        cardSearch: 'abc',
      }),
    ).toEqual([
      'deck-workspace',
      'deck-1',
      { cardPage: 2, cardSearch: 'abc' },
    ]);
  });
});
