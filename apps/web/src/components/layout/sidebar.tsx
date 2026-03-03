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
  BookOpen,
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

interface DeckItem {
  id: string;
  name: string;
  folderId: string;
  cardTemplateId: string;
}

interface TemplateItem {
  id: string;
  name: string;
  isSystem: boolean;
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

  const [templates] = createResource(async () => {
    const { data } = await api['card-templates'].get();
    return (data ?? []) as TemplateItem[];
  });

  // ── Expand state ────────────────────────────────────────
  const [expandedClasses, setExpandedClasses] = createSignal<Set<string>>(
    new Set(),
  );
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(
    new Set(),
  );

  // ── Lazy-loaded data ────────────────────────────────────
  const [foldersByClass, setFoldersByClass] = createSignal<
    Record<string, FolderItem[]>
  >({});
  const [decksByFolder, setDecksByFolder] = createSignal<
    Record<string, DeckItem[]>
  >({});

  // ── Create Class state ──────────────────────────────────
  const [showNewClass, setShowNewClass] = createSignal(false);
  const [newClassName, setNewClassName] = createSignal('');

  // ── Create Folder state (per class) ────────────────────
  // Lưu classId đang mở form tạo folder. null = không có form nào mở.
  const [creatingFolderForClass, setCreatingFolderForClass] = createSignal<
    string | null
  >(null);
  const [newFolderName, setNewFolderName] = createSignal('');

  // ── Create Deck state (per folder) ─────────────────────
  // Lưu folderId đang mở form tạo deck.
  const [creatingDeckForFolder, setCreatingDeckForFolder] = createSignal<
    string | null
  >(null);
  const [newDeckName, setNewDeckName] = createSignal('');
  const [newDeckTemplateId, setNewDeckTemplateId] = createSignal('');

  // ── Rename state ────────────────────────────────────────
  // renamingType + renamingId xác định item đang được đổi tên.
  // renamingContext: classId (khi rename folder), folderId (khi rename deck).
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [renamingType, setRenamingType] = createSignal<
    'class' | 'folder' | 'deck' | null
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
      // Lazy-load folders chỉ khi chưa có
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

  const toggleFolder = async (folderId: string) => {
    const s = new Set(expandedFolders());
    if (s.has(folderId)) {
      s.delete(folderId);
    } else {
      s.add(folderId);
      if (!decksByFolder()[folderId]) {
        const { data } = await api.decks['by-folder']({ folderId }).get();
        setDecksByFolder((prev) => ({
          ...prev,
          [folderId]: (data ?? []) as DeckItem[],
        }));
      }
    }
    setExpandedFolders(s);
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
    // Refetch folders cho class này
    const { data } = await api.folders['by-class']({ classId }).get();
    setFoldersByClass((prev) => ({
      ...prev,
      [classId]: (data ?? []) as FolderItem[],
    }));
    setNewFolderName('');
    setCreatingFolderForClass(null);
  };

  const handleCreateDeck = async (e: Event, folderId: string) => {
    e.preventDefault();
    const name = newDeckName().trim();
    const templateId = newDeckTemplateId();
    if (!name || !templateId) return;
    await api.decks['by-folder']({ folderId }).post({
      name,
      cardTemplateId: templateId,
    });
    // Refetch decks cho folder này
    const { data } = await api.decks['by-folder']({ folderId }).get();
    setDecksByFolder((prev) => ({
      ...prev,
      [folderId]: (data ?? []) as DeckItem[],
    }));
    setNewDeckName('');
    setNewDeckTemplateId('');
    setCreatingDeckForFolder(null);
  };

  const openNewFolder = (e: Event, classId: string) => {
    e.stopPropagation(); // Prevent toggling the class
    setCreatingFolderForClass(classId);
    setNewFolderName('');
    // Đảm bảo class đang expanded
    const s = new Set(expandedClasses());
    s.add(classId);
    setExpandedClasses(s);
  };

  const openNewDeck = (e: Event, folderId: string) => {
    e.stopPropagation();
    setCreatingDeckForFolder(folderId);
    setNewDeckName('');
    // Set default template là cái đầu tiên nếu có
    const tmpl = templates();
    if (tmpl && tmpl.length > 0) setNewDeckTemplateId(tmpl[0].id);
    // Đảm bảo folder đang expanded
    const s = new Set(expandedFolders());
    s.add(folderId);
    setExpandedFolders(s);
  };

