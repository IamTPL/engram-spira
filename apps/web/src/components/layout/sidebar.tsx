import {
  type Component,
  For,
  Show,
  createSignal,
  createResource,
  createEffect,
  on,
  onCleanup,
} from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/api/client';
import { currentUser, logout } from '@/stores/auth.store';
import { toast } from '@/stores/toast.store';
import { resolvedTheme, toggleTheme } from '@/stores/theme.store';
import { NOTIFICATIONS_POLL_MS } from '@/constants';
import { openFocusDrawer, isRunning } from '@/stores/focus.store';
import {
  sidebarCollapsed,
  toggleSidebar,
  mobileDrawerOpen,
  closeMobileDrawer,
  expandedClasses,
  setExpandedClasses,
  foldersByClass,
  setFoldersByClass,
  toggleClass,
  ensureClassExpanded,
  updateFoldersForClass,
  removeClassFromCache,
  type FolderItem,
} from '@/stores/sidebar.store';
import {
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Layers,
  Plus,
  X,
  Pencil,
  Trash2,
  LayoutDashboard,
  GripVertical,
  Bell,
  LogOut,
  BookOpen,
  Zap,
  PanelLeft,
  Settings,
  Sun,
  Moon,
  MessageSquare,
  Target,
  BookMarked,
} from 'lucide-solid';

interface ClassItem {
  id: string;
  name: string;
  description: string | null;
}

interface DueDeckNotification {
  deckId: string;
  deckName: string;
  dueCount: number;
}

