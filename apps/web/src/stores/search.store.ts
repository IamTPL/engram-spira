import { createSignal } from 'solid-js';

const [searchOpen, setSearchOpen] = createSignal(false);
export { searchOpen };
export const openSearch = () => setSearchOpen(true);
export const closeSearch = () => setSearchOpen(false);
export const toggleSearch = () => setSearchOpen((v) => !v);
