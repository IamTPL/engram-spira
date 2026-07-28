import { type JSX, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const badgeVariants = cva(
  'inline-flex min-h-5 items-center rounded-md border px-2 py-0.5 text-xs font-semibold leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground',
        destructive:
          'rounded-full border-transparent bg-destructive text-destructive-foreground',
        outline: 'border-input bg-card text-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        success:
          'rounded-full border-transparent bg-success-fill text-success-fill-foreground',
        warning:
          'rounded-full border-transparent bg-warning-fill text-warning-fill-foreground',
        info:
          'rounded-full border-transparent bg-info-fill text-info-fill-foreground',
        due:
          'rounded-full border-transparent bg-due-fill text-due-fill-foreground',
        new:
          'rounded-full border-transparent bg-new-fill text-new-fill-foreground',
        learning:
          'rounded-full border-transparent bg-learning-fill text-learning-fill-foreground',
        risk:
          'rounded-full border-transparent bg-risk-fill text-risk-fill-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

type BadgeProps = JSX.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge(props: BadgeProps) {
  const [local, others] = splitProps(props, ['class', 'children', 'variant']);
  return (
    <span
      class={cn(
        badgeVariants({ variant: local.variant }),
        local.class,
      )}
      {...others}
    >
      {local.children}
    </span>
  );
}

export { badgeVariants };
