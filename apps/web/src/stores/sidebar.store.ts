import { createSignal } from 'solid-js';
import { api } from '@/api/client';

const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

/** Mobile drawer open state — only used on screens < md */
const [mobileDrawerOpen, setMobileDrawerOpen] = createSignal(false);

/** Expanded class IDs — Record<string, boolean> for O(1) toggle without Set copy */
const [expandedClasses, setExpandedClasses] = createSignal<
  Record<string, boolean>
>({});

/** Lazy-loaded folders per class */
interface FolderItem {
  id: string;
  name: string;
  classId: string;
}
const [foldersByClass, setFoldersByClass] = createSignal<
  Record<string, FolderItem[]>
>({});

let allFoldersFetched = false;

/** Batch-fetch all folders for the user in a single request, populating foldersByClass */
const prefetchAllFolders = async () => {
  if (allFoldersFetched) return;
  try {
    const { data } = await (api.folders as any).all.get();
    if (Array.isArray(data)) {
      const grouped: Record<string, FolderItem[]> = {};
      for (const f of data as FolderItem[]) {
        (grouped[f.classId] ??= []).push(f);
      }
      setFoldersByClass(grouped);
      allFoldersFetched = true;
    }
  } catch {
    /* non-fatal — falls back to per-class fetch */
  }
};

/** Fetch folders for a single class (fallback when batch not yet loaded) */
const fetchFoldersForClass = async (classId: string) => {
  const { data } = await api.folders['by-class']({ classId }).get();
  setFoldersByClass((prev) => ({
    ...prev,
    [classId]: (data ?? []) as FolderItem[],
  }));
};

/** Toggle a class open/closed, lazy-loading folders on first expand */
const toggleClass = async (classId: string) => {
  const isExpanded = expandedClasses()[classId];
  if (isExpanded) {
    setExpandedClasses((prev) => ({ ...prev, [classId]: false }));
  } else {
    setExpandedClasses((prev) => ({ ...prev, [classId]: true }));
    if (!foldersByClass()[classId]) {
      await fetchFoldersForClass(classId);
    }
  }
};

/** Ensure a class is expanded (used for auto-expand on navigation) */
const ensureClassExpanded = async (classId: string) => {
  if (expandedClasses()[classId]) return;
  setExpandedClasses((prev) => ({ ...prev, [classId]: true }));
  if (!foldersByClass()[classId]) {
    await fetchFoldersForClass(classId);
  }
};

/** Update cached folders for a class */
const updateFoldersForClass = (classId: string, folders: FolderItem[]) => {
  setFoldersByClass((prev) => ({ ...prev, [classId]: folders }));
};

/** Remove a class from expanded set and folder cache */
const removeClassFromCache = (classId: string) => {
  setExpandedClasses((prev) => ({ ...prev, [classId]: false }));
  setFoldersByClass((prev) => {
    const n = { ...prev };
    delete n[classId];
    return n;
  });
};

export {
  sidebarCollapsed,
  mobileDrawerOpen,
  expandedClasses,
  setExpandedClasses,
  foldersByClass,
  setFoldersByClass,
};
export type { FolderItem };
export const toggleSidebar = () => setSidebarCollapsed((v) => !v);
export const openMobileDrawer = () => setMobileDrawerOpen(true);
export const closeMobileDrawer = () => setMobileDrawerOpen(false);
export const toggleMobileDrawer = () => setMobileDrawerOpen((v) => !v);
export {
  toggleClass,
  ensureClassExpanded,
  updateFoldersForClass,
  removeClassFromCache,
  prefetchAllFolders,
};
