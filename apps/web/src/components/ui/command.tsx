import { splitProps } from 'solid-js';
import {
  Command as CommandPrimitive,
  type CommandEmptyProps,
  type CommandGroupProps,
  type CommandInputProps,
  type CommandItemProps,
  type CommandListProps,
  type CommandRootProps,
} from 'cmdk-solid';
import { Search } from 'lucide-solid';
import { cn } from '@/lib/utils';

export function Command(props: CommandRootProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <CommandPrimitive
      class={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </CommandPrimitive>
  );
}

export function CommandInput(props: CommandInputProps) {
  const [local, others] = splitProps(props, ['class']);
  return (
    <div class="flex h-11 items-center border-b px-3" data-cmdk-input-wrapper="">
      <Search class="mr-2 h-4 w-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        class={cn(
          'flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          local.class,
        )}
        {...others}
      />
    </div>
  );
}

export function CommandList(props: CommandListProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <CommandPrimitive.List
      class={cn('max-h-72 overflow-y-auto overflow-x-hidden', local.class)}
      {...others}
    >
      {local.children}
    </CommandPrimitive.List>
  );
}

export function CommandEmpty(props: CommandEmptyProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <CommandPrimitive.Empty
      class={cn('py-6 text-center text-sm', local.class)}
      {...others}
    >
      {local.children}
    </CommandPrimitive.Empty>
  );
}

export function CommandGroup(props: CommandGroupProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <CommandPrimitive.Group
      class={cn(
        'overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </CommandPrimitive.Group>
  );
}

export function CommandItem(props: CommandItemProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <CommandPrimitive.Item
      class={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[selected]:bg-accent data-[selected]:text-accent-foreground data-[disabled]:opacity-50',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </CommandPrimitive.Item>
  );
}
