import {
  type Component,
  type JSX,
  createSignal,
  createContext,
  useContext,
  For,
  splitProps,
} from 'solid-js';
import { cn } from '@/lib/utils';

type TabsContextValue = {
  value: () => string;
  setValue: (v: string) => void;
};

const TabsContext = createContext<TabsContextValue>();

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs components must be used within <Tabs>');
  return ctx;
}

type TabsProps = JSX.HTMLAttributes<HTMLDivElement> & {
  defaultValue: string;
  value?: string;
  onValueChange?: (value: string) => void;
};

export function Tabs(props: TabsProps) {
  const [local, others] = splitProps(props, [
    'class',
    'children',
    'defaultValue',
    'value',
    'onValueChange',
  ]);

  const [internalValue, setInternalValue] = createSignal(local.defaultValue);

  const value = () => local.value ?? internalValue();
  const setValue = (v: string) => {
    setInternalValue(v);
    local.onValueChange?.(v);
  };

  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div class={cn('w-full', local.class)} {...others}>
        {local.children}
      </div>
    </TabsContext.Provider>
  );
}

type TabsListProps = JSX.HTMLAttributes<HTMLDivElement>;

export function TabsList(props: TabsListProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div
      role="tablist"
      class={cn(
        'inline-flex items-center gap-1 rounded-lg bg-muted p-1',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </div>
  );
}

type TabsTriggerProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string;
};

export function TabsTrigger(props: TabsTriggerProps) {
  const [local, others] = splitProps(props, ['class', 'children', 'value']);
  const ctx = useTabsContext();

  const isActive = () => ctx.value() === local.value;

  return (
    <button
      role="tab"
      aria-selected={isActive()}
      class={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-[--duration-normal] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer',
        isActive()
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-card/50',
        local.class,
      )}
      onClick={() => ctx.setValue(local.value)}
      {...others}
    >
      {local.children}
    </button>
  );
}

type TabsContentProps = JSX.HTMLAttributes<HTMLDivElement> & {
  value: string;
};

export function TabsContent(props: TabsContentProps) {
  const [local, others] = splitProps(props, ['class', 'children', 'value']);
  const ctx = useTabsContext();

  return (
    <div
      role="tabpanel"
      class={cn(
        'mt-4 animate-fade-in',
        ctx.value() !== local.value && 'hidden',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </div>
  );
}
