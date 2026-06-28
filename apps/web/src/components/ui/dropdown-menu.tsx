import {
  type JSX,
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  splitProps,
  useContext,
} from 'solid-js';
import { DropdownMenu as DropdownMenuPrimitive } from '@kobalte/core/dropdown-menu';
import { cn } from '@/lib/utils';

type DropdownMenuProps = Parameters<typeof DropdownMenuPrimitive>[0];
type DropdownMenuAlign = 'start' | 'center' | 'end';
type DropdownMenuPlacement = NonNullable<DropdownMenuProps['placement']>;

const DropdownMenuAlignContext = createContext<{
  setAlign: (align: DropdownMenuAlign | undefined) => void;
}>();

function getPlacementFromAlign(
  align: DropdownMenuAlign | undefined,
): DropdownMenuPlacement {
  if (align === 'end') return 'bottom-end';
  if (align === 'start') return 'bottom-start';
  return 'bottom';
}

export function DropdownMenu(props: DropdownMenuProps) {
  const [contentAlign, setContentAlign] = createSignal<DropdownMenuAlign>();
  const [local, others] = splitProps(props, ['children', 'placement']);

  return (
    <DropdownMenuAlignContext.Provider value={{ setAlign: setContentAlign }}>
      <DropdownMenuPrimitive
        modal={false}
        placement={local.placement ?? getPlacementFromAlign(contentAlign())}
        {...others}
      >
        {local.children}
      </DropdownMenuPrimitive>
    </DropdownMenuAlignContext.Provider>
  );
}

type DropdownMenuTriggerProps = Parameters<
  typeof DropdownMenuPrimitive.Trigger
>[0] & {
  class?: string;
};

export function DropdownMenuTrigger(props: DropdownMenuTriggerProps) {
  const [local, others] = splitProps(props, ['class', 'children', 'disabled']);
  return (
    <DropdownMenuPrimitive.Trigger
      as="div"
      disabled={local.disabled}
      class={cn('inline-flex cursor-pointer', local.class)}
      {...others}
    >
      {local.children}
    </DropdownMenuPrimitive.Trigger>
  );
}

type DropdownMenuContentProps = JSX.HTMLAttributes<HTMLDivElement> & {
  align?: 'start' | 'center' | 'end';
};

export function DropdownMenuContent(props: DropdownMenuContentProps) {
  const [local, others] = splitProps(props, ['class', 'children', 'align']);
  const context = useContext(DropdownMenuAlignContext);

  createEffect(() => {
    context?.setAlign(local.align);
    onCleanup(() => context?.setAlign(undefined));
  });

  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        class={cn(
          'z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-scale-in',
          local.align === 'end' && 'origin-top-right',
          local.align === 'start' && 'origin-top-left',
          local.class,
        )}
        {...others}
      >
        {local.children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

type DropdownMenuItemProps = Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  'onSelect'
> & {
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
};

export function DropdownMenuItem(props: DropdownMenuItemProps) {
  const [local, others] = splitProps(props, [
    'class',
    'children',
    'destructive',
    'disabled',
    'onSelect',
  ]);
  return (
    <DropdownMenuPrimitive.Item
      as="button"
      disabled={local.disabled}
      onSelect={local.onSelect}
      class={cn(
        'relative flex w-full select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        local.destructive &&
          'text-destructive focus:bg-destructive/10 focus:text-destructive',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </DropdownMenuPrimitive.Item>
  );
}

type DropdownMenuSeparatorProps = JSX.HTMLAttributes<HTMLDivElement>;

export function DropdownMenuSeparator(props: DropdownMenuSeparatorProps) {
  const [local, others] = splitProps(props, ['class']);
  return (
    <DropdownMenuPrimitive.Separator
      class={cn('-mx-1 my-1 h-px bg-muted', local.class)}
      {...others}
    />
  );
}

type DropdownMenuLabelProps = JSX.HTMLAttributes<HTMLDivElement>;

export function DropdownMenuLabel(props: DropdownMenuLabelProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <DropdownMenuPrimitive.GroupLabel
      as="div"
      class={cn('px-2 py-1.5 text-sm font-semibold', local.class)}
      {...others}
    >
      {local.children}
    </DropdownMenuPrimitive.GroupLabel>
  );
}
