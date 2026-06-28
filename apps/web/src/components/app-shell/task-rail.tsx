import type { Component } from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import {
  BarChart3,
  BookOpenCheck,
  Home,
  Library,
  Plus,
  Settings,
} from 'lucide-solid';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { openSearch } from '@/stores/search.store';
import { cn } from '@/lib/utils';

type TaskRailProps = {
  class?: string;
  onOpenExplorer: () => void;
  onOpenContext: () => void;
};

export const TaskRail: Component<TaskRailProps> = (props) => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (paths: string[]) =>
    paths.some((path) =>
      path === '/' ? location.pathname === '/' : location.pathname.startsWith(path),
    );

  const items = () => [
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
      label: 'Create',
      icon: Plus,
      active: false,
      onClick: openSearch,
    },
    {
      label: 'Insights',
      icon: BarChart3,
      active: isActive(['/insights']),
      onClick: props.onOpenContext,
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
        'hidden h-full w-16 shrink-0 flex-col items-center border-r bg-background py-3 md:flex',
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
          class="h-7 w-auto"
          aria-hidden="true"
        />
      </button>

      <div class="flex flex-1 flex-col items-center gap-1">
        {items().map((item) => {
          const Icon = item.icon;
          return (
            <Tooltip content={item.label} side="right">
              <Button
                variant="ghost"
                size="icon"
                class={cn(
                  'h-10 w-10 text-muted-foreground',
                  item.active &&
                    'bg-accent text-foreground shadow-inner hover:bg-accent',
                )}
                aria-label={item.label}
                aria-current={item.active ? 'page' : undefined}
                onClick={item.onClick}
              >
                <Icon class="h-4.5 w-4.5" />
              </Button>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
};
