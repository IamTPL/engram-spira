import { type Component, type JSX, createSignal, Show } from 'solid-js';
import { cn } from '@/lib/utils';

type TooltipProps = {
  content: JSX.Element | string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: JSX.Element;
  class?: string;
};

const sideClasses = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
} as const;

export const Tooltip: Component<TooltipProps> = (props) => {
  const [show, setShow] = createSignal(false);

  return (
    <div
      class="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocusIn={() => setShow(true)}
      onFocusOut={() => setShow(false)}
    >
      {props.children}
      <Show when={show()}>
        <div
          role="tooltip"
          class={cn(
            'absolute z-50 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1 text-xs text-background shadow-md animate-fade-in pointer-events-none',
            sideClasses[props.side ?? 'top'],
            props.class,
          )}
        >
          {props.content}
        </div>
      </Show>
    </div>
  );
};
