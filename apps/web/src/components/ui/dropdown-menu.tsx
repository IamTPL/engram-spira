import { type JSX, splitProps } from 'solid-js';
import { DropdownMenu as DropdownMenuPrimitive } from '@kobalte/core/dropdown-menu';
import { cn } from '@/lib/utils';

type DropdownMenuProps = Parameters<typeof DropdownMenuPrimitive>[0];

export function DropdownMenu(props: DropdownMenuProps) {
  return <DropdownMenuPrimitive modal={false} {...props} />;
}

type DropdownMenuTriggerProps = JSX.HTMLAttributes<HTMLDivElement>;

export function DropdownMenuTrigger(props: DropdownMenuTriggerProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <DropdownMenuPrimitive.Trigger
      as="div"
      disabled
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
