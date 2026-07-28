export type ShellPanel = 'explorer' | 'context';

export const shellStorageKeys = {
  explorerWidth: 'engram.shell.explorerWidth',
  contextWidth: 'engram.shell.contextWidth',
  explorerCollapsed: 'engram.shell.explorerCollapsed',
  contextCollapsed: 'engram.shell.contextCollapsed',
} as const;

export const shellPanelBounds = {
  explorer: { min: 240, max: 420, defaultWidth: 296 },
  context: { min: 280, max: 460, defaultWidth: 340 },
} as const;

export function getAppShellViewportClass() {
  return 'relative flex h-dvh min-h-0 w-full overflow-hidden bg-background text-foreground';
}

function widthKey(panel: ShellPanel) {
  return panel === 'explorer'
    ? shellStorageKeys.explorerWidth
    : shellStorageKeys.contextWidth;
}

export function clampPanelWidth(panel: ShellPanel, width: number) {
  const bounds = shellPanelBounds[panel];
  return Math.min(Math.max(width, bounds.min), bounds.max);
}

export function readStoredPanelWidth(
  storage: Pick<Storage, 'getItem'> | undefined,
  panel: ShellPanel,
  fallback = shellPanelBounds[panel].defaultWidth,
) {
  if (!storage) return fallback;

  const raw = storage.getItem(widthKey(panel));
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;

  return clampPanelWidth(panel, parsed);
}

export function readStoredBoolean(
  storage: Pick<Storage, 'getItem'> | undefined,
  key: string,
  fallback: boolean,
) {
  if (!storage) return fallback;

  const raw = storage.getItem(key);
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  return fallback;
}

export function writeStoredValue(
  storage: Pick<Storage, 'setItem'> | undefined,
  key: string,
  value: string | number | boolean,
) {
  storage?.setItem(key, String(value));
}
