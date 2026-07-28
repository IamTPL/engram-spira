import { describe, expect, test } from 'bun:test';
import {
  clampPanelWidth,
  getAppShellViewportClass,
  readStoredBoolean,
  readStoredPanelWidth,
} from './app-shell-state';

function storageWith(value: string | null): Storage {
  return {
    length: value === null ? 0 : 1,
    clear() {},
    getItem() {
      return value;
    },
    key() {
      return value === null ? null : 'key';
    },
    removeItem() {},
    setItem() {},
  };
}

describe('app shell state helpers', () => {
  test('contains protected-page overflow inside the viewport shell', () => {
    // Catches absolutely positioned controls in nested scrollers escaping the
    // shell and creating a second document-level scrollbar.
    const className = getAppShellViewportClass();

    expect(className).toContain('relative');
    expect(className).toContain('h-dvh');
    expect(className).toContain('overflow-hidden');
  });

  test('clamps explorer and context widths to their configured bounds', () => {
    expect(clampPanelWidth('explorer', 120)).toBe(240);
    expect(clampPanelWidth('explorer', 320)).toBe(320);
    expect(clampPanelWidth('explorer', 520)).toBe(420);

    expect(clampPanelWidth('context', 120)).toBe(280);
    expect(clampPanelWidth('context', 360)).toBe(360);
    expect(clampPanelWidth('context', 520)).toBe(460);
  });

  test('falls back when stored panel widths are missing, invalid, or out of bounds', () => {
    expect(readStoredPanelWidth(storageWith(null), 'explorer', 296)).toBe(296);
    expect(readStoredPanelWidth(storageWith('wide'), 'explorer', 296)).toBe(296);
    expect(readStoredPanelWidth(storageWith('999'), 'explorer', 296)).toBe(420);
    expect(readStoredPanelWidth(storageWith('260'), 'explorer', 296)).toBe(260);
  });

  test('reads persisted booleans without treating unrelated values as true', () => {
    expect(readStoredBoolean(storageWith('true'), 'key', false)).toBe(true);
    expect(readStoredBoolean(storageWith('false'), 'key', true)).toBe(false);
    expect(readStoredBoolean(storageWith('yes'), 'key', true)).toBe(true);
    expect(readStoredBoolean(storageWith(null), 'key', false)).toBe(false);
  });
});
