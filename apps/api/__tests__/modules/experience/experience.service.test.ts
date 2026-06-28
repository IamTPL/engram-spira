import { describe, expect, test } from 'bun:test';

import {
  aggregateResponse,
  emptySection,
  errorSection,
  okSection,
  resolveSection,
} from '../../../src/modules/experience/experience.service';

describe('experience aggregate helpers', () => {
  test('builds an aggregate envelope with ok, empty, and error sections', () => {
    const response = aggregateResponse(
      { recentDeckIds: [] },
      {
        classes: okSection(),
        recentDecks: emptySection(),
        trends: errorSection('Trend service unavailable', true),
      },
    );

    expect(response.data.recentDeckIds).toEqual([]);
    expect(Date.parse(response.meta.generatedAt)).not.toBeNaN();
    expect(response.meta.sections.classes.status).toBe('ok');
    expect(response.meta.sections.recentDecks.status).toBe('empty');
    expect(response.meta.sections.trends).toEqual({
      status: 'error',
      message: 'Trend service unavailable',
      retryable: true,
    });
  });

  test('throws when a required section fails', async () => {
    await expect(
      resolveSection({
        required: true,
        load: async () => {
          throw new Error('Required section failed');
        },
      }),
    ).rejects.toThrow('Required section failed');
  });

  test('returns fallback data and error meta when an optional section fails', async () => {
    const recentDecks = await resolveSection({
      load: async () => {
        throw new Error('Recent deck lookup failed');
      },
      fallback: [] as string[],
      retryable: false,
    });

    const response = aggregateResponse(
      { recentDeckIds: recentDecks.data },
      { recentDecks: recentDecks.meta },
    );

    expect(response.data.recentDeckIds).toEqual([]);
    expect(response.meta.sections.recentDecks).toEqual({
      status: 'error',
      message: 'Recent deck lookup failed',
      retryable: false,
    });
  });
});
