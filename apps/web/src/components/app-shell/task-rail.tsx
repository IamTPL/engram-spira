import { type Component, For, Show } from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import {
  BookOpenCheck,
  Home,
  Library,
  Search,
  Settings,
  Target,
} from 'lucide-solid';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import {
  formatFocusTime,
  isDrawerOpen,
  isRunning,
  openFocusDrawer,
  remainingSeconds,
} from '@/stores/focus.store';
import { openSearch } from '@/stores/search.store';
import { cn } from '@/lib/utils';

type TaskRailProps = {
  class?: string;
  onOpenExplorer: () => void;
};

type TaskRailItem = {
  label: string;
  icon: Component<{ class?: string }>;
  active: boolean;
  running?: boolean;
  pressable?: boolean;
  keyShortcuts?: string;
  onClick: () => void;
};

export const TaskRail: Component<TaskRailProps> = (props) => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (paths: string[]) =>
    paths.some((path) =>
      path === '/' ? location.pathname === '/' : location.pathname.startsWith(path),
    );

  const items = (): TaskRailItem[] => [
    {
      label: 'Search',
      icon: Search,
      active: false,
      keyShortcuts: 'Control+K Meta+K',
      onClick: openSearch,
    },
    {
      label: 'Home',
      icon: Home,
      active: isActive(['/']),
      onClick: () => navigate('/'),
    },
    {
      label: 'Study',
      icon: BookOpenCheck,
      active: isActive(['/study']),
      onClick: () => navigate('/study/interleaved'),
    },
    {
      label: 'Library',
      icon: Library,
      active: isActive(['/folder', '/deck']),
      onClick: props.onOpenExplorer,
    },
    {
      label: isRunning()
        ? `Focus ${formatFocusTime(remainingSeconds())}`
        : 'Focus Mode',
      icon: Target,
      active: isDrawerOpen(),
      running: isRunning(),
      pressable: true,
      onClick: openFocusDrawer,
    },
    {
      label: 'Settings',
      icon: Settings,
      active: isActive(['/settings']),
      onClick: () => navigate('/settings'),
    },
  ];

  return (
    <nav
      aria-label="Primary tasks"
      class={cn(
        'hidden h-full w-16 shrink-0 flex-col items-center border-r bg-background py-3 md:flex xl:hidden',
        props.class,
      )}
    >
      <button
        class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg hover:bg-accent"
        onClick={() => navigate('/')}
        aria-label="Home"
      >
        <img
          src="/logo-engram.webp"
          alt=""
          class="h-7 w-auto rounded-sm"
          aria-hidden="true"
        />
      </button>

      <div class="flex flex-1 flex-col items-center gap-1">
        <For each={items()}>
          {(item) => {
            const Icon = item.icon;
            return (
            <Tooltip content={item.label} side="right">
              <Button
                variant="ghost"
                size="icon"
                class={cn(
                  'relative h-10 w-10 text-muted-foreground',
                  item.active &&
                    'bg-accent text-foreground shadow-inner hover:bg-accent',
                )}
                aria-label={item.label}
                aria-keyshortcuts={item.keyShortcuts}
                aria-current={
                  item.active && !item.pressable ? 'page' : undefined
                }
                aria-pressed={item.pressable ? item.active : undefined}
                onClick={item.onClick}
              >
                <Icon class="h-4.5 w-4.5" />
                <Show when={item.running}>
                  <span
                    class="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-success"
                    aria-hidden="true"
                  />
                </Show>
              </Button>
            </Tooltip>
          );
          }}
        </For>
      </div>
    </nav>
  );
};
