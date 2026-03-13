import { type Component, type JSX, Show, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';

type EmptyStateProps = JSX.HTMLAttributes<HTMLDivElement> & {
  icon?: Component<{ class?: string }>;
  title: string;
  description?: string;
  action?: JSX.Element;
};

export function EmptyState(props: EmptyStateProps) {
  const [local, others] = splitProps(props, [
    'class',
    'icon',
    'title',
    'description',
    'action',
  ]);

  return (
    <div
      class={cn(
        'flex flex-col items-center justify-center text-center py-12 px-6',
        local.class,
      )}
      {...others}
    >
      <Show when={local.icon}>
        {(() => {
          const Icon = local.icon!;
          return (
            <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Icon class="h-7 w-7 text-muted-foreground" />
            </div>
          );
        })()}
      </Show>
      <h3 class="text-lg font-semibold">{local.title}</h3>
      <Show when={local.description}>
        <p class="mt-1.5 text-sm text-muted-foreground max-w-sm">
          {local.description}
        </p>
      </Show>
      <Show when={local.action}>
        <div class="mt-4">{local.action}</div>
      </Show>
    </div>
  );
}
