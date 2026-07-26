import { type Component, createMemo, Show, For } from 'solid-js';
import { cn } from '@/lib/utils';

interface FieldData {
  fieldName: string;
  fieldType: string;
  side: string;
  value: unknown;
  sortOrder: number;
}

interface FlashcardProps {
  fields: FieldData[];
  isFlipped: boolean;
  onFlip: () => void;
}

const Flashcard: Component<FlashcardProps> = (props) => {
  const frontFields = createMemo(() =>
    props.fields
      .filter((f) => f.side === 'front')
      .sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const backFields = createMemo(() =>
    props.fields
      .filter((f) => f.side === 'back')
      .sort((a, b) => a.sortOrder - b.sortOrder)
  );

  const renderFieldValue = (field: FieldData) => {
    const val = field.value;
    if (field.fieldType === 'json_array' && Array.isArray(val)) {
      return (
        <ul class="list-disc list-inside space-y-1">
          <For each={val as string[]}>
            {(item) => (
              <li class="text-sm text-muted-foreground">{String(item)}</li>
            )}
          </For>
        </ul>
      );
    }
    return <span>{String(val ?? '')}</span>;
  };

  return (
    <button
      type="button"
      class="perspective-1200 mx-auto block w-full max-w-2xl cursor-pointer select-none rounded-2xl text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      onClick={() => props.onFlip()}
      aria-label={
        props.isFlipped
          ? 'Showing answer. Flip to show the prompt'
          : 'Showing prompt. Flip to reveal the answer'
      }
      aria-pressed={props.isFlipped}
    >
      <div
        class={cn(
          'study-card-rotator relative h-[21rem] w-full preserve-3d transition-transform duration-500 ease-out motion-reduce:transition-none sm:h-[24rem]',
        )}
        style={{
          transform: props.isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* Front */}
        <div
          class={cn(
            'study-card-face absolute inset-0 overflow-hidden rounded-2xl border border-t-2 border-border border-t-foreground bg-card shadow-card-study backface-hidden',
            props.isFlipped ? 'z-0' : 'z-10',
          )}
          style={{ transform: 'translateZ(1px)' }}
          aria-hidden={props.isFlipped}
        >
          <div class="flex h-full min-h-0 flex-col">
            <div class="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border/70 px-5 sm:px-6">
              <span class="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
                Prompt
              </span>
              <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                Flip
                <kbd class="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                  Space
                </kbd>
              </span>
            </div>

            <div class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-x-hidden overflow-y-auto px-7 py-8 sm:px-12 sm:py-10">
              <For each={frontFields()}>
                {(field) => (
                  <div class="mb-4 w-full max-w-lg text-center last:mb-0">
                    <Show
                      when={
                        field.fieldName === 'word' ||
                        field.fieldName === 'question'
                      }
                    >
                      <div class="mb-2 text-3xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-4xl">
                        {renderFieldValue(field)}
                      </div>
                    </Show>
                    <Show when={field.fieldName === 'type'}>
                      <div class="text-sm italic leading-relaxed text-muted-foreground">
                        {renderFieldValue(field)}
                      </div>
                    </Show>
                    <Show when={field.fieldName === 'ipa'}>
                      <div class="font-mono text-base text-muted-foreground sm:text-lg">
                        {renderFieldValue(field)}
                      </div>
                    </Show>
                    <Show
                      when={
                        !['word', 'question', 'type', 'ipa'].includes(
                          field.fieldName,
                        )
                      }
                    >
                      <div class="text-base leading-relaxed">
                        <span class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          {field.fieldName}
                        </span>
                        <div class="[overflow-wrap:anywhere]">
                          {renderFieldValue(field)}
                        </div>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>

        {/* Back */}
        <div
          class={cn(
            'study-card-face absolute inset-0 overflow-hidden rounded-2xl border border-t-2 border-border border-t-foreground bg-card shadow-card-study backface-hidden',
            props.isFlipped ? 'z-10' : 'z-0',
          )}
          style={{ transform: 'rotateY(180deg) translateZ(1px)' }}
          aria-hidden={!props.isFlipped}
        >
          <div class="flex h-full min-h-0 flex-col">
            <div class="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border/70 px-5 sm:px-6">
              <span class="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
                Answer
              </span>
              <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                Flip back
                <kbd class="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                  Space
                </kbd>
              </span>
            </div>

            <div class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-x-hidden overflow-y-auto px-7 py-8 sm:px-12 sm:py-10">
              <For each={backFields()}>
                {(field) => (
                  <div class="mb-5 w-full max-w-lg text-center last:mb-0">
                    <Show
                      when={
                        field.fieldName === 'definition' ||
                        field.fieldName === 'answer'
                      }
                    >
                      <div class="text-xl font-medium leading-relaxed [overflow-wrap:anywhere] sm:text-2xl">
                        {renderFieldValue(field)}
                      </div>
                    </Show>
                    <Show when={field.fieldName === 'examples'}>
                      <div class="mt-3 rounded-lg bg-muted/45 p-4 text-left leading-relaxed">
                        {renderFieldValue(field)}
                      </div>
                    </Show>
                    <Show
                      when={
                        !['definition', 'answer', 'examples'].includes(
                          field.fieldName,
                        )
                      }
                    >
                      <div>
                        <span class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          {field.fieldName}
                        </span>
                        <div class="text-base leading-relaxed [overflow-wrap:anywhere]">
                          {renderFieldValue(field)}
                        </div>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
};

export default Flashcard;
