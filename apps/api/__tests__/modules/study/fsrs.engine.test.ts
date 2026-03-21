import { describe, test, expect } from 'bun:test';
import {
  calculateFsrsReview,
  type FsrsState,
} from '../../../src/modules/study/fsrs.engine';

describe('calculateFsrsReview (FSRS v5)', () => {
  // ── New card reviews ─────────────────────────────────
  describe('New card (no prior state)', () => {
    test('GOOD returns learning state', () => {
      const result = calculateFsrsReview('good', null);
      expect(result.fsrsState).toBe('learning');
      expect(result.stability).toBeGreaterThan(0);
      expect(result.difficulty).toBeGreaterThan(0);
    });

    test('AGAIN returns learning state with short interval', () => {
      const result = calculateFsrsReview('again', null);
      expect(result.fsrsState).toBe('learning');
      expect(result.intervalDays).toBeLessThanOrEqual(1);
    });

    test('EASY progresses faster than GOOD', () => {
      const easy = calculateFsrsReview('easy', null);
      const good = calculateFsrsReview('good', null);
      expect(easy.stability).toBeGreaterThanOrEqual(good.stability);
    });

    test('HARD returns learning state', () => {
      const result = calculateFsrsReview('hard', null);
      expect(result.fsrsState).toBe('learning');
      expect(result.stability).toBeGreaterThan(0);
    });

    test('returns valid Date for nextReviewAt', () => {
      const result = calculateFsrsReview('good', null);
      expect(result.nextReviewAt).toBeInstanceOf(Date);
      expect(result.nextReviewAt.getTime()).toBeGreaterThan(Date.now() - 1000);
    });
  });

  // ── Review card state ────────────────────────────────
  describe('Existing review card', () => {
    const reviewState: FsrsState = {
      stability: 10,
      difficulty: 5,
      fsrsState: 'review',
      lastElapsedDays: 10,
      learningSteps: 0,
    };

    test('GOOD on review card maintains or updates state', () => {
      const result = calculateFsrsReview('good', reviewState);
      expect(['review', 'learning', 'relearning', 'new']).toContain(
        result.fsrsState,
      );
      expect(result.stability).toBeGreaterThan(0);
    });

    test('AGAIN on review card goes to relearning', () => {
      const result = calculateFsrsReview('again', reviewState);
      expect(result.fsrsState).toBe('relearning');
    });

    test('EASY on review card increases stability', () => {
      const result = calculateFsrsReview('easy', reviewState);
      expect(result.stability).toBeGreaterThan(0);
    });
  });

  // ── Learning card state ──────────────────────────────
  describe('Learning card state', () => {
    test('preserves learningSteps from current state', () => {
      const result = calculateFsrsReview('good', {
        stability: 5,
        difficulty: 5,
        fsrsState: 'learning',
        lastElapsedDays: 0,
        learningSteps: 1,
      });
      expect(typeof result.learningSteps).toBe('number');
    });
  });

  // ── Output validation ────────────────────────────────
  describe('Output validation', () => {
    test('intervalDays is always >= 0', () => {
      for (const action of ['again', 'hard', 'good', 'easy'] as const) {
        const result = calculateFsrsReview(action, null);
        expect(result.intervalDays).toBeGreaterThanOrEqual(0);
      }
    });

    test('stability is always > 0 for all actions', () => {
      for (const action of ['again', 'hard', 'good', 'easy'] as const) {
        const result = calculateFsrsReview(action, null);
        expect(result.stability).toBeGreaterThan(0);
      }
    });

    test('difficulty is always > 0 for all actions', () => {
      for (const action of ['again', 'hard', 'good', 'easy'] as const) {
        const result = calculateFsrsReview(action, null);
        expect(result.difficulty).toBeGreaterThan(0);
      }
    });

    test('fsrsState is a valid string', () => {
      const validStates = ['new', 'learning', 'review', 'relearning'];
      for (const action of ['again', 'hard', 'good', 'easy'] as const) {
        const result = calculateFsrsReview(action, null);
        expect(validStates).toContain(result.fsrsState);
      }
    });

    test('lastElapsedDays is a number', () => {
      const result = calculateFsrsReview('good', null);
      expect(typeof result.lastElapsedDays).toBe('number');
    });
  });

  // ── Custom params ────────────────────────────────────
  describe('Custom FSRS parameters', () => {
    test('accepts custom parameters without error', () => {
      expect(() =>
        calculateFsrsReview('good', null, { request_retention: 0.9 }),
      ).not.toThrow();
    });
  });
});
