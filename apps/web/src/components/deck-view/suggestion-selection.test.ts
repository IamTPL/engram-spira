import { describe, expect, test } from 'bun:test';
import {
  getBulkSelectionState,
  toggleAllSelection,
} from './suggestion-selection';

describe('suggestion bulk selection', () => {
  test('derives none, partial, and all from current items only', () => {
    // Catches a master checkbox that treats stale or absent selections as visible items.
    expect(getBulkSelectionState([], new Set())).toBe('none');
    expect(getBulkSelectionState(['a', 'b'], new Set(['a']))).toBe('partial');
    expect(getBulkSelectionState(['a', 'b'], new Set(['a', 'b']))).toBe('all');
    expect(getBulkSelectionState(['a'], new Set(['stale']))).toBe('none');
  });

  test('selects every current item from a partial selection', () => {
    // Catches an indeterminate master control that clears selection instead of selecting all.
    expect(toggleAllSelection(['a', 'b'], new Set(['a']))).toEqual(
      new Set(['a', 'b']),
    );
  });

  test('clears every current item from a complete selection', () => {
    // Catches a checked master control that cannot clear its selection.
    expect(toggleAllSelection(['a', 'b'], new Set(['a', 'b']))).toEqual(
      new Set(),
    );
  });
});
