import { createSignal } from 'solid-js';
import { api } from '@/api/client';

const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

/** Mobile drawer open state — only used on screens < md */
const [mobileDrawerOpen, setMobileDrawerOpen] = createSignal(false);

/** Expanded class IDs — Record<string, boolean> for O(1) toggle without Set copy */
const [expandedClasses, setExpandedClasses] = createSignal<Record<string, boolean>>(
  {},
);

/** Lazy-loaded folders per class */
interface FolderItem {
  id: string;
  name: string;
  classId: string;
}
const [foldersByClass, setFoldersByClass] = createSignal<
  Record<string, FolderItem[]>
>({});

/** Toggle a class open/closed, lazy-loading folders on first expand */
const toggleClass = async (classId: string) => {
  const isExpanded = expandedClasses()[classId];
  if (isExpanded) {
    setExpandedClasses((prev) => ({ ...prev, [classId]: false }));
  } else {
    setExpandedClasses((prev) => ({ ...prev, [classId]: true }));
    if (!foldersByClass()[classId]) {
      const { data } = await api.folders['by-class']({ classId }).get();
      setFoldersByClass((prev) => ({
        ...prev,
        [classId]: (data ?? []) as FolderItem[],
      }));
    }
  }
};

/** Ensure a class is expanded (used for auto-expand on navigation) */
const ensureClassExpanded = async (classId: string) => {
  if (expandedClasses()[classId]) return;
  setExpandedClasses((prev) => ({ ...prev, [classId]: true }));
  if (!foldersByClass()[classId]) {
    const { data } = await api.folders['by-class']({ classId }).get();
    setFoldersByClass((prev) => ({
      ...prev,
      [classId]: (data ?? []) as FolderItem[],
    }));
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
};
