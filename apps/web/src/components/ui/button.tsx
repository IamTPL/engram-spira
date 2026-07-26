import { type JSX, Show, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-solid';

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-45 cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline:
          'border border-input bg-card text-foreground shadow-xs hover:border-muted-foreground/40 hover:bg-accent',
        secondary:
          'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/75',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link:
          'text-info shadow-none underline-offset-4 hover:text-info/80 hover:underline',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6 text-base',
        icon: 'h-10 w-10 shrink-0 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
  };

export function Button(props: ButtonProps) {
  const [local, others] = splitProps(props, [
    'variant',
    'size',
    'class',
    'children',
    'loading',
    'disabled',
  ]);
  return (
    <button
      class={cn(
        buttonVariants({ variant: local.variant, size: local.size }),
        local.class,
      )}
      disabled={local.disabled || local.loading}
      aria-busy={local.loading || undefined}
      {...others}
    >
      <Show when={local.loading}>
        <Loader2 class="h-4 w-4 motion-safe:animate-spin" />
      </Show>
      {local.children}
    </button>
  );
}

export { buttonVariants };
