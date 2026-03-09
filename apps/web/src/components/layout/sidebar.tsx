import { type Component, Show } from 'solid-js';
import { X, LayoutDashboard } from 'lucide-solid';
import { useNavigate, useLocation } from '@solidjs/router';
import {
  sidebarCollapsed,
  mobileDrawerOpen,
  closeMobileDrawer,
} from '@/stores/sidebar.store';
import { SidebarProvider } from './sidebar/sidebar-context';
import { SidebarContent } from './sidebar/sidebar-content';
import { SidebarClassList } from './sidebar/sidebar-class-list';
import { SidebarFooter } from './sidebar/sidebar-footer';

const Sidebar: Component = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const mobileNavigate = (path: string) => {
    closeMobileDrawer();
    navigate(path);
  };

  return (
    <SidebarProvider>
      {/* ── Desktop sidebar (hidden on mobile) ── */}
      <aside
        class="hidden md:flex bg-card h-full flex-col shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out"
        style={{ width: sidebarCollapsed() ? '56px' : '256px' }}
      >
        <SidebarContent />
      </aside>

      {/* ── Mobile drawer overlay (shown when mobileDrawerOpen) ── */}
      <Show when={mobileDrawerOpen()}>
        <div class="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            class="absolute inset-0 bg-black/40 transition-opacity"
            onClick={closeMobileDrawer}
          />
          {/* Drawer panel */}
          <aside class="relative z-10 w-72 max-w-[85vw] h-full bg-card border-r flex flex-col overflow-hidden animate-slide-in-left">
            {/* Close button */}
            <div class="flex items-center justify-between px-4 py-3 border-b">
              <span class="text-sm font-semibold">Library</span>
              <button
                class="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                onClick={closeMobileDrawer}
              >
                <X class="h-4 w-4" />
              </button>
            </div>
            {/* Re-render expanded sidebar content for mobile - always expanded */}
            <div class="flex-1 overflow-y-auto">
              <div class="w-full h-full flex flex-col overflow-hidden">
                {/* ── Dashboard nav item ── */}
                <div class="px-3 pt-3 pb-1 shrink-0">
                  <button
                    onClick={() => mobileNavigate('/')}
                    class={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      location.pathname === '/'
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    <LayoutDashboard class="h-4 w-4 shrink-0" />
                    <span>Dashboard</span>
                  </button>
                </div>

                <div class="mx-3 h-px bg-border shrink-0 my-1" />

                <div class="p-3 flex-1 overflow-y-auto">
                  <SidebarClassList />
                </div>

                <SidebarFooter compact={false} />
              </div>
            </div>
          </aside>
        </div>
      </Show>
    </SidebarProvider>
  );
};

export default Sidebar;
