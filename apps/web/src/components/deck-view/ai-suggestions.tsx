import {
  type Component,
  Show,
  For,
  createMemo,
  createSignal,
} from 'solid-js';
import { api, getApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/stores/toast.store';
import { Sparkles, Loader2, Check, X, Link2 } from 'lucide-solid';
import { queryClient } from '@/lib/query-client';
import { Checkbox } from '@/components/ui/checkbox';
import {
  createBatchAcceptanceController,
  suggestionKey,
} from './ai-suggestions-state';
import {
  getBulkSelectionState,
  toggleAllSelection,
} from './suggestion-selection';

interface Suggestion {
  sourceCardId: string;
  targetCardId: string;
  sourceLabel: string;
  targetLabel: string;
  similarity: number;
  suggestedType: 'related';
  reason?: string;
}

interface AiSuggestionsProps {
  deckId: string;
}

const AiSuggestions: Component<AiSuggestionsProps> = (props) => {
  const [detecting, setDetecting] = createSignal(false);
  const [suggestions, setSuggestions] = createSignal<Suggestion[]>([]);
  const [detected, setDetected] = createSignal(false);
  const [accepting, setAccepting] = createSignal<string | null>(null);
  const [acceptingSelected, setAcceptingSelected] = createSignal(false);
  const [selectedSuggestionKeys, setSelectedSuggestionKeys] = createSignal<Set<string>>(
    new Set(),
  );
  const batchAcceptance = createBatchAcceptanceController((inFlight) => {
    setAcceptingSelected(inFlight);
  });
  const currentSuggestionKeys = createMemo(() =>
    suggestions().map(suggestionKey),
  );
  const selectionState = createMemo(() =>
    getBulkSelectionState(
      currentSuggestionKeys(),
      selectedSuggestionKeys(),
    ),
  );

  const handleDetect = async () => {
    setDetecting(true);
    setSuggestions([]);
    try {
      const { data, error } = await (api['knowledge-graph'] as any).ai.detect.post({
        deckId: props.deckId,
        threshold: 0.75,
      });
      if (error) throw new Error(getApiError(error));
      const result = data as { suggestions: Suggestion[] };
      setSuggestions(result.suggestions ?? []);
      setSelectedSuggestionKeys(new Set<string>());
      setDetected(true);
      if ((result.suggestions ?? []).length === 0) {
        toast.info('No new relationships detected');
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Detection failed');
    } finally {
      setDetecting(false);
    }
  };

  const handleAccept = async (suggestion: Suggestion) => {
    const key = `${suggestion.sourceCardId}:${suggestion.targetCardId}`;
    setAccepting(key);
    try {
      const { error } = await (api['knowledge-graph'] as any).links.post({
        sourceCardId: suggestion.sourceCardId,
        targetCardId: suggestion.targetCardId,
        linkType: 'related',
      });
      if (error) throw new Error(getApiError(error));
      setSuggestions((prev) =>
        prev.filter(
          (s) =>
            !(s.sourceCardId === suggestion.sourceCardId && s.targetCardId === suggestion.targetCardId),
        ),
      );
      setSelectedSuggestionKeys((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
      toast.success('Link created');
      // Refresh Knowledge Graph so new edges appear immediately
      queryClient.invalidateQueries({ queryKey: ['deck-graph'] });
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to create link');
    } finally {
      setAccepting(null);
    }
  };

  const handleDismiss = async (suggestion: Suggestion) => {
    // Persist dismissal so it doesn't reappear
    try {
      await (api['knowledge-graph'] as any).ai.dismiss.post({
        sourceCardId: suggestion.sourceCardId,
        targetCardId: suggestion.targetCardId,
      });
    } catch {
      // Best effort, still remove from UI.
    }
    setSuggestions((prev) =>
      prev.filter(
        (s) =>
          !(s.sourceCardId === suggestion.sourceCardId && s.targetCardId === suggestion.targetCardId),
      ),
    );
    setSelectedSuggestionKeys((previous) => {
      const next = new Set(previous);
      next.delete(suggestionKey(suggestion));
      return next;
    });
  };

  const handleAcceptSelected = async () => {
    await batchAcceptance.acceptSelected(
      suggestions(),
      selectedSuggestionKeys(),
      handleAccept,
    );
  };

  const toggleSuggestionSelection = (suggestion: Suggestion, checked: boolean) => {
    const key = suggestionKey(suggestion);
    setSelectedSuggestionKeys((previous) => {
      const next = new Set(previous);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  return (
    <section
      class="rounded-lg border bg-card p-4"
      aria-labelledby="relationship-suggestions-title"
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex items-start gap-2.5">
          <Sparkles class="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <div>
            <h3
              id="relationship-suggestions-title"
              class="text-sm font-semibold text-foreground"
            >
              Relationship suggestions
            </h3>
            <p class="mt-0.5 text-xs text-muted-foreground">
              Find useful links between concepts in this deck.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDetect}
          loading={detecting()}
          disabled={acceptingSelected() || accepting() !== null}
          class="w-full text-xs sm:w-auto"
        >
          <Show when={!detecting()}>
            <Sparkles class="h-3.5 w-3.5 text-info" />
          </Show>
          {detected() ? 'Detect again' : 'Detect links'}
        </Button>
      </div>

      <Show when={suggestions().length > 0}>
        <div class="mt-4 rounded-md border border-info/25 bg-info-surface p-3 motion-safe:animate-fade-in">
          <div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-2">
              <Link2 class="h-4 w-4 text-info" />
              <span class="text-sm font-semibold text-foreground">
                {suggestions().length} suggested relationship
                {suggestions().length !== 1 ? 's' : ''}
              </span>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Checkbox
                checked={selectionState() === 'all'}
                indeterminate={selectionState() === 'partial'}
                onChange={() =>
                  setSelectedSuggestionKeys((current) =>
                    toggleAllSelection(currentSuggestionKeys(), current),
                  )
                }
                disabled={
                  detecting() ||
                  acceptingSelected() ||
                  accepting() !== null
                }
                aria-label={
                  selectionState() === 'all'
                    ? 'Clear selection'
                    : 'Select all'
                }
                class="min-h-11 text-xs font-medium text-foreground data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
              >
                <span>
                  {selectionState() === 'all'
                    ? 'Clear selection'
                    : 'Select all'}
                </span>
              </Checkbox>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAcceptSelected}
                loading={acceptingSelected()}
                disabled={
                  acceptingSelected() ||
                  accepting() !== null ||
                  selectedSuggestionKeys().size === 0
                }
                class="min-h-11 w-full border-success/30 text-xs text-success hover:bg-success-surface sm:min-h-8 sm:w-auto"
              >
                <Show when={!acceptingSelected()}>
                  <Check class="h-3 w-3" />
                </Show>
                Accept selected ({selectedSuggestionKeys().size})
              </Button>
            </div>
          </div>

          <div class="max-h-72 space-y-2 overflow-y-auto">
            <For each={suggestions()}>
              {(suggestion) => {
                const key = () => suggestionKey(suggestion);
                return (
                  <div class="flex flex-col gap-2 rounded-md border bg-card px-3 py-2.5 text-xs sm:flex-row sm:items-center">
                    <Checkbox
                      checked={selectedSuggestionKeys().has(key())}
                      onChange={(checked: boolean) => toggleSuggestionSelection(suggestion, checked)}
                      disabled={
                        acceptingSelected() || accepting() !== null
                      }
                      aria-label={`Select relationship between ${
                        suggestion.sourceLabel || 'source card'
                      } and ${suggestion.targetLabel || 'target card'}`}
                    />
                    <Link2 class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div class="flex-1 min-w-0">
                      <div class="flex min-w-0 items-center gap-1.5">
                        <span class="truncate font-medium">{suggestion.sourceLabel || suggestion.sourceCardId.slice(0, 8)}</span>
                        <span class="text-muted-foreground shrink-0">→</span>
                        <span class="truncate font-medium">{suggestion.targetLabel || suggestion.targetCardId.slice(0, 8)}</span>
                      </div>
                      <Show when={suggestion.reason}>
                        <p class="text-[10px] text-muted-foreground italic mt-0.5 truncate" title={suggestion.reason}>
                          {suggestion.reason}
                        </p>
                      </Show>
                    </div>
                    <div class="flex items-center gap-1.5 sm:ml-2">
                      <Badge variant="muted" class="shrink-0 text-[10px]">
                        Related
                      </Badge>
                      <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {Math.round(suggestion.similarity * 100)}%
                      </span>
                      <button
                        type="button"
                        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-success transition-colors hover:bg-success-surface disabled:opacity-50"
                        onClick={() => handleAccept(suggestion)}
                        disabled={
                          accepting() !== null || acceptingSelected()
                        }
                        title="Accept relationship"
                        aria-label={`Accept relationship between ${
                          suggestion.sourceLabel || 'source card'
                        } and ${suggestion.targetLabel || 'target card'}`}
                      >
                        <Show
                          when={accepting() === key()}
                          fallback={<Check class="h-3.5 w-3.5" />}
                        >
                          <Loader2 class="h-3.5 w-3.5 motion-safe:animate-spin" />
                        </Show>
                      </button>
                      <button
                        type="button"
                        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive-surface hover:text-destructive"
                        onClick={() => handleDismiss(suggestion)}
                        disabled={
                          acceptingSelected() || accepting() !== null
                        }
                        title="Dismiss relationship"
                        aria-label={`Dismiss relationship between ${
                          suggestion.sourceLabel || 'source card'
                        } and ${suggestion.targetLabel || 'target card'}`}
                      >
                        <X class="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      <Show when={detected() && suggestions().length === 0}>
        <p class="mt-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          No new relationships were detected.
        </p>
      </Show>
    </section>
  );
};

export default AiSuggestions;
