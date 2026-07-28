import { type Component, Show, For, createMemo } from 'solid-js';
import { Button } from '@/components/ui/button';
import {
  Pencil,
  Trash2,
  Check,
  X,
  CheckSquare,
  Square,
  GripVertical,
  Network,
} from 'lucide-solid';
import type { CardItem, CardField } from './types';

// ── Helper functions (defined once, not per-item) ────────────────────────
function getFieldByName(fields: CardField[], name: string): CardField | undefined {
  return fields.find((f) => f.fieldName === name);
}

function hasFieldValue(f: CardField | undefined): boolean {
  if (!f) return false;
  if (Array.isArray(f.value)) return (f.value as string[]).length > 0;
  return String(f.value ?? '').trim() !== '';
}

function getExamplesFromFields(fields: CardField[]): string[] {
  const f = getFieldByName(fields, 'examples');
  if (!f || f.value == null) return [];

  // AI-generated cards store examples as a plain string;
  // manually created cards may store them as an array.
  if (Array.isArray(f.value)) return f.value as string[];

  const str = String(f.value).trim();
  if (!str) return [];

  // Try JSON parse in case it's a serialized array (e.g. '["a","b"]')
  if (str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch { /* not JSON, treat as plain string */ }
  }

  // Split on newline if multi-line, otherwise return as single-element array
  if (str.includes('\n')) return str.split('\n').map((s) => s.trim()).filter(Boolean);
  return [str];
}

interface CardItemRowProps {
  card: CardItem;
  index: number;
  selectMode: boolean;
  isSelected: boolean;
  isEditing: boolean;
  isDragSource: boolean;
  isDragging: boolean;
  dragDisabledReason: string | null;
  confirmDeleteId: string | null;
  showExploreConnections: boolean;
  onToggleSelection: (cardId: string) => void;
  onExploreConnections: (cardId: string) => void;
  onStartEdit: (card: CardItem) => void;
  onDelete: (cardId: string) => void;
  onConfirmDelete: (cardId: string | null) => void;
  onDragStart: (cardId: string, e: DragEvent) => void;
  onDragEnd: () => void;
}

