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
import { openSearch } from '@/stores/search.store';
import { cn } from '@/lib/utils';

type MobileBottomNavProps = {
  class?: string;
  onOpenExplorer: () => void;
  onOpenContext: () => void;
};

export const MobileBottomNav: Component<MobileBottomNavProps> = (props) => {
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
        'border-t bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden',
        props.class,
      )}
    >
      <div class="grid h-16 grid-cols-6">
        {items().map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              class={cn(
                'flex min-w-0 flex-col items-center justify-center gap-1 rounded-md px-0.5 text-[10px] font-medium text-muted-foreground',
                item.active && 'text-foreground',
              )}
              aria-label={item.label}
              aria-current={item.active ? 'page' : undefined}
              onClick={item.onClick}
            >
              <span
                class={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg',
                  item.active && 'bg-accent',
                )}
              >
                <Icon class="h-4 w-4" />
              </span>
              <span class="w-full truncate leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
