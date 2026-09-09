import { describe, test, expect } from 'bun:test';
import { cosineSimilarity } from '../../src/shared/embedding-utils';

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
