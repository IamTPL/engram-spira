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
      class="space-y-5 bg-card p-4 sm:p-5"
      aria-labelledby="edit-card-title"
    >
      <div>
        <h2
          id="edit-card-title"
          class="text-base font-semibold tracking-tight text-foreground"
        >
          Edit card
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Update the card content, then save your changes.
        </p>
      </div>
      <div class="space-y-4">
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
      </div>
      <div class="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={props.onCancel}
          class="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          loading={props.editSaving()}
          class="w-full sm:w-auto"
        >
          Save changes
        </Button>
      </div>
    </form>
  );
};

export default EditCardForm;
