import {
  type Accessor,
  type JSX,
  For,
  Show,
  createContext,
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  splitProps,
  useContext,
} from 'solid-js';
import { Select as SelectPrimitive } from '@kobalte/core/select';
import { Check, ChevronDown } from 'lucide-solid';
import { cn } from '@/lib/utils';

type RegisteredSelectOption = {
  value: string;
  label: JSX.Element;
  textValue: string;
  disabled?: boolean;
  class?: string;
};

type SelectItemEntry = {
  type: 'item';
  key: string;
  value: string;
  option: RegisteredSelectOption;
};

type SelectDecorationEntry = {
  type: 'label' | 'separator';
  key: string;
  render: () => JSX.Element;
};

type SelectContentEntry = SelectItemEntry | SelectDecorationEntry;

type SelectRegistrationContextValue = {
  registeredItems: Accessor<RegisteredSelectOption[]>;
  contentBeforeItem: (item: any) => SelectDecorationEntry[];
  trailingContent: Accessor<SelectDecorationEntry[]>;
  registerContentEntry: (entry: SelectDecorationEntry) => void;
  registerItem: (item: RegisteredSelectOption) => void;
  unregisterContentEntry: (key: string) => void;
  unregisterItem: (value: string) => void;
  setPlaceholder: (placeholder: JSX.Element | undefined) => void;
};

const SelectRegistrationContext =
  createContext<SelectRegistrationContextValue>();

type SelectProps = Omit<
  Parameters<typeof SelectPrimitive>[0],
  | 'itemComponent'
  | 'optionDisabled'
  | 'optionTextValue'
  | 'optionValue'
  | 'options'
  | 'placeholder'
> & {
  class?: string;
  itemComponent?: (props: { item: any }) => JSX.Element;
  optionDisabled?: string | ((option: any) => boolean);
  optionTextValue?: string | ((option: any) => string);
  optionValue?: string | ((option: any) => string | number);
  onValueChange?: (value: string) => void;
  options?: any[];
  placeholder?: JSX.Element;
};

function isRegisteredSelectOption(
  option: unknown,
): option is RegisteredSelectOption {
  return (
    typeof option === 'object' &&
    option !== null &&
    'value' in option &&
    'label' in option
  );
}

function getSelectOptionValue(option: any) {
  if (isRegisteredSelectOption(option)) return option.value;
  return String(option);
}

function getSelectOptionText(option: any) {
  if (isRegisteredSelectOption(option)) return option.textValue;
  return String(option);
}

function getSelectOptionDisabled(option: any) {
  return isRegisteredSelectOption(option) ? Boolean(option.disabled) : false;
}

function getSelectOptionLabel(option: any) {
  if (isRegisteredSelectOption(option)) return option.label;
  return option == null ? '' : String(option);
}

function getSelectOptionClass(option: any) {
  return isRegisteredSelectOption(option) ? option.class : undefined;
}

function getItemRawValue(item: any) {
  return item?.rawValue ?? item;
}

function getTextFromChildren(value: JSX.Element): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(getTextFromChildren).join('');
  }

  return '';
}

function isSelectItemEntry(entry: SelectContentEntry): entry is SelectItemEntry {
  return entry.type === 'item';
}

function isSelectDecorationEntry(
  entry: SelectContentEntry,
): entry is SelectDecorationEntry {
  return entry.type === 'label' || entry.type === 'separator';
}

