import { describe, expect, test } from 'bun:test';
import { buildSortOrderAssignments } from '../../src/shared/reorder';

describe('buildSortOrderAssignments', () => {
  test('places requested items first and keeps omitted items in existing order', () => {
    expect(
      buildSortOrderAssignments(
        [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
        ['c', 'a'],
      ),
    ).toEqual([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
      { id: 'c', sortOrder: 0 },
      { id: 'd', sortOrder: 3 },
    ]);
  });

  test('preserves the existing last-occurrence behavior for duplicate IDs', () => {
    expect(
      buildSortOrderAssignments(
        [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        ['b', 'a', 'b'],
      ),
    ).toEqual([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
      { id: 'c', sortOrder: 3 },
    ]);
  });
});
