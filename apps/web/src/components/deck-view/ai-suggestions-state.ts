export type SuggestionIdentity = {
  sourceCardId: string;
  targetCardId: string;
};

export function suggestionKey(suggestion: SuggestionIdentity) {
  return `${suggestion.sourceCardId}:${suggestion.targetCardId}`;
}

export function selectedSuggestionsForAcceptance<T extends SuggestionIdentity>(
  suggestions: T[],
  selectedKeys: Set<string>,
) {
  return suggestions.filter((suggestion) => selectedKeys.has(suggestionKey(suggestion)));
}

export function createBatchAcceptanceController(
  onInFlightChange: (inFlight: boolean) => void,
) {
  let inFlight = false;

  return {
    isInFlight: () => inFlight,
    async acceptSelected<T extends SuggestionIdentity>(
      suggestions: T[],
      selectedKeys: Set<string>,
      acceptSuggestion: (suggestion: T) => Promise<void>,
    ) {
      if (inFlight) return false;

      const selected = selectedSuggestionsForAcceptance(suggestions, selectedKeys);
      if (selected.length === 0) return false;

      inFlight = true;
      onInFlightChange(true);
      try {
        for (const suggestion of selected) {
          await acceptSuggestion(suggestion);
        }
        return true;
      } finally {
        inFlight = false;
        onInFlightChange(false);
      }
    },
  };
}