export function Select(props: SelectProps) {
  const [contentEntries, setContentEntries] = createSignal<
    SelectContentEntry[]
  >([]);
  const [placeholder, setPlaceholder] = createSignal<JSX.Element>();
  const [local, others] = splitProps(props, [
    'class',
    'children',
    'itemComponent',
    'optionDisabled',
    'optionTextValue',
    'optionValue',
    'onChange',
    'onValueChange',
    'options',
    'placeholder',
  ]);

  const registeredItems = () =>
    contentEntries()
      .filter(isSelectItemEntry)
      .map((entry) => entry.option);

  const contentBeforeItem = (item: any) => {
    const value = getSelectOptionValue(getItemRawValue(item));
    const entries = contentEntries();
    const itemIndex = entries.findIndex(
      (entry) => entry.type === 'item' && entry.value === value,
    );

    if (itemIndex === -1) return [];

    let previousItemIndex = -1;

    for (let index = itemIndex - 1; index >= 0; index -= 1) {
      if (entries[index]?.type === 'item') {
        previousItemIndex = index;
        break;
      }
    }

    return entries
      .slice(previousItemIndex + 1, itemIndex)
      .filter(isSelectDecorationEntry);
  };

  const trailingContent = () => {
    const entries = contentEntries();
    let lastItemIndex = -1;

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (entries[index]?.type === 'item') {
        lastItemIndex = index;
        break;
      }
    }

    return entries.slice(lastItemIndex + 1).filter(isSelectDecorationEntry);
  };

  const upsertContentEntry = (entry: SelectContentEntry) => {
    setContentEntries((entries) => {
      const nextEntries = entries.slice();
      const existingIndex = nextEntries.findIndex(
        (existingEntry) => existingEntry.key === entry.key,
      );

      if (existingIndex === -1) {
        nextEntries.push(entry);
      } else {
        nextEntries[existingIndex] = entry;
      }

      return nextEntries;
    });
  };

  const context: SelectRegistrationContextValue = {
    registeredItems,
    contentBeforeItem,
    trailingContent,
    registerContentEntry: upsertContentEntry,
    registerItem: (item) => {
      upsertContentEntry({
        type: 'item',
        key: `item:${item.value}`,
        value: item.value,
        option: item,
      });
    },
    unregisterContentEntry: (key) => {
      setContentEntries((entries) =>
        entries.filter((entry) => entry.key !== key),
      );
    },
    unregisterItem: (value) => {
      setContentEntries((entries) =>
        entries.filter(
          (entry) => !(entry.type === 'item' && entry.value === value),
        ),
      );
    },
    setPlaceholder,
  };

  const options = () => local.options ?? registeredItems();
  const itemComponent = (itemProps: { item: any }) => {
    if (local.itemComponent) return local.itemComponent(itemProps);
    return (
      <>
        <For each={contentBeforeItem(itemProps.item)}>
          {(entry) => entry.render()}
        </For>
        <SelectItem item={itemProps.item} />
      </>
    );
  };
  const onChange = (value: any) => {
    local.onChange?.(value);

    if (value != null && !Array.isArray(value)) {
      local.onValueChange?.(getSelectOptionValue(value));
    }
  };

  return (
    <SelectRegistrationContext.Provider value={context}>
      <SelectPrimitive
        class={cn('w-full', local.class)}
        options={options()}
        optionValue={local.optionValue ?? getSelectOptionValue}
        optionTextValue={local.optionTextValue ?? getSelectOptionText}
        optionDisabled={local.optionDisabled ?? getSelectOptionDisabled}
        itemComponent={itemComponent}
        placeholder={local.placeholder ?? placeholder()}
        onChange={onChange}
        {...others}
      >
        {local.children}
      </SelectPrimitive>
    </SelectRegistrationContext.Provider>
  );
}

type SelectTriggerProps = Parameters<typeof SelectPrimitive.Trigger>[0];

