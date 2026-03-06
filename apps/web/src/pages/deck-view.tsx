import {
  type Component,
  createSignal,
  createResource,
  createMemo,
  Show,
  For,
  Index,
} from 'solid-js';
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

const WORD_TYPES = [
  { value: 'noun', label: 'Noun (n)' },
  { value: 'verb', label: 'Verb (v)' },
  { value: 'adj', label: 'Adjective (adj)' },
  { value: 'adv', label: 'Adverb (adv)' },
  { value: 'prep', label: 'Preposition (prep)' },
  { value: 'conj', label: 'Conjunction (conj)' },
  { value: 'pron', label: 'Pronoun (pron)' },
  { value: 'det', label: 'Determiner (det)' },
  { value: 'intj', label: 'Interjection (intj)' },
  { value: 'phrasal verb', label: 'Phrasal verb' },
  { value: 'idiom', label: 'Idiom' },
  { value: 'phrase', label: 'Phrase' },
] as const;

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
  const [aiCardCount, setAiCardCount] = createSignal(10);
  const [aiGenerating, setAiGenerating] = createSignal(false);
  const [aiPreview, setAiPreview] = createSignal<
    { front: string; back: string }[] | null
  >(null);
  const [aiJobId, setAiJobId] = createSignal<string | null>(null);
  const [aiSaving, setAiSaving] = createSignal(false);

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
        cardCount: aiCardCount(),
      });
      if (error) throw new Error(error.error ?? 'Generation failed');
      setAiPreview(data.cards);
      setAiJobId(data.jobId);
    } catch (err: any) {
      toast.error(err?.message ?? 'AI generation failed');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAiSave = async () => {
    const jobId = aiJobId();
    const preview = aiPreview();
    if (!jobId || !preview) return;
    setAiSaving(true);
    try {
      const { error } = await (api.ai as any).jobs({ jobId }).save.post({
        cards: preview,
      });
      if (error) throw new Error(error.error ?? 'Save failed');
      toast.success(`${preview.length} cards saved!`);
      setShowAiModal(false);
      setAiPreview(null);
      setAiJobId(null);
      setAiSourceText('');
      refetchCards();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save cards');
    } finally {
      setAiSaving(false);
    }
  };

  const closeAiModal = () => {
    setShowAiModal(false);
    setAiPreview(null);
    setAiJobId(null);
    setAiSourceText('');
    setAiCardCount(10);
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
              </Button>
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
                                            <span class="text-muted-foreground capitalize font-medium">
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
                                          <span class="text-muted-foreground capitalize font-medium">
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
          <div class="bg-card border rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col mx-4 animate-fade-in">
            {/* Header */}
            <div class="flex items-center justify-between p-5 border-b">
              <div class="flex items-center gap-2">
                <Sparkles class="h-5 w-5 text-palette-4" />
                <h2 class="text-lg font-semibold">AI Card Generator</h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                onClick={closeAiModal}
              >
                <X class="h-4 w-4" />
              </Button>
            </div>

            {/* Body */}
            <div class="flex-1 overflow-y-auto p-5 space-y-4">
              <Show when={!aiPreview()}>
                {/* Input phase */}
                <div class="space-y-3">
                  <label class="text-sm font-medium text-foreground">
                    Paste your notes, text, or describe a topic
                  </label>
                  <Textarea
                    placeholder="Enter or paste text to generate flashcards from... (min 10 characters)"
                    value={aiSourceText()}
                    onInput={(e) => setAiSourceText(e.currentTarget.value)}
                    class="min-h-50 resize-y"
                  />
                  <div class="flex items-center gap-3">
                    <label class="text-sm text-muted-foreground">
                      Number of cards:
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={aiCardCount()}
                      onInput={(e) =>
                        setAiCardCount(
                          Math.max(
                            1,
                            Math.min(50, Number(e.currentTarget.value) || 10),
                          ),
                        )
                      }
                      class="w-20 h-9"
                    />
                  </div>
                </div>
              </Show>

              <Show when={aiPreview()}>
                {/* Preview phase */}
                <div class="space-y-1">
                  <p class="text-sm text-muted-foreground">
                    Review and edit generated cards before saving.
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {aiPreview()!.length} cards generated
                  </p>
                </div>
                <div class="space-y-3">
                  <Index each={aiPreview()!}>
                    {(card, idx) => (
                      <div class="border rounded-lg p-4 space-y-2 bg-background">
                        <div class="flex items-center justify-between">
                          <span class="text-xs font-medium text-muted-foreground">
                            Card {idx + 1}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            class="h-6 w-6 text-destructive"
                            onClick={() => {
                              setAiPreview((prev) =>
                                prev ? prev.filter((_, i) => i !== idx) : null,
                              );
                            }}
                          >
                            <Trash2 class="h-3 w-3" />
                          </Button>
                        </div>
                        <div>
                          <label class="text-xs text-muted-foreground">
                            Front
                          </label>
                          <Textarea
                            value={card().front}
                            onInput={(e) => {
                              setAiPreview((prev) => {
                                if (!prev) return null;
                                const copy = [...prev];
                                copy[idx] = {
                                  ...copy[idx],
                                  front: e.currentTarget.value,
                                };
                                return copy;
                              });
                            }}
                            class="mt-1 min-h-15"
                          />
                        </div>
                        <div>
                          <label class="text-xs text-muted-foreground">
                            Back
                          </label>
                          <Textarea
                            value={card().back}
                            onInput={(e) => {
                              setAiPreview((prev) => {
                                if (!prev) return null;
                                const copy = [...prev];
                                copy[idx] = {
                                  ...copy[idx],
                                  back: e.currentTarget.value,
                                };
                                return copy;
                              });
                            }}
                            class="mt-1 min-h-15"
                          />
                        </div>
                      </div>
                    )}
                  </Index>
                </div>
              </Show>
            </div>

            {/* Footer */}
            <div class="flex items-center justify-end gap-2 p-5 border-t">
              <Show when={aiPreview()}>
                <Button
                  variant="outline"
                  onClick={() => {
                    setAiPreview(null);
                    setAiJobId(null);
                  }}
                >
                  Back to Edit
                </Button>
                <Button
                  onClick={handleAiSave}
                  disabled={aiSaving() || !aiPreview()?.length}
                >
                  <Show
                    when={aiSaving()}
                    fallback={<Save class="h-4 w-4 mr-2" />}
                  >
                    <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                  </Show>
                  {aiSaving()
                    ? 'Saving...'
                    : `Save ${aiPreview()?.length ?? 0} Cards`}
                </Button>
              </Show>
              <Show when={!aiPreview()}>
                <Button variant="outline" onClick={closeAiModal}>
                  Cancel
                </Button>
                <Button
                  onClick={handleAiGenerate}
                  disabled={aiGenerating() || aiSourceText().trim().length < 10}
                >
                  <Show
                    when={aiGenerating()}
                    fallback={<Sparkles class="h-4 w-4 mr-2" />}
                  >
                    <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                  </Show>
                  {aiGenerating() ? 'Generating...' : 'Generate Cards'}
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
