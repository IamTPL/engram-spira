export function shouldIgnoreStudyShortcut(event: KeyboardEvent) {
  const target = event.target;
  const isTextEntry =
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

  return (
    event.defaultPrevented ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    isTextEntry
  );
}

export function isInteractiveStudyTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest('button, a, summary, [role="button"]')
  );
}
