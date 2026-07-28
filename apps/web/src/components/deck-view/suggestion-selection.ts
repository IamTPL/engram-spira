export type BulkSelectionState = 'none' | 'partial' | 'all';

export function getBulkSelectionState(
  itemIds: string[],
  selectedIds: Set<string>,
): BulkSelectionState {
  const currentIds = new Set(itemIds);
  if (currentIds.size === 0) return 'none';

  let selectedCount = 0;
  for (const id of currentIds) {
    if (selectedIds.has(id)) selectedCount++;
  }

  if (selectedCount === 0) return 'none';
  return selectedCount === currentIds.size ? 'all' : 'partial';
}

export function toggleAllSelection(
  itemIds: string[],
  selectedIds: Set<string>,
): Set<string> {
  if (getBulkSelectionState(itemIds, selectedIds) === 'all') {
    return new Set();
  }

  return new Set(itemIds);
}
