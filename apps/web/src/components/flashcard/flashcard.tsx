import { type Component, createSignal, createMemo, Show, For } from 'solid-js';
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
    <div
      class="perspective-1200 w-full max-w-lg mx-auto cursor-pointer select-none"
      onClick={() => props.onFlip()}
    >
      <div
        class={cn(
          'relative w-full min-h-85 transition-transform duration-500 preserve-3d',
        )}
        style={{
          transform: props.isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* Front */}
        <div class="absolute inset-0 flex flex-col items-center justify-center p-10 rounded-2xl border bg-card shadow-card-study backface-hidden">
          <For each={frontFields()}>
            {(field) => (
              <div class="text-center mb-3">
                <Show
                  when={
                    field.fieldName === 'word' || field.fieldName === 'question'
                  }
                >
                  <div class="text-3xl font-bold mb-2">
                    {renderFieldValue(field)}
                  </div>
                </Show>
                <Show when={field.fieldName === 'type'}>
                  <div class="text-sm text-muted-foreground italic">
                    {renderFieldValue(field)}
                  </div>
                </Show>
                <Show when={field.fieldName === 'ipa'}>
                  <div class="text-lg text-muted-foreground">
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
                  <div class="text-base">
                    <span class="text-xs text-muted-foreground uppercase">
                      {field.fieldName}
                    </span>
                    <div>{renderFieldValue(field)}</div>
                  </div>
                </Show>
              </div>
            )}
          </For>
          <p class="absolute bottom-4 text-xs text-muted-foreground">
            Click or press Space to flip
          </p>
        </div>

        {/* Back */}
        <div
          class="absolute inset-0 flex flex-col items-center justify-center p-8 rounded-xl border bg-card shadow-lg"
          style={{
            'backface-visibility': 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          <For each={backFields()}>
            {(field) => (
              <div class="text-center mb-4 w-full">
                <Show
                  when={
                    field.fieldName === 'definition' ||
                    field.fieldName === 'answer'
                  }
                >
                  <div class="text-xl">{renderFieldValue(field)}</div>
                </Show>
                <Show when={field.fieldName === 'examples'}>
                  <div class="mt-3 text-left">{renderFieldValue(field)}</div>
                </Show>
                <Show
                  when={
                    !['definition', 'answer', 'examples'].includes(
                      field.fieldName,
                    )
                  }
                >
                  <div>
                    <span class="text-xs text-muted-foreground uppercase">
                      {field.fieldName}
                    </span>
                    <div class="text-base">{renderFieldValue(field)}</div>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

export default Flashcard;
