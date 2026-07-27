import {
  type Component,
  createSignal,
  createMemo,
  createEffect,
  onCleanup,
  batch,
  Show,
  For,
  lazy,
  Suspense,
} from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { api, getApiError } from '@/api/client';
import { queryClient } from '@/lib/query-client';
import PageShell from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { toast } from '@/stores/toast.store';
import {
  Sparkles,
  Loader2,
  X,
  Plus,
  Layers,
  BarChart3,
  Search,
} from 'lucide-solid';
import {
  AI_BANNER_POLL_INTERVAL_MS,
  AI_BANNER_POLL_TIMEOUT_MS,
} from '@/constants';

import { createDebouncedSignal } from '@/lib/create-debounced-signal';
import { createDragAutoScroller } from '@/lib/drag-auto-scroll';
import { useDeckData } from './use-deck-data';
import type { CardItem } from './types';
import DeckHeader from './deck-header';
import CardItemRow from './card-item';
import AddCardForm from './add-card-form';
import EditCardForm from './edit-card-form';
import BulkActionsBar from './bulk-actions-bar';
import {
  getDropPosition,
  reorderCards,
  type DropPosition,
} from './deck-reorder';

// Lazy-load AI modal (heavy component with its own store)
const AiGenerateModal = lazy(() => import('./ai-generate-modal'));
const DRAG_CARD_MIME = 'application/x-engram-card-id';

// Lazy-load deck analytics components (only rendered when toggled)
const RetentionHeatmap = lazy(
  () => import('@/components/deck-view/retention-heatmap'),
);
const GraphView = lazy(() => import('@/components/deck-view/graph-view'));
const DuplicateScanner = lazy(
  () => import('@/components/deck-view/duplicate-scanner'),
);
const AiSuggestions = lazy(
  () => import('@/components/deck-view/ai-suggestions'),
);

