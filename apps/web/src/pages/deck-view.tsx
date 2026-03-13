import {
  type Component,
  createSignal,
  createResource,
  createMemo,
  createEffect,
  onCleanup,
  Show,
  For,
} from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import { useParams, useNavigate } from '@solidjs/router';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import ArrayInput from '@/components/ui/array-input';
import Sidebar from '@/components/layout/sidebar';
import MobileNav from '@/components/layout/mobile-nav';
import { toast } from '@/stores/toast.store';
import {
  ArrowLeft,
  Plus,
  Play,
  Trash2,
  Pencil,
  X,
  Check,
  Layers,
  Search,
  Hash,
  Sparkles,
  Loader2,
  Save,
  GripVertical,
  CheckSquare,
  Square,
} from 'lucide-solid';

import {
  WORD_TYPES,
  AI_SOURCE_MIN_CHARS,
  AI_SOURCE_MAX_CHARS,
  AI_BANNER_POLL_INTERVAL_MS,
  AI_BANNER_POLL_TIMEOUT_MS,
} from '@/constants';
import Spinner from '@/components/ui/spinner';

interface TemplateField {
  id: string;
  name: string;
  fieldType: string;
  side: string;
  sortOrder: number;
  isRequired: boolean;
  config: { placeholder?: string; maxItems?: number } | null;
}

interface CardField {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  side: string;
  value: unknown;
}

interface CardItem {
  id: string;
  sortOrder: number;
  fields: CardField[];
}

// ── Shared field editor (used by Add & Edit forms) ───────────────────────
const FieldEditor: Component<{
  field: TemplateField;
  value: unknown;
  onChange: (value: unknown) => void;
}> = (props) => {
  const strVal = () => String(props.value ?? '');
  const arrVal = (): string[] => {
    const v = props.value;
    return Array.isArray(v) ? (v as string[]) : [];
  };

  return (
    <div class="space-y-1">
      <label class="text-sm font-medium capitalize text-foreground">
        {props.field.name}
        {props.field.isRequired && <span class="text-destructive ml-1">*</span>}
        <span class="text-xs text-muted-foreground ml-2">
          ({props.field.side})
        </span>
      </label>

      <Show when={props.field.fieldType === 'json_array'}>
        <ArrayInput
          value={arrVal()}
          onChange={props.onChange}
          placeholder={
            props.field.config?.placeholder ?? `Add ${props.field.name}...`
          }
          maxItems={props.field.config?.maxItems}
        />
      </Show>
      <Show when={props.field.fieldType === 'textarea'}>
        <Textarea
          placeholder={props.field.config?.placeholder ?? props.field.name}
          value={strVal()}
          onInput={(e) => props.onChange(e.currentTarget.value)}
          required={props.field.isRequired}
        />
      </Show>
      <Show when={props.field.name === 'type'}>
        <select
          class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={strVal()}
          onChange={(e) => props.onChange(e.currentTarget.value)}
        >
          <option value="">Select type...</option>
          <For each={WORD_TYPES}>
            {(t) => <option value={t.value}>{t.label}</option>}
          </For>
        </select>
      </Show>
      <Show
        when={
          props.field.fieldType !== 'json_array' &&
          props.field.fieldType !== 'textarea' &&
          props.field.name !== 'type'
        }
      >
        <Input
          placeholder={props.field.config?.placeholder ?? props.field.name}
          value={strVal()}
          onInput={(e) => props.onChange(e.currentTarget.value)}
          required={props.field.isRequired}
        />
      </Show>
    </div>
  );
};

