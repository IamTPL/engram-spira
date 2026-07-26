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
        'inline-flex h-10 items-center justify-center rounded-lg border border-transparent bg-muted/80 p-1 text-muted-foreground',
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
        'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 active:translate-y-px disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 data-[selected]:bg-card data-[selected]:text-foreground data-[selected]:shadow-xs',
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
        'mt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </TabsPrimitive.Content>
  );
}
