import { type JSX, Show, splitProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@/lib/utils';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-solid';
import { cva, type VariantProps } from 'class-variance-authority';

const alertVariants = cva(
  'relative w-full rounded-xl border px-4 py-3.5 text-sm shadow-xs',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-card-foreground',
        destructive:
          'border-destructive/25 bg-destructive-surface text-destructive [&>svg]:text-destructive',
        success:
          'border-success/25 bg-success-surface text-success [&>svg]:text-success',
        warning:
          'border-warning/25 bg-warning-surface text-warning [&>svg]:text-warning',
        info:
          'border-info/25 bg-info-surface text-info [&>svg]:text-info',
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
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
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
        showIcon() &&
          '[&>svg]:absolute [&>svg]:left-4 [&>svg]:top-[1.125rem] [&>svg~*]:pl-7',
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
    <h5
      class={cn('mb-1 font-semibold leading-tight tracking-tight', local.class)}
      {...others}
    >
      {local.children}
    </h5>
  );
}

type AlertDescriptionProps = JSX.HTMLAttributes<HTMLParagraphElement>;

export function AlertDescription(props: AlertDescriptionProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div
      class={cn('text-sm leading-relaxed [&_p]:leading-relaxed', local.class)}
      {...others}
    >
      {local.children}
    </div>
  );
}
