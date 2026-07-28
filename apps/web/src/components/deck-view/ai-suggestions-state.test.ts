import { describe, expect, test } from 'bun:test';
import {
  createBatchAcceptanceController,
  selectedSuggestionsForAcceptance,
  type SuggestionIdentity,
} from './ai-suggestions-state';

const suggestions: SuggestionIdentity[] = [
  { sourceCardId: 'alpha', targetCardId: 'beta' },
  { sourceCardId: 'beta', targetCardId: 'gamma' },
];

describe('suggestion acceptance selection', () => {
  test('returns only explicitly checked suggestions for batch acceptance', () => {
    // Catches a batch action that accepts every detected suggestion.
    expect(
      selectedSuggestionsForAcceptance(
        suggestions,
        new Set(['alpha:beta']),
      ),
    ).toEqual([{ sourceCardId: 'alpha', targetCardId: 'beta' }]);
  });

  test('returns no suggestions when nothing is checked', () => {
    // Catches a hidden Accept All fallback when a batch has no selection.
    expect(selectedSuggestionsForAcceptance(suggestions, new Set())).toEqual([]);
  });

  test('holds its guard through a sequential batch and rejects competing starts', async () => {
    // Catches a later checked item being accepted after the user changes selection mid-batch.
    let releaseFirst!: () => void;
    const firstAcceptance = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const states: boolean[] = [];
    const accepted: string[] = [];
    const controller = createBatchAcceptanceController((inFlight) => {
      states.push(inFlight);
    });

    const batch = controller.acceptSelected(
      suggestions,
      new Set(['alpha:beta', 'beta:gamma']),
      async (suggestion) => {
        accepted.push(`${suggestion.sourceCardId}:${suggestion.targetCardId}`);
        if (suggestion.sourceCardId === 'alpha') await firstAcceptance;
      },
    );

    await Promise.resolve();

    expect(controller.isInFlight()).toBe(true);
    expect(accepted).toEqual(['alpha:beta']);
    expect(
      await controller.acceptSelected(
        suggestions,
        new Set(['alpha:beta', 'beta:gamma']),
        async () => {},
      ),
    ).toBe(false);

    releaseFirst();
    expect(await batch).toBe(true);
    expect(accepted).toEqual(['alpha:beta', 'beta:gamma']);
    expect(controller.isInFlight()).toBe(false);
    expect(states).toEqual([true, false]);
  });

  test('releases its guard when a batch acceptance fails', async () => {
    // Catches permanently disabled controls after a failed relationship request.
    const states: boolean[] = [];
    const controller = createBatchAcceptanceController((inFlight) => {
      states.push(inFlight);
    });

    await expect(
      controller.acceptSelected(
        suggestions,
        new Set(['alpha:beta']),
        async () => {
          throw new Error('network unavailable');
        },
      ),
    ).rejects.toThrow('network unavailable');

    expect(controller.isInFlight()).toBe(false);
    expect(states).toEqual([true, false]);
  });
});
