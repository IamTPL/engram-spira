import { type JSX, Show, splitProps } from 'solid-js';
import { Select as SelectPrimitive } from '@kobalte/core/select';
import { Check, ChevronDown } from 'lucide-solid';
import { cn } from '@/lib/utils';

type SelectProps = Parameters<typeof SelectPrimitive>[0] & {
  class?: string;
};

export function Select(props: SelectProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <SelectPrimitive class={cn('w-full', local.class)} {...others}>
      {local.children}
    </SelectPrimitive>
  );
}

type SelectTriggerProps = Parameters<typeof SelectPrimitive.Trigger>[0];

export function SelectTrigger(props: SelectTriggerProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <SelectPrimitive.Trigger
      class={cn(
        'flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
        local.class,
      )}
      {...others}
    >
      {local.children}
      <SelectPrimitive.Icon>
        <ChevronDown class="h-4 w-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

type SelectValueProps = Parameters<typeof SelectPrimitive.Value>[0] & {
  placeholder?: JSX.Element;
};

export function SelectValue(props: SelectValueProps) {
  const [local, others] = splitProps(props, [
    'class',
    'children',
    'placeholder',
  ]);
  return (
    <SelectPrimitive.Value class={cn(local.class)} {...others}>
      {local.children ?? local.placeholder}
    </SelectPrimitive.Value>
  );
}

type SelectContentProps = Parameters<typeof SelectPrimitive.Content>[0];

export function SelectContent(props: SelectContentProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        class={cn(
          'z-50 min-w-32 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-scale-in',
          local.class,
        )}
        {...others}
      >
        <SelectPrimitive.Listbox class="p-1">
          {local.children}
        </SelectPrimitive.Listbox>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

type SelectItemProps = JSX.HTMLAttributes<HTMLDivElement> & {
  item?: any;
  disabled?: boolean;
  value?: string;
};

export function SelectItem(props: SelectItemProps) {
  const [local, others] = splitProps(props, [
    'class',
    'children',
    'item',
    'disabled',
    'value',
  ]);
  return (
    <Show
      when={local.item}
      fallback={
        <div
          role="option"
          aria-disabled={local.disabled}
          data-value={local.value}
          class={cn(
            'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
            local.class,
          )}
          {...others}
        >
          {local.children}
        </div>
      }
    >
      {(item) => (
        <SelectPrimitive.Item
          item={item()}
          class={cn(
            'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
            local.class,
          )}
          {...others}
        >
          <span class="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
            <SelectPrimitive.ItemIndicator>
              <Check class="h-4 w-4" />
            </SelectPrimitive.ItemIndicator>
          </span>
          <SelectPrimitive.ItemLabel>{local.children}</SelectPrimitive.ItemLabel>
        </SelectPrimitive.Item>
      )}
    </Show>
  );
}

type SelectLabelProps = Parameters<typeof SelectPrimitive.Label>[0];

export function SelectLabel(props: SelectLabelProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <SelectPrimitive.Label
      class={cn('px-2 py-1.5 text-sm font-semibold', local.class)}
      {...others}
    >
      {local.children}
    </SelectPrimitive.Label>
  );
}

type SelectSeparatorProps = JSX.HTMLAttributes<HTMLDivElement>;

export function SelectSeparator(props: SelectSeparatorProps) {
  const [local, others] = splitProps(props, ['class']);
  return (
    <div
      role="separator"
      class={cn('-mx-1 my-1 h-px bg-muted', local.class)}
      {...others}
    />
  );
}
