import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Component,
} from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import {
  Check,
  CircleAlert,
  GitBranch,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-solid';

import { api, getApiError } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { queryClient } from '@/lib/query-client';
import { createAnimationFrameScheduler } from '@/lib/create-animation-frame-scheduler';
import { toast } from '@/stores/toast.store';
import {
  knowledgeGraphKeys,
  type RelationType,
} from './knowledge-graph-state';
import {
  knowledgeGraphReviewQueueState,
  isKnowledgeGraphRunTerminal,
  nextSuggestionFocusId,
  relationTypeLabel,
  resolveRunIdForDeck,
  shouldPollKnowledgeGraphRun,
  summarizeSuggestionReview,
  toggleSuggestionSelection,
  type KnowledgeGraphRunRequest,
  type KnowledgeGraphRunStatus,
} from './knowledge-graph-review-state';
import {
  getBulkSelectionState,
  toggleAllSelection,
} from './suggestion-selection';

interface KnowledgeGraphReviewProps {
  deckId: string;
  requestedRun?: KnowledgeGraphRunRequest;
}

interface RunResponse {
  id: string;
  type: 'deck_index' | 'sense_expansion';
  status: KnowledgeGraphRunStatus;
  stage: string;
  progress: { completed: number; total: number };
  stats: {
    cards: number;
    indexedSenses: number;
    candidates: number;
    verified: number;
    suggestions: number;
    coveredNodes: number;
    embeddingRequests: number;
    verifierRequests: number;
    inputTokens: number | null;
    outputTokens: number | null;
  };
  error: { code: string; message: string } | null;
}

interface SuggestionArtifact {
  lemma: string;
  definition: string;
  partOfSpeech: string;
  languageTag?: string;
}

interface TypedSuggestion {
  id: string;
  runId: string;
  status: 'pending';
  source: {
    cardId: string | null;
    senseId: string | null;
    artifact: SuggestionArtifact;
  };
  target: {
    cardId: string | null;
    senseId: string | null;
    artifact: SuggestionArtifact;
  };
  relationType: RelationType;
  direction: 'source_to_target' | 'target_to_source' | 'symmetric';
  confidenceBand: 'high' | 'medium' | 'low';
  reason: string;
  evidence: { source: string; target: string } | null;
  retrieval: {
    similarity: number | null;
    mutualKnn: boolean;
  };
}

interface SuggestionPage {
  items: TypedSuggestion[];
  pageInfo: {
    nextCursor: string | null;
    truncated: boolean;
  };
}

function storedRunId(deckId: string): string {
  if (typeof sessionStorage === 'undefined') return '';
  return sessionStorage.getItem(`kg-v2-run:${deckId}`) ?? '';
}

function relationArrow(
  direction: TypedSuggestion['direction'],
): string {
  if (direction === 'symmetric') return '↔';
  if (direction === 'target_to_source') return '←';
  return '→';
}

const KnowledgeGraphReview: Component<KnowledgeGraphReviewProps> = (props) => {
  let reviewTitle: HTMLHeadingElement | undefined;
  const scheduleAnimationFrame = createAnimationFrameScheduler();
  const [activeDeckId, setActiveDeckId] = createSignal(props.deckId);
  const [runId, setRunId] = createSignal(storedRunId(props.deckId));
  const [starting, setStarting] = createSignal(false);
  const [acceptingId, setAcceptingId] = createSignal<string | null>(null);
  const [acceptingSelected, setAcceptingSelected] = createSignal(false);
  const [dismissingId, setDismissingId] = createSignal<string | null>(null);
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());

  createEffect(() => {
    const deckId = props.deckId;
    const currentDeckId = activeDeckId();
    if (currentDeckId === deckId) return;
    const nextRunId = resolveRunIdForDeck(
      currentDeckId,
      runId(),
      deckId,
      storedRunId(deckId),
    );
    setActiveDeckId(deckId);
    setSelectedIds(new Set<string>());
    setRunId(nextRunId);
  });

  createEffect(() => {
    const requestedRun = props.requestedRun;
    if (!requestedRun || requestedRun.deckId !== props.deckId) return;
    requestedRun.sequence;
    setSelectedIds(new Set<string>());
    setRunId(requestedRun.runId);
  });

  createEffect(() => {
    const id = runId();
    if (typeof sessionStorage === 'undefined') return;
    if (id) sessionStorage.setItem(`kg-v2-run:${props.deckId}`, id);
    else sessionStorage.removeItem(`kg-v2-run:${props.deckId}`);
  });

  const runQuery = createQuery(() => ({
    queryKey: knowledgeGraphKeys.run(runId() || 'idle'),
    queryFn: async () => {
      const id = runId();
      if (!id) return null;
      const { data, error } = await api['knowledge-graph']
        .runs({ runId: id })
        .get();
      if (error) throw new Error(getApiError(error));
      return data as RunResponse;
    },
    enabled: !!runId(),
    retry: 1,
    refetchInterval: (query: { state: { data?: RunResponse | null } }) =>
      shouldPollKnowledgeGraphRun(query.state.data?.status) ? 1_500 : false,
  }));

  const canLoadSuggestions = createMemo(() => {
    const status = runQuery.data?.status;
    return status === 'completed' || status === 'partial';
  });

  const suggestionsQuery = createQuery(() => ({
    queryKey: knowledgeGraphKeys.suggestions(runId() || 'idle', 'pending'),
    queryFn: async () => {
      const id = runId();
      if (!id) return null;
      const { data, error } = await api['knowledge-graph']
        .runs({ runId: id })
        .suggestions.get({
        query: { status: 'pending', limit: 20 },
      });
      if (error) throw new Error(getApiError(error));
      return data as SuggestionPage;
    },
    enabled: !!runId() && canLoadSuggestions(),
    staleTime: 0,
  }));

  const currentSuggestionIds = createMemo(() =>
    (suggestionsQuery.data?.items ?? []).map((item) => item.id),
  );
  const selectionState = createMemo(() =>
    getBulkSelectionState(currentSuggestionIds(), selectedIds()),
  );

  const reviewQueueState = createMemo(() =>
    knowledgeGraphReviewQueueState({
      enabled: !!runId() && canLoadSuggestions(),
      loading: suggestionsQuery.isLoading,
      error: suggestionsQuery.isError,
      itemCount: suggestionsQuery.data?.items.length ?? 0,
    }),
  );

  createEffect(() => {
    const visibleIds = new Set(currentSuggestionIds());
    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((suggestionId) => visibleIds.has(suggestionId)),
      );
      return next.size === current.size ? current : next;
    });
  });

  const startRun = async () => {
    if (starting()) return;
    setStarting(true);
    try {
      const { data, error } = await api['knowledge-graph'].runs.deck.post({
        deckId: props.deckId,
        sourceLanguageTag: 'en',
        definitionLanguageTag: 'vi',
      });
      if (error) throw new Error(getApiError(error));
      const created = data as {
        runId: string;
        status: 'queued';
        reused: boolean;
      };
      setSelectedIds(new Set<string>());
      setRunId(created.runId);
      toast.info(
        created.reused
          ? 'Reusing the unchanged lexical graph analysis'
          : 'Lexical graph analysis queued',
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not start graph analysis',
      );
    } finally {
      setStarting(false);
    }
  };

  const cancelRun = async () => {
    const id = runId();
    if (!id) return;
    try {
      const { error } = await api['knowledge-graph']
        .runs({ runId: id })
        .cancel.post();
      if (error) throw new Error(getApiError(error));
      await queryClient.invalidateQueries({
        queryKey: knowledgeGraphKeys.run(id),
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not cancel analysis',
      );
    }
  };

  const mutateSuggestion = async (
    suggestionId: string,
    action: 'accept' | 'dismiss',
  ) => {
    const endpoint = api['knowledge-graph'].suggestions({
      id: suggestionId,
    });
    const { error } =
      action === 'accept'
        ? await endpoint.accept.post()
        : await endpoint.dismiss.post();
    if (error) throw new Error(getApiError(error));
  };

  const refreshAfterReview = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: knowledgeGraphKeys.suggestions(
          runId() || 'idle',
          'pending',
        ),
      }),
      queryClient.invalidateQueries({
        queryKey: knowledgeGraphKeys.all,
      }),
    ]);
  };

  const focusAfterSuggestionReview = (removedId: string) => {
    const nextId = nextSuggestionFocusId(
      (suggestionsQuery.data?.items ?? []).map((item) => item.id),
      removedId,
    );
    scheduleAnimationFrame(() => {
      const nextItem = nextId
        ? document.querySelector<HTMLElement>(
            `[data-kg-suggestion-id="${nextId}"]`,
          )
        : null;
      (nextItem ?? reviewTitle)?.focus({ preventScroll: true });
    });
  };

  const acceptSuggestion = async (suggestionId: string, quiet = false) => {
    setAcceptingId(suggestionId);
    try {
      await mutateSuggestion(suggestionId, 'accept');
      setSelectedIds((current) =>
        toggleSuggestionSelection(current, suggestionId, false),
      );
      if (!quiet) {
        await refreshAfterReview();
        focusAfterSuggestionReview(suggestionId);
        toast.success('Relationship added to your lexical graph');
      }
      return true;
    } catch (error) {
      if (!quiet) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Could not accept relationship',
        );
      }
      return false;
    } finally {
      setAcceptingId(null);
    }
  };

  const acceptSelected = async () => {
    if (acceptingSelected() || selectedIds().size === 0) return;
    const attempted = selectedIds().size;
    setAcceptingSelected(true);
    let accepted = 0;
    try {
      for (const suggestionId of selectedIds()) {
        if (await acceptSuggestion(suggestionId, true)) accepted += 1;
      }
      await refreshAfterReview();
      setSelectedIds(new Set<string>());
      const result = summarizeSuggestionReview(attempted, accepted);
      if (accepted > 0) {
        toast.success(
          `${accepted} relationship${accepted === 1 ? '' : 's'} added`,
        );
      }
      if (result.failed > 0) {
        toast.error(
          `${result.failed} relationship${result.failed === 1 ? '' : 's'} could not be added`,
        );
      }
      scheduleAnimationFrame(() => {
        reviewTitle?.focus({ preventScroll: true });
      });
    } finally {
      setAcceptingSelected(false);
    }
  };

  const dismissSuggestion = async (suggestionId: string) => {
    setDismissingId(suggestionId);
    try {
      await mutateSuggestion(suggestionId, 'dismiss');
      setSelectedIds((current) =>
        toggleSuggestionSelection(current, suggestionId, false),
      );
      await refreshAfterReview();
      focusAfterSuggestionReview(suggestionId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not dismiss relationship',
      );
    } finally {
      setDismissingId(null);
    }
  };

  const restart = () => {
    setRunId('');
    setSelectedIds(new Set<string>());
    void startRun();
  };

  const statusLabel = createMemo(() => {
    const run = runQuery.data;
    if (!run) return 'Not analyzed';
    if (run.status === 'queued') return 'Waiting for a worker';
    if (run.status === 'processing') return `Analyzing · ${run.stage}`;
    if (run.status === 'completed') return 'Analysis complete';
    if (run.status === 'partial') return 'Analysis completed with gaps';
    if (run.status === 'stale') return 'Deck changed during analysis';
    if (run.status === 'cancelled') return 'Analysis cancelled';
    return 'Analysis failed';
  });

  return (
    <section
      class="overflow-hidden rounded-lg border bg-card"
      aria-labelledby="lexical-analysis-title"
    >
      <div class="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex min-w-0 items-start gap-3">
          <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted text-info">
            <Sparkles class="h-4 w-4" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <h3
              ref={reviewTitle}
              id="lexical-analysis-title"
              class="text-sm font-semibold text-foreground"
              tabIndex={-1}
            >
              Lexical relationship review
            </h3>
            <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              AI proposes typed links between exact word meanings. Nothing is
              added until you approve it.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="min-h-11 w-full shrink-0 text-xs sm:min-h-9 sm:w-auto"
          loading={starting()}
          disabled={starting() || shouldPollKnowledgeGraphRun(runQuery.data?.status)}
          onClick={runId() ? restart : startRun}
        >
          <Show when={!starting()}>
            <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
          </Show>
          {runId() ? 'Analyze current deck' : 'Build lexical graph'}
        </Button>
      </div>

      <Show
        when={runId()}
        fallback={
          <div class="px-4 py-5 text-sm text-muted-foreground">
            Start an analysis to index vocabulary senses and find useful
            one-hop connections for this deck.
          </div>
        }
      >
        <div class="flex flex-col gap-3 border-b bg-muted/35 px-4 py-3 sm:flex-row sm:items-center">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <Show
              when={shouldPollKnowledgeGraphRun(runQuery.data?.status)}
              fallback={<GitBranch class="h-4 w-4 shrink-0 text-info" />}
            >
              <Loader2 class="h-4 w-4 shrink-0 text-info motion-safe:animate-spin" />
            </Show>
            <div class="min-w-0">
              <p class="text-xs font-medium text-foreground">{statusLabel()}</p>
              <Show when={runQuery.data}>
                {(currentRun) => (
                  <p class="mt-0.5 text-[11px] text-muted-foreground">
                    {currentRun().stats.indexedSenses} senses ·{' '}
                    {currentRun().stats.candidates} candidates ·{' '}
                    {currentRun().stats.verified} verified
                  </p>
                )}
              </Show>
            </div>
          </div>
          <Show when={shouldPollKnowledgeGraphRun(runQuery.data?.status)}>
            <Button
              variant="ghost"
              size="sm"
              class="min-h-11 text-xs sm:min-h-8"
              onClick={cancelRun}
            >
              Cancel
            </Button>
          </Show>
        </div>

        <Show when={runQuery.isError}>
          <div class="flex items-start gap-2 px-4 py-4 text-sm text-destructive">
            <CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
            <p>Run status could not be loaded. Try analyzing the deck again.</p>
          </div>
        </Show>

        <Show when={runQuery.data?.error}>
          {(runError) => (
            <div class="flex items-start gap-2 px-4 py-4 text-sm text-destructive">
              <CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
              <p>{runError().message}</p>
            </div>
          )}
        </Show>

        <Show
          when={
            runQuery.data &&
            isKnowledgeGraphRunTerminal(runQuery.data.status) &&
            canLoadSuggestions()
          }
        >
          <Show
            when={reviewQueueState() !== 'loading'}
            fallback={
              <div class="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground">
                <Loader2 class="h-4 w-4 motion-safe:animate-spin" />
                Loading review queue…
              </div>
            }
          >
            <Show
              when={reviewQueueState() !== 'error'}
              fallback={
                <div class="space-y-3 px-4 py-5">
                  <div class="flex items-start gap-2 text-sm text-destructive">
                    <CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      Review suggestions could not be loaded. This does not
                      mean the queue is empty.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    class="min-h-11 text-xs sm:min-h-9"
                    onClick={() => void suggestionsQuery.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              }
            >
              <Show
                when={reviewQueueState() === 'ready'}
                fallback={
                  <div class="px-4 py-5">
                    <p class="text-sm font-medium text-foreground">
                      Review queue is clear
                    </p>
                    <p class="mt-1 text-xs text-muted-foreground">
                      No pending typed relationships remain for this run.
                    </p>
                  </div>
                }
              >
                <div class="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p class="text-xs text-muted-foreground">
                    Select only the relationships you trust.
                  </p>
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Checkbox
                      checked={selectionState() === 'all'}
                      indeterminate={selectionState() === 'partial'}
                      onChange={() =>
                        setSelectedIds((current) =>
                          toggleAllSelection(currentSuggestionIds(), current),
                        )
                      }
                      disabled={
                        acceptingSelected() ||
                        acceptingId() !== null ||
                        dismissingId() !== null
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
                      class="min-h-11 border-success/30 text-xs text-success hover:bg-success-surface sm:min-h-9"
                      loading={acceptingSelected()}
                      disabled={
                        acceptingSelected() ||
                        acceptingId() !== null ||
                        dismissingId() !== null ||
                        selectedIds().size === 0
                      }
                      onClick={acceptSelected}
                    >
                      <Show when={!acceptingSelected()}>
                        <Check class="h-3.5 w-3.5" />
                      </Show>
                      Accept selected ({selectedIds().size})
                    </Button>
                  </div>
                </div>
                <ul class="max-h-[34rem] divide-y overflow-y-auto">
                  <For each={suggestionsQuery.data?.items ?? []}>
                    {(suggestion) => (
                      <li
                        class="flex gap-3 px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/25"
                        data-kg-suggestion-id={suggestion.id}
                        tabIndex={-1}
                      >
                        <Checkbox
                          checked={selectedIds().has(suggestion.id)}
                          disabled={
                            acceptingSelected() ||
                            acceptingId() !== null ||
                            dismissingId() !== null
                          }
                          aria-label={`Select ${relationTypeLabel(
                            suggestion.relationType,
                          )} relationship between ${
                            suggestion.source.artifact.lemma
                          } and ${suggestion.target.artifact.lemma}`}
                          onChange={(checked: boolean) =>
                            setSelectedIds((current) =>
                              toggleSuggestionSelection(
                                current,
                                suggestion.id,
                                checked,
                              ),
                            )
                          }
                        />
                        <div class="min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="font-medium text-foreground">
                              {suggestion.source.artifact.lemma}
                            </span>
                            <span
                              class="text-muted-foreground"
                              aria-label={suggestion.direction}
                            >
                              {relationArrow(suggestion.direction)}
                            </span>
                            <span class="font-medium text-foreground">
                              {suggestion.target.artifact.lemma}
                            </span>
                            <Badge variant="muted" class="text-[10px]">
                              {relationTypeLabel(suggestion.relationType)}
                            </Badge>
                            <span class="text-[10px] capitalize text-muted-foreground">
                              {suggestion.confidenceBand} confidence
                            </span>
                          </div>
                          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {suggestion.reason}
                          </p>
                          <Show when={suggestion.evidence}>
                            {(evidence) => (
                              <p class="mt-1 text-[11px] text-muted-foreground">
                                Evidence: “{evidence().source}” / “
                                {evidence().target}”
                              </p>
                            )}
                          </Show>
                        </div>
                        <div class="flex shrink-0 items-start gap-1">
                          <button
                            type="button"
                            class="inline-flex h-11 w-11 items-center justify-center rounded-md text-success transition-colors hover:bg-success-surface disabled:opacity-50"
                            disabled={
                              acceptingSelected() ||
                              acceptingId() !== null ||
                              dismissingId() !== null
                            }
                            aria-label={`Accept relationship between ${suggestion.source.artifact.lemma} and ${suggestion.target.artifact.lemma}`}
                            onClick={() => acceptSuggestion(suggestion.id)}
                          >
                            <Show
                              when={acceptingId() === suggestion.id}
                              fallback={<Check class="h-4 w-4" />}
                            >
                              <Loader2 class="h-4 w-4 motion-safe:animate-spin" />
                            </Show>
                          </button>
                          <button
                            type="button"
                            class="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive-surface hover:text-destructive disabled:opacity-50"
                            disabled={
                              acceptingSelected() ||
                              acceptingId() !== null ||
                              dismissingId() !== null
                            }
                            aria-label={`Dismiss relationship between ${suggestion.source.artifact.lemma} and ${suggestion.target.artifact.lemma}`}
                            onClick={() => dismissSuggestion(suggestion.id)}
                          >
                            <Show
                              when={dismissingId() === suggestion.id}
                              fallback={<X class="h-4 w-4" />}
                            >
                              <Loader2 class="h-4 w-4 motion-safe:animate-spin" />
                            </Show>
                          </button>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>
    </section>
  );
};

export default KnowledgeGraphReview;
