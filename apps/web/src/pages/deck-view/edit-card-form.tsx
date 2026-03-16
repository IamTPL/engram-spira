import { type Component, For } from 'solid-js';
import { Button } from '@/components/ui/button';
import FieldEditor from './field-editor';
import type { TemplateField } from './types';

interface EditCardFormProps {
  sortedFields: () => TemplateField[];
  editInputs: () => Record<string, unknown>;
  setEditInputs: (
    fn: (prev: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
  editSaving: () => boolean;
  onSubmit: (e: Event) => void;
  onCancel: () => void;
}

const EditCardForm: Component<EditCardFormProps> = (props) => {
  return (
    <form
      onSubmit={props.onSubmit}
      class="p-5 space-y-3 bg-white dark:bg-gray-900"
    >
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Editing card
      </p>
      <For each={props.sortedFields()}>
        {(field) => (
          <FieldEditor
            field={field}
            value={props.editInputs()[field.id]}
            onChange={(v) =>
              props.setEditInputs((prev) => ({
                ...prev,
                [field.id]: v,
              }))
            }
          />
        )}
      </For>
      <div class="flex gap-2 pt-1">
        <Button type="submit" disabled={props.editSaving()}>
          {props.editSaving() ? 'Saving...' : 'Save'}
        </Button>
        <Button type="button" variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

export default EditCardForm;
