import { type Component, Show, For, createSignal } from 'solid-js';
import { api, getApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/stores/toast.store';
import { Sparkles, Loader2, Check, X, Link2 } from 'lucide-solid';
import { queryClient } from '@/lib/query-client';

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

  const handleDetect = async () => {
    setDetecting(true);
    setSuggestions([]);
    try {
      const { data, error } = await (api['knowledge-graph'] as any).ai.detect.post({
        deckId: props.deckId,
        threshold: 0.9,
      });
      if (error) throw new Error(getApiError(error));
      const result = data as { suggestions: Suggestion[] };
      setSuggestions(result.suggestions ?? []);
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
      // Best effort — still remove from UI
    }
    setSuggestions((prev) =>
      prev.filter(
        (s) =>
          !(s.sourceCardId === suggestion.sourceCardId && s.targetCardId === suggestion.targetCardId),
      ),
    );
  };

  const handleAcceptAll = async () => {
    const all = suggestions();
    for (const s of all) {
      await handleAccept(s);
    }
  };

  return (
    <div>
      <Show when={!detected() || suggestions().length === 0}>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDetect}
          disabled={detecting()}
          class="text-xs"
        >
          <Show when={detecting()} fallback={<Sparkles class="h-3.5 w-3.5 mr-1.5" />}>
            <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" />
          </Show>
          {detecting() ? 'Analyzing...' : 'AI Detect Relationships'}
        </Button>
      </Show>

      <Show when={suggestions().length > 0}>
        <div class="rounded-xl border border-palette-5/30 bg-palette-5/5 p-4 mt-3 animate-fade-in">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <Sparkles class="h-4 w-4 text-palette-5" />
              <span class="text-sm font-semibold">
                {suggestions().length} relationship{suggestions().length !== 1 ? 's' : ''} suggested
              </span>
            </div>
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAcceptAll}
                class="text-xs h-7 text-green-600 border-green-500/30 hover:bg-green-500/10"
              >
                <Check class="h-3 w-3 mr-1" />
                Accept All
              </Button>
            </div>
          </div>

          <div class="space-y-2 max-h-64 overflow-y-auto">
            <For each={suggestions()}>
              {(suggestion) => {
                const key = () => `${suggestion.sourceCardId}:${suggestion.targetCardId}`;
                return (
                    <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border text-xs">
                    <Link2 class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-1.5">
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
                    <Badge variant="muted" class="text-[10px] shrink-0">related</Badge>
                    <span class="text-[10px] text-muted-foreground tabular-nums shrink-0">
                      {Math.round(suggestion.similarity * 100)}%
                    </span>
                    <button
                      class="shrink-0 p-1 rounded hover:bg-green-500/20 text-green-600 transition-colors disabled:opacity-50"
                      onClick={() => handleAccept(suggestion)}
                      disabled={accepting() === key()}
                      title="Accept"
                    >
                      <Show when={accepting() === key()} fallback={<Check class="h-3.5 w-3.5" />}>
                        <Loader2 class="h-3.5 w-3.5 animate-spin" />
                      </Show>
                    </button>
                    <button
                      class="shrink-0 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => handleDismiss(suggestion)}
                      title="Dismiss"
                    >
                      <X class="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default AiSuggestions;
