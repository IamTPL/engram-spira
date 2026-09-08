import { describe, expect, test } from 'bun:test';
import {
  createFsrsLiveService,
  type FsrsLiveRepository,
} from '../../../src/modules/study/fsrs-live.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CARD_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const RECEIVED_AT = new Date('2026-07-29T12:00:00.123Z');

function result(status: 'applied' | 'duplicate' = 'applied') {
  return {
    requestId: REQUEST_ID,
    cardId: CARD_ID,
    status,
    learningCycle: 1,
    sequence: 1,
    state: 'learning' as const,
    nextReviewAt: '2026-07-29T12:01:00.000Z',
    stability: 0.4,
    difficulty: 5.2,
    scheduledDays: 0,
  };
}

describe('FSRS live review service', () => {
  test('single review delegates to the canonical batch command with one captured clock instant', async () => {
    const calls: Parameters<FsrsLiveRepository['applyReviewBatch']>[0][] = [];
    let clockCalls = 0;
    const repository: FsrsLiveRepository = {
      async applyReviewBatch(input) {
        calls.push(input);
        return { results: [result()], applied: 1, duplicates: 0 };
      },
      async resetCards() {
        return 0;
      },
      async resetDeck() {
        return 0;
      },
      async rotateParameters() {
        throw new Error('not used');
      },
    };
    const service = createFsrsLiveService(repository, () => {
      clockCalls += 1;
      return new Date(RECEIVED_AT);
    });

    const actual = await service.reviewCard(
      USER_ID,
      {
        requestId: REQUEST_ID,
        cardId: CARD_ID,
        rating: 'good',
        reviewedAt: '2026-07-29T11:59:00.123Z',
      },
      420,
    );

    expect(actual).toEqual(result());
    expect(clockCalls).toBe(1);
    expect(calls).toEqual([
      {
        userId: USER_ID,
        timezoneOffsetMinutes: 420,
        commands: [
          {
            requestId: REQUEST_ID,
            cardId: CARD_ID,
            rating: 'good',
            reviewedAt: '2026-07-29T11:59:00.123Z',
            receivedAt: '2026-07-29T12:00:00.123Z',
            durationMs: null,
            origin: 'live',
          },
        ],
      },
    ]);
  });

  test('batch returns repository counts and preserves input result order', async () => {
    const secondRequest = '44444444-4444-4444-8444-444444444444';
    const repository: FsrsLiveRepository = {
      async applyReviewBatch() {
        return {
          results: [
            { ...result('duplicate'), status: 'duplicate' },
            { ...result(), requestId: secondRequest, sequence: 2 },
          ],
          applied: 1,
          duplicates: 1,
        };
      },
      async resetCards() {
        return 0;
      },
      async resetDeck() {
        return 0;
      },
      async rotateParameters() {
        throw new Error('not used');
      },
    };
    const service = createFsrsLiveService(repository, () => RECEIVED_AT);

    await expect(
      service.reviewBatch(
        USER_ID,
        [
          {
            requestId: REQUEST_ID,
            cardId: CARD_ID,
            rating: 'good',
            reviewedAt: '2026-07-29T11:59:00.123Z',
          },
          {
            requestId: secondRequest,
            cardId: CARD_ID,
            rating: 'hard',
            reviewedAt: '2026-07-29T12:00:00.123Z',
          },
        ],
        0,
      ),
    ).resolves.toEqual({
      results: [
        result('duplicate'),
        { ...result(), requestId: secondRequest, sequence: 2 },
      ],
      applied: 1,
      duplicates: 1,
    });
  });

  test('reset wrappers use the canonical reset repository primitives', async () => {
    const calls: unknown[] = [];
    const repository: FsrsLiveRepository = {
      async applyReviewBatch() {
        return { results: [], applied: 0, duplicates: 0 };
      },
      async resetCards(userId, cardIds) {
        calls.push(['cards', userId, cardIds]);
        return 1;
      },
      async resetDeck(userId, deckId) {
        calls.push(['deck', userId, deckId]);
        return 3;
      },
      async rotateParameters() {
        throw new Error('not used');
      },
    };
    const service = createFsrsLiveService(repository, () => RECEIVED_AT);

    expect(await service.resetCard(USER_ID, CARD_ID)).toBe(1);
    expect(
      await service.resetDeck(
        USER_ID,
        '55555555-5555-4555-8555-555555555555',
      ),
    ).toBe(3);
    expect(calls).toEqual([
      ['cards', USER_ID, [CARD_ID]],
      [
        'deck',
        USER_ID,
        '55555555-5555-4555-8555-555555555555',
      ],
    ]);
  });

  test('parameter rotation delegates to the canonical repository primitive without touching review state', async () => {
    const calls: unknown[] = [];
    const repository = {
      async applyReviewBatch() {
        return { results: [], applied: 0, duplicates: 0 };
      },
      async resetCards() {
        return 0;
      },
      async resetDeck() {
        return 0;
      },
      async rotateParameters(userId: string, parameters: unknown) {
        calls.push([userId, parameters]);
        return {
          id: '66666666-6666-4666-8666-666666666666',
          revision: 2,
          status: 'created' as const,
          paramsHash: 'a'.repeat(64),
        };
      },
    };
    const live = createFsrsLiveService(repository, () => RECEIVED_AT);
    const parameters = { request_retention: 0.87 };

    await expect(
      live.rotateParameters(USER_ID, parameters),
    ).resolves.toEqual({
      id: '66666666-6666-4666-8666-666666666666',
      revision: 2,
      status: 'created',
      paramsHash: 'a'.repeat(64),
    });
    expect(calls).toEqual([[USER_ID, parameters]]);
  });

  test('parameter rotation canonicalizes the user UUID and rejects malformed IDs before repository access', async () => {
    const calls: unknown[] = [];
    const repository: FsrsLiveRepository = {
      async applyReviewBatch() {
        return { results: [], applied: 0, duplicates: 0 };
      },
      async resetCards() {
        return 0;
      },
      async resetDeck() {
        return 0;
      },
      async rotateParameters(userId, parameters) {
        calls.push([userId, parameters]);
        return {
          id: '66666666-6666-4666-8666-666666666666',
          revision: 2,
          status: 'active',
          paramsHash: 'a'.repeat(64),
        };
      },
    };
    const live = createFsrsLiveService(repository, () => RECEIVED_AT);
    const parameters = { request_retention: 0.87 };

    await live.rotateParameters(USER_ID.toUpperCase(), parameters);
    await expect(
      live.rotateParameters('not-a-uuid', parameters),
    ).rejects.toThrow('valid UUID');
    expect(calls).toEqual([[USER_ID, parameters]]);
  });

  test('reset canonicalizes uppercase UUIDs and rejects malformed IDs before repository access', async () => {
    const calls: unknown[] = [];
    const repository: FsrsLiveRepository = {
      async applyReviewBatch() {
        return { results: [], applied: 0, duplicates: 0 };
      },
      async resetCards(userId, cardIds) {
        calls.push(['cards', userId, cardIds]);
        return 1;
      },
      async resetDeck(userId, deckId) {
        calls.push(['deck', userId, deckId]);
        return 1;
      },
      async rotateParameters() {
        throw new Error('not used');
      },
    };
    const live = createFsrsLiveService(repository, () => RECEIVED_AT);
    const deckId = '55555555-5555-4555-8555-555555555555';

    await live.resetCard(USER_ID.toUpperCase(), CARD_ID.toUpperCase());
    await live.resetDeck(USER_ID.toUpperCase(), deckId.toUpperCase());
    await expect(live.resetCard(USER_ID, 'not-a-uuid')).rejects.toThrow(
      'valid UUID',
    );
    await expect(live.resetDeck('not-a-uuid', deckId)).rejects.toThrow(
      'valid UUID',
    );
    expect(calls).toEqual([
      ['cards', USER_ID, [CARD_ID]],
      ['deck', USER_ID, deckId],
    ]);
  });
});
