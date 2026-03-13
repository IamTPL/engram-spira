import { onMount, onCleanup } from 'solid-js';

/**
 * Focuses #main-content after client-side navigations so screen readers
 * announce the new page and keyboard users land in the right spot.
 * Uses a patched history listener — no router primitives needed.
 * Renders nothing — side-effect only.
 */
export default function RouteAnnouncer() {
  onMount(() => {
    let lastPath = location.pathname;

    const focusMain = () => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      requestAnimationFrame(() => {
        const main = document.getElementById('main-content');
        if (main) {
          main.setAttribute('tabindex', '-1');
          main.focus({ preventScroll: false });
        }
      });
    };

    window.addEventListener('popstate', focusMain);

    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = (...args) => {
      origPush(...args);
      focusMain();
    };
    history.replaceState = (...args) => {
      origReplace(...args);
      focusMain();
    };

    onCleanup(() => {
      window.removeEventListener('popstate', focusMain);
      history.pushState = origPush;
      history.replaceState = origReplace;
    });
  });

  return null;
}