// ── Main Page ────────────────────────────────────────────────────────────
const DeckViewPage: Component = () => {
  const params = useParams<{ deckId: string }>();
  const navigate = useNavigate();

  // Add card state
  const [showAddCard, setShowAddCard] = createSignal(false);
  const [addInputs, setAddInputs] = createSignal<Record<string, unknown>>({});
  const [saving, setSaving] = createSignal(false);

  // Edit card state
  const [editingCardId, setEditingCardId] = createSignal<string | null>(null);
  const [editInputs, setEditInputs] = createSignal<Record<string, unknown>>({});
  const [editSaving, setEditSaving] = createSignal(false);

  // Delete confirm state
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(
    null,
  );

  // AI generation state
  const [showAiModal, setShowAiModal] = createSignal(false);
  const [aiSourceText, setAiSourceText] = createSignal('');
  const [aiBackLang, setAiBackLang] = createSignal<'vi' | 'en'>('vi');
  const [aiGenerating, setAiGenerating] = createSignal(false);
  // Store-based preview: fine-grained O(1) property updates per keystroke instead of full array copy
  const [aiPreviewOpen, setAiPreviewOpen] = createSignal(false);
  const [aiPreviewCards, setAiPreviewCards] = createStore<
    {
      front: string;
      back: string;
      ipa?: string;
      wordType?: string;
      examples?: string;
    }[]
  >([]);
  const [aiJobId, setAiJobId] = createSignal<string | null>(null);
  const [aiSaving, setAiSaving] = createSignal(false);
  // Layer 2: confirm dialog when closing with unsaved preview
  const [aiConfirmDiscard, setAiConfirmDiscard] = createSignal(false);
  // Layer 3: pending/processing job resume — fetch once on mount
  const [pendingJob, { refetch: refetchPendingJob }] = createResource(
    () => params.deckId,
    async (deckId) => {
      try {
        // Fetch only active jobs (processing | pending) for this deck.
        // Passing status filter avoids loading saved/failed history and ensures
        // even the oldest active job is returned regardless of limit.
        const { data } = await (api.ai as any).jobs.get({
          query: { limit: 5, status: 'processing,pending' },
        });
        if (!Array.isArray(data)) return null;
        return (data as any[]).find((j) => j.deckId === deckId) ?? null;
      } catch {
        return null;
      }
    },
  );
  const [pendingJobDismissed, setPendingJobDismissed] = createSignal(false);

  // Bulk selection state
  const [selectMode, setSelectMode] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = createSignal(false);

  // Drag-drop reorder state
  const [dragIndex, setDragIndex] = createSignal<number | null>(null);
  const [dropIndex, setDropIndex] = createSignal<number | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────
  const [deck] = createResource(
    () => params.deckId,
    async (deckId) => {
      const { data } = await (api.decks as any)[deckId].get();
      return data as {
        id: string;
        name: string;
        folderId: string;
        cardTemplateId: string;
      } | null;
    },
  );

  const [template] = createResource(
    () => deck()?.cardTemplateId,
    async (templateId) => {
      if (!templateId) return null;
      const { data } = await (api['card-templates'] as any)[templateId].get();
      return data as {
        id: string;
        name: string;
        fields: TemplateField[];
      } | null;
    },
  );

  const [cards, { refetch: refetchCards }] = createResource(
    () => params.deckId,
    async (deckId) => {
      const { data } = await api.cards['by-deck']({ deckId }).get();
      // API now returns paginated { items, total, page, limit, hasMore }
      const list = Array.isArray(data) ? data : ((data as any)?.items ?? []);
      return (list as CardItem[]).sort((a, b) => a.sortOrder - b.sortOrder);
    },
  );

  // ── Handlers ─────────────────────────────────────────────────────────
  const sortedFields = () =>
    [...(template()?.fields ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

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
      await api.cards['by-deck']({ deckId: params.deckId }).post({
        fieldValues,
      });
      setAddInputs({});
      setShowAddCard(false);
      refetchCards();
      toast.success('Card added successfully');
    } catch {
      toast.error('Failed to add card');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (card: CardItem, tmpl: { fields: TemplateField[] }) => {
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
      await (api.cards as any)[cardId].patch({ fieldValues });
      setEditingCardId(null);
      refetchCards();
      toast.success('Card updated');
    } catch {
      toast.error('Failed to update card');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    try {
      await (api.cards as any)[cardId].delete();
      setConfirmDeleteId(null);
      refetchCards();
      toast.success('Card deleted');
    } catch {
      toast.error('Failed to delete card');
    }
  };

  // ── AI handlers ──────────────────────────────────────────────────────
  // Polling interval reference — cleared on unmount or modal close
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  // Banner-level background poll — separate from modal poll so the banner
  // auto-updates even when the user has not clicked "View progress".
  let bannerPollTimer: ReturnType<typeof setInterval> | null = null;
  let bannerPollStartedAt = 0;
  // Tracks whether we saw the banner job as 'processing' so we can fire a
  // "ready" toast only on transition (not on initial page-load with pending job).
  let bannerSeenProcessing = false;

  onCleanup(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (bannerPollTimer) clearInterval(bannerPollTimer);
  });

  // Auto-poll the resume banner when a job is still processing.
  // Calls refetchPendingJob() every AI_BANNER_POLL_INTERVAL_MS until the job
  // reaches a terminal state (pending | failed | expired) or the timeout fires.
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
      // Notify when job transitions FROM processing → pending (cards ready)
      if (bannerSeenProcessing && job?.status === 'pending' && !dismissed) {
        bannerSeenProcessing = false;
        toast.success(
          `AI cards ready — ${job.cardCount ?? 'some'} cards generated!`,
        );
      }
      if (!job) bannerSeenProcessing = false;
    }
  });

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    // Resume banner polling if a background job is still processing
    // (modal closed but job not finished yet)
    const job = pendingJob();
    if (job?.status === 'processing' && !pendingJobDismissed()) {
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
    }
  };

  const startPolling = (jobId: string) => {
    // Pause banner polling while the modal is actively polling the same job.
    // This prevents duplicate concurrent requests to /ai/jobs endpoints.
    if (bannerPollTimer) {
      clearInterval(bannerPollTimer);
      bannerPollTimer = null;
    }
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const { data, error } = await (api.ai as any).jobs({ jobId }).get();
        if (error || !data) return; // transient error — try again next tick
        if (data.status === 'pending') {
          stopPolling();
          setAiGenerating(false);
          setAiPreviewCards(reconcile((data.generatedCards as any[]) ?? []));
          setAiPreviewOpen(true);
        } else if (data.status === 'failed') {
          stopPolling();
          setAiGenerating(false);
          setAiJobId(null);
          toast.error(data.errorMessage ?? 'AI generation failed');
        }
        // else: still 'processing' — keep polling
      } catch {
        // network hiccup — keep polling
      }
    }, 2000);
  };

  const handleAiGenerate = async () => {
    const text = aiSourceText().trim();
    if (!text || text.length < 10) {
      toast.error('Please enter at least 10 characters');
      return;
    }
    setAiGenerating(true);
    try {
      const { data, error } = await (api.ai as any).generate.post({
        deckId: params.deckId,
        sourceText: text,
        backLanguage: aiBackLang(),
      });
      if (error) throw new Error(error.error ?? 'Generation failed');
      setAiJobId(data.jobId);
      startPolling(data.jobId);
    } catch (err: any) {
      setAiGenerating(false);
      toast.error(err?.message ?? 'AI generation failed');
    }
    // Note: setAiGenerating(false) is called by the polling handler, not here
  };

  const handleAiSave = async () => {
    const jobId = aiJobId();
    if (!jobId || !aiPreviewOpen()) return;
    stopPolling(); // ensure no in-flight poll interferes with save
    setAiSaving(true);
    try {
      const { error } = await (api.ai as any).jobs({ jobId }).save.post({
        // Map to plain objects and strip null optional fields so TypeBox
        // t.Optional(t.String()) doesn't reject AI-returned null values
        cards: aiPreviewCards.map((c) => ({
          front: c.front,
          back: c.back,
          ...(c.ipa != null ? { ipa: c.ipa } : {}),
          ...(c.wordType != null ? { wordType: c.wordType } : {}),
          ...(c.examples != null ? { examples: c.examples } : {}),
        })),
      });
      if (error) throw new Error(error.error ?? 'Save failed');
      toast.success(`${aiPreviewCards.length} cards saved!`);
      setShowAiModal(false);
      setAiPreviewOpen(false);
      setAiPreviewCards(reconcile([]));
      setAiJobId(null);
      setAiSourceText('');
      setPendingJobDismissed(false);
      refetchPendingJob();
      refetchCards();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save cards');
    } finally {
      setAiSaving(false);
    }
  };

  // Layer 2: confirm when preview is ready but unsaved — generation is always closeable
  const closeAiModal = () => {
    if (aiPreviewOpen() && aiJobId()) {
      setAiConfirmDiscard(true); // Layer 2: ask before discarding unsaved preview
      return;
    }
    forceCloseAiModal();
  };

  const forceCloseAiModal = () => {
    const hadActiveJob = !!aiJobId();
    stopPolling();
    setAiConfirmDiscard(false);
    setShowAiModal(false);
    setAiPreviewOpen(false);
    setAiPreviewCards(reconcile([]));
    setAiJobId(null);
    setAiSourceText('');
    setAiBackLang('vi');
    // If a job was in progress, refetch so the resume banner shows immediately
    if (hadActiveJob) refetchPendingJob();
  };

  // Layer 3: resume a pending/processing job stored in DB
  const handleResumeJob = async () => {
    const job = pendingJob();
    if (!job) return;
    setShowAiModal(true);
    if (job.status === 'processing') {
      // Still generating — open modal in spinner state and poll for completion
      setAiJobId(job.id);
      setAiGenerating(true);
      startPolling(job.id);
    } else {
      // status === 'pending' — cards are ready, load preview
      try {
        const { data, error } = await (api.ai as any)
          .jobs({ jobId: job.id })
          .get();
        if (error || !data) throw new Error('Failed to fetch job');
        setAiPreviewCards(reconcile((data.generatedCards as any[]) ?? []));
        setAiJobId(data.id);
        setAiPreviewOpen(true);
        setPendingJobDismissed(false);
      } catch {
        toast.error('Failed to resume session');
        setShowAiModal(false);
      }
    }
  };

  // ── Bulk selection handlers ──────────────────────────────────────────
  const toggleSelectMode = () => {
    if (selectMode()) {
      setSelectMode(false);
      setSelectedIds(new Set<string>());
    } else {
      setSelectMode(true);
      setSelectedIds(new Set<string>());
    }
  };

  const toggleCardSelection = (cardId: string) => {
    const s = new Set(selectedIds());
    if (s.has(cardId)) s.delete(cardId);
    else s.add(cardId);
    setSelectedIds(s);
  };

  const selectAll = () => {
    const all = filteredCards();
    setSelectedIds(new Set(all.map((c) => c.id)));
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds()];
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      await (api.cards['by-deck']({ deckId: params.deckId }) as any)[
        'batch'
      ].delete({ cardIds: ids });
      toast.success(`${ids.length} card${ids.length > 1 ? 's' : ''} deleted`);
      setSelectedIds(new Set<string>());
      setSelectMode(false);
      refetchCards();
    } catch {
      toast.error('Failed to delete cards');
    } finally {
      setBulkDeleting(false);
    }
  };

  // ── Drag-drop reorder ───────────────────────────────────────────────
  const handleDragStart = (index: number, e: DragEvent) => {
    setDragIndex(index);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  };

  const handleDragOver = (index: number, e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setDropIndex(index);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  const handleDrop = async (targetIndex: number, e: DragEvent) => {
    e.preventDefault();
    const fromIndex = dragIndex();
    if (fromIndex === null || fromIndex === targetIndex) {
      handleDragEnd();
      return;
    }

    const list = [...filteredCards()];
    const [moved] = list.splice(fromIndex, 1);
    list.splice(targetIndex, 0, moved);

    // Optimistic: update card IDs order in the API
    const cardIds = list.map((c) => c.id);
    handleDragEnd();

    try {
      await api.cards['by-deck']({ deckId: params.deckId }).reorder.patch({
        cardIds,
      });
      refetchCards();
    } catch {
      toast.error('Failed to reorder cards');
      refetchCards();
    }
  };

  // ── Search / filter ──────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = createSignal('');

  const filteredCards = createMemo(() => {
    const q = searchQuery().toLowerCase().trim();
    const all = cards() ?? [];
    if (!q) return all;
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

  const cardCount = () => cards()?.length ?? 0;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div class="h-screen flex overflow-hidden">
      <Sidebar />
      <main class="flex-1 overflow-y-auto">
        {/* ── Hero header ── */}
        <div class="border-b px-6 py-4">
          <div class="max-w-5xl mx-auto">
            <div class="flex items-center gap-3 mb-3">
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 shrink-0"
                onClick={() => {
                  const folderId = deck()?.folderId;
                  navigate(folderId ? `/folder/${folderId}` : '/');
                }}
              >
                <ArrowLeft class="h-4 w-4" />
              </Button>
              <div class="flex-1 min-w-0">
                <h1 class="text-xl font-bold truncate leading-tight">
                  {deck()?.name ?? 'Loading...'}
                </h1>
                <div class="flex items-center gap-3 mt-1">
                  <Show when={template()}>
                    <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-palette-5/15 text-palette-5 font-medium">
                      <Layers class="h-3 w-3" />
                      {template()!.name}
                    </span>
                  </Show>
                  <span class="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Hash class="h-3 w-3" />
                    {cardCount()} card{cardCount() !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions row */}
            <div class="flex items-center gap-3">
              <Button
                onClick={() => navigate(`/study/${params.deckId}`)}
                class="shadow-sm"
              >
                <Play class="h-4 w-4 mr-2" />
                Study Now
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setAddInputs({});
                  setShowAddCard(true);
                }}
                disabled={showAddCard()}
              >
                <Plus class="h-4 w-4 mr-2" />
                Add Card
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowAiModal(true)}
                disabled={showAiModal()}
                class="text-palette-5 border-palette-5/30 hover:bg-palette-5/10"
              >
                <Sparkles class="h-4 w-4 mr-2" />
                AI Generate
              </Button>{' '}
              <Button
                variant={selectMode() ? 'default' : 'outline'}
                onClick={toggleSelectMode}
              >
                <CheckSquare class="h-4 w-4 mr-2" />
                {selectMode() ? 'Cancel' : 'Select'}
              </Button>
              {/* Search */}
              <div class="ml-auto relative max-w-xs w-full">
                <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search cards..."
                  class="pl-9 h-9 text-sm"
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Content ── */}
        <div class="p-6">
          <div class="max-w-5xl mx-auto space-y-4">
            {/* ── Layer 3: Pending/processing AI job resume banner ── */}
            <Show
              when={pendingJob() && !pendingJobDismissed() && !showAiModal()}
            >
              <div class="flex items-center gap-3 px-4 py-3 rounded-xl border border-palette-5/30 bg-palette-5/5 text-sm animate-fade-in">
                <Show
                  when={pendingJob()!.status === 'processing'}
                  fallback={
                    <Sparkles class="h-4 w-4 text-palette-5 shrink-0" />
                  }
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

            {/* Add card form */}
            <Show when={showAddCard() && template()}>
              <form
                onSubmit={handleAddCard}
                class="border rounded-xl p-6 bg-card shadow-sm space-y-4 animate-fade-in"
              >
                <div class="flex items-center justify-between">
                  <h3 class="font-semibold text-foreground">New Card</h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8"
                    onClick={() => setShowAddCard(false)}
                  >
                    <X class="h-4 w-4" />
                  </Button>
                </div>
                <For each={sortedFields()}>
                  {(field) => (
                    <FieldEditor
                      field={field}
                      value={addInputs()[field.id]}
                      onChange={(v) =>
                        setAddInputs((prev) => ({ ...prev, [field.id]: v }))
                      }
                    />
                  )}
                </For>
                <div class="flex gap-2 pt-1">
                  <Button type="submit" disabled={saving()}>
                    {saving() ? 'Saving...' : 'Save Card'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAddCard(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Show>

            {/* Bulk action bar */}
            <Show when={selectMode()}>
              <div class="flex items-center gap-3 p-3 border rounded-xl bg-accent/50">
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  Select All
                </Button>
                <span class="text-sm text-muted-foreground">
                  {selectedIds().size} selected
                </span>
                <div class="ml-auto flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={selectedIds().size === 0 || bulkDeleting()}
                    onClick={handleBulkDelete}
                  >
                    <Trash2 class="h-3.5 w-3.5 mr-1.5" />
                    {bulkDeleting()
                      ? 'Deleting...'
                      : `Delete (${selectedIds().size})`}
                  </Button>
                </div>
              </div>
            </Show>

            {/* Card list */}
            <Show when={cards.loading}>
              <div class="space-y-3">
                <For each={[1, 2, 3]}>
                  {() => <div class="h-24 rounded-xl bg-muted animate-pulse" />}
                </For>
              </div>
            </Show>

            <Show when={!cards.loading}>
              <Show
                when={filteredCards().length > 0}
                fallback={
                  <div class="text-center py-16">
                    <Show
                      when={cardCount() === 0}
                      fallback={
                        <div>
                          <p class="text-muted-foreground text-sm">
                            No results for &ldquo;{searchQuery()}&rdquo;
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
                <div class="space-y-2">
                  <For each={filteredCards()}>
                    {(card, index) => {
                      const getField = (name: string) =>
                        card.fields.find((f) => f.fieldName === name);
                      const hasValue = (f: CardField | undefined) => {
                        if (!f) return false;
                        if (Array.isArray(f.value))
                          return (f.value as string[]).length > 0;
                        return String(f.value ?? '').trim() !== '';
                      };
                      const getExamples = (): string[] => {
                        const f = getField('examples');
                        if (!f || !Array.isArray(f.value)) return [];
                        return f.value as string[];
                      };

                      const wordField = getField('word');
                      const typeField = getField('type');
                      const ipaField = getField('ipa');
                      const defField = getField('definition');
                      const isVocabLayout =
                        hasValue(wordField) && hasValue(defField);
                      const examples = getExamples();

                      const otherFields = card.fields.filter(
                        (f) =>
                          ![
                            'word',
                            'type',
                            'ipa',
                            'definition',
                            'examples',
                          ].includes(f.fieldName) && hasValue(f),
                      );

                      return (
                        <div
                          class={`group border rounded-xl bg-card overflow-hidden transition-shadow ${
                            dragIndex() === index()
                              ? 'opacity-40'
                              : dropIndex() === index()
                                ? 'border-palette-5 shadow-md'
                                : 'hover:shadow-sm'
                          }`}
                          draggable={
                            !selectMode() && editingCardId() !== card.id
                          }
                          onDragStart={(e) => handleDragStart(index(), e)}
                          onDragOver={(e) => handleDragOver(index(), e)}
                          onDrop={(e) => handleDrop(index(), e)}
                          onDragEnd={handleDragEnd}
                          onDragLeave={() => setDropIndex(null)}
                        >
                          {/* Normal view */}
                          <Show when={editingCardId() !== card.id}>
                            <div class="p-4 flex items-start gap-3">
                              {/* Drag handle */}
                              <Show when={!selectMode()}>
                                <div
                                  class="mt-1 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                                  title="Drag to reorder"
                                >
                                  <GripVertical class="h-4 w-4" />
                                </div>
                              </Show>

                              {/* Checkbox for bulk select */}
                              <Show when={selectMode()}>
                                <button
                                  class="mt-1 shrink-0"
                                  onClick={() => toggleCardSelection(card.id)}
                                >
                                  <Show
                                    when={selectedIds().has(card.id)}
                                    fallback={
                                      <Square class="h-4.5 w-4.5 text-muted-foreground hover:text-foreground" />
                                    }
                                  >
                                    <CheckSquare class="h-4.5 w-4.5 text-palette-5" />
                                  </Show>
                                </button>
                              </Show>

                              {/* Card number */}
                              <span class="text-xs font-mono text-muted-foreground/60 mt-1 shrink-0 w-6 text-right">
                                {index() + 1}
                              </span>

                              <div class="flex-1 min-w-0">
                                {/* Vocabulary two-column layout */}
                                <Show when={isVocabLayout}>
                                  <div class="grid grid-cols-[1fr_1fr] gap-0">
                                    <div class="pr-4">
                                      <p class="font-semibold text-foreground leading-snug">
                                        {String(wordField!.value)}
                                        <Show when={hasValue(typeField)}>
                                          <span class="ml-1.5 text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                            {String(typeField!.value)}
                                          </span>
                                        </Show>
                                      </p>
                                      <Show when={hasValue(ipaField)}>
                                        <p class="text-sm text-muted-foreground/70 mt-0.5 font-mono">
                                          {String(ipaField!.value)}
                                        </p>
                                      </Show>
                                    </div>

                                    <div class="border-l pl-4">
                                      <p class="text-sm text-foreground leading-relaxed">
                                        {String(defField!.value)}
                                      </p>
                                      <Show when={examples.length > 0}>
                                        <ul class="mt-2 space-y-1">
                                          <For each={examples}>
                                            {(ex) => (
                                              <li class="text-xs text-muted-foreground flex gap-1.5 items-start">
                                                <span class="text-palette-3/50 shrink-0 mt-0.5">
                                                  &bull;
                                                </span>
                                                <span class="italic">{ex}</span>
                                              </li>
                                            )}
                                          </For>
                                        </ul>
                                      </Show>
                                    </div>
                                  </div>

                                  <Show when={otherFields.length > 0}>
                                    <div class="mt-2 pt-2 border-t space-y-1">
                                      <For each={otherFields}>
                                        {(f) => (
                                          <div class="text-sm">
                                            <span class="text-muted-foreground capitalize font-extrabold">
                                              {f.fieldName}:{' '}
                                            </span>
                                            <span>
                                              {Array.isArray(f.value)
                                                ? (f.value as string[]).join(
                                                    ' · ',
                                                  )
                                                : String(f.value)}
                                            </span>
                                          </div>
                                        )}
                                      </For>
                                    </div>
                                  </Show>
                                </Show>

                                {/* Fallback: linear layout */}
                                <Show when={!isVocabLayout}>
                                  <div class="space-y-1">
                                    <For
                                      each={card.fields.filter((f) =>
                                        hasValue(f),
                                      )}
                                    >
                                      {(field) => (
                                        <div class="text-sm">
                                          <span class="text-muted-foreground capitalize font-extrabold">
                                            {field.fieldName}:{' '}
                                          </span>
                                          <span>
                                            {Array.isArray(field.value)
                                              ? (field.value as string[]).join(
                                                  ' · ',
                                                )
                                              : String(field.value)}
                                          </span>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </div>

                              {/* Action buttons (visible on hover) */}
                              <div class="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  class="h-8 w-8 text-muted-foreground hover:text-foreground"
                                  title="Edit card"
                                  onClick={() => {
                                    const tmpl = template();
                                    if (tmpl) startEdit(card, tmpl);
                                  }}
                                >
                                  <Pencil class="h-3.5 w-3.5" />
                                </Button>
                                <Show
                                  when={confirmDeleteId() === card.id}
                                  fallback={
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      class="h-8 w-8 text-muted-foreground hover:text-destructive"
                                      title="Delete card"
                                      onClick={() =>
                                        setConfirmDeleteId(card.id)
                                      }
                                    >
                                      <Trash2 class="h-3.5 w-3.5" />
                                    </Button>
                                  }
                                >
                                  <div class="flex items-center gap-1">
                                    <span class="text-xs text-destructive whitespace-nowrap font-medium">
                                      Delete?
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      class="h-8 w-8 text-destructive hover:bg-destructive/10"
                                      onClick={() => handleDeleteCard(card.id)}
                                    >
                                      <Check class="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      class="h-8 w-8"
                                      onClick={() => setConfirmDeleteId(null)}
                                    >
                                      <X class="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </Show>
                              </div>
                            </div>
                          </Show>

                          {/* Edit form */}
                          <Show
                            when={editingCardId() === card.id && template()}
                          >
                            <form
                              onSubmit={handleEditCard}
                              class="p-5 space-y-3 bg-accent/30"
                            >
                              <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                Editing card
                              </p>
                              <For each={sortedFields()}>
                                {(field) => (
                                  <FieldEditor
                                    field={field}
                                    value={editInputs()[field.id]}
                                    onChange={(v) =>
                                      setEditInputs((prev) => ({
                                        ...prev,
                                        [field.id]: v,
                                      }))
                                    }
                                  />
                                )}
                              </For>
                              <div class="flex gap-2 pt-1">
                                <Button type="submit" disabled={editSaving()}>
                                  {editSaving() ? 'Saving...' : 'Save'}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => setEditingCardId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </form>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </main>

      {/* ── AI Generate Modal ─────────────────────────────────────────── */}
      <Show when={showAiModal()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAiModal();
          }}
        >
          <div class="relative bg-card border rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4 animate-fade-in">
            {/* Header */}
            <div class="flex items-center justify-between p-5 border-b">
              <div class="flex items-center gap-2">
                <Sparkles class="h-5 w-5 text-palette-4" />
                <h2 class="text-lg font-semibold">AI Card Generator</h2>
                <Show when={aiGenerating()}>
                  <span class="text-xs text-muted-foreground">Generating…</span>
                </Show>
              </div>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                onClick={closeAiModal}
                title="Close"
              >
                <X class="h-4 w-4" />
              </Button>
            </div>

            {/* Layer 2: Confirm discard overlay */}
            <Show when={aiConfirmDiscard()}>
              <div class="absolute inset-0 z-10 flex items-center justify-center bg-black/60 rounded-2xl">
                <div class="bg-card border rounded-xl shadow-xl p-6 mx-6 space-y-4 max-w-sm w-full">
                  <h3 class="font-semibold text-foreground">
                    Discard unsaved cards?
                  </h3>
                  <p class="text-sm text-muted-foreground">
                    You have{' '}
                    <strong>{aiPreviewCards.length} generated cards</strong>{' '}
                    that haven't been saved yet. The session will be available
                    for 24 hours — you can resume it later from the deck view.
                  </p>
                  <div class="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAiConfirmDiscard(false)}
                    >
                      Keep editing
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={forceCloseAiModal}
                    >
                      Close anyway
                    </Button>
                  </div>
                </div>
              </div>
            </Show>

            {/* Body */}
            <div class="flex-1 overflow-y-auto p-5 space-y-4">
              <Show
                when={aiPreviewOpen()}
                fallback={
                  <Show
                    when={aiGenerating()}
                    fallback={
                      /* ── Input phase ── */
                      <div class="space-y-4">
                        {/* Back language selector */}
                        <div class="space-y-2">
                          <label class="text-sm font-medium text-foreground">
                            Back (explanation) language
                          </label>
                          <div class="flex gap-2">
                            <For
                              each={
                                [
                                  { value: 'vi', label: '🇻🇳 Tiếng Việt' },
                                  { value: 'en', label: '🇬🇧 English' },
                                ] as const
                              }
                            >
                              {(opt) => (
                                <button
                                  type="button"
                                  onClick={() => setAiBackLang(opt.value)}
                                  class={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                                    aiBackLang() === opt.value
                                      ? 'border-palette-4 bg-palette-4/10 text-foreground'
                                      : 'border-border bg-background text-muted-foreground hover:border-palette-4/50'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              )}
                            </For>
                          </div>
                        </div>

                        {/* Source text */}
                        <div class="space-y-2">
                          <label class="text-sm font-medium text-foreground">
                            Paste your notes, text, or describe a topic
                          </label>
                          <Textarea
                            placeholder={`Enter or paste text to generate flashcards from... (min ${AI_SOURCE_MIN_CHARS} characters)`}
                            value={aiSourceText()}
                            onInput={(e) => {
                              const raw = e.currentTarget.value;
                              const val = raw.slice(0, AI_SOURCE_MAX_CHARS);
                              // Keep DOM in sync when paste exceeds limit
                              if (raw !== val) e.currentTarget.value = val;
                              setAiSourceText(val);
                            }}
                            class="min-h-50 resize-y"
                          />
                          <div class="flex justify-between text-xs">
                            <Show
                              when={
                                aiSourceText().trim().length > 0 &&
                                aiSourceText().trim().length <
                                  AI_SOURCE_MIN_CHARS
                              }
                            >
                              <span class="text-destructive">
                                Need at least {AI_SOURCE_MIN_CHARS} characters
                              </span>
                            </Show>
                            <span
                              class="ml-auto"
                              classList={{
                                'text-destructive':
                                  aiSourceText().length >= AI_SOURCE_MAX_CHARS,
                                'text-amber-500':
                                  aiSourceText().length >=
                                  AI_SOURCE_MAX_CHARS * 0.9,
                                'text-muted-foreground':
                                  aiSourceText().length <
                                  AI_SOURCE_MAX_CHARS * 0.9,
                              }}
                            >
                              {aiSourceText().length.toLocaleString()} /{' '}
                              {AI_SOURCE_MAX_CHARS.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    }
                  >
                    {/* ── Generating state ── */}
                    <div class="flex flex-col items-center justify-center py-16 gap-6">
                      <Spinner size="lg" />
                      <div class="text-center space-y-1.5">
                        <p class="text-sm font-medium text-foreground">
                          AI is generating your flashcards…
                        </p>
                        <p class="text-xs text-muted-foreground max-w-xs">
                          You can close this modal anytime — generation runs in
                          the background and you can resume when it's done.
                        </p>
                      </div>
                    </div>
                  </Show>
                }
              >
                {/* ── Preview phase ── */}
                <div class="space-y-1">
                  <p class="text-sm text-muted-foreground">
                    Review and edit generated cards before saving.
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {aiPreviewCards.length} cards generated
                  </p>
                </div>
                <div class="space-y-3">
                  <For each={aiPreviewCards}>
                    {(card, getIdx) => (
                      <div class="border rounded-lg p-4 space-y-3 bg-background">
                        {/* Card header */}
                        <div class="flex items-center justify-between">
                          <div class="flex items-center gap-2">
                            <span class="text-xs font-medium text-muted-foreground">
                              Card {getIdx() + 1}
                            </span>
                            {/* Vocab type + IPA badges */}
                            <Show when={card.wordType || card.ipa}>
                              <div class="flex items-center gap-1">
                                <Show when={card.wordType}>
                                  <span class="text-xs px-1.5 py-0.5 rounded bg-muted border text-muted-foreground">
                                    {card.wordType}
                                  </span>
                                </Show>
                                <Show when={card.ipa}>
                                  <span class="text-xs px-1.5 py-0.5 rounded bg-muted border font-mono text-muted-foreground">
                                    {card.ipa}
                                  </span>
                                </Show>
                              </div>
                            </Show>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            class="h-6 w-6 text-destructive"
                            onClick={() =>
                              setAiPreviewCards(
                                produce((c) => {
                                  c.splice(getIdx(), 1);
                                }),
                              )
                            }
                          >
                            <Trash2 class="h-3 w-3" />
                          </Button>
                        </div>

                        {/* Front */}
                        <div>
                          <label class="text-xs text-muted-foreground">
                            Front
                          </label>
                          <Textarea
                            value={card.front}
                            onInput={(e) =>
                              setAiPreviewCards(
                                getIdx(),
                                'front',
                                e.currentTarget.value,
                              )
                            }
                            class="mt-1 min-h-15"
                          />
                        </div>

                        {/* Back */}
                        <div>
                          <label class="text-xs text-muted-foreground">
                            Back
                          </label>
                          <Textarea
                            value={card.back}
                            onInput={(e) =>
                              setAiPreviewCards(
                                getIdx(),
                                'back',
                                e.currentTarget.value,
                              )
                            }
                            class="mt-1 min-h-15"
                          />
                        </div>

                        {/* Examples (read-only, vocab only) */}
                        <Show when={card.examples}>
                          <div class="pt-1 border-t">
                            <p class="text-xs font-medium text-muted-foreground mb-1">
                              Examples
                            </p>
                            <p class="text-xs text-muted-foreground italic leading-relaxed whitespace-pre-line">
                              {card.examples}
                            </p>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* Footer */}
            <div class="flex items-center justify-end gap-2 p-5 border-t">
              <Show
                when={aiPreviewOpen()}
                fallback={
                  <Show
                    when={aiGenerating()}
                    fallback={
                      /* Input phase footer */
                      <>
                        <Button variant="outline" onClick={closeAiModal}>
                          Cancel
                        </Button>
                        <Button
                          onClick={handleAiGenerate}
                          disabled={
                            aiSourceText().trim().length <
                              AI_SOURCE_MIN_CHARS ||
                            aiSourceText().length > AI_SOURCE_MAX_CHARS
                          }
                        >
                          <Sparkles class="h-4 w-4 mr-2" />
                          Generate Cards
                        </Button>
                      </>
                    }
                  >
                    {/* Generating state footer */}
                    <Button variant="outline" onClick={closeAiModal}>
                      Close — run in background
                    </Button>
                  </Show>
                }
              >
                <Button
                  variant="outline"
                  onClick={() => {
                    setAiPreviewOpen(false);
                    setAiJobId(null);
                  }}
                >
                  Back to Edit
                </Button>
                <Button
                  onClick={handleAiSave}
                  disabled={aiSaving() || !aiPreviewCards.length}
                >
                  <Show
                    when={aiSaving()}
                    fallback={<Save class="h-4 w-4 mr-2" />}
                  >
                    <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                  </Show>
                  {aiSaving()
                    ? 'Saving...'
                    : `Save ${aiPreviewCards.length} Cards`}
                </Button>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default DeckViewPage;
