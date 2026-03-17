import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  on,
  batch,
  type Accessor,
  type Setter,
} from 'solid-js';
import { api, getApiError } from '@/api/client';
import { currentUser } from '@/stores/auth.store';
import { toast } from '@/stores/toast.store';
import {
  foldersByClass,
  updateFoldersForClass,
  removeClassFromCache,
  ensureClassExpanded,
  prefetchAllFolders,
  type FolderItem,
} from '@/stores/sidebar.store';

export interface ClassItem {
  id: string;
  name: string;
  description: string | null;
}

interface SidebarContextType {
  classes: Accessor<ClassItem[]>;
  classesLoading: Accessor<boolean>;
  refetchClasses: () => void;
  showNewClass: Accessor<boolean>;
  setShowNewClass: Setter<boolean>;
  newClassName: Accessor<string>;
  setNewClassName: Setter<string>;
  creatingFolderForClass: Accessor<string | null>;
  setCreatingFolderForClass: Setter<string | null>;
  newFolderName: Accessor<string>;
  setNewFolderName: Setter<string>;
  renamingId: Accessor<string | null>;
  renamingType: Accessor<'class' | 'folder' | null>;
  renameValue: Accessor<string>;
  setRenameValue: Setter<string>;
  confirmDeleteId: Accessor<string | null>;
  setConfirmDeleteId: Setter<string | null>;
  dragType: Accessor<'class' | 'folder' | null>;
  dragId: Accessor<string | null>;
  dropTargetId: Accessor<string | null>;

  handleClassDragStart: (classId: string, e: DragEvent) => void;
  handleClassDragOver: (classId: string, e: DragEvent) => void;
  handleClassDrop: (targetClassId: string, e: DragEvent) => Promise<void>;
  handleFolderDragStart: (
    classId: string,
    folderId: string,
    e: DragEvent,
  ) => void;
  handleFolderDragOver: (folderId: string, e: DragEvent) => void;
  handleFolderDrop: (
    targetClassId: string,
    targetFolderId: string,
    e: DragEvent,
  ) => Promise<void>;
  handleDragEnd: () => void;

  handleCreateClass: (e: Event) => Promise<void>;
  handleCreateFolder: (e: Event, classId: string) => Promise<void>;
  openNewFolder: (e: Event, classId: string) => void;

  startRename: (
    e: Event,
    type: 'class' | 'folder',
    id: string,
    currentName: string,
    context?: string,
  ) => void;
  cancelRename: () => void;
  submitRename: (id: string) => Promise<void>;

  handleDeleteClass: (e: Event, id: string) => Promise<void>;
  handleDeleteFolder: (
    e: Event,
    classId: string,
    folderId: string,
  ) => Promise<void>;
}

const SidebarContext = createContext<SidebarContextType>();

