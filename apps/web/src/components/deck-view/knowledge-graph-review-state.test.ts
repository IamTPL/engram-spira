import { describe, expect, test } from 'bun:test';

import {
  createKnowledgeGraphRunRequest,
  isKnowledgeGraphRunTerminal,
  knowledgeGraphReviewQueueState,
  nextSuggestionFocusId,
  relationTypeLabel,
  resolveRunIdForDeck,
  shouldPollKnowledgeGraphRun,
  summarizeSuggestionReview,
  toggleSuggestionSelection,
} from './knowledge-graph-review-state';

describe('knowledge graph review state', () => {
  test('polls only queued and processing runs', () => {
    expect(shouldPollKnowledgeGraphRun('queued')).toBe(true);
    expect(shouldPollKnowledgeGraphRun('processing')).toBe(true);
    expect(shouldPollKnowledgeGraphRun('partial')).toBe(false);
    expect(shouldPollKnowledgeGraphRun('failed')).toBe(false);
  });

  test('recognizes every terminal state', () => {
    expect(isKnowledgeGraphRunTerminal('completed')).toBe(true);
    expect(isKnowledgeGraphRunTerminal('partial')).toBe(true);
    expect(isKnowledgeGraphRunTerminal('failed')).toBe(true);
    expect(isKnowledgeGraphRunTerminal('cancelled')).toBe(true);
    expect(isKnowledgeGraphRunTerminal('stale')).toBe(true);
    expect(isKnowledgeGraphRunTerminal('queued')).toBe(false);
  });

  test('updates suggestion selection without mutating the previous set', () => {
    const current = new Set(['a']);
    const selected = toggleSuggestionSelection(current, 'b', true);
    const deselected = toggleSuggestionSelection(selected, 'a', false);

    expect([...current]).toEqual(['a']);
    expect([...selected]).toEqual(['a', 'b']);
    expect([...deselected]).toEqual(['b']);
  });

  test('presents taxonomy names as readable labels', () => {
    expect(relationTypeLabel('translation_of')).toBe('Translation');
    expect(relationTypeLabel('confused_with')).toBe('Often confused');
    expect(relationTypeLabel('is_a')).toBe('Is a');
  });

  test('creates a new handoff token even when an expansion run is reused', () => {
    const first = createKnowledgeGraphRunRequest(undefined, 'deck-a', 'run-a');
    const reused = createKnowledgeGraphRunRequest(first, 'deck-a', 'run-a');

    expect(first).toEqual({
      deckId: 'deck-a',
      runId: 'run-a',
      sequence: 1,
    });
    expect(reused).toEqual({
      deckId: 'deck-a',
      runId: 'run-a',
      sequence: 2,
    });
  });

  test('loads the stored run for a newly selected deck', () => {
    expect(
      resolveRunIdForDeck('deck-a', 'run-a', 'deck-b', 'run-b'),
    ).toBe('run-b');
    expect(
      resolveRunIdForDeck('deck-a', 'run-a', 'deck-a', 'ignored'),
    ).toBe('run-a');
  });

  test('never presents a failed suggestion request as an empty queue', () => {
    expect(
      knowledgeGraphReviewQueueState({
        enabled: true,
        loading: false,
        error: true,
        itemCount: 0,
      }),
    ).toBe('error');
    expect(
      knowledgeGraphReviewQueueState({
        enabled: true,
        loading: false,
        error: false,
        itemCount: 0,
      }),
    ).toBe('empty');
  });

  test('reports partial bulk-review failures and keeps a deterministic focus target', () => {
    expect(summarizeSuggestionReview(5, 3)).toEqual({
      accepted: 3,
      failed: 2,
    });
    expect(nextSuggestionFocusId(['a', 'b', 'c'], 'b')).toBe('c');
    expect(nextSuggestionFocusId(['a', 'b', 'c'], 'c')).toBe('b');
    expect(nextSuggestionFocusId(['only'], 'only')).toBeNull();
  });
});
