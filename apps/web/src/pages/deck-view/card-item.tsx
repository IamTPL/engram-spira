import { type Component, Show, For, createMemo } from 'solid-js';
import { Button } from '@/components/ui/button';
import {
  Pencil,
  Trash2,
  Check,
  X,
  CheckSquare,
  Square,
} from 'lucide-solid';
import type { CardItem, CardField, TemplateField } from './types';

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
  if (!f || !Array.isArray(f.value)) return [];
  return f.value as string[];
}

interface CardItemRowProps {
  card: CardItem;
  index: number;
  selectMode: boolean;
  isSelected: boolean;
  isEditing: boolean;
  isDragSource: boolean;
  isDropTarget: boolean;
  isDragging: boolean;
  confirmDeleteId: string | null;
  onToggleSelection: (cardId: string) => void;
  onStartEdit: (card: CardItem) => void;
  onDelete: (cardId: string) => void;
  onConfirmDelete: (cardId: string | null) => void;
  onDragStart: (index: number, e: DragEvent) => void;
  onDragOver: (index: number, e: DragEvent) => void;
  onDrop: (index: number, e: DragEvent) => void;
  onDragEnd: () => void;
  onDragLeave: () => void;
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
    <div
      class={`group border rounded-xl bg-card overflow-hidden transition-shadow duration-200 ease-out cursor-grab active:cursor-grabbing ${
        props.isDragSource
          ? 'opacity-50 scale-95 shadow-lg rotate-1'
          : props.isDropTarget
            ? 'border-palette-5 shadow-lg scale-[1.02] -translate-y-1'
            : props.isDragging
              ? 'transition-transform duration-300'
              : 'hover:shadow-sm'
      }`}
      draggable={!props.selectMode && !props.isEditing}
      style={{
        'touch-action':
          !props.selectMode && !props.isEditing ? 'none' : undefined,
        'will-change': props.isDragging ? 'transform, opacity' : 'auto',
      }}
      onDragStart={(e) => props.onDragStart(props.index, e)}
      onDragOver={(e) => props.onDragOver(props.index, e)}
      onDrop={(e) => props.onDrop(props.index, e)}
      onDragEnd={props.onDragEnd}
      onDragLeave={props.onDragLeave}
    >
      {/* Normal view */}
      <Show when={!props.isEditing}>
        <div class="p-4 flex items-start gap-3">


          {/* Checkbox for bulk select */}
          <Show when={props.selectMode}>
            <button
              class="mt-1 shrink-0"
              aria-label={props.isSelected ? 'Deselect card' : 'Select card'}
              onClick={() => props.onToggleSelection(props.card.id)}
            >
              <Show
                when={props.isSelected}
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
            {props.index + 1}
          </span>

          <div class="flex-1 min-w-0">
            {/* Vocabulary two-column layout */}
            <Show when={isVocabLayout()}>
              <div class="grid grid-cols-[1fr_1fr] gap-0">
                <div class="pr-4">
                  <p class="font-semibold text-foreground leading-snug">
                    {String(wordField()!.value)}
                    <Show when={hasFieldValue(typeField())}>
                      <span class="ml-1.5 text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {String(typeField()!.value)}
                      </span>
                    </Show>
                  </p>
                  <Show when={hasFieldValue(ipaField())}>
                    <p class="text-sm text-muted-foreground/70 mt-0.5 font-mono">
                      {String(ipaField()!.value)}
                    </p>
                  </Show>
                </div>

                <div class="border-l pl-4">
                  <p class="text-sm text-foreground leading-relaxed">
                    {String(defField()!.value)}
                  </p>
                  <Show when={examples().length > 0}>
                    <ul class="mt-2 space-y-1">
                      <For each={examples()}>
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

              <Show when={otherFields().length > 0}>
                <div class="mt-2 pt-2 border-t space-y-1">
                  <For each={otherFields()}>
                    {(f) => (
                      <div class="text-sm">
                        <span class="text-muted-foreground capitalize font-extrabold">
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

            {/* Fallback: linear layout */}
            <Show when={!isVocabLayout()}>
              <div class="space-y-1">
                <For each={props.card.fields.filter((f) => hasFieldValue(f))}>
                  {(field) => (
                    <div class="text-sm">
                      <span class="text-muted-foreground capitalize font-extrabold">
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

          {/* Action buttons (visible on hover or focus-within) */}
          <div class="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
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
              <div class="flex items-center gap-1">
                <span class="text-xs text-destructive whitespace-nowrap font-medium">
                  Delete?
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 text-destructive hover:bg-destructive/10"
                  onClick={() => props.onDelete(props.card.id)}
                >
                  <Check class="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  onClick={() => props.onConfirmDelete(null)}
                >
                  <X class="h-3.5 w-3.5" />
                </Button>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default CardItemRow;
