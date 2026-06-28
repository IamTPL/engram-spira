import { type Accessor, type Component, For, Show } from 'solid-js';
import { ArrowRight, BookOpenCheck, Command, Inbox } from 'lucide-solid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  CommandActionRef,
  ContextPanelDescriptor,
} from '@/components/app-shell/types';
import {
  dueDeckLoading,
  dueDecks,
  hasDue,
  totalDue,
} from '@/stores/notifications.store';
import { cn } from '@/lib/utils';

type ContextPanelProps = {
  class?: string;
  descriptor: Accessor<ContextPanelDescriptor | null>;
  pendingActionKey: Accessor<string | null>;
  onRunAction: (action: CommandActionRef) => void;
  onNavigate: (href: string) => void;
  onOpenSearch: () => void;
};

function actionKey(action: CommandActionRef) {
  return `${action.id}:${JSON.stringify(action.params ?? {})}`;
}

const defaultActions: CommandActionRef[] = [
  { id: 'navigate.home', label: 'Home' },
  { id: 'settings.open', label: 'Settings' },
];

export const ContextPanel: Component<ContextPanelProps> = (props) => {
  const descriptor = () => props.descriptor();
  const actions = () => descriptor()?.actions ?? defaultActions;

  return (
    <div
      class={cn(
        'flex h-full min-h-0 flex-col bg-background text-sm',
        props.class,
      )}
    >
      <div class="shrink-0 border-b px-4 py-3">
        <p class="text-xs font-medium uppercase text-muted-foreground">
          Context
        </p>
        <h2 class="mt-1 truncate text-base font-semibold text-foreground">
          {descriptor()?.title ?? 'Today'}
        </h2>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <Show when={descriptor()} fallback={<DefaultContextPanel {...props} />}>
          {(panel) => (
            <div class="space-y-4">
              <Show when={!panel().empty} fallback={<EmptyRouteContext />}>
                {panel().content()}
              </Show>
            </div>
          )}
        </Show>
      </div>

      <Show when={actions().length > 0}>
        <div class="shrink-0 border-t p-3">
          <div class="grid gap-2">
            <For each={actions()}>
              {(action) => (
                <Button
                  variant="outline"
                  size="sm"
                  class="justify-between"
                  disabled={props.pendingActionKey() === actionKey(action)}
                  onClick={() => props.onRunAction(action)}
                >
                  <span class="truncate">{action.label}</span>
                  <ArrowRight class="ml-2 h-3.5 w-3.5 shrink-0" />
                </Button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

const DefaultContextPanel: Component<ContextPanelProps> = (props) => {
  return (
    <div class="space-y-4">
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-medium text-foreground">Review queue</p>
            <p class="text-xs text-muted-foreground">
              {hasDue() ? `${totalDue()} cards due` : 'All caught up'}
            </p>
          </div>
          <Badge variant={hasDue() ? 'destructive' : 'muted'}>
            {dueDeckLoading() ? 'Sync' : hasDue() ? 'Due' : 'Clear'}
          </Badge>
        </div>

        <Show
          when={!dueDeckLoading()}
          fallback={<div class="h-20 rounded-md bg-muted animate-pulse" />}
        >
          <Show
            when={hasDue()}
            fallback={
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-md border bg-card px-3 py-3 text-left hover:bg-accent"
                onClick={props.onOpenSearch}
              >
                <span class="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Command class="h-4 w-4" />
                </span>
                <span class="min-w-0">
                  <span class="block text-sm font-medium text-foreground">
                    Command center
                  </span>
                  <span class="block truncate text-xs text-muted-foreground">
                    Cards, decks, actions
                  </span>
                </span>
              </button>
            }
          >
            <div class="grid gap-2">
              <For each={dueDecks().slice(0, 4)}>
                {(deck) => (
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-left hover:bg-accent"
                    onClick={() => props.onNavigate(`/study/${deck.deckId}`)}
                  >
                    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <BookOpenCheck class="h-4 w-4" />
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-foreground">
                        {deck.deckName}
                      </span>
                      <span class="block text-xs text-muted-foreground">
                        {deck.dueCount} due
                      </span>
                    </span>
                    <ArrowRight class="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </section>
    </div>
  );
};

const EmptyRouteContext: Component = () => (
  <div class="flex min-h-40 flex-col items-center justify-center rounded-md border border-dashed text-center">
    <Inbox class="h-8 w-8 text-muted-foreground/60" />
    <p class="mt-3 text-sm font-medium text-foreground">No context</p>
  </div>
);
