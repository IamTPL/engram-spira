import { type Component, For, Show } from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import {
  BookOpenCheck,
  Home,
  Library,
  Settings,
  Target,
} from 'lucide-solid';
import {
  isDrawerOpen,
  isRunning,
  openFocusDrawer,
} from '@/stores/focus.store';
import { cn } from '@/lib/utils';

type MobileBottomNavProps = {
  class?: string;
  onOpenExplorer: () => void;
};

export const MobileBottomNav: Component<MobileBottomNavProps> = (props) => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (paths: string[]) =>
    paths.some((path) =>
      path === '/' ? location.pathname === '/' : location.pathname.startsWith(path),
    );

  const items = (): Array<{
    label: string;
    icon: Component<{ class?: string }>;
    active: boolean;
    running?: boolean;
    pressable?: boolean;
    onClick: () => void;
  }> => [
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
      label: 'Focus',
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
        'border-t bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden',
        props.class,
      )}
    >
      <div class="grid h-16 grid-cols-5">
        <For each={items()}>
          {(item) => {
            const Icon = item.icon;
            return (
            <button
              type="button"
              class={cn(
                'relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-md px-0.5 text-[10px] font-medium text-muted-foreground',
                item.active && 'text-foreground',
              )}
              aria-label={item.label}
              aria-current={
                item.active && !item.pressable ? 'page' : undefined
              }
              aria-pressed={item.pressable ? item.active : undefined}
              onClick={item.onClick}
            >
              <span
                class={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg',
                  item.active && 'bg-accent',
                )}
              >
                <Icon class="h-4 w-4" />
                <Show when={item.running}>
                  <span
                    class="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-success"
                    aria-hidden="true"
                  />
                </Show>
              </span>
              <span class="w-full truncate leading-none">{item.label}</span>
            </button>
          );
          }}
        </For>
      </div>
    </nav>
  );
};
