import { type JSX, Show, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-solid';

const alertVariants = {
  default: 'border-border bg-card text-foreground',
  destructive: 'border-destructive/30 bg-destructive/5 text-destructive',
  success: 'border-success/30 bg-success/5 text-success',
  warning: 'border-warning/30 bg-warning/5 text-warning',
  info: 'border-info/30 bg-info/5 text-info',
} as const;

const alertIcons = {
  default: Info,
  destructive: AlertCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
} as const;

type AlertProps = JSX.HTMLAttributes<HTMLDivElement> & {
  variant?: keyof typeof alertVariants;
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
  const IconComponent = () => alertIcons[variant()];
  const showIcon = () => local.icon !== false;

  return (
    <div
      role="alert"
      class={cn(
        'relative flex gap-3 rounded-lg border p-4 text-sm',
        alertVariants[variant()],
        local.class,
      )}
      {...others}
    >
      <Show when={showIcon()}>
        {(() => {
          const Icon = IconComponent();
          return <Icon class="h-4 w-4 shrink-0 mt-0.5" />;
        })()}
      </Show>
      <div class="flex-1 min-w-0">
        <Show when={local.title}>
          <h5 class="font-medium leading-none mb-1">{local.title}</h5>
        </Show>
        <div class="text-sm opacity-90">{local.children}</div>
      </div>
    </div>
  );
}