  // ── Rename handlers ─────────────────────────────────────
  const startRename = (
    e: Event,
    type: 'class' | 'folder' | 'deck',
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
      } else if (type === 'deck') {
        await (api.decks as any)[id].patch({ name });
        if (context) {
          setDecksByFolder((prev) => ({
            ...prev,
            [context]: (prev[context] ?? []).map((d) =>
              d.id === id ? { ...d, name } : d,
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
      // Remove from local expand state
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
      const s = new Set(expandedFolders());
      s.delete(folderId);
      setExpandedFolders(s);
      setFoldersByClass((prev) => ({
        ...prev,
        [classId]: (prev[classId] ?? []).filter((f) => f.id !== folderId),
      }));
      setDecksByFolder((prev) => {
        const n = { ...prev };
        delete n[folderId];
        return n;
      });
      toast.success('Folder deleted');
    } catch {
      toast.error('Failed to delete folder');
    }
  };

  const handleDeleteDeck = async (
    e: Event,
    folderId: string,
    deckId: string,
  ) => {
    e.stopPropagation();
    try {
      await (api.decks as any)[deckId].delete();
      setConfirmDeleteId(null);
      setDecksByFolder((prev) => ({
        ...prev,
        [folderId]: (prev[folderId] ?? []).filter((d) => d.id !== deckId),
      }));
      toast.success('Deck deleted');
    } catch {
      toast.error('Failed to delete deck');
    }
  };

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
          {/* Dashboard */}
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

          {/* Separator */}
          <div class="h-px bg-border w-7 my-1.5" />

          {/* Library — click expands sidebar */}
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
           EXPANDED: full navigation tree
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
          {/* ── Separator ── */}
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
                            {/* Rename input for class */}
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
                          {/* Action buttons — hiện khi hover class */}
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
                              {/* Confirm delete class */}
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

                        {/* Expanded class content */}
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

                            {/* Folders */}
                            <For each={foldersByClass()[cls.id] ?? []}>
                              {(folder) => (
                                <div>
                                  {/* Folder row */}
                                  <div class="flex items-center gap-1 group/folder">
                                    <Show
                                      when={
                                        renamingId() === folder.id &&
                                        renamingType() === 'folder'
                                      }
                                      fallback={
                                        <button
                                          class="flex items-center gap-1.5 flex-1 px-2 py-1 text-sm rounded-md hover:bg-accent text-left min-w-0"
                                          onClick={() =>
                                            toggleFolder(folder.id)
                                          }
                                        >
                                          <Show
                                            when={expandedFolders().has(
                                              folder.id,
                                            )}
                                            fallback={
                                              <ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground" />
                                            }
                                          >
                                            <ChevronDown class="h-3 w-3 shrink-0 text-muted-foreground" />
                                          </Show>
                                          <FolderOpen class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                          <span class="truncate text-[15px]">
                                            {folder.name}
                                          </span>
                                        </button>
                                      }
                                    >
                                      {/* Rename input for folder */}
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
                                            <button
                                              class="opacity-0 group-hover/folder:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 transition-opacity"
                                              title="Add deck"
                                              onClick={(e) =>
                                                openNewDeck(e, folder.id)
                                              }
                                            >
                                              <Plus class="h-3 w-3" />
                                            </button>
                                          </>
                                        }
                                      >
                                        {/* Confirm delete folder */}
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

                                  {/* Expanded folder content */}
                                  <Show when={expandedFolders().has(folder.id)}>
                                    <div class="ml-4 mt-0.5 space-y-0.5">
                                      {/* New Deck form */}
                                      <Show
                                        when={
                                          creatingDeckForFolder() === folder.id
                                        }
                                      >
                                        <form
                                          onSubmit={(e) =>
                                            handleCreateDeck(e, folder.id)
                                          }
                                          class="space-y-1.5 py-1 pr-1"
                                        >
                                          <Input
                                            placeholder="Deck name..."
                                            value={newDeckName()}
                                            onInput={(e) =>
                                              setNewDeckName(
                                                e.currentTarget.value,
                                              )
                                            }
                                            class="h-6 text-xs"
                                            autofocus
                                            onKeyDown={(e) => {
                                              if (e.key === 'Escape')
                                                setCreatingDeckForFolder(null);
                                            }}
                                          />
                                          <select
                                            class="w-full h-6 text-xs rounded border border-input bg-background px-1.5 text-foreground"
                                            value={newDeckTemplateId()}
                                            onChange={(e) =>
                                              setNewDeckTemplateId(
                                                e.currentTarget.value,
                                              )
                                            }
                                          >
                                            <option value="" disabled>
                                              Select template...
                                            </option>
                                            <For each={templates() ?? []}>
                                              {(t) => (
                                                <option value={t.id}>
                                                  {t.name}
                                                </option>
                                              )}
                                            </For>
                                          </select>
                                          <div class="flex gap-1">
                                            <Button
                                              type="submit"
                                              class="h-6 text-xs px-2 flex-1"
                                              disabled={
                                                !newDeckName().trim() ||
                                                !newDeckTemplateId()
                                              }
                                            >
                                              Create
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              class="h-6 w-6 p-0"
                                              onClick={() =>
                                                setCreatingDeckForFolder(null)
                                              }
                                            >
                                              <X class="h-3 w-3" />
                                            </Button>
                                          </div>
                                        </form>
                                      </Show>

                                      {/* Decks */}
                                      <For
                                        each={decksByFolder()[folder.id] ?? []}
                                      >
                                        {(deck) => (
                                          <div class="flex items-center gap-1 group/deck">
                                            <Show
                                              when={
                                                renamingId() === deck.id &&
                                                renamingType() === 'deck'
                                              }
                                              fallback={
                                                <button
                                                  class="flex items-center gap-1.5 flex-1 px-2 py-1 text-sm rounded-md hover:bg-accent text-left min-w-0"
                                                  onClick={() =>
                                                    navigate(`/deck/${deck.id}`)
                                                  }
                                                >
                                                  <BookOpen class="h-3.5 w-3.5 shrink-0 text-primary" />
                                                  <span class="truncate text-sm">
                                                    {deck.name}
                                                  </span>
                                                </button>
                                              }
                                            >
                                              {/* Rename input for deck */}
                                              <input
                                                class="flex-1 mx-1 px-1.5 py-0.5 text-sm rounded border border-primary bg-background outline-none min-w-0"
                                                value={renameValue()}
                                                onInput={(e) =>
                                                  setRenameValue(
                                                    e.currentTarget.value,
                                                  )
                                                }
                                                onBlur={() =>
                                                  submitRename(deck.id)
                                                }
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    submitRename(deck.id);
                                                  } else if (
                                                    e.key === 'Escape'
                                                  ) {
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
                                            <Show
                                              when={renamingId() !== deck.id}
                                            >
                                              <Show
                                                when={
                                                  confirmDeleteId() === deck.id
                                                }
                                                fallback={
                                                  <>
                                                    <button
                                                      class="opacity-0 group-hover/deck:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 transition-opacity"
                                                      title="Rename deck"
                                                      onClick={(e) =>
                                                        startRename(
                                                          e,
                                                          'deck',
                                                          deck.id,
                                                          deck.name,
                                                          folder.id,
                                                        )
                                                      }
                                                    >
                                                      <Pencil class="h-3 w-3" />
                                                    </button>
                                                    <button
                                                      class="opacity-0 group-hover/deck:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent shrink-0 transition-opacity"
                                                      title="Delete deck"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        setConfirmDeleteId(
                                                          deck.id,
                                                        );
                                                      }}
                                                    >
                                                      <Trash2 class="h-3 w-3" />
                                                    </button>
                                                  </>
                                                }
                                              >
                                                {/* Confirm delete deck */}
                                                <span class="text-xs text-destructive font-medium whitespace-nowrap">
                                                  Delete?
                                                </span>
                                                <button
                                                  class="h-6 w-6 flex items-center justify-center rounded text-destructive hover:bg-destructive/10 shrink-0"
                                                  onClick={(e) =>
                                                    handleDeleteDeck(
                                                      e,
                                                      folder.id,
                                                      deck.id,
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
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </nav>
              </Show>
            </Show>
          </div>{' '}
          {/* closes p-3 flex-1 overflow-y-auto */}
        </div>{' '}
        {/* closes w-64 h-full flex flex-col */}
      </Show>{' '}
      {/* closes expanded Show */}
    </aside>
  );
};

export default Sidebar;
