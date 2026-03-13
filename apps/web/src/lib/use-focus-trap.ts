import { onCleanup } from 'solid-js';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps keyboard focus within a container element.
 * Call inside onMount or createEffect after the modal DOM is ready.
 * Returns a cleanup function (also auto-cleaned via onCleanup).
 */
export function useFocusTrap(containerRef: () => HTMLElement | undefined) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const container = containerRef();
    if (!container) return;

    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  document.addEventListener('keydown', handleKeyDown);

  const cleanup = () => document.removeEventListener('keydown', handleKeyDown);
  onCleanup(cleanup);
  return cleanup;
}
