import type { RelationType } from './knowledge-graph-state';

export type KnowledgeGraphRunStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'stale';

export interface KnowledgeGraphRunRequest {
  deckId: string;
  runId: string;
  sequence: number;
}

export type KnowledgeGraphReviewQueueState =
  | 'disabled'
  | 'loading'
  | 'error'
  | 'empty'
  | 'ready';

const TERMINAL_RUN_STATUSES = new Set<KnowledgeGraphRunStatus>([
  'completed',
  'partial',
  'failed',
  'cancelled',
  'stale',
]);

const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  synonym: 'Synonym',
  antonym: 'Antonym',
  is_a: 'Is a',
  part_of: 'Part of',
  derived_from: 'Derived from',
  collocation: 'Collocation',
  confused_with: 'Often confused',
  translation_of: 'Translation',
  coordinate: 'Related kind',
};

export function isKnowledgeGraphRunTerminal(
  status: KnowledgeGraphRunStatus,
): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export function shouldPollKnowledgeGraphRun(
  status: KnowledgeGraphRunStatus | undefined,
): boolean {
  return status === 'queued' || status === 'processing';
}

export function toggleSuggestionSelection(
  current: Set<string>,
  suggestionId: string,
  selected: boolean,
): Set<string> {
  const next = new Set(current);
  if (selected) next.add(suggestionId);
  else next.delete(suggestionId);
  return next;
}

export function relationTypeLabel(type: RelationType): string {
  return RELATION_TYPE_LABELS[type];
}

export function createKnowledgeGraphRunRequest(
  current: KnowledgeGraphRunRequest | undefined,
  deckId: string,
  runId: string,
): KnowledgeGraphRunRequest {
  return {
    deckId,
    runId,
    sequence: (current?.sequence ?? 0) + 1,
  };
}

export function resolveRunIdForDeck(
  currentDeckId: string,
  currentRunId: string,
  nextDeckId: string,
  storedRunId: string,
): string {
  return currentDeckId === nextDeckId ? currentRunId : storedRunId;
}

export function knowledgeGraphReviewQueueState(input: {
  enabled: boolean;
  loading: boolean;
  error: boolean;
  itemCount: number;
}): KnowledgeGraphReviewQueueState {
  if (!input.enabled) return 'disabled';
  if (input.loading) return 'loading';
  if (input.error) return 'error';
  return input.itemCount > 0 ? 'ready' : 'empty';
}

export function summarizeSuggestionReview(
  attempted: number,
  accepted: number,
): { accepted: number; failed: number } {
  return {
    accepted,
    failed: Math.max(0, attempted - accepted),
  };
}

export function nextSuggestionFocusId(
  suggestionIds: string[],
  removedId: string,
): string | null {
  const removedIndex = suggestionIds.indexOf(removedId);
  if (removedIndex < 0) return suggestionIds[0] ?? null;
  return suggestionIds[removedIndex + 1] ?? suggestionIds[removedIndex - 1] ?? null;
}
