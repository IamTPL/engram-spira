import {
  type Component,
  For,
  Show,
  createSignal,
  createResource,
} from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/api/client';
import { currentUser } from '@/stores/auth.store';
import { toast } from '@/stores/toast.store';
import { sidebarCollapsed, toggleSidebar } from '@/stores/sidebar.store';
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
} from 'lucide-solid';

interface ClassItem {
  id: string;
  name: string;
  description: string | null;
}

interface FolderItem {
  id: string;
  name: string;
  classId: string;
}

const Sidebar: Component = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // ── Data resources ─────────────────────────────────────
  const [classes, { refetch: refetchClasses }] = createResource(
    () => currentUser()?.id,
    async () => {
      const { data } = await api.classes.get();
      return (data ?? []) as ClassItem[];
    },
  );

  // ── Expand state ────────────────────────────────────────
  const [expandedClasses, setExpandedClasses] = createSignal<Set<string>>(
    new Set(),
  );

  // ── Lazy-loaded data ────────────────────────────────────
  const [foldersByClass, setFoldersByClass] = createSignal<
    Record<string, FolderItem[]>
  >({});

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

  // ── Expand/collapse helpers ─────────────────────────────
  const toggleClass = async (classId: string) => {
    const s = new Set(expandedClasses());
    if (s.has(classId)) {
      s.delete(classId);
    } else {
      s.add(classId);
      if (!foldersByClass()[classId]) {
        const { data } = await api.folders['by-class']({ classId }).get();
        setFoldersByClass((prev) => ({
          ...prev,
          [classId]: (data ?? []) as FolderItem[],
        }));
      }
    }
    setExpandedClasses(s);
  };

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
    setFoldersByClass((prev) => ({
      ...prev,
      [classId]: (data ?? []) as FolderItem[],
    }));
    setNewFolderName('');
    setCreatingFolderForClass(null);
  };

  const openNewFolder = (e: Event, classId: string) => {
    e.stopPropagation();
    setCreatingFolderForClass(classId);
    setNewFolderName('');
    const s = new Set(expandedClasses());
    s.add(classId);
    setExpandedClasses(s);
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
          setFoldersByClass((prev) => ({
            ...prev,
            [context]: (prev[context] ?? []).map((f) =>
              f.id === id ? { ...f, name } : f,
            ),
          }));
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
      const s = new Set(expandedClasses());
      s.delete(id);
      setExpandedClasses(s);
      setFoldersByClass((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
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
      setFoldersByClass((prev) => ({
        ...prev,
        [classId]: (prev[classId] ?? []).filter((f) => f.id !== folderId),
      }));
      toast.success('Folder deleted');
    } catch {
      toast.error('Failed to delete folder');
    }
  };

  // ── Check if current path is a folder page ─────────────
  const isFolderActive = (folderId: string) =>
    location.pathname === `/folder/${folderId}`;

  return (
    <aside
      class="border-r bg-card h-full flex flex-col shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out"
      style={{ width: sidebarCollapsed() ? '56px' : '256px' }}
    >
      {/* ═══════════════════════════════════════════════════
           COLLAPSED: icon-only strip
          ═══════════════════════════════════════════════════ */}
      <Show when={sidebarCollapsed()}>
        <div class="flex flex-col items-center w-14 py-2 gap-0.5">
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
          <div class="h-px bg-border w-7 my-1.5" />
          <button
            title="Library — click to expand"
            onClick={toggleSidebar}
            class="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Layers class="h-4.5 w-4.5" />
          </button>
        </div>
      </Show>

      {/* ═══════════════════════════════════════════════════
           EXPANDED: full navigation tree (Class → Folder)
          ═══════════════════════════════════════════════════ */}
      <Show when={!sidebarCollapsed()}>
        <div class="w-64 h-full flex flex-col overflow-hidden">
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
                      <div>
                        {/* Class row */}
                        <div class="flex items-center gap-1 group">
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
                              class="flex-1 mx-1 px-1.5 py-0.5 text-sm rounded border border-primary bg-background outline-none min-w-0"
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
                                <div class="flex items-center gap-1 group/folder">
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
                                      class="flex-1 mx-1 px-1.5 py-0.5 text-sm rounded border border-primary bg-background outline-none min-w-0"
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
        </div>
      </Show>
    </aside>
  );
};

export default Sidebar;
