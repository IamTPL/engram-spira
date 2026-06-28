import { type JSX, Show, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';

type ProgressProps = JSX.HTMLAttributes<HTMLDivElement> & {
  value: number;
  max?: number;
  variant?: 'default' | 'success' | 'warning' | 'destructive' | 'info';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
};

const variantClasses = {
  default: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-info',
} as const;

const sizeClasses = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
} as const;

export function Progress(props: ProgressProps) {
  const [local, others] = splitProps(props, [
    'class',
    'value',
    'max',
    'variant',
    'size',
    'showLabel',
  ]);

  const max = () => Math.max(local.max ?? 100, 1);
  const percentage = () => Math.min(100, Math.max(0, (local.value / max()) * 100));

  return (
    <div class={cn('flex items-center gap-3', local.class)} {...others}>
      <div
        class={cn(
          'relative w-full overflow-hidden rounded-full bg-muted',
          sizeClasses[local.size ?? 'md'],
        )}
        role="progressbar"
        aria-valuenow={local.value}
        aria-valuemin={0}
        aria-valuemax={max()}
      >
        <div
          class={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            variantClasses[local.variant ?? 'default'],
          )}
          style={{ width: `${percentage()}%` }}
        />
      </div>
      <Show when={local.showLabel}>
        <span class="text-xs font-medium text-muted-foreground tabular-nums shrink-0">
          {Math.round(percentage())}%
        </span>
      </Show>
    </div>
  );
}
