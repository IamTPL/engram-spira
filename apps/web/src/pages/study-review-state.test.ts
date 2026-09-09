import { describe, expect, test } from 'bun:test';
import { applyReviewedCards, buildReviewItem, describeCardProgress } from './study-review-state';

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

  test('never lets rounding print the next unit under the wrong label', () => {
    const at = (ms: number, stability: number) =>
      describeCardProgress(
        {
          state: 'review',
          stability,
          reps: 3,
          lastReviewedAt: new Date(now.getTime() - ms).toISOString(),
        },
        now,
      ).detail;
    const MINUTE = 60_000;
    const HOUR = 60 * MINUTE;
    expect(at(59.7 * MINUTE, 59.4 / (24 * 60))).toBe('Last seen 59 min ago · 3 reviews · stability 59 min');
    expect(at(59.7 * MINUTE, 59.7 / (24 * 60))).toBe('Last seen 59 min ago · 3 reviews · stability 1 h');
    expect(at(60.5 * MINUTE, 60.5 / (24 * 60))).toBe('Last seen 1 h ago · 3 reviews · stability 1 h');
    expect(at(47.8 * HOUR, 0.97)).toBe('Last seen 47 h ago · 3 reviews · stability 23 h');
    expect(at(47.8 * HOUR, 0.999)).toBe('Last seen 47 h ago · 3 reviews · stability 1 d');
    expect(at(48 * HOUR, 1.9)).toBe('Last seen 2 days ago · 3 reviews · stability 2 d');
  });

  test('treats a future or unparseable last-review instant as just now instead of NaN', () => {
    const base = { state: 'review' as const, stability: 3, reps: 1 };
    expect(
      describeCardProgress({ ...base, lastReviewedAt: '2026-09-09T12:05:00.000Z' }, now).detail,
    ).toBe('Last seen just now · 1 review · stability 3 d');
    expect(
      describeCardProgress({ ...base, lastReviewedAt: 'not-a-date' }, now).detail,
    ).toBe('Last seen just now · 1 review · stability 3 d');
  });
});
