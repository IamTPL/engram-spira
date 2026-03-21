import { describe, test, expect } from 'bun:test';
import {
  cosineSimilarity,
  computeRetention,
} from '../../src/shared/embedding-utils';

describe('cosineSimilarity', () => {
  test('identical vectors return 1', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  test('orthogonal vectors return 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  test('opposite vectors return -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  test('zero vectors return 0 (no division by zero)', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  test('similar vectors return high value', () => {
    const sim = cosineSimilarity([1, 2, 3], [1, 2, 4]);
    expect(sim).toBeGreaterThan(0.9);
    expect(sim).toBeLessThan(1);
  });

  test('single element vectors', () => {
    expect(cosineSimilarity([3], [3])).toBeCloseTo(1, 5);
    expect(cosineSimilarity([3], [-3])).toBeCloseTo(-1, 5);
  });

  test('high-dimensional vectors', () => {
    const a = new Array(768).fill(0.1);
    const b = new Array(768).fill(0.1);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });
});

describe('computeRetention', () => {
  test('retention = 1 when daysSinceReview = 0', () => {
    expect(computeRetention(10, 5, 2.5, 0)).toBeCloseTo(1, 5);
  });

  test('retention decreases over time', () => {
    const r1 = computeRetention(10, 5, 2.5, 1);
    const r5 = computeRetention(10, 5, 2.5, 5);
    const r10 = computeRetention(10, 5, 2.5, 10);
    expect(r1).toBeGreaterThan(r5);
    expect(r5).toBeGreaterThan(r10);
  });

  test('higher stability = slower decay', () => {
    const lowStability = computeRetention(2, 5, 2.5, 5);
    const highStability = computeRetention(20, 5, 2.5, 5);
    expect(highStability).toBeGreaterThan(lowStability);
  });

  test('uses SM-2 approximation when stability is null', () => {
    // S = max(1, intervalDays * (easeFactor / 2.5)) = max(1, 5 * 1) = 5
    const r = computeRetention(null, 5, 2.5, 5);
    expect(r).toBeCloseTo(Math.exp(-1), 5); // e^(-5/5)
  });

  test('SM-2 fallback clamps S to at least 1', () => {
    const r = computeRetention(null, 0, 2.5, 1);
    expect(r).toBeCloseTo(Math.exp(-1), 5); // S = max(1, 0) = 1
  });

  test('uses FSRS stability when > 0', () => {
    const r = computeRetention(10, 5, 2.5, 10);
    expect(r).toBeCloseTo(Math.exp(-10 / 10), 5); // e^(-1)
  });

  test('stability = 0 falls back to SM-2 approximation', () => {
    const r = computeRetention(0, 5, 2.5, 5);
    expect(r).toBeCloseTo(Math.exp(-1), 5);
  });

  test('retention is always between 0 and 1 for positive inputs', () => {
    for (const days of [0, 1, 5, 10, 50, 100, 365]) {
      const r = computeRetention(10, 5, 2.5, days);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});