export function SelectTrigger(props: SelectTriggerProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <SelectPrimitive.Trigger
      class={cn(
        'flex h-10 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-xs transition-[background-color,border-color,box-shadow,transform] duration-150 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 active:translate-y-px disabled:cursor-not-allowed disabled:translate-y-0 disabled:bg-muted/60 disabled:text-muted-foreground disabled:opacity-70 [&>span]:line-clamp-1',
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
  const context = useContext(SelectRegistrationContext);
  const [local, others] = splitProps(props, [
    'class',
    'children',
    'placeholder',
  ]);

  createEffect(() => {
    context?.setPlaceholder(local.placeholder);
    onCleanup(() => context?.setPlaceholder(undefined));
  });

  return (
    <SelectPrimitive.Value class={cn(local.class)} {...others}>
      {local.children ??
        ((state) => getSelectOptionLabel(state.selectedOption()))}
    </SelectPrimitive.Value>
  );
}

type SelectContentProps = Parameters<typeof SelectPrimitive.Content>[0];

export function SelectContent(props: SelectContentProps) {
  const context = useContext(SelectRegistrationContext);
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <>
      <div hidden aria-hidden="true">
        {local.children}
      </div>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          class={cn(
            'z-50 min-w-40 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl motion-safe:animate-scale-in',
            local.class,
          )}
          {...others}
        >
          <SelectPrimitive.Listbox class="p-1" />
          <For each={context?.trailingContent() ?? []}>
            {(entry) => entry.render()}
          </For>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </>
  );
}

type SelectItemProps = JSX.HTMLAttributes<HTMLDivElement> & {
  item?: any;
  disabled?: boolean;
  value?: string;
};

export function SelectItem(props: SelectItemProps) {
  const context = useContext(SelectRegistrationContext);
  const [local, others] = splitProps(props, [
    'class',
    'children',
    'item',
    'disabled',
    'value',
  ]);

  createEffect(() => {
    if (local.item || local.value == null) return;

    const registeredValue = local.value;
    const label = local.children ?? registeredValue;
    const textValue = getTextFromChildren(label) || registeredValue;

    context?.registerItem({
      value: registeredValue,
      label,
      textValue,
      disabled: local.disabled,
      class: local.class,
    });

    onCleanup(() => context?.unregisterItem(registeredValue));
  });

  return (
    <Show
      when={local.item}
      fallback={null}
    >
      {(item) => (
        <SelectPrimitive.Item
          item={item()}
          class={cn(
            'relative flex min-h-9 w-full cursor-default select-none items-center rounded-md py-2 pl-2.5 pr-8 text-sm outline-none transition-colors duration-150 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
            getSelectOptionClass(getItemRawValue(item())),
            local.class,
          )}
          {...others}
        >
          <span class="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
            <SelectPrimitive.ItemIndicator>
              <Check class="h-4 w-4" />
            </SelectPrimitive.ItemIndicator>
          </span>
          <SelectPrimitive.ItemLabel>
            {local.children ?? getSelectOptionLabel(getItemRawValue(item()))}
          </SelectPrimitive.ItemLabel>
        </SelectPrimitive.Item>
      )}
    </Show>
  );
}

type SelectLabelProps = Parameters<typeof SelectPrimitive.Label>[0];

export function SelectLabel(props: SelectLabelProps) {
  const context = useContext(SelectRegistrationContext);
  const key = createUniqueId();
  const [local, others] = splitProps(props, ['class', 'children']);

  createEffect(() => {
    if (!context) return;

    context.registerContentEntry({
      type: 'label',
      key,
      render: () => (
        <li
          role="presentation"
          class={cn(
            'px-2.5 py-1.5 text-xs font-semibold text-muted-foreground',
            local.class,
          )}
          {...others}
        >
          {local.children}
        </li>
      ),
    });

    onCleanup(() => context.unregisterContentEntry(key));
  });

  return (
    <Show
      when={!context}
      fallback={null}
    >
      <SelectPrimitive.Label
        class={cn(
          'px-2.5 py-1.5 text-xs font-semibold text-muted-foreground',
          local.class,
        )}
        {...others}
      >
        {local.children}
      </SelectPrimitive.Label>
    </Show>
  );
}

type SelectSeparatorProps = JSX.HTMLAttributes<HTMLDivElement>;

export function SelectSeparator(props: SelectSeparatorProps) {
  const context = useContext(SelectRegistrationContext);
  const key = createUniqueId();
  const [local, others] = splitProps(props, ['class']);

  createEffect(() => {
    if (!context) return;

    context.registerContentEntry({
      type: 'separator',
      key,
      render: () => (
        <li role="presentation">
          <div
            role="separator"
            class={cn('-mx-1 my-1 h-px bg-border', local.class)}
            {...others}
          />
        </li>
      ),
    });

    onCleanup(() => context.unregisterContentEntry(key));
  });

  return (
    <Show
      when={!context}
      fallback={null}
    >
      <div
        role="separator"
        class={cn('-mx-1 my-1 h-px bg-border', local.class)}
        {...others}
      />
    </Show>
  );
}
