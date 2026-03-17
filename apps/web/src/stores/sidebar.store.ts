import { createSignal } from 'solid-js';

const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

/** Mobile drawer open state — only used on screens < md */
const [mobileDrawerOpen, setMobileDrawerOpen] = createSignal(false);

/** Expanded class IDs — Record<string, boolean> for O(1) toggle without Set copy */
const [expandedClasses, setExpandedClasses] = createSignal<
  Record<string, boolean>
>({});

export interface FolderItem {
  id: string;
  name: string;
  classId: string;
}

/** Toggle a class open/closed (sync — folder data owned by TanStack Query in context) */
const toggleClass = (classId: string) => {
  setExpandedClasses((prev) => ({ ...prev, [classId]: !prev[classId] }));
};

/** Ensure a class is expanded (used for auto-expand on navigation) */
const ensureClassExpanded = (classId: string) => {
  if (expandedClasses()[classId]) return;
  setExpandedClasses((prev) => ({ ...prev, [classId]: true }));
};

export {
  sidebarCollapsed,
  mobileDrawerOpen,
  expandedClasses,
  setExpandedClasses,
};
export const toggleSidebar = () => setSidebarCollapsed((v) => !v);
export const openMobileDrawer = () => setMobileDrawerOpen(true);
export const closeMobileDrawer = () => setMobileDrawerOpen(false);
export const toggleMobileDrawer = () => setMobileDrawerOpen((v) => !v);
export { toggleClass, ensureClassExpanded };
