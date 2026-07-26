import { type Component, Show, For } from 'solid-js';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import ArrayInput from '@/components/ui/array-input';
import { WORD_TYPES } from '@/constants';
import type { TemplateField } from './types';

// ── Shared field editor (used by Add & Edit forms) ───────────────────────
const FieldEditor: Component<{
  field: TemplateField;
  value: unknown;
  onChange: (value: unknown) => void;
}> = (props) => {
  const strVal = () => String(props.value ?? '');
  const fieldId = () => `deck-field-${props.field.id}`;
  const fieldLabelId = () => `${fieldId()}-label`;
  const arrVal = (): string[] => {
    const v = props.value;
    return Array.isArray(v) ? (v as string[]) : [];
  };

  return (
    <div class="space-y-2">
      <label
        id={fieldLabelId()}
        for={fieldId()}
        class="flex flex-wrap items-baseline gap-x-2 text-sm font-medium capitalize text-foreground"
      >
        {props.field.name}
        <Show when={props.field.isRequired}>
          <span class="text-destructive" aria-hidden="true">
            *
          </span>
        </Show>
        <span class="text-xs font-normal text-muted-foreground">
          {props.field.side}
        </span>
      </label>

      <Show when={props.field.fieldType === 'json_array'}>
        <div role="group" aria-labelledby={fieldLabelId()}>
          <ArrayInput
            value={arrVal()}
            onChange={props.onChange}
            placeholder={
              props.field.config?.placeholder ?? `Add ${props.field.name}...`
            }
            maxItems={props.field.config?.maxItems}
          />
        </div>
      </Show>
      <Show when={props.field.fieldType === 'textarea'}>
        <Textarea
          id={fieldId()}
          placeholder={props.field.config?.placeholder ?? props.field.name}
          value={strVal()}
          onInput={(e) => props.onChange(e.currentTarget.value)}
          required={props.field.isRequired}
        />
      </Show>
      <Show when={props.field.name === 'type'}>
        <select
          id={fieldId()}
          class="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-xs transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
          value={strVal()}
          onChange={(e) => props.onChange(e.currentTarget.value)}
          required={props.field.isRequired}
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
          id={fieldId()}
          placeholder={props.field.config?.placeholder ?? props.field.name}
          value={strVal()}
          onInput={(e) => props.onChange(e.currentTarget.value)}
          required={props.field.isRequired}
        />
      </Show>
    </div>
  );
};

export default FieldEditor;
