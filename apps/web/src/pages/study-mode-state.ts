export type StudyDeckMode = 'due' | 'all';

export function isStudyCluster(cardIds?: string): boolean {
  return Boolean(cardIds?.trim());
}

export function buildStudyDeckQuery(
  mode: StudyDeckMode,
  cardIds?: string,
): { mode?: 'all'; cardIds?: string } {
  const normalizedCardIds = cardIds?.trim();
  if (normalizedCardIds) {
    return {
      mode: 'all',
      cardIds: normalizedCardIds,
    };
  }
  return mode === 'all' ? { mode: 'all' } : {};
}
