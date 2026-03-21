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
import { useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { api, getApiError } from '@/api/client';
import { queryClient } from '@/lib/query-client';
import PageShell from '@/components/layout/page-shell';
import { Button } from '@/components/ui/button';
import { toast } from '@/stores/toast.store';
import { Sparkles, Loader2, X, Plus, Layers, BarChart3 } from 'lucide-solid';
import {
  AI_BANNER_POLL_INTERVAL_MS,
  AI_BANNER_POLL_TIMEOUT_MS,
} from '@/constants';

import { createDebouncedSignal } from '@/lib/create-debounced-signal';
import VirtualList from '@/lib/virtual-list';
import { useDeckData } from './use-deck-data';
import type { CardItem } from './types';
import DeckHeader from './deck-header';
import CardItemRow from './card-item';
import AddCardForm from './add-card-form';
import EditCardForm from './edit-card-form';
import BulkActionsBar from './bulk-actions-bar';

// Lazy-load AI modal (heavy component with its own store)
const AiGenerateModal = lazy(() => import('./ai-generate-modal'));

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
  const navigate = useNavigate();
  const {
    params,
    deck,
    template,
    cards,
    cardLoading,
    cardCount,
    sortedFields,
    localCards,
    setLocalCards,
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
              'AI generation is taking too long. The job may have failed — please try again.',
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
          `AI cards ready — ${job.cardCount ?? 'some'} cards generated!`,
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
  const [dragIndex, setDragIndex] = createSignal<number | null>(null);
  const [dropIndex, setDropIndex] = createSignal<number | null>(null);
  const [isDragging, setIsDragging] = createSignal(false);

  // ── Search / filter (debounced 250ms) ──────────────────────────
  const [searchQuery, setSearchQuery, immediateSearchQuery] =
    createDebouncedSignal('', 250);

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

  // ── VirtualList infinite scroll trigger ─────────────────────────
  const handleReachEnd = () => {
    if (hasMoreServer() && !fetchingMore()) {
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
  const handleDragStart = (index: number, e: DragEvent) => {
    batch(() => {
      setDragIndex(index);
      setIsDragging(true);
    });
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  };

  const handleDragOver = (index: number, e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dropIndex() !== index) setDropIndex(index);
  };

  const handleDragEnd = () => {
    batch(() => {
      setDragIndex(null);
      setDropIndex(null);
      setIsDragging(false);
    });
  };

  const handleDrop = async (targetIndex: number, e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const fromIndex = dragIndex();
    if (fromIndex === null || fromIndex === targetIndex) {
      handleDragEnd();
      return;
    }

    const allCards = cards();
    if (!allCards) {
      handleDragEnd();
      return;
    }

    const filtered = filteredCards();
    const movedCard = filtered[fromIndex];
    const targetCard = filtered[targetIndex];

    const fullFromIndex = allCards.findIndex((c) => c.id === movedCard.id);
    const fullTargetIndex = allCards.findIndex((c) => c.id === targetCard.id);

    const reordered = [...allCards];
    const [moved] = reordered.splice(fullFromIndex, 1);
    reordered.splice(fullTargetIndex, 0, moved);

    const updatedCards = reordered.map((card, idx) => ({
      ...card,
      sortOrder: idx,
    }));

    const cardIds = reordered.map((c) => c.id);
    handleDragEnd();
    setLocalCards(updatedCards);

    const { error: reorderError } = await api.cards['by-deck']({
      deckId: params.deckId,
    }).reorder.patch({
      cardIds,
    });
    if (reorderError) {
      toast.error(getApiError(reorderError) || 'Failed to reorder cards');
      refetchCards();
    }
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

      {/* ── Content ── */}
      <div class={`flex-1 min-h-0 p-6 ${showAnalytics() ? 'overflow-y-auto' : 'overflow-hidden'}`}>
        <div class={`max-w-5xl mx-auto ${showAnalytics() ? '' : 'h-full'} flex flex-col gap-4`}>
          {/* ── Pending AI job resume banner ── */}
          <Show when={pendingJob() && !pendingJobDismissed() && !showAiModal()}>
            <div class="flex items-center gap-3 px-4 py-3 rounded-xl border border-palette-5/30 bg-palette-5/5 text-sm animate-fade-in">
              <Show
                when={pendingJob()!.status === 'processing'}
                fallback={<Sparkles class="h-4 w-4 text-palette-5 shrink-0" />}
              >
                <Loader2 class="h-4 w-4 text-palette-5 shrink-0 animate-spin" />
              </Show>
              <span class="flex-1 text-foreground">
                <Show
                  when={pendingJob()!.status === 'processing'}
                  fallback={
                    <>
                      You have an unsaved AI generation —{' '}
                      <strong>{pendingJob()!.cardCount} cards</strong> waiting
                      to be saved.
                    </>
                  }
                >
                  AI is generating your cards in the background&hellip;
                </Show>
              </span>
              <Button
                size="sm"
                variant="outline"
                class="border-palette-5/40 text-palette-5 hover:bg-palette-5/10 h-7 px-3 text-xs"
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
                class="text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setPendingJobDismissed(true)}
                aria-label="Dismiss"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          </Show>

          {/* ── Analytics Panel (lazy-loaded) ── */}
          <Show when={showAnalytics()}>
            <div class="space-y-4 animate-fade-in">
              <Suspense
                fallback={
                  <div class="h-32 rounded-xl bg-muted animate-pulse" />
                }
              >
                <RetentionHeatmap deckId={params.deckId} />
              </Suspense>
              <Suspense
                fallback={
                  <div class="h-80 rounded-xl bg-muted animate-pulse" />
                }
              >
                <GraphView deckId={params.deckId} />
              </Suspense>
              <Suspense fallback={null}>
                <DuplicateScanner deckId={params.deckId} />
              </Suspense>
              <Suspense fallback={null}>
                <AiSuggestions deckId={params.deckId} />
              </Suspense>
            </div>
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
            <div class="space-y-3">
              <For each={[1, 2, 3]}>
                {() => <div class="h-24 rounded-xl bg-muted animate-pulse" />}
              </For>
            </div>
          </Show>

          {/* Card list */}
          <Show when={!cardLoading()}>
            <div class="flex flex-col flex-1" style={{ "min-height": showAnalytics() ? "400px" : undefined }}>
              <Show
                when={filteredCards().length > 0}
                fallback={
                  <div class="text-center py-16">
                    <Show
                      when={cardCount() === 0}
                      fallback={
                        <div>
                          <p class="text-muted-foreground text-sm">
                            No results for &ldquo;{immediateSearchQuery()}
                            &rdquo;
                          </p>
                        </div>
                      }
                    >
                      <div class="inline-flex h-16 w-16 rounded-full bg-muted items-center justify-center mb-4">
                        <Layers class="h-7 w-7 text-muted-foreground" />
                      </div>
                      <p class="text-foreground font-medium mb-1">
                        No cards yet
                      </p>
                      <p class="text-muted-foreground text-sm mb-4">
                        Click <strong>Add Card</strong> to get started!
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setAddInputs({});
                          setShowAddCard(true);
                        }}
                      >
                        <Plus class="h-4 w-4 mr-2" />
                        Add your first card
                      </Button>
                    </Show>
                  </div>
                }
              >
                <VirtualList
                  items={filteredCards()}
                  estimatedRowHeight={120}
                  overscan={5}
                  class="flex-1 min-h-0"
                  onReachEnd={handleReachEnd}
                >
                  {(card, index) => (
                    <div class="pb-2">
                      <Show
                        when={editingCardId() !== card.id}
                        fallback={
                          <div class="border rounded-xl bg-card overflow-hidden">
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
                          isDragSource={dragIndex() === index()}
                          isDropTarget={dropIndex() === index()}
                          isDragging={isDragging()}
                          confirmDeleteId={confirmDeleteId()}
                          onToggleSelection={toggleCardSelection}
                          onStartEdit={startEdit}
                          onDelete={handleDeleteCard}
                          onConfirmDelete={setConfirmDeleteId}
                          onDragStart={handleDragStart}
                          onDragOver={handleDragOver}
                          onDrop={handleDrop}
                          onDragEnd={handleDragEnd}
                          onDragLeave={() => setDropIndex(null)}
                        />
                      </Show>
                    </div>
                  )}
                </VirtualList>
                <Show when={hasMoreServer() || fetchingMore()}>
                  <div class="flex items-center justify-center gap-2 py-3">
                    <Show when={fetchingMore()}>
                      <Loader2 class="h-3.5 w-3.5 text-muted-foreground animate-spin" />
                    </Show>
                    <p class="text-xs text-muted-foreground">
                      Showing {filteredCards().length} of {cardCount()} cards…
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
