import { type JSX, Show, splitProps } from 'solid-js';
import { Tooltip as TooltipPrimitive } from '@kobalte/core/tooltip';
import { cn } from '@/lib/utils';

type TooltipProps = Parameters<typeof TooltipPrimitive>[0] & {
  content?: JSX.Element | string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  class?: string;
};

export function Tooltip(props: TooltipProps) {
  const [local, others] = splitProps(props, [
    'children',
    'content',
    'side',
    'class',
  ]);
  return (
    <TooltipPrimitive
      gutter={6}
      placement={local.side}
      {...others}
    >
      <Show
        when={local.content}
        fallback={local.children}
      >
        {(content) => (
          <>
            <TooltipTrigger>{local.children}</TooltipTrigger>
            <TooltipContent class={local.class}>{content()}</TooltipContent>
          </>
        )}
      </Show>
    </TooltipPrimitive>
  );
}

type TooltipTriggerProps = Parameters<typeof TooltipPrimitive.Trigger>[0];

export function TooltipTrigger(props: TooltipTriggerProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <TooltipPrimitive.Trigger
      as="span"
      class={cn('inline-flex', local.class)}
      {...others}
    >
      {local.children}
    </TooltipPrimitive.Trigger>
  );
}

type TooltipContentProps = Parameters<typeof TooltipPrimitive.Content>[0] & {
  side?: 'top' | 'bottom' | 'left' | 'right';
};

export function TooltipContent(props: TooltipContentProps) {
  const [local, others] = splitProps(props, ['class', 'children', 'side']);
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        class={cn(
          'z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-md animate-fade-in',
          local.class,
        )}
        {...others}
      >
        {local.children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
