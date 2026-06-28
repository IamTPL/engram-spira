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
      'flex h-9 w-full rounded-md border bg-background px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
      local.error
        ? 'border-destructive focus-visible:ring-destructive'
        : 'border-input',
      local.class,
    );

  return (
    <Show
      when={hasIcon()}
      fallback={
        <input
          class={inputClass()}
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
            inputClass(),
            local.iconLeft ? 'pl-10 pr-3' : 'pl-3',
            local.iconRight ? 'pr-10' : 'pr-3',
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
