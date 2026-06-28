import { type Component, type JSX, Show, splitProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '@/lib/utils';

type EmptyStateProps = JSX.HTMLAttributes<HTMLDivElement> & {
  icon?: Component<{ class?: string }>;
  title: JSX.Element;
  description?: JSX.Element;
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
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        local.class,
      )}
      {...others}
    >
      <Show when={local.icon}>
        {(Icon) => (
          <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Dynamic
              component={Icon()}
              class="h-7 w-7 text-muted-foreground"
            />
          </div>
        )}
      </Show>
      <h3 class="text-lg font-semibold tracking-tight">{local.title}</h3>
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
