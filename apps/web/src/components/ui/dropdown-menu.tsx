import {
  type Component,
  type JSX,
  Show,
  splitProps,
  createSignal,
  createEffect,
  onCleanup,
} from 'solid-js';
import { cn } from '@/lib/utils';

type DropdownMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
};

export const DropdownMenu: Component<DropdownMenuProps> = (props) => {
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-dropdown-menu]')) {
      props.onOpenChange(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onOpenChange(false);
  };

  createEffect(() => {
    if (props.open) {
      document.addEventListener('click', handleClickOutside, true);
      document.addEventListener('keydown', handleKeyDown);
    } else {
      document.removeEventListener('click', handleClickOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
    }
  });

  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside, true);
    document.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div class="relative inline-block" data-dropdown-menu>
      {props.children}
    </div>
  );
};

type DropdownMenuTriggerProps = JSX.HTMLAttributes<HTMLDivElement>;

export function DropdownMenuTrigger(props: DropdownMenuTriggerProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div class={cn('cursor-pointer', local.class)} {...others}>
      {local.children}
    </div>
  );
}

type DropdownMenuContentProps = JSX.HTMLAttributes<HTMLDivElement> & {
  align?: 'start' | 'center' | 'end';
};

export function DropdownMenuContent(props: DropdownMenuContentProps) {
  const [local, others] = splitProps(props, ['class', 'children', 'align']);

  const alignClass = () => {
    switch (local.align) {
      case 'start':
        return 'left-0';
      case 'center':
        return 'left-1/2 -translate-x-1/2';
      case 'end':
      default:
        return 'right-0';
    }
  };

  return (
    <div
      class={cn(
        'absolute top-full mt-1 z-50 min-w-32 overflow-hidden rounded-lg border bg-card p-1 shadow-lg animate-scale-in',
        alignClass(),
        local.class,
      )}
      role="menu"
      {...others}
    >
      {local.children}
    </div>
  );
}

type DropdownMenuItemProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  destructive?: boolean;
};

export function DropdownMenuItem(props: DropdownMenuItemProps) {
  const [local, others] = splitProps(props, [
    'class',
    'children',
    'destructive',
  ]);
  return (
    <button
      role="menuitem"
      class={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors cursor-pointer',
        local.destructive
          ? 'text-destructive hover:bg-destructive/10 focus:bg-destructive/10'
          : 'hover:bg-accent focus:bg-accent',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </button>
  );
}

type DropdownMenuSeparatorProps = JSX.HTMLAttributes<HTMLDivElement>;

export function DropdownMenuSeparator(props: DropdownMenuSeparatorProps) {
  const [local, others] = splitProps(props, ['class']);
  return (
    <div
      class={cn('-mx-1 my-1 h-px bg-border', local.class)}
      role="separator"
      {...others}
    />
  );
}

type DropdownMenuLabelProps = JSX.HTMLAttributes<HTMLDivElement>;

export function DropdownMenuLabel(props: DropdownMenuLabelProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div
      class={cn(
        'px-2 py-1.5 text-xs font-semibold text-muted-foreground',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </div>
  );
}
