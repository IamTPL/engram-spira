import { describe, expect, test } from 'bun:test';
import { applyReviewedCards, buildReviewItem } from './study-review-state';

const CARD = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';

describe('buildReviewItem', () => {
  test('captures the grading instant and duration since the card was shown', () => {
    const now = new Date('2026-09-08T10:00:05.250Z');
    expect(buildReviewItem(CARD, 'easy', now.getTime() - 4250, now, REQUEST)).toEqual({
      requestId: REQUEST,
      cardId: CARD,
      rating: 'easy',
      reviewedAt: '2026-09-08T10:00:05.250Z',
      durationMs: 4250,
    });
  });

  test('omits durationMs when the card had no shown timestamp or the clock went backwards', () => {
    const now = new Date('2026-09-08T10:00:05.250Z');
    expect(buildReviewItem(CARD, 'good', null, now, REQUEST).durationMs).toBeUndefined();
    expect(
      buildReviewItem(CARD, 'good', now.getTime() + 1000, now, REQUEST).durationMs,
    ).toBeUndefined();
  });

  test('generates a fresh v4 requestId per item by default', () => {
    const a = buildReviewItem(CARD, 'again', null);
    const b = buildReviewItem(CARD, 'again', null);
    expect(a.requestId).not.toBe(b.requestId);
    expect(a.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });
});

describe('applyReviewedCards', () => {
  test('decrements the matching deck and drops it at zero', () => {
    const decks = [{ deckId: 'a', dueCount: 3 }, { deckId: 'b', dueCount: 1 }];
    expect(applyReviewedCards(decks, 'a', 2)).toEqual([{ deckId: 'a', dueCount: 1 }, { deckId: 'b', dueCount: 1 }]);
    expect(applyReviewedCards(decks, 'b', 5)).toEqual([{ deckId: 'a', dueCount: 3 }]);
    expect(applyReviewedCards(decks, 'zzz', 1)).toEqual(decks);
  });
});

import { describeCardProgress } from './study-review-state';

describe('describeCardProgress', () => {
  const now = new Date('2026-09-09T12:00:00.000Z');

  test('describes a New card without history', () => {
    expect(describeCardProgress(null, now)).toEqual({ label: 'New', detail: null });
  });

  test('describes a review card with last-seen age, review count and stability', () => {
    expect(
      describeCardProgress(
        {
          state: 'review',
          stability: 13.046,
          reps: 2,
          lastReviewedAt: '2026-06-27T13:24:39.027Z',
        },
        now,
      ),
    ).toEqual({
      label: 'Review',
      detail: 'Last seen 74 days ago · 2 reviews · stability 13 d',
    });
  });

  test('uses hours and minutes for young learning cards', () => {
    expect(
      describeCardProgress(
        {
          state: 'learning',
          stability: 0.0104,
          reps: 1,
          lastReviewedAt: '2026-09-09T11:57:00.000Z',
        },
        now,
      ),
    ).toEqual({
      label: 'Learning',
      detail: 'Last seen 3 min ago · 1 review · stability 15 min',
    });
    expect(
      describeCardProgress(
        {
          state: 'relearning',
          stability: 0.5,
          reps: 4,
          lastReviewedAt: '2026-09-09T06:00:00.000Z',
        },
        now,
      ).detail,
    ).toBe('Last seen 6 h ago · 4 reviews · stability 12 h');
  });
});
