import { type JSX, Show, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';

type InputProps = JSX.InputHTMLAttributes<HTMLInputElement> & {
  error?: boolean;
  iconLeft?: JSX.Element;
  iconRight?: JSX.Element;
};

export function Input(props: InputProps) {
  const [local, others] = splitProps(props, [
    'class',
    'error',
    'iconLeft',
    'iconRight',
  ]);

  const hasIcon = () => !!local.iconLeft || !!local.iconRight;

  return (
    <Show
      when={hasIcon()}
      fallback={
        <input
          class={cn(
            'flex h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm transition-all duration-[--duration-normal] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
            local.error
              ? 'border-destructive focus-visible:ring-destructive'
              : 'border-input',
            local.class,
          )}
          {...others}
        />
      }
    >
      <div class="relative">
        <Show when={local.iconLeft}>
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
            {local.iconLeft}
          </span>
        </Show>
        <input
          class={cn(
            'flex h-10 w-full rounded-md border bg-transparent py-2 text-sm shadow-sm transition-all duration-[--duration-normal] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
            local.error
              ? 'border-destructive focus-visible:ring-destructive'
              : 'border-input',
            local.iconLeft ? 'pl-10 pr-3' : 'pl-3',
            local.iconRight ? 'pr-10' : 'pr-3',
            local.class,
          )}
          {...others}
        />
        <Show when={local.iconRight}>
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
            {local.iconRight}
          </span>
        </Show>
      </div>
    </Show>
  );
}
