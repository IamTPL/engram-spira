import { type JSX, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';

const badgeVariants = {
  default: 'bg-primary text-primary-foreground shadow-sm',
  secondary: 'bg-secondary text-secondary-foreground',
  destructive: 'bg-destructive text-destructive-foreground shadow-sm',
  success: 'bg-success text-success-foreground shadow-sm',
  warning: 'bg-warning text-warning-foreground shadow-sm',
  outline: 'border border-border text-foreground',
  muted: 'bg-muted text-muted-foreground',
} as const;

type BadgeProps = JSX.HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof badgeVariants;
};

export function Badge(props: BadgeProps) {
  const [local, others] = splitProps(props, ['class', 'children', 'variant']);
  return (
    <span
      class={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
        badgeVariants[local.variant ?? 'default'],
        local.class,
      )}
      {...others}
    >
      {local.children}
    </span>
  );
}
