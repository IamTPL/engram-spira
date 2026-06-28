import { type JSX, Show, splitProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@/lib/utils';
import { AlertCircle, Info } from 'lucide-solid';
import { cva, type VariantProps } from 'class-variance-authority';

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive:
          'border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const alertIcons = {
  default: Info,
  destructive: AlertCircle,
} as const;

type AlertProps = JSX.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants> & {
  title?: string;
  icon?: boolean;
};

export function Alert(props: AlertProps) {
  const [local, others] = splitProps(props, [
    'class',
    'children',
    'variant',
    'title',
    'icon',
  ]);

  const variant = () => local.variant ?? 'default';
  const showIcon = () => local.icon !== false;

  return (
    <div
      role="alert"
      class={cn(
        alertVariants({ variant: local.variant }),
        showIcon() && '[&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-7',
        local.class,
      )}
      {...others}
    >
      <Show when={showIcon()}>
        <Dynamic component={alertIcons[variant()]} class="h-4 w-4" />
      </Show>
      <Show when={local.title}>
        <AlertTitle>{local.title}</AlertTitle>
      </Show>
      <Show when={local.children}>
        <AlertDescription>{local.children}</AlertDescription>
      </Show>
    </div>
  );
}

type AlertTitleProps = JSX.HTMLAttributes<HTMLHeadingElement>;

export function AlertTitle(props: AlertTitleProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <h5 class={cn('mb-1 font-medium leading-none tracking-tight', local.class)} {...others}>
      {local.children}
    </h5>
  );
}

type AlertDescriptionProps = JSX.HTMLAttributes<HTMLParagraphElement>;

export function AlertDescription(props: AlertDescriptionProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div class={cn('text-sm [&_p]:leading-relaxed', local.class)} {...others}>
      {local.children}
    </div>
  );
}
