import { type Component, Suspense, lazy } from 'solid-js';
import { PanelLeft, PanelRight, Search } from 'lucide-solid';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { openSearch } from '@/stores/search.store';
import { cn } from '@/lib/utils';

const GlobalSearch = lazy(() => import('@/components/search/global-search'));

type CommandBarProps = {
  explorerCollapsed: boolean;
  contextCollapsed: boolean;
  onOpenExplorer: () => void;
  onToggleExplorer: () => void;
  onOpenContext: () => void;
  onToggleContext: () => void;
};

export const CommandBar: Component<CommandBarProps> = (props) => {
  return (
    <>
      <header class="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 md:px-4">
        <Tooltip content="Library" side="bottom">
          <Button
            variant="ghost"
            size="icon"
            class="h-9 w-9 xl:hidden"
            aria-label="Open library"
            onClick={props.onOpenExplorer}
          >
            <PanelLeft class="h-4 w-4" />
          </Button>
        </Tooltip>

        <Tooltip
          content={props.explorerCollapsed ? 'Show library' : 'Hide library'}
          side="bottom"
        >
          <Button
            variant="ghost"
            size="icon"
            class="hidden h-9 w-9 xl:inline-flex"
            aria-label={
              props.explorerCollapsed ? 'Show library' : 'Hide library'
            }
            aria-pressed={!props.explorerCollapsed}
            onClick={props.onToggleExplorer}
          >
            <PanelLeft
              class={cn(
                'h-4 w-4 transition-transform',
                props.explorerCollapsed && 'rotate-180',
              )}
            />
          </Button>
        </Tooltip>

        <button
          type="button"
          class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/40 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={openSearch}
        >
          <Search class="h-4 w-4 shrink-0" />
          <span class="truncate">Search commands, decks, cards</span>
          <span class="ml-auto hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
            <kbd class="rounded border bg-background px-1.5 py-0.5">Ctrl</kbd>
            <kbd class="rounded border bg-background px-1.5 py-0.5">K</kbd>
          </span>
        </button>

        <Tooltip content="Context" side="bottom">
          <Button
            variant="ghost"
            size="icon"
            class="h-9 w-9 xl:hidden"
            aria-label="Open context panel"
            onClick={props.onOpenContext}
          >
            <PanelRight class="h-4 w-4" />
          </Button>
        </Tooltip>

        <Tooltip
          content={props.contextCollapsed ? 'Show context' : 'Hide context'}
          side="bottom"
        >
          <Button
            variant="ghost"
            size="icon"
            class="hidden h-9 w-9 xl:inline-flex"
            aria-label={
              props.contextCollapsed ? 'Show context' : 'Hide context'
            }
            aria-pressed={!props.contextCollapsed}
            onClick={props.onToggleContext}
          >
            <PanelRight
              class={cn(
                'h-4 w-4 transition-transform',
                props.contextCollapsed && 'rotate-180',
              )}
            />
          </Button>
        </Tooltip>
      </header>

      <Suspense>
        <GlobalSearch />
      </Suspense>
    </>
  );
};
