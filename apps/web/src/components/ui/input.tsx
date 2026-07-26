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
  const inputClass = () =>
    cn(
      'flex h-10 w-full rounded-md border bg-card px-3 py-2 text-base text-foreground shadow-xs transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:text-muted-foreground disabled:opacity-70 md:text-sm',
      local.error
        ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20'
        : 'border-input',
      local.class,
    );

  return (
    <Show
      when={hasIcon()}
      fallback={
        <input
          class={inputClass()}
          aria-invalid={local.error || undefined}
          {...others}
        />
      }
    >
      <div class="relative w-full">
        <Show when={local.iconLeft}>
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
            {local.iconLeft}
          </span>
        </Show>
        <input
          class={cn(
            inputClass(),
            local.iconLeft ? 'pl-10 pr-3' : 'pl-3',
            local.iconRight ? 'pr-10' : 'pr-3',
          )}
          aria-invalid={local.error || undefined}
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
