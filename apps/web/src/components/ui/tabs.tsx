import { splitProps } from 'solid-js';
import { Tabs as TabsPrimitive } from '@kobalte/core/tabs';
import { cn } from '@/lib/utils';

type TabsProps = Omit<Parameters<typeof TabsPrimitive>[0], 'onChange'> & {
  onChange?: (value: string) => void;
  onValueChange?: (value: string) => void;
};

export function Tabs(props: TabsProps) {
  const [local, others] = splitProps(props, [
    'class',
    'children',
    'onChange',
    'onValueChange',
  ]);
  return (
    <TabsPrimitive
      class={cn('w-full', local.class)}
      onChange={(value: string) => {
        local.onChange?.(value);
        local.onValueChange?.(value);
      }}
      {...others}
    >
      {local.children}
    </TabsPrimitive>
  );
}

type TabsListProps = Parameters<typeof TabsPrimitive.List>[0];

export function TabsList(props: TabsListProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <TabsPrimitive.List
      class={cn(
        'inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </TabsPrimitive.List>
  );
}

type TabsTriggerProps = Parameters<typeof TabsPrimitive.Trigger>[0];

export function TabsTrigger(props: TabsTriggerProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <TabsPrimitive.Trigger
      class={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </TabsPrimitive.Trigger>
  );
}

type TabsContentProps = Parameters<typeof TabsPrimitive.Content>[0];

export function TabsContent(props: TabsContentProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <TabsPrimitive.Content
      class={cn(
        'mt-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </TabsPrimitive.Content>
  );
}
