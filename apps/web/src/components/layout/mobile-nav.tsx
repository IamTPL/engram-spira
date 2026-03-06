import { type Component } from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import { openMobileDrawer } from '@/stores/sidebar.store';
import { LayoutDashboard, Layers, Settings, BookOpen } from 'lucide-solid';

/** Bottom navigation bar — visible only on mobile (< md) */
const MobileNav: Component = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const items = [
    { label: 'Home', icon: LayoutDashboard, path: '/' },
    { label: 'Library', icon: Layers, action: openMobileDrawer },
    { label: 'Docs', icon: BookOpen, path: '/docs' },
    { label: 'Settings', icon: Settings, path: '/settings' },
  ] as const;

  return (
    <nav class="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card border-t safe-area-pb">
      <div class="flex items-center justify-around h-14">
        {items.map((item) => {
          const isActive = () =>
            'path' in item && location.pathname === item.path;

          const handleClick = () => {
            if ('action' in item && item.action) {
              item.action();
            } else if ('path' in item && item.path) {
              navigate(item.path);
            }
          };

          return (
            <button
              class={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
                isActive()
                  ? 'text-primary'
                  : 'text-muted-foreground active:text-foreground'
              }`}
              onClick={handleClick}
            >
              <item.icon class="h-5 w-5" />
              <span class="text-[10px] font-medium leading-none">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileNav;
