import { describe, expect, test } from 'bun:test';
import { getFocusTickDelay } from './focus.store';

describe('getFocusTickDelay', () => {
  test('aligns the next update to the visible second boundary', () => {
    expect(getFocusTickDelay(10_000, 10)).toBe(1000);
    expect(getFocusTickDelay(9501, 10)).toBe(501);
    expect(getFocusTickDelay(9000, 9)).toBe(1000);
  });

  test('never schedules a zero-delay loop near a boundary', () => {
    expect(getFocusTickDelay(9000.5, 10)).toBe(1);
  });
});
