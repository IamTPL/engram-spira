import { createSignal } from 'solid-js';

const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

export { sidebarCollapsed };
export const toggleSidebar = () => setSidebarCollapsed((v) => !v);
