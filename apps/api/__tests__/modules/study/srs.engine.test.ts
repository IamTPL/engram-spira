import { describe, test, expect } from 'bun:test';
import {
  calculateNextReview,
  dispatchReview,
} from '../../../src/modules/study/srs.engine';

describe('calculateNextReview (SM-2)', () => {
  // ── AGAIN ──────────────────────────────────────────────
  describe('AGAIN action', () => {
    test('resets boxLevel to 0', () => {
      const result = calculateNextReview('again', {
        boxLevel: 3,
        easeFactor: 2.5,
        intervalDays: 15,
      });
      expect(result.boxLevel).toBe(0);
    });

    test('sets intervalDays to 0', () => {
      const result = calculateNextReview('again', {
        boxLevel: 1,
        easeFactor: 2.5,
        intervalDays: 6,
      });
      expect(result.intervalDays).toBe(0);
    });

    test('penalizes easeFactor by -0.2', () => {
      const result = calculateNextReview('again', { easeFactor: 2.5 });
      expect(result.easeFactor).toBe(2.3);
    });

    test('easeFactor cannot go below 1.3', () => {
      const result = calculateNextReview('again', { easeFactor: 1.3 });
      expect(result.easeFactor).toBe(1.3);
    });

    test('easeFactor clamps at 1.3 when already below threshold', () => {
      const result = calculateNextReview('again', { easeFactor: 1.4 });
      expect(result.easeFactor).toBe(1.3); // 1.4 - 0.2 = 1.2 → clamped to 1.3
    });

    test('nextReviewAt is ~10 minutes later', () => {
      const before = Date.now();
      const result = calculateNextReview('again', {});
      const tenMinMs = 10 * 60 * 1000;
      const diff = result.nextReviewAt.getTime() - before;
      expect(diff).toBeGreaterThanOrEqual(tenMinMs - 200);
      expect(diff).toBeLessThanOrEqual(tenMinMs + 200);
    });
  });

  // ── HARD ───────────────────────────────────────────────
  describe('HARD action', () => {
    test('graduates new card to boxLevel 1', () => {
      const result = calculateNextReview('hard', { boxLevel: 0 });
      expect(result.boxLevel).toBe(1);
    });

    test('first interval is 1 day for new card', () => {
      const result = calculateNextReview('hard', { boxLevel: 0 });
      expect(result.intervalDays).toBe(1);
    });

    test('penalizes easeFactor by -0.15', () => {
      const result = calculateNextReview('hard', { easeFactor: 2.5 });
      expect(result.easeFactor).toBe(2.35);
    });

    test('interval grows slowly (max(interval+1, interval*1.2))', () => {
      const result = calculateNextReview('hard', {
        boxLevel: 2,
        easeFactor: 2.5,
        intervalDays: 6,
      });
      // max(6+1, round(6*1.2)) = max(7, 7) = 7
      expect(result.intervalDays).toBe(7);
    });

    test('does not decrement boxLevel', () => {
      const result = calculateNextReview('hard', { boxLevel: 3 });
      expect(result.boxLevel).toBe(3);
    });
  });

  // ── GOOD ───────────────────────────────────────────────
  describe('GOOD action', () => {
    test('first GOOD gives 1 day interval', () => {
      const result = calculateNextReview('good', { boxLevel: 0 });
      expect(result.boxLevel).toBe(1);
      expect(result.intervalDays).toBe(1);
    });

    test('second GOOD gives 6 day interval', () => {
      const result = calculateNextReview('good', {
        boxLevel: 1,
        easeFactor: 2.5,
        intervalDays: 1,
      });
      expect(result.boxLevel).toBe(2);
      expect(result.intervalDays).toBe(6);
    });

    test('third+ GOOD multiplies interval by easeFactor', () => {
      const result = calculateNextReview('good', {
        boxLevel: 2,
        easeFactor: 2.5,
        intervalDays: 6,
      });
      expect(result.boxLevel).toBe(3);
      expect(result.intervalDays).toBe(15); // round(6 * 2.5)
    });

    test('easeFactor is unchanged on GOOD', () => {
      const result = calculateNextReview('good', { easeFactor: 2.3 });
      expect(result.easeFactor).toBe(2.3);
    });

    test('nextReviewAt matches intervalDays', () => {
      const before = Date.now();
      const result = calculateNextReview('good', {
        boxLevel: 0,
        easeFactor: 2.5,
      });
      const oneDayMs = 1 * 24 * 60 * 60 * 1000;
      const diff = result.nextReviewAt.getTime() - before;
      expect(diff).toBeGreaterThanOrEqual(oneDayMs - 200);
      expect(diff).toBeLessThanOrEqual(oneDayMs + 200);
    });
  });

  // ── EASY ───────────────────────────────────────────────
  describe('EASY action', () => {
    test('boosts easeFactor by +0.15', () => {
      const result = calculateNextReview('easy', { easeFactor: 2.5 });
      expect(result.easeFactor).toBe(2.65);
    });

    test('first EASY gives 4 day interval', () => {
      const result = calculateNextReview('easy', {
        boxLevel: 0,
        easeFactor: 2.5,
      });
      expect(result.intervalDays).toBe(4);
    });

    test('second EASY factors in bonus', () => {
      const result = calculateNextReview('easy', {
        boxLevel: 1,
        easeFactor: 2.5,
        intervalDays: 1,
      });
      // round(6 * 1.3) = 8
      expect(result.intervalDays).toBe(8);
    });

    test('third+ EASY applies both EF and bonus', () => {
      const result = calculateNextReview('easy', {
        boxLevel: 2,
        easeFactor: 2.5,
        intervalDays: 6,
      });
      // newEf = 2.65, round(6 * 2.65 * 1.3) = round(20.67) = 21
      expect(result.intervalDays).toBe(21);
    });
  });

  // ── Edge cases ─────────────────────────────────────────
  describe('Edge cases', () => {
    test('default state when current is empty', () => {
      const result = calculateNextReview('good');
      expect(result.boxLevel).toBe(1);
      expect(result.intervalDays).toBe(1);
      expect(result.easeFactor).toBe(2.5);
    });

    test('invalid action throws', () => {
      expect(() => calculateNextReview('invalid' as any, {})).toThrow(
        'Invalid review action',
      );
    });

    test('nextReviewAt is always a valid Date', () => {
      for (const action of ['again', 'hard', 'good', 'easy'] as const) {
        const result = calculateNextReview(action, {});
        expect(result.nextReviewAt).toBeInstanceOf(Date);
        expect(result.nextReviewAt.getTime()).toBeGreaterThan(0);
      }
    });
  });
});

describe('dispatchReview', () => {
  test('dispatches to SM-2 when algorithm is sm2', () => {
    const result = dispatchReview(
      'sm2',
      'good',
      { boxLevel: 0, easeFactor: 2.5, intervalDays: 1 },
      null,
    );
    expect(result.type).toBe('sm2');
    expect(result.result).toHaveProperty('boxLevel');
  });

  test('dispatches to FSRS when algorithm is fsrs', () => {
    const result = dispatchReview('fsrs', 'good', {}, null);
    expect(result.type).toBe('fsrs');
    expect(result.result).toHaveProperty('stability');
  });

  test('SM-2 result matches calculateNextReview', () => {
    const state = { boxLevel: 1, easeFactor: 2.5, intervalDays: 1 };
    const dispatched = dispatchReview('sm2', 'good', state, null);
    const direct = calculateNextReview('good', state);
    expect(dispatched.type).toBe('sm2');
    if (dispatched.type === 'sm2') {
      expect(dispatched.result.boxLevel).toBe(direct.boxLevel);
      expect(dispatched.result.intervalDays).toBe(direct.intervalDays);
    }
  });
});
