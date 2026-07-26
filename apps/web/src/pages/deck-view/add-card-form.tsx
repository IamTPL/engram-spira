import { type Component, For } from 'solid-js';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-solid';
import FieldEditor from './field-editor';
import type { TemplateField } from './types';

interface AddCardFormProps {
  sortedFields: () => TemplateField[];
  addInputs: () => Record<string, unknown>;
  setAddInputs: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  saving: () => boolean;
  onSubmit: (e: Event) => void;
  onClose: () => void;
}

const AddCardForm: Component<AddCardFormProps> = (props) => {
  return (
    <form
      onSubmit={props.onSubmit}
      class="space-y-5 rounded-lg border bg-card p-4 shadow-xs motion-safe:animate-fade-in sm:p-6"
      aria-labelledby="new-card-title"
    >
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2
            id="new-card-title"
            class="text-lg font-semibold tracking-tight text-foreground"
          >
            New card
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            Complete the fields defined by this deck template.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          onClick={props.onClose}
          aria-label="Close new card form"
          title="Close"
        >
          <X class="h-4 w-4" />
        </Button>
      </div>
      <div class="space-y-4">
        <For each={props.sortedFields()}>
          {(field) => (
            <FieldEditor
              field={field}
              value={props.addInputs()[field.id]}
              onChange={(v) =>
                props.setAddInputs((prev) => ({ ...prev, [field.id]: v }))
              }
            />
          )}
        </For>
      </div>
      <div class="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={props.onClose}
          class="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          loading={props.saving()}
          class="w-full sm:w-auto"
        >
          Save card
        </Button>
      </div>
    </form>
  );
};

export default AddCardForm;