const Sidebar: Component = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showNotifications, setShowNotifications] = createSignal(false);
  const [showUserMenu, setShowUserMenu] = createSignal(false);

  const [dueDecks, { refetch: refetchDue }] = createResource(
    () => currentUser()?.id,
    async () => {
      const { data } = await (api.notifications as any)['due-decks'].get();
      return (data ?? []) as DueDeckNotification[];
    },
  );

  const timer = setInterval(() => {
    if (currentUser()) refetchDue();
  }, NOTIFICATIONS_POLL_MS);
  onCleanup(() => clearInterval(timer));

  const totalDue = () =>
    (dueDecks() ?? []).reduce((sum, d) => sum + d.dueCount, 0);
  const hasDue = () => totalDue() > 0;
  const userInitial = () => {
    const email = currentUser()?.email ?? '';
    return email.charAt(0).toUpperCase();
  };

  const handleLogout = async () => {
    setShowUserMenu(false);
    await logout();
    navigate('/login', { replace: true });
  };

  const handleDeckClick = (deckId: string) => {
    setShowNotifications(false);
    navigate(`/deck/${deckId}`);
  };

  const handleToggleSidebar = () => {
    setShowNotifications(false);
    setShowUserMenu(false);
    toggleSidebar();
  };

  // ── Data resources ─────────────────────────────────────
  const [classes, { refetch: refetchClasses, mutate: mutateClasses }] =
    createResource(
      () => currentUser()?.id,
      async () => {
        const { data } = await api.classes.get();
        return (data ?? []) as ClassItem[];
      },
    );

  // ── Create Class state ──────────────────────────────────
  const [showNewClass, setShowNewClass] = createSignal(false);
  const [newClassName, setNewClassName] = createSignal('');

  // ── Create Folder state (per class) ────────────────────
  const [creatingFolderForClass, setCreatingFolderForClass] = createSignal<
    string | null
  >(null);
  const [newFolderName, setNewFolderName] = createSignal('');

  // ── Rename state ────────────────────────────────────────
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [renamingType, setRenamingType] = createSignal<
    'class' | 'folder' | null
  >(null);
  const [renamingContext, setRenamingContext] = createSignal<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = createSignal('');

  // ── Delete confirm state ──────────────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(
    null,
  );

  // ── Drag-drop state ───────────────────────────────────────
  const [dragType, setDragType] = createSignal<'class' | 'folder' | null>(null);
  const [dragId, setDragId] = createSignal<string | null>(null);
  const [dragClassContext, setDragClassContext] = createSignal<string | null>(
    null,
  );
  const [dropTargetId, setDropTargetId] = createSignal<string | null>(null);

  // ── Drag-drop handlers ───────────────────────────────────
  const handleClassDragStart = (classId: string, e: DragEvent) => {
    setDragType('class');
    setDragId(classId);
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', classId);
  };

  const handleClassDragOver = (classId: string, e: DragEvent) => {
    if (dragType() !== 'class' || dragId() === classId) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    setDropTargetId(classId);
  };

  const handleClassDrop = async (targetClassId: string, e: DragEvent) => {
    e.preventDefault();
    const sourceId = dragId();
    if (!sourceId || sourceId === targetClassId || dragType() !== 'class')
      return;

    const list = classes() ?? [];
    const fromIdx = list.findIndex((c) => c.id === sourceId);
    const toIdx = list.findIndex((c) => c.id === targetClassId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...list];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    // Optimistic UI update
    mutateClasses(reordered);
    resetDrag();

    try {
      await api.classes.reorder.patch({
        classIds: reordered.map((c) => c.id),
      });
    } catch {
      refetchClasses();
      toast.error('Failed to reorder classes');
    }
  };

  const handleFolderDragStart = (
    classId: string,
    folderId: string,
    e: DragEvent,
  ) => {
    setDragType('folder');
    setDragId(folderId);
    setDragClassContext(classId);
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', folderId);
  };

  const handleFolderDragOver = (folderId: string, e: DragEvent) => {
    if (dragType() !== 'folder' || dragId() === folderId) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    setDropTargetId(folderId);
  };

  const handleFolderDrop = async (
    targetClassId: string,
    targetFolderId: string,
    e: DragEvent,
  ) => {
    e.preventDefault();
    const sourceId = dragId();
    const sourceClassId = dragClassContext();
    if (
      !sourceId ||
      !sourceClassId ||
      sourceId === targetFolderId ||
      dragType() !== 'folder'
    )
      return;

    // Only support reorder within the same class
    if (sourceClassId !== targetClassId) {
      resetDrag();
      return;
    }

    const list = foldersByClass()[sourceClassId] ?? [];
    const fromIdx = list.findIndex((f) => f.id === sourceId);
    const toIdx = list.findIndex((f) => f.id === targetFolderId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...list];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    // Optimistic UI update
    updateFoldersForClass(sourceClassId, reordered);
    resetDrag();

    try {
      await api.folders['by-class']({ classId: sourceClassId }).reorder.patch({
        folderIds: reordered.map((f) => f.id),
      });
    } catch {
      // Refetch folders on failure
      const { data } = await api.folders['by-class']({
        classId: sourceClassId,
      }).get();
      updateFoldersForClass(sourceClassId, (data ?? []) as FolderItem[]);
      toast.error('Failed to reorder folders');
    }
  };

  const handleDragEnd = () => resetDrag();

  const resetDrag = () => {
    setDragType(null);
    setDragId(null);
    setDragClassContext(null);
    setDropTargetId(null);
  };

  // ── Auto-expand class based on current route ────────────
  createEffect(
    on(
      () => location.pathname,
      async (path) => {
        // Match /folder/:id or /deck/:id
        const folderMatch = path.match(/^\/folder\/([^/]+)/);
        if (folderMatch) {
          const folderId = folderMatch[1];
          // Find which class owns this folder by checking loaded folders
          // or fetch from API
          const allFolders = foldersByClass();
          for (const [classId, folders] of Object.entries(allFolders)) {
            if (folders.some((f) => f.id === folderId)) {
              await ensureClassExpanded(classId);
              return;
            }
          }
          // Folder not in cache — fetch the folder to get classId
          try {
            const { data } = await (api.folders as any)[folderId].get();
            if (data?.classId) {
              await ensureClassExpanded(data.classId);
            }
          } catch {
            /* ignore — folder not found */
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

  // ── CRUD handlers ───────────────────────────────────────
  const handleCreateClass = async (e: Event) => {
    e.preventDefault();
    const name = newClassName().trim();
    if (!name) return;
    await api.classes.post({ name });
    setNewClassName('');
    setShowNewClass(false);
    refetchClasses();
  };

  const handleCreateFolder = async (e: Event, classId: string) => {
    e.preventDefault();
    const name = newFolderName().trim();
    if (!name) return;
    await api.folders['by-class']({ classId }).post({ name });
    const { data } = await api.folders['by-class']({ classId }).get();
    updateFoldersForClass(classId, (data ?? []) as FolderItem[]);
    setNewFolderName('');
    setCreatingFolderForClass(null);
  };

  const openNewFolder = (e: Event, classId: string) => {
    e.stopPropagation();
    setCreatingFolderForClass(classId);
    setNewFolderName('');
    ensureClassExpanded(classId);
  };

  // ── Rename handlers ─────────────────────────────────────
  const startRename = (
    e: Event,
    type: 'class' | 'folder',
    id: string,
    currentName: string,
    context?: string,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setRenamingId(id);
    setRenamingType(type);
    setRenamingContext(context ?? null);
    setRenameValue(currentName);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenamingType(null);
    setRenamingContext(null);
    setRenameValue('');
  };

  const submitRename = async (id: string) => {
    const name = renameValue().trim();
    if (!name) {
      cancelRename();
      return;
    }
    const type = renamingType();
    const context = renamingContext();
    try {
      if (type === 'class') {
        await (api.classes as any)[id].patch({ name });
        refetchClasses();
      } else if (type === 'folder') {
        await (api.folders as any)[id].patch({ name });
        if (context) {
          updateFoldersForClass(
            context,
            (foldersByClass()[context] ?? []).map((f) =>
              f.id === id ? { ...f, name } : f,
            ),
          );
        }
      }
    } finally {
      cancelRename();
    }
  };

  // ── Delete handlers ────────────────────────────────────────
  const handleDeleteClass = async (e: Event, id: string) => {
    e.stopPropagation();
    try {
      await (api.classes as any)[id].delete();
      setConfirmDeleteId(null);
      removeClassFromCache(id);
      refetchClasses();
      toast.success('Class deleted');
    } catch {
      toast.error('Failed to delete class');
    }
  };

  const handleDeleteFolder = async (
    e: Event,
    classId: string,
    folderId: string,
  ) => {
    e.stopPropagation();
    try {
      await (api.folders as any)[folderId].delete();
      setConfirmDeleteId(null);
      updateFoldersForClass(
        classId,
        (foldersByClass()[classId] ?? []).filter((f) => f.id !== folderId),
      );
      toast.success('Folder deleted');
    } catch {
      toast.error('Failed to delete folder');
    }
  };

  // ── Check if current path is a folder page ─────────────
  const isFolderActive = (folderId: string) =>
    location.pathname === `/folder/${folderId}`;

  /** Navigates and closes mobile drawer */
  const mobileNavigate = (path: string) => {
    closeMobileDrawer();
    navigate(path);
  };

  const SidebarFooter = (compact = false) => (
    <Show when={currentUser()}>
      <div
        class={
          compact
            ? 'mt-auto pt-2 border-t border-border w-full flex flex-col items-center gap-1.5'
            : 'border-t border-border p-3 shrink-0'
        }
      >
        <div class={compact ? 'relative' : 'relative w-full'}>
          <Button
            variant="ghost"
            size="icon"
            title="Notifications"
            onClick={() => {
              setShowNotifications(!showNotifications());
              setShowUserMenu(false);
            }}
            class={compact ? 'h-8 w-8 relative' : 'relative'}
          >
            <Bell class="h-4 w-4" />
            <Show when={hasDue()}>
              <span class="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {totalDue() > 99 ? '99+' : totalDue()}
              </span>
            </Show>
          </Button>

          <Show when={showNotifications()}>
            <div
              class="fixed inset-0 z-30"
              onClick={() => setShowNotifications(false)}
            />
            <div
              class={`fixed z-40 w-80 max-w-[90vw] rounded-xl border bg-card shadow-xl overflow-hidden ${
                compact ? 'left-14 bottom-14' : 'left-64 bottom-14'
              }`}
            >
              <div class="flex items-center justify-between px-4 py-3 border-b bg-muted/40">
                <div class="flex items-center gap-2">
                  <Zap class="h-4 w-4 text-yellow-500" />
                  <span class="text-sm font-semibold">Due for Review</span>
                </div>
                <Show when={hasDue()}>
                  <span class="text-xs text-muted-foreground">
                    {totalDue()} card{totalDue() !== 1 ? 's' : ''}
                  </span>
                </Show>
              </div>
              <div class="max-h-80 overflow-y-auto">
                <Show
                  when={!dueDecks.loading}
                  fallback={
                    <div class="px-4 py-6 text-center text-sm text-muted-foreground">
                      Loading...
                    </div>
                  }
                >
                  <Show
                    when={hasDue()}
                    fallback={
                      <div class="px-4 py-8 text-center">
                        <p class="text-sm font-medium text-foreground">
                          All caught up!
                        </p>
                        <p class="text-xs text-muted-foreground mt-1">
                          No cards due right now.
                        </p>
                      </div>
                    }
                  >
                    <For each={dueDecks() ?? []}>
                      {(deck) => (
                        <button
                          class="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent transition-colors text-left border-b border-border/50 last:border-0"
                          onClick={() => handleDeckClick(deck.deckId)}
                        >
                          <div class="h-8 w-8 rounded-lg bg-palette-1 flex items-center justify-center shrink-0">
                            <BookOpen class="h-4 w-4 text-slate-700" />
                          </div>
                          <div class="flex-1 min-w-0">
                            <p class="text-sm font-medium truncate">
                              {deck.deckName}
                            </p>
                            <p class="text-xs text-muted-foreground">
                              {deck.dueCount} card
                              {deck.dueCount !== 1 ? 's' : ''} due
                            </p>
                          </div>
                          <span class="text-xs font-semibold text-red-500 shrink-0">
                            Study
                          </span>
                        </button>
                      )}
                    </For>
                  </Show>
                </Show>
              </div>
            </div>
          </Show>
        </div>

        <div class={compact ? 'relative' : 'relative w-full'}>
          <button
            class={
              compact
                ? 'h-8 w-8 rounded-full bg-linear-to-br from-palette-5 to-palette-3 flex items-center justify-center text-slate-800 text-sm font-bold shadow-sm'
                : 'flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent transition-colors cursor-pointer w-full'
            }
            onClick={() => {
              setShowUserMenu(!showUserMenu());
              setShowNotifications(false);
            }}
          >
            <Show
              when={currentUser()?.avatarUrl}
              fallback={
                <div
                  class={
                    compact
                      ? 'h-8 w-8 rounded-full bg-linear-to-br from-palette-5 to-palette-3 flex items-center justify-center text-slate-800 text-sm font-bold shadow-sm'
                      : 'h-8 w-8 rounded-full bg-linear-to-br from-palette-5 to-palette-3 flex items-center justify-center text-slate-800 text-sm font-bold shadow-sm'
                  }
                >
                  {userInitial()}
                </div>
              }
            >
              <img
                src={currentUser()!.avatarUrl!}
                alt="avatar"
                class="h-8 w-8 rounded-full object-cover shadow-sm ring-1 ring-border"
              />
            </Show>
            <Show when={!compact}>
              <div class="flex-1 min-w-0 text-left">
                <p class="text-sm font-medium truncate text-foreground">
                  {currentUser()!.email.split('@')[0]}
                </p>
                <p class="text-xs text-muted-foreground truncate">
                  {currentUser()!.email}
                </p>
              </div>
              <ChevronDown
                class={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
                  showUserMenu() ? 'rotate-180' : ''
                }`}
              />
            </Show>
          </button>

          <Show when={showUserMenu()}>
            <div
              class="fixed inset-0 z-30"
              onClick={() => setShowUserMenu(false)}
            />
            <div
              class={`fixed z-40 w-64 rounded-xl border bg-card shadow-xl overflow-hidden ${
                compact ? 'left-14 bottom-2' : 'left-64 bottom-2'
              }`}
            >
              <div class="px-4 py-3 border-b bg-muted/30">
                <div class="flex items-center gap-3">
                  <Show
                    when={currentUser()?.avatarUrl}
                    fallback={
                      <div class="h-10 w-10 rounded-full bg-linear-to-br from-palette-5 to-palette-3 flex items-center justify-center text-slate-800 text-base font-bold shadow-sm shrink-0">
                        {userInitial()}
                      </div>
                    }
                  >
                    <img
                      src={currentUser()!.avatarUrl!}
                      alt="avatar"
                      class="h-10 w-10 rounded-full object-cover shadow-sm ring-1 ring-border shrink-0"
                    />
                  </Show>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold truncate text-foreground">
                      {currentUser()!.email.split('@')[0]}
                    </p>
                    <p class="text-xs text-muted-foreground truncate">
                      {currentUser()!.email}
                    </p>
                  </div>
                </div>
              </div>

              <div class="py-1">
                <button
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors text-left"
                  onClick={() => {
                    setShowUserMenu(false);
                    openFocusDrawer();
                  }}
                >
                  <Target class="h-4 w-4 text-muted-foreground" />
                  <span>Focus Mode</span>
                  <Show when={isRunning()}>
                    <span class="ml-auto relative flex h-2 w-2">
                      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                    </span>
                  </Show>
                </button>

                <button
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors text-left"
                  onClick={() => {
                    setShowUserMenu(false);
                    navigate('/docs');
                  }}
                >
                  <BookMarked class="h-4 w-4 text-muted-foreground" />
                  <span>Docs</span>
                </button>

                <button
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors text-left"
                  onClick={() => {
                    setShowUserMenu(false);
                    navigate('/settings');
                  }}
                >
                  <Settings class="h-4 w-4 text-muted-foreground" />
                  <span>Settings</span>
                </button>

                <button
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors text-left"
                  onClick={toggleTheme}
                >
                  <Show
                    when={resolvedTheme() === 'dark'}
                    fallback={<Moon class="h-4 w-4 text-muted-foreground" />}
                  >
                    <Sun class="h-4 w-4 text-muted-foreground" />
                  </Show>
                  <span>
                    {resolvedTheme() === 'dark' ? 'Light Mode' : 'Dark Mode'}
                  </span>
                </button>

                <button
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors text-left"
                  onClick={() => {
                    setShowUserMenu(false);
                    navigate('/feedback');
                  }}
                >
                  <MessageSquare class="h-4 w-4 text-muted-foreground" />
                  <span>Report / Feedback</span>
                </button>
              </div>

              <div class="border-t py-1">
                <button
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left"
                  onClick={handleLogout}
                >
                  <LogOut class="h-4 w-4" />
                  <span>Log out</span>
                </button>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );

  /** Shared sidebar content — reused for both desktop aside and mobile drawer */
  const SidebarContent = () => (
    <>
      {/* ═══════════════════════════════════════════════════
           COLLAPSED: icon-only strip (desktop only)
          ═══════════════════════════════════════════════════ */}
      <Show when={sidebarCollapsed()}>
        <div class="flex flex-col items-center w-14 h-full py-2 gap-0.5">
          <div class="flex flex-col items-center gap-0.5 w-full">
            <button
              title="Expand sidebar"
              onClick={handleToggleSidebar}
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
          {SidebarFooter(true)}
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
                onClick={handleToggleSidebar}
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
                  src="/logo-engram.png"
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
            {/* Library header */}
            <div class="flex items-center justify-between mb-3">
              <h2 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Library
              </h2>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                title="New Class"
                onClick={() => {
                  setShowNewClass(!showNewClass());
                  setNewClassName('');
                }}
              >
                <Plus class="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* New Class form */}
            <Show when={showNewClass()}>
              <form onSubmit={handleCreateClass} class="mb-3 flex gap-1">
                <Input
                  placeholder="Class name..."
                  value={newClassName()}
                  onInput={(e) => setNewClassName(e.currentTarget.value)}
                  class="h-7 text-xs"
                  autofocus
                />
                <Button type="submit" size="icon" class="h-7 w-7 shrink-0">
                  <Plus class="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7 shrink-0"
                  onClick={() => setShowNewClass(false)}
                >
                  <X class="h-3 w-3" />
                </Button>
              </form>
            </Show>

            {/* Classes list */}
            <Show
              when={!classes.loading}
              fallback={
                <div class="space-y-2 mt-2">
                  <For each={[1, 2, 3]}>
                    {() => (
                      <div class="h-7 rounded-md bg-muted animate-pulse" />
                    )}
                  </For>
                </div>
              }
            >
              <Show
                when={(classes() ?? []).length > 0}
                fallback={
                  <p class="text-xs text-muted-foreground text-center py-6 leading-relaxed">
                    No classes yet.
                    <br />
                    Click <strong>+</strong> to create one.
                  </p>
                }
              >
                <nav class="space-y-0.5">
                  <For each={classes()}>
                    {(cls) => (
                      <div
                        draggable={
                          renamingId() !== cls.id &&
                          confirmDeleteId() !== cls.id
                        }
                        onDragStart={(e: DragEvent) =>
                          handleClassDragStart(cls.id, e)
                        }
                        onDragOver={(e: DragEvent) =>
                          handleClassDragOver(cls.id, e)
                        }
                        onDrop={(e: DragEvent) => handleClassDrop(cls.id, e)}
                        onDragEnd={handleDragEnd}
                        onDragLeave={() => {
                          if (dropTargetId() === cls.id) setDropTargetId(null);
                        }}
                        class={
                          dragId() === cls.id && dragType() === 'class'
                            ? 'opacity-40'
                            : dropTargetId() === cls.id &&
                                dragType() === 'class'
                              ? 'border-t-2 border-palette-5'
                              : ''
                        }
                      >
                        {/* Class row */}
                        <div class="flex items-center gap-0 group">
                          <span
                            class="opacity-0 group-hover:opacity-60 cursor-grab active:cursor-grabbing shrink-0 text-muted-foreground"
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <GripVertical class="h-3.5 w-3.5" />
                          </span>
                          <Show
                            when={
                              renamingId() === cls.id &&
                              renamingType() === 'class'
                            }
                            fallback={
                              <button
                                class="flex items-center gap-1.5 flex-1 px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left min-w-0"
                                onClick={() => toggleClass(cls.id)}
                              >
                                <Show
                                  when={expandedClasses().has(cls.id)}
                                  fallback={
                                    <ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground" />
                                  }
                                >
                                  <ChevronDown class="h-3 w-3 shrink-0 text-muted-foreground" />
                                </Show>
                                <Layers class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span class="truncate font-semibold text-[15px]">
                                  {cls.name}
                                </span>
                              </button>
                            }
                          >
                            <input
                              class="flex-1 mx-1 px-1.5 py-0.5 text-sm rounded border border-palette-5 bg-background outline-none min-w-0"
                              value={renameValue()}
                              onInput={(e) =>
                                setRenameValue(e.currentTarget.value)
                              }
                              onBlur={() => submitRename(cls.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  submitRename(cls.id);
                                } else if (e.key === 'Escape') {
                                  cancelRename();
                                }
                              }}
                              ref={(el) =>
                                setTimeout(() => {
                                  el.focus();
                                  el.select();
                                }, 0)
                              }
                            />
                          </Show>
                          {/* Action buttons */}
                          <Show when={renamingId() !== cls.id}>
                            <Show
                              when={confirmDeleteId() === cls.id}
                              fallback={
                                <>
                                  <button
                                    class="opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 transition-opacity"
                                    title="Rename class"
                                    onClick={(e) =>
                                      startRename(e, 'class', cls.id, cls.name)
                                    }
                                  >
                                    <Pencil class="h-3 w-3" />
                                  </button>
                                  <button
                                    class="opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent shrink-0 transition-opacity"
                                    title="Delete class"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmDeleteId(cls.id);
                                    }}
                                  >
                                    <Trash2 class="h-3 w-3" />
                                  </button>
                                  <button
                                    class="opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 transition-opacity"
                                    title="Add folder"
                                    onClick={(e) => openNewFolder(e, cls.id)}
                                  >
                                    <Plus class="h-3 w-3" />
                                  </button>
                                </>
                              }
                            >
                              <span class="text-xs text-destructive font-medium whitespace-nowrap">
                                Delete?
                              </span>
                              <button
                                class="h-6 w-6 flex items-center justify-center rounded text-destructive hover:bg-destructive/10 shrink-0"
                                onClick={(e) => handleDeleteClass(e, cls.id)}
                              >
                                <X class="h-3 w-3" />
                              </button>
                              <button
                                class="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-accent shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteId(null);
                                }}
                              >
                                <X class="h-3 w-3 opacity-50" />
                              </button>
                            </Show>
                          </Show>
                        </div>

                        {/* Expanded class content — folders only */}
                        <Show when={expandedClasses().has(cls.id)}>
                          <div class="ml-4 mt-0.5 space-y-0.5">
                            {/* New Folder form */}
                            <Show when={creatingFolderForClass() === cls.id}>
                              <form
                                onSubmit={(e) => handleCreateFolder(e, cls.id)}
                                class="flex gap-1 py-1"
                              >
                                <Input
                                  placeholder="Folder name..."
                                  value={newFolderName()}
                                  onInput={(e) =>
                                    setNewFolderName(e.currentTarget.value)
                                  }
                                  class="h-6 text-xs"
                                  autofocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape')
                                      setCreatingFolderForClass(null);
                                  }}
                                />
                                <Button
                                  type="submit"
                                  size="icon"
                                  class="h-6 w-6 shrink-0"
                                >
                                  <Plus class="h-3 w-3" />
                                </Button>
                              </form>
                            </Show>

                            {/* Folders — click navigates to folder page */}
                            <For each={foldersByClass()[cls.id] ?? []}>
                              {(folder) => (
                                <div
                                  draggable={
                                    renamingId() !== folder.id &&
                                    confirmDeleteId() !== folder.id
                                  }
                                  onDragStart={(e: DragEvent) => {
                                    e.stopPropagation();
                                    handleFolderDragStart(cls.id, folder.id, e);
                                  }}
                                  onDragOver={(e: DragEvent) =>
                                    handleFolderDragOver(folder.id, e)
                                  }
                                  onDrop={(e: DragEvent) => {
                                    e.stopPropagation();
                                    handleFolderDrop(cls.id, folder.id, e);
                                  }}
                                  onDragEnd={handleDragEnd}
                                  onDragLeave={() => {
                                    if (dropTargetId() === folder.id)
                                      setDropTargetId(null);
                                  }}
                                  class={`flex items-center gap-0 group/folder ${
                                    dragId() === folder.id &&
                                    dragType() === 'folder'
                                      ? 'opacity-40'
                                      : dropTargetId() === folder.id &&
                                          dragType() === 'folder'
                                        ? 'border-t-2 border-palette-5'
                                        : ''
                                  }`}
                                >
                                  <span
                                    class="opacity-0 group-hover/folder:opacity-60 cursor-grab active:cursor-grabbing shrink-0 text-muted-foreground"
                                    onMouseDown={(e) => e.stopPropagation()}
                                  >
                                    <GripVertical class="h-3 w-3" />
                                  </span>
                                  <Show
                                    when={
                                      renamingId() === folder.id &&
                                      renamingType() === 'folder'
                                    }
                                    fallback={
                                      <button
                                        class={`flex items-center gap-1.5 flex-1 px-2 py-1 text-sm rounded-md text-left min-w-0 transition-colors ${
                                          isFolderActive(folder.id)
                                            ? 'bg-accent text-foreground font-medium'
                                            : 'hover:bg-accent'
                                        }`}
                                        onClick={() =>
                                          navigate(`/folder/${folder.id}`)
                                        }
                                      >
                                        <FolderOpen class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                        <span class="truncate text-[15px]">
                                          {folder.name}
                                        </span>
                                      </button>
                                    }
                                  >
                                    <input
                                      class="flex-1 mx-1 px-1.5 py-0.5 text-sm rounded border border-palette-5 bg-background outline-none min-w-0"
                                      value={renameValue()}
                                      onInput={(e) =>
                                        setRenameValue(e.currentTarget.value)
                                      }
                                      onBlur={() => submitRename(folder.id)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          submitRename(folder.id);
                                        } else if (e.key === 'Escape') {
                                          cancelRename();
                                        }
                                      }}
                                      ref={(el) =>
                                        setTimeout(() => {
                                          el.focus();
                                          el.select();
                                        }, 0)
                                      }
                                    />
                                  </Show>
                                  {/* Action buttons */}
                                  <Show when={renamingId() !== folder.id}>
                                    <Show
                                      when={confirmDeleteId() === folder.id}
                                      fallback={
                                        <>
                                          <button
                                            class="opacity-0 group-hover/folder:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 transition-opacity"
                                            title="Rename folder"
                                            onClick={(e) =>
                                              startRename(
                                                e,
                                                'folder',
                                                folder.id,
                                                folder.name,
                                                cls.id,
                                              )
                                            }
                                          >
                                            <Pencil class="h-3 w-3" />
                                          </button>
                                          <button
                                            class="opacity-0 group-hover/folder:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent shrink-0 transition-opacity"
                                            title="Delete folder"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setConfirmDeleteId(folder.id);
                                            }}
                                          >
                                            <Trash2 class="h-3 w-3" />
                                          </button>
                                        </>
                                      }
                                    >
                                      <span class="text-xs text-destructive font-medium whitespace-nowrap">
                                        Delete?
                                      </span>
                                      <button
                                        class="h-6 w-6 flex items-center justify-center rounded text-destructive hover:bg-destructive/10 shrink-0"
                                        onClick={(e) =>
                                          handleDeleteFolder(
                                            e,
                                            cls.id,
                                            folder.id,
                                          )
                                        }
                                      >
                                        <X class="h-3 w-3" />
                                      </button>
                                      <button
                                        class="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-accent shrink-0"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setConfirmDeleteId(null);
                                        }}
                                      >
                                        <X class="h-3 w-3 opacity-50" />
                                      </button>
                                    </Show>
                                  </Show>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </nav>
              </Show>
            </Show>
          </div>

          {SidebarFooter(false)}
        </div>
      </Show>
    </>
  );

  return (
    <>
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
                  <div class="flex items-center justify-between mb-3">
                    <h2 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Library
                    </h2>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="h-7 w-7"
                      title="New Class"
                      onClick={() => {
                        setShowNewClass(!showNewClass());
                        setNewClassName('');
                      }}
                    >
                      <Plus class="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* New Class form */}
                  <Show when={showNewClass()}>
                    <form onSubmit={handleCreateClass} class="mb-3 flex gap-1">
                      <Input
                        placeholder="Class name..."
                        value={newClassName()}
                        onInput={(e) => setNewClassName(e.currentTarget.value)}
                        class="h-7 text-xs"
                        autofocus
                      />
                      <Button
                        type="submit"
                        size="icon"
                        class="h-7 w-7 shrink-0"
                      >
                        <Plus class="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7 shrink-0"
                        onClick={() => setShowNewClass(false)}
                      >
                        <X class="h-3 w-3" />
                      </Button>
                    </form>
                  </Show>

                  {/* Classes list (simplified — reuse same tree) */}
                  <Show
                    when={!classes.loading}
                    fallback={
                      <div class="space-y-2 mt-2">
                        <For each={[1, 2, 3]}>
                          {() => (
                            <div class="h-7 rounded-md bg-muted animate-pulse" />
                          )}
                        </For>
                      </div>
                    }
                  >
                    <Show
                      when={(classes() ?? []).length > 0}
                      fallback={
                        <p class="text-xs text-muted-foreground text-center py-6 leading-relaxed">
                          No classes yet.
                          <br />
                          Click <strong>+</strong> to create one.
                        </p>
                      }
                    >
                      <nav class="space-y-0.5">
                        <For each={classes()}>
                          {(cls) => (
                            <div>
                              <button
                                class="flex items-center gap-1.5 w-full px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left min-w-0"
                                onClick={() => toggleClass(cls.id)}
                              >
                                <Show
                                  when={expandedClasses().has(cls.id)}
                                  fallback={
                                    <ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground" />
                                  }
                                >
                                  <ChevronDown class="h-3 w-3 shrink-0 text-muted-foreground" />
                                </Show>
                                <Layers class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span class="truncate font-semibold text-[15px]">
                                  {cls.name}
                                </span>
                              </button>
                              <Show when={expandedClasses().has(cls.id)}>
                                <div class="ml-4 mt-0.5 space-y-0.5">
                                  <For each={foldersByClass()[cls.id] ?? []}>
                                    {(folder) => (
                                      <button
                                        class={`flex items-center gap-1.5 w-full px-2 py-1 text-sm rounded-md text-left min-w-0 transition-colors ${
                                          isFolderActive(folder.id)
                                            ? 'bg-accent text-foreground font-medium'
                                            : 'hover:bg-accent'
                                        }`}
                                        onClick={() =>
                                          mobileNavigate(`/folder/${folder.id}`)
                                        }
                                      >
                                        <FolderOpen class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                        <span class="truncate text-[15px]">
                                          {folder.name}
                                        </span>
                                      </button>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                      </nav>
                    </Show>
                  </Show>
                </div>

                {SidebarFooter(false)}
              </div>
            </div>
          </aside>
        </div>
      </Show>
    </>
  );
};

export default Sidebar;
