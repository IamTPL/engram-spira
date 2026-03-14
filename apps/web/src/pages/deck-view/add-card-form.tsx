import { type Component, Show, For } from 'solid-js';
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
      class="border rounded-xl p-6 bg-card shadow-sm space-y-4 animate-fade-in"
    >
      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-foreground">New Card</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          onClick={props.onClose}
        >
          <X class="h-4 w-4" />
        </Button>
      </div>
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
      <div class="flex gap-2 pt-1">
        <Button type="submit" disabled={props.saving()}>
          {props.saving() ? 'Saving...' : 'Save Card'}
        </Button>
        <Button type="button" variant="outline" onClick={props.onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

export default AddCardForm;
