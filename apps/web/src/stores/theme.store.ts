import { createSignal, createEffect, createRoot } from 'solid-js';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'engram-theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system')
    return stored;
  return 'system';
}

function getResolvedTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return theme;
}

const [theme, setThemeSignal] = createSignal<Theme>(getInitialTheme());
const [resolvedTheme, setResolvedTheme] = createSignal<'light' | 'dark'>(
  getResolvedTheme(getInitialTheme()),
);

export { theme, resolvedTheme };

export function setTheme(newTheme: Theme) {
  setThemeSignal(newTheme);
  localStorage.setItem(STORAGE_KEY, newTheme);
}

export function toggleTheme() {
  const current = resolvedTheme();
  setTheme(current === 'light' ? 'dark' : 'light');
}

// Sync <html> class and resolved theme reactively
// Wrapped in createRoot because this runs at module scope (before render())
createRoot(() => {
  createEffect(() => {
    const t = theme();
    const resolved = getResolvedTheme(t);
    setResolvedTheme(resolved);

    const html = document.documentElement;
    html.classList.remove('light', 'dark');
    html.classList.add(resolved);
  });
});

// Listen for system theme changes when mode is 'system'
if (typeof window !== 'undefined') {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (theme() === 'system') {
        const resolved = getResolvedTheme('system');
        setResolvedTheme(resolved);
        const html = document.documentElement;
        html.classList.remove('light', 'dark');
        html.classList.add(resolved);
      }
    });
}
