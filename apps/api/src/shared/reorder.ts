export type SortOrderAssignment = {
  id: string;
  sortOrder: number;
};

export const REORDER_UPDATE_BATCH_SIZE = 1_000;

/**
 * Preserve the repository's reorder semantics:
 * - requested IDs use their last position when duplicated;
 * - omitted items follow in their existing order.
 */
export function buildSortOrderAssignments<T extends { id: string }>(
  existingItems: T[],
  requestedIds: string[],
): SortOrderAssignment[] {
  const requestedIndex = new Map(requestedIds.map((id, index) => [id, index]));
  let nextOrder = requestedIds.length;

  return existingItems.map((item) => ({
    id: item.id,
    sortOrder: requestedIndex.get(item.id) ?? nextOrder++,
  }));
}
