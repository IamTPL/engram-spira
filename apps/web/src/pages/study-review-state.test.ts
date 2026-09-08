import { describe, expect, test } from 'bun:test';
import { buildReviewItem } from './study-review-state';

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
