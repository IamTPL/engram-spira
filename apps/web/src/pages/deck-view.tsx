import {
  type Component,
  createSignal,
  createResource,
  Show,
  For,
} from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import ArrayInput from '@/components/ui/array-input';
import Header from '@/components/layout/header';
import { toast } from '@/stores/toast.store';
import { ArrowLeft, Plus, Play, Trash2, Pencil, X, Check } from 'lucide-solid';

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

  // ── Data ──────────────────────────────────────────────────────────────
  const [deck] = createResource(
    () => params.deckId,
    async (deckId) => {
      const { data } = await (api.decks as any)[deckId].get();
      return data as {
        id: string;
        name: string;
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

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div class="h-screen flex flex-col">
      <Header />
      <div class="flex-1 overflow-y-auto p-8">
        <div class="max-w-2xl mx-auto">
          {/* Title */}
          <div class="flex items-center gap-3 mb-2">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft class="h-4 w-4" />
            </Button>
            <div class="flex-1 min-w-0">
              <h2 class="text-2xl font-bold truncate">
                {deck()?.name ?? 'Loading...'}
              </h2>
              <Show when={template()}>
                <span class="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                  {template()!.name}
                </span>
              </Show>
            </div>
          </div>

          {/* Actions */}
          <div class="flex gap-3 my-6">
            <Button onClick={() => navigate(`/study/${params.deckId}`)}>
              <Play class="h-4 w-4 mr-2" />
              Study
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
          </div>

          {/* Add card form */}
          <Show when={showAddCard() && template()}>
            <form
              onSubmit={handleAddCard}
              class="border rounded-lg p-6 mb-6 bg-card space-y-4"
            >
              <div class="flex items-center justify-between">
                <h3 class="font-semibold">New Card</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
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
              <div class="flex gap-2">
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

          {/* Card list */}
          <div class="space-y-3">
            <h3 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Cards ({cards()?.length ?? 0})
            </h3>

            <Show when={cards.loading}>
              <For each={[1, 2, 3]}>
                {() => <div class="h-20 rounded-lg bg-muted animate-pulse" />}
              </For>
            </Show>

            <For
              each={cards() ?? []}
              fallback={
                <Show when={!cards.loading}>
                  <p class="text-muted-foreground text-sm py-8 text-center">
                    No cards yet. Click <strong>Add Card</strong> to get
                    started!
                  </p>
                </Show>
              }
            >
              {(card) => {
                // Extract named fields directly from card.fields (bypass isNotEmpty filter)
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
                const isVocabLayout = hasValue(wordField) && hasValue(defField);
                const examples = getExamples();

                // Fields not covered by the vocab layout
                const otherFields = card.fields.filter(
                  (f) =>
                    !['word', 'type', 'ipa', 'definition', 'examples'].includes(
                      f.fieldName,
                    ) && hasValue(f),
                );

                return (
                  <div class="border rounded-xl bg-card overflow-hidden">
                    {/* Normal view */}
                    <Show when={editingCardId() !== card.id}>
                      <div class="p-4 flex items-start gap-3">
                        <div class="flex-1 min-w-0">
                          {/* ── Vocabulary two-column layout ── */}
                          <Show when={isVocabLayout}>
                            <div class="grid grid-cols-[1fr_1fr] gap-0">
                              {/* Left: word, type, ipa */}
                              <div class="pr-4">
                                <p class="font-semibold text-foreground leading-snug">
                                  {String(wordField!.value)}
                                  <Show when={hasValue(typeField)}>
                                    <span class="ml-1.5 text-sm font-normal text-muted-foreground">
                                      ({String(typeField!.value)})
                                    </span>
                                  </Show>
                                </p>
                                <Show when={hasValue(ipaField)}>
                                  <p class="text-sm text-muted-foreground/70 mt-0.5 font-mono">
                                    {String(ipaField!.value)}
                                  </p>
                                </Show>
                              </div>

                              {/* Right: definition, examples */}
                              <div class="border-l pl-4">
                                <p class="text-sm text-foreground leading-relaxed">
                                  {String(defField!.value)}
                                </p>
                                <Show when={examples.length > 0}>
                                  <ul class="mt-2 space-y-1">
                                    <For each={examples}>
                                      {(ex) => (
                                        <li class="text-xs text-muted-foreground flex gap-1.5 items-start">
                                          <span class="text-muted-foreground/40 shrink-0 mt-0.5">
                                            ·
                                          </span>
                                          <span class="italic">{ex}</span>
                                        </li>
                                      )}
                                    </For>
                                  </ul>
                                </Show>
                              </div>
                            </div>

                            {/* Other fields below the 2-col layout */}
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
                                          ? (f.value as string[]).join(' · ')
                                          : String(f.value)}
                                      </span>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </Show>

                          {/* ── Fallback: linear layout for other templates ── */}
                          <Show when={!isVocabLayout}>
                            <div class="space-y-1">
                              <For
                                each={card.fields.filter((f) => hasValue(f))}
                              >
                                {(field) => (
                                  <div class="text-sm">
                                    <span class="text-muted-foreground capitalize font-medium">
                                      {field.fieldName}:{' '}
                                    </span>
                                    <span>
                                      {Array.isArray(field.value)
                                        ? (field.value as string[]).join(' · ')
                                        : String(field.value)}
                                    </span>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>

                        <div class="flex gap-1 shrink-0">
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
                                onClick={() => setConfirmDeleteId(card.id)}
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
                    <Show when={editingCardId() === card.id && template()}>
                      <form
                        onSubmit={handleEditCard}
                        class="p-4 space-y-3 bg-accent/30"
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
        </div>
      </div>
    </div>
  );
};

export default DeckViewPage;
