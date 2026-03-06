import { createSignal } from 'solid-js';
import { api } from '@/api/client';

const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

/** Mobile drawer open state — only used on screens < md */
const [mobileDrawerOpen, setMobileDrawerOpen] = createSignal(false);

/** Expanded class IDs in the sidebar tree */
const [expandedClasses, setExpandedClasses] = createSignal<Set<string>>(
  new Set(),
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

/** Ensure a class is expanded (used for auto-expand on navigation) */
const ensureClassExpanded = async (classId: string) => {
  const s = new Set(expandedClasses());
  if (s.has(classId)) return;
  s.add(classId);
  if (!foldersByClass()[classId]) {
    const { data } = await api.folders['by-class']({ classId }).get();
    setFoldersByClass((prev) => ({
      ...prev,
      [classId]: (data ?? []) as FolderItem[],
    }));
  }
  setExpandedClasses(s);
};

/** Update cached folders for a class */
const updateFoldersForClass = (classId: string, folders: FolderItem[]) => {
  setFoldersByClass((prev) => ({ ...prev, [classId]: folders }));
};

/** Remove a class from expanded set and folder cache */
const removeClassFromCache = (classId: string) => {
  const s = new Set(expandedClasses());
  s.delete(classId);
  setExpandedClasses(s);
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