export function SidebarProvider(props: { children: any }) {
  const [classes, setClasses] = createSignal<ClassItem[]>([]);
  const [classesLoading, setClassesLoading] = createSignal(false);

  async function fetchClasses() {
    if (!currentUser()) return;
    setClassesLoading(true);
    try {
      const { data } = await api.classes.get();
      setClasses((data ?? []) as ClassItem[]);
    } catch {
      /* non-fatal */
    } finally {
      setClassesLoading(false);
    }
  }

  // Auto-fetch when currentUser changes
  createEffect(
    on(
      () => currentUser()?.id,
      (id) => {
        if (id) {
          fetchClasses();
          prefetchAllFolders();
        } else {
          setClasses([]);
        }
      },
    ),
  );

  const [showNewClass, setShowNewClass] = createSignal(false);
  const [newClassName, setNewClassName] = createSignal('');
  const [creatingFolderForClass, setCreatingFolderForClass] = createSignal<
    string | null
  >(null);
  const [newFolderName, setNewFolderName] = createSignal('');

  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [renamingType, setRenamingType] = createSignal<
    'class' | 'folder' | null
  >(null);
  const [renamingContext, setRenamingContext] = createSignal<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = createSignal('');

  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(
    null,
  );

  const [dragType, setDragType] = createSignal<'class' | 'folder' | null>(null);
  const [dragId, setDragId] = createSignal<string | null>(null);
  const [dragClassContext, setDragClassContext] = createSignal<string | null>(
    null,
  );
  const [dropTargetId, setDropTargetId] = createSignal<string | null>(null);

  const resetDrag = () => {
    batch(() => {
      setDragType(null);
      setDragId(null);
      setDragClassContext(null);
      setDropTargetId(null);
    });
  };

  const handleClassDragStart = (classId: string, e: DragEvent) => {
    batch(() => {
      setDragType('class');
      setDragId(classId);
    });
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

    const list = classes();
    const fromIdx = list.findIndex((c) => c.id === sourceId);
    const toIdx = list.findIndex((c) => c.id === targetClassId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...list];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    setClasses(reordered);
    resetDrag();

    const { error: reorderError } = await api.classes.reorder.patch({
      classIds: reordered.map((c) => c.id),
    });
    if (reorderError) {
      fetchClasses();
      toast.error(getApiError(reorderError) || 'Failed to reorder classes');
    }
  };

  const handleFolderDragStart = (
    classId: string,
    folderId: string,
    e: DragEvent,
  ) => {
    batch(() => {
      setDragType('folder');
      setDragId(folderId);
      setDragClassContext(classId);
    });
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

    updateFoldersForClass(sourceClassId, reordered);
    resetDrag();

    const { error: reorderFolderError } = await api.folders['by-class']({
      classId: sourceClassId,
    }).reorder.patch({
      folderIds: reordered.map((f) => f.id),
    });
    if (reorderFolderError) {
      const { data } = await api.folders['by-class']({
        classId: sourceClassId,
      }).get();
      updateFoldersForClass(sourceClassId, (data ?? []) as FolderItem[]);
      toast.error(
        getApiError(reorderFolderError) || 'Failed to reorder folders',
      );
    }
  };

  const handleDragEnd = () => resetDrag();

  const handleCreateClass = async (e: Event) => {
    e.preventDefault();
    const name = newClassName().trim();
    if (!name) return;
    try {
      const { error } = await api.classes.post({ name });
      if (error) throw new Error(getApiError(error));
      setNewClassName('');
      setShowNewClass(false);
      fetchClasses();
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to create class');
    }
  };

  const handleCreateFolder = async (e: Event, classId: string) => {
    e.preventDefault();
    const name = newFolderName().trim();
    if (!name) return;
    try {
      const { error } = await api.folders['by-class']({ classId }).post({
        name,
      });
      if (error) throw new Error(getApiError(error));
      const { data } = await api.folders['by-class']({ classId }).get();
      updateFoldersForClass(classId, (data ?? []) as FolderItem[]);
      setNewFolderName('');
      setCreatingFolderForClass(null);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to create folder');
    }
  };

  const openNewFolder = (e: Event, classId: string) => {
    e.stopPropagation();
    setCreatingFolderForClass(classId);
    setNewFolderName('');
    ensureClassExpanded(classId);
  };

  const startRename = (
    e: Event,
    type: 'class' | 'folder',
    id: string,
    currentName: string,
    context?: string,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    batch(() => {
      setRenamingId(id);
      setRenamingType(type);
      setRenamingContext(context ?? null);
      setRenameValue(currentName);
    });
  };

  const cancelRename = () => {
    batch(() => {
      setRenamingId(null);
      setRenamingType(null);
      setRenamingContext(null);
      setRenameValue('');
    });
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
        const { error } = await (api.classes as any)[id].patch({ name });
        if (error) throw new Error(getApiError(error));
        fetchClasses();
      } else if (type === 'folder') {
        const { error } = await (api.folders as any)[id].patch({ name });
        if (error) throw new Error(getApiError(error));
        if (context) {
          updateFoldersForClass(
            context,
            (foldersByClass()[context] ?? []).map((f) =>
              f.id === id ? { ...f, name } : f,
            ),
          );
        }
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to rename');
    } finally {
      cancelRename();
    }
  };

  const handleDeleteClass = async (e: Event, id: string) => {
    e.stopPropagation();
    try {
      const { error: deleteClassError } = await (api.classes as any)[
        id
      ].delete();
      if (deleteClassError) throw new Error(getApiError(deleteClassError));
      setConfirmDeleteId(null);
      removeClassFromCache(id);
      fetchClasses();
      toast.success('Class deleted');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete class');
    }
  };

  const handleDeleteFolder = async (
    e: Event,
    classId: string,
    folderId: string,
  ) => {
    e.stopPropagation();
    try {
      const { error: deleteFolderError } = await (api.folders as any)[
        folderId
      ].delete();
      if (deleteFolderError) throw new Error(getApiError(deleteFolderError));
      setConfirmDeleteId(null);
      updateFoldersForClass(
        classId,
        (foldersByClass()[classId] ?? []).filter((f) => f.id !== folderId),
      );
      toast.success('Folder deleted');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete folder');
    }
  };

  return (
    <SidebarContext.Provider
      value={{
        classes,
        classesLoading,
        refetchClasses: fetchClasses,
        showNewClass,
        setShowNewClass,
        newClassName,
        setNewClassName,
        creatingFolderForClass,
        setCreatingFolderForClass,
        newFolderName,
        setNewFolderName,
        renamingId,
        renamingType,
        renameValue,
        setRenameValue,
        confirmDeleteId,
        setConfirmDeleteId,
        dragType,
        dragId,
        dropTargetId,
        handleClassDragStart,
        handleClassDragOver,
        handleClassDrop,
        handleFolderDragStart,
        handleFolderDragOver,
        handleFolderDrop,
        handleDragEnd,
        handleCreateClass,
        handleCreateFolder,
        openNewFolder,
        startRename,
        cancelRename,
        submitRename,
        handleDeleteClass,
        handleDeleteFolder,
      }}
    >
      {props.children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider');
  return ctx;
}
