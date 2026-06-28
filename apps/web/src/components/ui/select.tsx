import {
  type Accessor,
  type JSX,
  Show,
  createContext,
  createEffect,
  createSignal,
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

type SelectRegistrationContextValue = {
  registeredItems: Accessor<RegisteredSelectOption[]>;
  registerItem: (item: RegisteredSelectOption) => void;
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

export function Select(props: SelectProps) {
  const [registeredItems, setRegisteredItems] = createSignal<
    RegisteredSelectOption[]
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

  const context: SelectRegistrationContextValue = {
    registeredItems,
    registerItem: (item) => {
      setRegisteredItems((items) => {
        const nextItems = items.slice();
        const existingIndex = nextItems.findIndex(
          (existingItem) => existingItem.value === item.value,
        );

        if (existingIndex === -1) {
          nextItems.push(item);
        } else {
          nextItems[existingIndex] = item;
        }

        return nextItems;
      });
    },
    unregisterItem: (value) => {
      setRegisteredItems((items) =>
        items.filter((item) => item.value !== value),
      );
    },
    setPlaceholder,
  };

  const options = () => local.options ?? registeredItems();
  const itemComponent = (itemProps: { item: any }) => {
    if (local.itemComponent) return local.itemComponent(itemProps);
    return <SelectItem item={itemProps.item} />;
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
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <>
      <div hidden aria-hidden="true">
        {local.children}
      </div>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          class={cn(
            'z-50 min-w-32 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-scale-in',
            local.class,
          )}
          {...others}
        >
          <SelectPrimitive.Listbox class="p-1" />
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

    const label = local.children ?? local.value;
    const textValue = getTextFromChildren(label) || local.value;

    context?.registerItem({
      value: local.value,
      label,
      textValue,
      disabled: local.disabled,
      class: local.class,
    });

    onCleanup(() => context?.unregisterItem(local.value!));
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
            'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
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