const CardItemRow: Component<CardItemRowProps> = (props) => {
  const wordField = createMemo(() => getFieldByName(props.card.fields, 'word'));
  const typeField = createMemo(() => getFieldByName(props.card.fields, 'type'));
  const ipaField = createMemo(() => getFieldByName(props.card.fields, 'ipa'));
  const defField = createMemo(() => getFieldByName(props.card.fields, 'definition'));
  const isVocabLayout = createMemo(() =>
    hasFieldValue(wordField()) && hasFieldValue(defField()),
  );
  const examples = createMemo(() => getExamplesFromFields(props.card.fields));
  const otherFields = createMemo(() =>
    props.card.fields.filter(
      (f) =>
        !['word', 'type', 'ipa', 'definition', 'examples'].includes(f.fieldName) &&
        hasFieldValue(f),
    ),
  );

  return (
    <article
      class={`group overflow-hidden rounded-lg border bg-card transition-[border-color,box-shadow,opacity] motion-safe:duration-150 ${
        props.isDragSource
          ? 'border-primary/35 opacity-45 shadow-none'
          : props.isDragging
            ? 'border-border'
            : 'hover:border-muted-foreground/35 hover:shadow-xs'
      } ${props.isSelected ? 'border-primary/50 bg-accent/35' : ''}`}
      aria-label={`Card ${props.index + 1}`}
    >
      {/* Normal view */}
      <Show when={!props.isEditing}>
        <div class="flex items-start gap-2.5 p-3 sm:gap-3 sm:p-4">
          <div class="flex w-7 shrink-0 flex-col items-center gap-2 pt-0.5">
            <Show
              when={props.selectMode}
              fallback={
                <button
                  type="button"
                  draggable={!props.dragDisabledReason && !props.isEditing}
                  aria-disabled={!!props.dragDisabledReason}
                  aria-label={`Drag card ${props.index + 1} to reorder`}
                  title={props.dragDisabledReason ?? 'Drag to reorder'}
                  class={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    props.dragDisabledReason
                      ? 'cursor-not-allowed text-muted-foreground/30'
                      : 'cursor-grab text-muted-foreground/55 hover:bg-accent hover:text-foreground active:cursor-grabbing'
                  }`}
                  style={{ 'touch-action': 'pan-y' }}
                  onDragStart={(event) => {
                    if (props.dragDisabledReason || props.isEditing) {
                      event.preventDefault();
                      return;
                    }
                    const preview = event.currentTarget.closest('article');
                    if (preview && event.dataTransfer) {
                      event.dataTransfer.setDragImage(preview, 24, 24);
                    }
                    props.onDragStart(props.card.id, event);
                  }}
                  onDragEnd={props.onDragEnd}
                >
                  <GripVertical class="h-4 w-4" aria-hidden="true" />
                </button>
              }
            >
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label={
                  props.isSelected ? 'Deselect card' : 'Select card'
                }
                aria-pressed={props.isSelected}
                onClick={() => props.onToggleSelection(props.card.id)}
              >
                <Show
                  when={props.isSelected}
                  fallback={<Square class="h-4 w-4" />}
                >
                  <CheckSquare class="h-4 w-4 text-primary" />
                </Show>
              </button>
            </Show>
            <span class="font-mono text-[11px] tabular-nums text-muted-foreground/70">
              {props.index + 1}
            </span>
          </div>

          <div class="flex-1 min-w-0">
            {/* Vocabulary two-column layout */}
            <Show when={isVocabLayout()}>
              <div class="grid grid-cols-1 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div class="min-w-0 md:pr-5">
                  <p class="text-base font-semibold leading-snug text-foreground">
                    {String(wordField()!.value)}
                    <Show when={hasFieldValue(typeField())}>
                      <span class="ml-2 inline-flex rounded-sm border bg-muted px-1.5 py-0.5 align-middle text-[11px] font-medium text-muted-foreground">
                        {String(typeField()!.value)}
                      </span>
                    </Show>
                  </p>
                  <Show when={hasFieldValue(ipaField())}>
                    <p class="mt-1 font-mono text-xs text-muted-foreground">
                      {String(ipaField()!.value)}
                    </p>
                  </Show>
                </div>

                <div class="mt-3 min-w-0 border-t pt-3 md:mt-0 md:border-l md:border-t-0 md:pl-5 md:pt-0">
                  <p class="text-sm leading-relaxed text-foreground">
                    {String(defField()!.value)}
                  </p>
                  <Show when={examples().length > 0}>
                    <ul class="mt-2 list-disc space-y-1 pl-4">
                      <For each={examples()}>
                        {(ex) => (
                          <li class="text-xs leading-relaxed text-muted-foreground">
                            <span>{ex}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>
              </div>

              <Show when={otherFields().length > 0}>
                <div class="mt-3 space-y-2 border-t pt-3">
                  <For each={otherFields()}>
                    {(f) => (
                      <div class="grid gap-0.5 text-sm sm:grid-cols-[minmax(7rem,0.3fr)_minmax(0,1fr)] sm:gap-3">
                        <span class="capitalize text-muted-foreground">
                          {f.fieldName}:{' '}
                        </span>
                        <span class="min-w-0 text-foreground">
                          {Array.isArray(f.value)
                            ? (f.value as string[]).join(', ')
                            : String(f.value)}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>

            {/* Fallback: linear layout */}
            <Show when={!isVocabLayout()}>
              <div class="space-y-2">
                <For each={props.card.fields.filter((f) => hasFieldValue(f))}>
                  {(field) => (
                    <div class="grid gap-0.5 text-sm sm:grid-cols-[minmax(7rem,0.3fr)_minmax(0,1fr)] sm:gap-3">
                      <span class="capitalize text-muted-foreground">
                        {field.fieldName}:{' '}
                      </span>
                      <span class="min-w-0 text-foreground">
                        {Array.isArray(field.value)
                          ? (field.value as string[]).join(', ')
                          : String(field.value)}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Action buttons (visible on hover or focus-within) */}
          <div class="flex shrink-0 gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <Show when={props.showExploreConnections}>
              <Button
                variant="ghost"
                size="icon"
                class="h-11 w-11 text-muted-foreground hover:text-info sm:h-8 sm:w-8"
                aria-label="Explore connections"
                title="Explore connections"
                onClick={() => props.onExploreConnections(props.card.id)}
              >
                <Network class="h-3.5 w-3.5" />
              </Button>
            </Show>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="Edit card"
              title="Edit card"
              onClick={() => props.onStartEdit(props.card)}
            >
              <Pencil class="h-3.5 w-3.5" />
            </Button>
            <Show
              when={props.confirmDeleteId === props.card.id}
              fallback={
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label="Delete card"
                  title="Delete card"
                  onClick={() => props.onConfirmDelete(props.card.id)}
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </Button>
              }
            >
              <div
                class="flex items-center gap-1"
                role="group"
                aria-label="Confirm card deletion"
              >
                <span class="hidden whitespace-nowrap text-xs font-medium text-destructive sm:inline">
                  Delete?
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 text-destructive hover:bg-destructive/10"
                  onClick={() => props.onDelete(props.card.id)}
                  aria-label="Confirm delete card"
                  title="Confirm delete card"
                >
                  <Check class="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  onClick={() => props.onConfirmDelete(null)}
                  aria-label="Cancel delete card"
                  title="Cancel delete card"
                >
                  <X class="h-3.5 w-3.5" />
                </Button>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </article>
  );
};

export default CardItemRow;
