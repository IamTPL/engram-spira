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
        'flex flex-col items-center justify-center px-5 py-10 text-center sm:px-6 sm:py-12',
        local.class,
      )}
      {...others}
    >
      <Show when={local.icon}>
        {(Icon) => (
          <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border bg-muted text-muted-foreground shadow-xs">
            <Dynamic
              component={Icon()}
              class="h-5 w-5"
            />
          </div>
        )}
      </Show>
      <h3 class="text-base font-semibold tracking-tight text-foreground">
        {local.title}
      </h3>
      <Show when={local.description}>
        <p class="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {local.description}
        </p>
      </Show>
      <Show when={local.action}>
        <div class="mt-4">{local.action}</div>
      </Show>
    </div>
  );
}
