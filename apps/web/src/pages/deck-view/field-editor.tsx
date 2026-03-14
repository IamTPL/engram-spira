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

export default FieldEditor;
