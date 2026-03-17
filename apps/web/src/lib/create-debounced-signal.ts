import { createSignal, createEffect, onCleanup } from 'solid-js';

/**
 * Returns [debouncedValue, setValue, immediateValue].
 * - `debouncedValue` updates after `delayMs` of inactivity.
 * - `immediateValue` updates immediately (for controlled inputs).
 */
export function createDebouncedSignal<T>(initialValue: T, delayMs: number) {
  const [value, setValue] = createSignal<T>(initialValue);
  const [debounced, setDebounced] = createSignal<T>(initialValue);
  let timer: ReturnType<typeof setTimeout>;

  createEffect(() => {
    const v = value();
    clearTimeout(timer);
    timer = setTimeout(() => setDebounced(() => v), delayMs);
  });

  onCleanup(() => clearTimeout(timer));

  return [debounced, setValue, value] as const;
}
