import { Show, createEffect, on } from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import { PanelLeft, LayoutDashboard } from 'lucide-solid';
import {
  ensureClassExpanded,
  sidebarCollapsed,
  toggleSidebar,
} from '@/stores/sidebar.store';
import { api } from '@/api/client';
import { useSidebar } from './sidebar-context';
import { SidebarFooter } from './sidebar-footer';
import { SidebarClassList } from './sidebar-class-list';

/** Shared sidebar content — reused for both desktop aside and mobile drawer */
export function SidebarContent() {
  const { foldersByClass } = useSidebar();
  const navigate = useNavigate();
  const location = useLocation();

  // ── Auto-expand class based on current route ────────────
  createEffect(
    on(
      () => location.pathname,
      async (path) => {
        // Match /folder/:id or /deck/:id
        const folderMatch = path.match(/^\/folder\/([^/]+)/);
        if (folderMatch) {
          const folderId = folderMatch[1];
          const allFolders = foldersByClass();
          for (const [classId, folders] of Object.entries(allFolders)) {
            if (folders.some((f) => f.id === folderId)) {
              await ensureClassExpanded(classId);
              return;
            }
          }
          try {
            const { data } = await (api.folders as any)[folderId].get();
            if (data?.classId) {
              await ensureClassExpanded(data.classId);
            }
          } catch {
            /* ignore */
          }
          return;
        }

        const deckMatch = path.match(/^\/deck\/([^/]+)/);
        if (deckMatch) {
          const deckId = deckMatch[1];
          try {
            const { data } = await (api.decks as any)[deckId].get();
            if (data?.folderId) {
              const { data: folderData } = await (api.folders as any)[
                data.folderId
              ].get();
              if (folderData?.classId) {
                await ensureClassExpanded(folderData.classId);
              }
            }
          } catch {
            /* ignore */
          }
        }
      },
    ),
  );

  return (
    <>
      {/* ═══════════════════════════════════════════════════
           COLLAPSED: icon-only strip (desktop only)
          ═══════════════════════════════════════════════════ */}
      <Show when={sidebarCollapsed()}>
        <div class="flex flex-col items-center w-14 h-full py-2 gap-0.5">
          <div class="flex flex-col items-center gap-0.5 w-full">
            <button
              title="Expand sidebar"
              onClick={toggleSidebar}
              class="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <PanelLeft class="h-4.5 w-4.5 rotate-180" />
            </button>
            <div class="h-px bg-border w-7 my-1.5" />
            <button
              title="Dashboard"
              onClick={() => navigate('/')}
              class={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                location.pathname === '/'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <LayoutDashboard class="h-4.5 w-4.5" />
            </button>
          </div>
          <SidebarFooter compact={true} />
        </div>
      </Show>

      {/* ═══════════════════════════════════════════════════
           EXPANDED: full navigation tree (Class → Folder)
          ═══════════════════════════════════════════════════ */}
      <Show when={!sidebarCollapsed()}>
        <div class="w-64 h-full flex flex-col overflow-hidden">
          <div class="px-3 py-3 border-b shrink-0">
            <div class="flex items-center gap-1">
              <button
                onClick={toggleSidebar}
                title="Collapse sidebar"
                class="hidden md:flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <PanelLeft class="h-4 w-4" />
              </button>

              <button
                class="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1 hover:bg-accent transition-colors min-w-0"
                onClick={() => navigate('/')}
                title="Go to Dashboard"
              >
                <img
                  src="/logo-engram.webp"
                  alt="Engram Spira logo"
                  class="h-7 w-auto"
                />
                <span class="text-base font-bold tracking-tight text-foreground truncate">
                  Engram Spira
                </span>
              </button>
            </div>
          </div>

          {/* ── Dashboard nav item ── */}
          <div class="px-3 pt-3 pb-1 shrink-0">
            <button
              onClick={() => navigate('/')}
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
      </Show>
    </>
  );
}