const DeckViewPage: Component = () => {
  const {
    params,
    deck,
    template,
    cards,
    cardLoading,
    cardCount,
    sortedFields,
    pauseCardSync,
    resumeCardSync,
    applyCardOrder,
    refetchCards,
    hasMore: hasMoreServer,
    fetchMore,
    fetchingMore,
  } = useDeckData();

  // ── Add card state ──────────────────────────────────────────────
  const [showAddCard, setShowAddCard] = createSignal(false);
  const [addInputs, setAddInputs] = createSignal<Record<string, unknown>>({});
  const [saving, setSaving] = createSignal(false);

  // ── Edit card state ─────────────────────────────────────────────
  const [editingCardId, setEditingCardId] = createSignal<string | null>(null);
  const [editInputs, setEditInputs] = createSignal<Record<string, unknown>>({});
  const [editSaving, setEditSaving] = createSignal(false);

  // ── Delete confirm state ────────────────────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(
    null,
  );

  // ── AI generation state ─────────────────────────────────────────
  const [showAiModal, setShowAiModal] = createSignal(false);

  // Layer 3: pending/processing job resume
  const pendingJobQuery = createQuery(() => ({
    queryKey: ['pendingJob', params.deckId],
    queryFn: async () => {
      try {
        const { data } = await (api.ai as any).jobs.get({
          query: { limit: 5, status: 'processing,pending' },
        });
        if (!Array.isArray(data)) return null;
        return (
          (data as any[]).find((j: any) => j.deckId === params.deckId) ?? null
        );
      } catch {
        return null;
      }
    },
    enabled: !!params.deckId,
  }));
  const pendingJob = () => pendingJobQuery.data ?? null;
  const refetchPendingJob = () =>
    queryClient.invalidateQueries({ queryKey: ['pendingJob', params.deckId] });
  const [pendingJobDismissed, setPendingJobDismissed] = createSignal(false);

  // Banner polling for background AI jobs
  let bannerPollTimer: ReturnType<typeof setInterval> | null = null;
  let bannerPollStartedAt = 0;
  let bannerSeenProcessing = false;

  onCleanup(() => {
    if (bannerPollTimer) clearInterval(bannerPollTimer);
  });

  createEffect(() => {
    const job = pendingJob();
    const dismissed = pendingJobDismissed();

    if (job && job.status === 'processing' && !dismissed) {
      bannerSeenProcessing = true;
      if (!bannerPollTimer) {
        bannerPollStartedAt = Date.now();
        bannerPollTimer = setInterval(() => {
          if (Date.now() - bannerPollStartedAt > AI_BANNER_POLL_TIMEOUT_MS) {
            clearInterval(bannerPollTimer!);
            bannerPollTimer = null;
            toast.error(
              'AI generation is taking too long. The job may have failed. Please try again.',
            );
            return;
          }
          refetchPendingJob();
        }, AI_BANNER_POLL_INTERVAL_MS);
      }
    } else {
      if (bannerPollTimer) {
        clearInterval(bannerPollTimer);
        bannerPollTimer = null;
      }
      if (bannerSeenProcessing && job?.status === 'pending' && !dismissed) {
        bannerSeenProcessing = false;
        toast.success(
          `AI cards ready. ${job.cardCount ?? 'Some'} cards generated.`,
        );
      }
      if (!job) bannerSeenProcessing = false;
    }
  });

  // ── Analytics panel state ─────────────────────────────────────
  const [showAnalytics, setShowAnalytics] = createSignal(false);

  // ── Bulk selection state ────────────────────────────────────────
  const [selectMode, setSelectMode] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = createSignal(false);

  // ── Drag-drop reorder state ─────────────────────────────────────
  const [dragCardId, setDragCardId] = createSignal<string | null>(null);
  const [dropCardId, setDropCardId] = createSignal<string | null>(null);
  const [dropPosition, setDropPosition] =
    createSignal<DropPosition | null>(null);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isReordering, setIsReordering] = createSignal(false);
  let cardListRef: HTMLDivElement | undefined;
  let isTrackingDocumentDrag = false;
  let lastDragPointer: { x: number; y: number } | null = null;

  // ── Search / filter (debounced 250ms) ──────────────────────────
  const [searchQuery, setSearchQuery, immediateSearchQuery] =
    createDebouncedSignal('', 250);

  const reorderUnavailableReason = createMemo(() => {
    if (immediateSearchQuery().trim()) return 'Clear search to reorder cards';
    if (fetchingMore()) return 'Wait for the remaining cards to load';
    if (isReordering()) return 'Saving the current card order';
    return null;
  });

  // Server-side search when query is non-empty (searches ALL cards, not just loaded pages)
  const searchResultsQuery = createQuery(() => ({
    queryKey: ['cards-search', params.deckId, searchQuery()],
    queryFn: async () => {
      const q = searchQuery().trim();
      if (!q) return null;
      const { data } = await api.cards['by-deck']({
        deckId: params.deckId,
      }).search.get({ query: { q } });
      return data as { items: CardItem[]; total: number } | null;
    },
    enabled: !!searchQuery().trim() && !!params.deckId,
    staleTime: 30_000,
  }));

  const filteredCards = createMemo(() => {
    const q = searchQuery().toLowerCase().trim();
    const all = cards() ?? [];
    if (!q) return all;

    // Use server-side search results if available
    const serverResults = searchResultsQuery.data;
    if (serverResults?.items) return serverResults.items;

    // Fallback: client-side filter on loaded cards while server query is loading
    return all.filter((card) =>
      card.fields.some((f) => {
        if (Array.isArray(f.value))
          return (f.value as string[]).some((v) => v.toLowerCase().includes(q));
        return String(f.value ?? '')
          .toLowerCase()
          .includes(q);
      }),
    );
  });

  // ── Infinite scroll trigger ─────────────────────────────────────
  const handleReachEnd = () => {
    if (
      !isDragging() &&
      !isReordering() &&
      !immediateSearchQuery().trim() &&
      hasMoreServer() &&
      !fetchingMore()
    ) {
      fetchMore();
    }
  };

  // ── Handlers ────────────────────────────────────────────────────
  const handleAddCard = async (e: Event) => {
    e.preventDefault();
    const tmpl = template();
    if (!tmpl) return;
    setSaving(true);
    try {
      const fieldValues = tmpl.fields.map((f) => ({
        templateFieldId: f.id,
        value: addInputs()[f.id] ?? (f.fieldType === 'json_array' ? [] : ''),
      }));
      const { error: addError } = await api.cards['by-deck']({
        deckId: params.deckId,
      }).post({
        fieldValues,
      });
      if (addError) throw new Error(getApiError(addError));
      setAddInputs({});
      setShowAddCard(false);
      refetchCards();
      toast.success('Card added successfully');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to add card');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (card: CardItem) => {
    const tmpl = template();
    if (!tmpl) return;
    const inputs: Record<string, unknown> = {};
    tmpl.fields.forEach((f) => {
      const found = card.fields.find((cf) => cf.fieldName === f.name);
      inputs[f.id] = found?.value ?? (f.fieldType === 'json_array' ? [] : '');
    });
    setEditInputs(inputs);
    setEditingCardId(card.id);
  };

  const handleEditCard = async (e: Event) => {
    e.preventDefault();
    const tmpl = template();
    const cardId = editingCardId();
    if (!tmpl || !cardId) return;
    setEditSaving(true);
    try {
      const fieldValues = tmpl.fields.map((f) => ({
        templateFieldId: f.id,
        value: editInputs()[f.id] ?? (f.fieldType === 'json_array' ? [] : ''),
      }));
      const { error: editError } = await (api.cards as any)[cardId].patch({
        fieldValues,
      });
      if (editError) throw new Error(getApiError(editError));
      setEditingCardId(null);
      refetchCards();
      toast.success('Card updated');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to update card');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    try {
      const { error: deleteError } = await (api.cards as any)[cardId].delete();
      if (deleteError) throw new Error(getApiError(deleteError));
      setConfirmDeleteId(null);
      refetchCards();
      toast.success('Card deleted');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete card');
    }
  };

  // ── Bulk selection handlers ─────────────────────────────────────
  const toggleSelectMode = () => {
    batch(() => {
      setSelectMode((v) => !v);
      setSelectedIds(new Set<string>());
    });
  };

  const toggleCardSelection = (cardId: string) => {
    const s = new Set(selectedIds());
    if (s.has(cardId)) s.delete(cardId);
    else s.add(cardId);
    setSelectedIds(s);
  };

  const selectAll = () => {
    const all = filteredCards();
    // Toggle: if all are already selected → deselect all, else select all
    if (selectedIds().size === all.length) {
      setSelectedIds(new Set<string>());
    } else {
      setSelectedIds(new Set(all.map((c) => c.id)));
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds()];
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      const { error: bulkDeleteError } = await (
        api.cards['by-deck']({ deckId: params.deckId }) as any
      )['batch'].delete({ cardIds: ids });
      if (bulkDeleteError) throw new Error(getApiError(bulkDeleteError));
      toast.success(`${ids.length} card${ids.length > 1 ? 's' : ''} deleted`);
      batch(() => {
        setSelectedIds(new Set<string>());
        setSelectMode(false);
      });
      refetchCards();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete cards');
    } finally {
      setBulkDeleting(false);
    }
  };

  // ── Drag-drop reorder ───────────────────────────────────────────
  const clearDropTarget = () => {
    if (dropCardId() === null && dropPosition() === null) return;
    batch(() => {
      setDropCardId(null);
      setDropPosition(null);
    });
  };

  const updateDropTargetFromPoint = (clientX: number, clientY: number) => {
    if (!cardListRef) return;

    const listBounds = cardListRef.getBoundingClientRect();
    const isHorizontallyAligned =
      clientX >= listBounds.left - 40 && clientX <= listBounds.right + 40;
    if (!isHorizontallyAligned) {
      clearDropTarget();
      return;
    }

    const pointedElement = document.elementFromPoint(clientX, clientY);
    let row = pointedElement?.closest<HTMLElement>('[data-deck-card-id]') ?? null;

    if (!row || !cardListRef.contains(row)) {
      const rows = Array.from(
        cardListRef.querySelectorAll<HTMLElement>('[data-deck-card-id]'),
      );
      const visibleRows = rows.filter((candidate) => {
        const bounds = candidate.getBoundingClientRect();
        return bounds.bottom >= listBounds.top && bounds.top <= listBounds.bottom;
      });
      const candidates = visibleRows.length > 0 ? visibleRows : rows;

      if (candidates.length === 0) {
        clearDropTarget();
        return;
      }

      row = candidates.reduce((nearest, candidate) => {
        const nearestBounds = nearest.getBoundingClientRect();
        const candidateBounds = candidate.getBoundingClientRect();
        const nearestDistance = Math.abs(
          clientY - (nearestBounds.top + nearestBounds.height / 2),
        );
        const candidateDistance = Math.abs(
          clientY - (candidateBounds.top + candidateBounds.height / 2),
        );
        return candidateDistance < nearestDistance ? candidate : nearest;
      });
    }

    const cardId = row.dataset.deckCardId;
    if (!cardId || cardId === dragCardId()) {
      clearDropTarget();
      return;
    }

    const position = getDropPosition(clientY, row.getBoundingClientRect());
    if (dropCardId() !== cardId || dropPosition() !== position) {
      batch(() => {
        setDropCardId(cardId);
        setDropPosition(position);
      });
    }
  };
  const dragAutoScroller = createDragAutoScroller(
    () => cardListRef,
    updateDropTargetFromPoint,
  );
  const trackDragPointer = (e: DragEvent) => {
    if (e.clientX === 0 && e.clientY === 0 && lastDragPointer) {
      return lastDragPointer;
    }
    lastDragPointer = { x: e.clientX, y: e.clientY };
    return lastDragPointer;
  };

  const handleDocumentDragOver = (e: DragEvent) => {
    if (!isDragging()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const pointer = trackDragPointer(e);
    dragAutoScroller.updatePointer(pointer.x, pointer.y);
    updateDropTargetFromPoint(pointer.x, pointer.y);
  };

  const stopDocumentDragTracking = () => {
    dragAutoScroller.stop();
    if (!isTrackingDocumentDrag) return;
    document.removeEventListener('dragover', handleDocumentDragOver);
    document.removeEventListener('drop', handleDocumentDragEnd);
    document.removeEventListener('dragend', handleDocumentDragEnd);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('blur', handleDocumentDragEnd);
    isTrackingDocumentDrag = false;
  };

  const resetDragState = () => {
    stopDocumentDragTracking();
    lastDragPointer = null;
    batch(() => {
      setDragCardId(null);
      setDropCardId(null);
      setDropPosition(null);
      setIsDragging(false);
    });
  };

  const handleDragEnd = () => {
    resetDragState();
    if (!isReordering()) resumeCardSync();
  };

  const handleDocumentDragEnd = () => {
    handleDragEnd();
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') handleDocumentDragEnd();
  };

  const startDocumentDragTracking = () => {
    if (isTrackingDocumentDrag) return;
    document.addEventListener('dragover', handleDocumentDragOver);
    document.addEventListener('drop', handleDocumentDragEnd);
    document.addEventListener('dragend', handleDocumentDragEnd);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleDocumentDragEnd);
    isTrackingDocumentDrag = true;
  };

  onCleanup(stopDocumentDragTracking);

  const handleDragStart = (cardId: string, e: DragEvent) => {
    if (reorderUnavailableReason()) {
      e.preventDefault();
      return;
    }

    void pauseCardSync();
    batch(() => {
      setDragCardId(cardId);
      setDropCardId(null);
      setDropPosition(null);
      setIsDragging(true);
    });
    startDocumentDragTracking();

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(DRAG_CARD_MIME, cardId);
      e.dataTransfer.setData('text/plain', cardId);
    }
  };

  const handleListDragOver = (e: DragEvent) => {
    if (!isDragging()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  };

  const handleCardListScroll = (container: HTMLDivElement) => {
    if (isDragging() && lastDragPointer) {
      updateDropTargetFromPoint(lastDragPointer.x, lastDragPointer.y);
    }

    const remainingScroll =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (remainingScroll <= Math.max(320, container.clientHeight / 2)) {
      handleReachEnd();
    }
  };

  const handleDrop = async (
    targetCardId: string,
    position: DropPosition,
    e: DragEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const sourceCardId =
      dragCardId() ||
      e.dataTransfer?.getData(DRAG_CARD_MIME) ||
      e.dataTransfer?.getData('text/plain');
    const previousCards = cards();
    const reordered =
      sourceCardId && previousCards
        ? reorderCards(
            previousCards,
            sourceCardId,
            targetCardId,
            position,
          )
        : null;

    resetDragState();
    if (!reordered) {
      resumeCardSync();
      return;
    }

    const cardIds = reordered.map((card) => card.id);

    setIsReordering(true);
    applyCardOrder(reordered);

    try {
      const { error: reorderError } = await api.cards['by-deck']({
        deckId: params.deckId,
      }).reorder.patch({
        cardIds,
      });

      if (reorderError) {
        throw new Error(
          getApiError(reorderError) || 'Failed to reorder cards',
        );
      }
    } catch (err: any) {
      applyCardOrder(previousCards);
      toast.error(err?.message ?? 'Failed to reorder cards');
      try {
        await refetchCards();
      } catch {
        // The exact pre-drag order is already restored locally and in cache.
      }
    } finally {
      resumeCardSync();
      setIsReordering(false);
    }
  };

  const handleListDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const pointer = trackDragPointer(e);
    updateDropTargetFromPoint(pointer.x, pointer.y);
    const targetCardId = dropCardId();
    const position = dropPosition();
    if (!targetCardId || !position) {
      handleDragEnd();
      return;
    }
    void handleDrop(targetCardId, position, e);
  };

  // ── AI handlers ─────────────────────────────────────────────────
  const handleResumeJob = async () => {
    const job = pendingJob();
    if (!job) return;
    setShowAiModal(true);
  };

  const handleAiModalClose = () => {
    setShowAiModal(false);
    refetchPendingJob();
  };

  const handleAiSaved = () => {
    setPendingJobDismissed(false);
    refetchPendingJob();
    refetchCards();
  };

  // ── Render ──────────────────────────────────────────────────────
  return (
    <PageShell maxWidth={false} class="p-0" noScroll>
      <DeckHeader
        deckId={params.deckId}
        deck={deck}
        template={template}
        cardCount={cardCount}
        searchQuery={searchQuery}
        immediateSearchQuery={immediateSearchQuery}
        setSearchQuery={setSearchQuery}
        showAddCard={showAddCard}
        setShowAddCard={(v: boolean) => {
          setShowAddCard(v);
          if (v)
            document
              .getElementById('main-content')
              ?.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        setAddInputs={() => setAddInputs({})}
        showAiModal={showAiModal}
        setShowAiModal={setShowAiModal}
        selectMode={selectMode}
        toggleSelectMode={toggleSelectMode}
        showAnalytics={showAnalytics}
        toggleAnalytics={() => setShowAnalytics((v) => !v)}
      />

      <div
        class={`min-h-0 flex-1 bg-surface px-4 py-3 sm:px-6 sm:py-4 ${
          showAnalytics() ? 'overflow-y-auto' : 'overflow-hidden'
        }`}
      >
        <div
          class={`mx-auto flex min-h-0 max-w-6xl flex-col gap-4 ${
            showAnalytics() ? '' : 'h-full'
          }`}
        >
          {/* ── Pending AI job resume banner ── */}
          <Show when={pendingJob() && !pendingJobDismissed() && !showAiModal()}>
            <section
              class="flex flex-col gap-3 rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm motion-safe:animate-fade-in sm:flex-row sm:items-center"
              aria-label="AI generation status"
              aria-live="polite"
            >
              <Show
                when={pendingJob()!.status === 'processing'}
                fallback={
                  <Sparkles class="h-4 w-4 shrink-0 text-primary" />
                }
              >
                <Loader2 class="h-4 w-4 shrink-0 text-primary motion-safe:animate-spin" />
              </Show>
              <span class="min-w-0 flex-1 text-foreground">
                <Show
                  when={pendingJob()!.status === 'processing'}
                  fallback={
                    <>
                      <strong>{pendingJob()!.cardCount} generated cards</strong>{' '}
                      are ready to review and save.
                    </>
                  }
                >
                  AI is generating your cards in the background&hellip;
                </Show>
              </span>
              <Button
                size="sm"
                variant="outline"
                class="h-8 shrink-0 border-border bg-card px-3 text-xs text-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={handleResumeJob}
              >
                <Show
                  when={pendingJob()!.status === 'processing'}
                  fallback="Resume"
                >
                  View progress
                </Show>
              </Button>
              <button
                type="button"
                class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setPendingJobDismissed(true)}
                aria-label="Dismiss AI generation status"
              >
                <X class="h-4 w-4" />
              </button>
            </section>
          </Show>

          {/* ── Analytics Panel (lazy-loaded) ── */}
          <Show when={showAnalytics()}>
            <section
              class="space-y-4 motion-safe:animate-fade-in"
              aria-labelledby="deck-analytics-title"
            >
              <div class="flex items-start gap-3 py-1">
                <div class="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground">
                  <BarChart3 class="h-4 w-4" />
                </div>
                <div>
                  <h2
                    id="deck-analytics-title"
                    class="text-lg font-semibold tracking-tight text-foreground"
                  >
                    Deck analytics
                  </h2>
                  <p class="mt-0.5 text-sm text-muted-foreground">
                    Review retention, relationships, and card quality.
                  </p>
                </div>
              </div>
              <Suspense
                fallback={
                  <div class="h-32 rounded-lg border bg-card motion-safe:animate-pulse" />
                }
              >
                <RetentionHeatmap deckId={params.deckId} />
              </Suspense>
              <Suspense
                fallback={
                  <div class="h-80 rounded-lg border bg-card motion-safe:animate-pulse" />
                }
              >
                <GraphView deckId={params.deckId} />
              </Suspense>
              <div class="grid gap-3 lg:grid-cols-2">
                <Suspense
                  fallback={
                    <div class="h-9 rounded-lg border bg-card motion-safe:animate-pulse" />
                  }
                >
                  <DuplicateScanner deckId={params.deckId} />
                </Suspense>
                <Suspense
                  fallback={
                    <div class="h-9 rounded-lg border bg-card motion-safe:animate-pulse" />
                  }
                >
                  <AiSuggestions deckId={params.deckId} />
                </Suspense>
              </div>
            </section>
          </Show>

          {/* Add card form */}
          <Show when={showAddCard() && template()}>
            <AddCardForm
              sortedFields={sortedFields}
              addInputs={addInputs}
              setAddInputs={setAddInputs}
              saving={saving}
              onSubmit={handleAddCard}
              onClose={() => setShowAddCard(false)}
            />
          </Show>

          {/* Bulk action bar */}
          <Show when={selectMode()}>
            <BulkActionsBar
              selectedCount={selectedIds().size}
              totalCount={filteredCards().length}
              bulkDeleting={bulkDeleting()}
              onSelectAll={selectAll}
              onBulkDelete={handleBulkDelete}
            />
          </Show>

          {/* Card list loading */}
          <Show when={cardLoading()}>
            <div class="space-y-2" aria-label="Loading cards" aria-busy="true">
              <For each={[1, 2, 3]}>
                {() => (
                  <div class="h-28 rounded-lg border bg-card motion-safe:animate-pulse" />
                )}
              </For>
            </div>
          </Show>

          {/* Card list */}
          <Show when={!cardLoading()}>
            <div
              class={`flex min-h-0 flex-col ${
                showAnalytics() ? 'flex-none' : 'flex-1'
              }`}
              style={{
                height: showAnalytics()
                  ? 'clamp(25rem, 70vh, 45rem)'
                  : undefined,
              }}
              aria-label="Cards in this deck"
            >
              <Show
                when={filteredCards().length > 0}
                fallback={
                  <div class="flex min-h-64 items-center justify-center rounded-lg border border-dashed bg-card px-6 py-12 text-center">
                    <Show
                      when={cardCount() === 0}
                      fallback={
                        <div class="max-w-sm">
                          <Search class="mx-auto mb-3 h-5 w-5 text-muted-foreground" />
                          <p class="text-sm font-medium text-foreground">
                            No matching cards
                          </p>
                          <p class="mt-1 text-sm text-muted-foreground">
                            No results for &ldquo;{immediateSearchQuery()}
                            &rdquo;
                          </p>
                        </div>
                      }
                    >
                      <div class="max-w-sm">
                        <div class="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                          <Layers class="h-5 w-5" />
                        </div>
                        <p class="font-medium text-foreground">
                          Build your first card
                        </p>
                        <p class="mt-1 text-sm text-muted-foreground">
                          Add a card manually or generate a draft from your
                          notes.
                        </p>
                        <Button
                          variant="outline"
                          class="mt-4"
                          onClick={() => {
                            setAddInputs({});
                            setShowAddCard(true);
                          }}
                        >
                          <Plus class="h-4 w-4" />
                          Add first card
                        </Button>
                      </div>
                    </Show>
                  </div>
                }
              >
                <div
                  class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
                  style={{ 'overflow-anchor': 'none' }}
                  ref={(element) => {
                    cardListRef = element;
                  }}
                  onScroll={(event) =>
                    handleCardListScroll(event.currentTarget)
                  }
                  onDragOver={handleListDragOver}
                  onDrop={handleListDrop}
                >
                  <For each={filteredCards()}>
                    {(card, index) => (
                      <div
                        class="relative pb-2"
                        data-deck-card-id={card.id}
                      >
                        <Show
                          when={
                            dropCardId() === card.id &&
                            dragCardId() !== card.id &&
                            dropPosition()
                          }
                        >
                          <div
                            class={`pointer-events-none absolute inset-x-2 z-10 flex items-center ${
                              dropPosition() === 'before'
                                ? '-top-1'
                                : 'bottom-1'
                            }`}
                            aria-hidden="true"
                          >
                            <span class="h-2.5 w-2.5 rounded-full border-2 border-background bg-info shadow-xs" />
                            <span class="h-0.5 flex-1 bg-info shadow-xs" />
                          </div>
                        </Show>
                        <Show
                          when={editingCardId() !== card.id}
                          fallback={
                            <div class="overflow-hidden rounded-lg border bg-card shadow-xs">
                              <EditCardForm
                                sortedFields={sortedFields}
                                editInputs={editInputs}
                                setEditInputs={setEditInputs}
                                editSaving={editSaving}
                                onSubmit={handleEditCard}
                                onCancel={() => setEditingCardId(null)}
                              />
                            </div>
                          }
                        >
                          <CardItemRow
                            card={card}
                            index={index()}
                            selectMode={selectMode()}
                            isSelected={selectedIds().has(card.id)}
                            isEditing={false}
                            isDragSource={dragCardId() === card.id}
                            isDragging={isDragging()}
                            dragDisabledReason={reorderUnavailableReason()}
                            confirmDeleteId={confirmDeleteId()}
                            onToggleSelection={toggleCardSelection}
                            onStartEdit={startEdit}
                            onDelete={handleDeleteCard}
                            onConfirmDelete={setConfirmDeleteId}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                          />
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
                <p class="sr-only" aria-live="polite">
                  {isReordering() ? 'Saving the new card order' : ''}
                </p>
                <Show when={hasMoreServer() || fetchingMore()}>
                  <div class="flex items-center justify-center gap-2 py-3">
                    <Show when={fetchingMore()}>
                      <Loader2 class="h-3.5 w-3.5 text-muted-foreground motion-safe:animate-spin" />
                    </Show>
                    <p class="text-xs text-muted-foreground">
                      {filteredCards().length} of {cardCount()} cards loaded
                    </p>
                  </div>
                </Show>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      {/* ── AI Generate Modal (lazy-loaded) ── */}
      <Suspense>
        <AiGenerateModal
          deckId={params.deckId}
          open={showAiModal()}
          onClose={handleAiModalClose}
          onSaved={handleAiSaved}
          pendingJob={showAiModal() ? pendingJob() : null}
        />
      </Suspense>
    </PageShell>
  );
};

export default DeckViewPage;
