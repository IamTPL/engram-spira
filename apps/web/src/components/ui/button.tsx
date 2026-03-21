import { type JSX, Show, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-[--duration-normal] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'btn-gradient text-slate-800 shadow hover:opacity-90 active:translate-y-px active:shadow-sm',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:translate-y-px',
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground active:translate-y-px',
        secondary:
          'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 active:translate-y-px',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-palette-5 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3 py-2',
        sm: 'h-7 rounded-md px-3 text-xs',
        lg: 'h-9 rounded-md px-4',
        icon: 'h-9 w-9',
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
      {...others}
    >
      <Show when={local.loading}>
        <svg
          class="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="3"
          />
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </Show>
      {local.children}
    </button>
  );
}

export { buttonVariants };
