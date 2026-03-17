import {
  type Component,
  type JSX,
  createSignal,
  createEffect,
  onCleanup,
  For,
  onMount,
} from 'solid-js';

/**
 * Lightweight virtual list for Solid.js.
 * Only renders items visible in the viewport + a small overscan buffer.
 * Uses a fixed estimated row height for simplicity — good enough for card lists
 * where rows are roughly uniform.
 */

interface VirtualListProps<T> {
  items: T[];
  estimatedRowHeight: number;
  overscan?: number;
  class?: string;
  onReachEnd?: () => void;
  children: (item: T, index: () => number) => JSX.Element;
}

function VirtualList<T>(props: VirtualListProps<T>) {
  let containerRef!: HTMLDivElement;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(0);

  const overscan = () => props.overscan ?? 3;
  const rowHeight = () => props.estimatedRowHeight;
  const totalHeight = () => props.items.length * rowHeight();

  const startIndex = () => {
    const idx = Math.floor(scrollTop() / rowHeight()) - overscan();
    return Math.max(0, idx);
  };

  const endIndex = () => {
    const idx =
      Math.ceil((scrollTop() + containerHeight()) / rowHeight()) + overscan();
    return Math.min(props.items.length, idx);
  };

  const visibleItems = () => {
    const start = startIndex();
    const end = endIndex();
    const result: { item: T; index: number }[] = [];
    for (let i = start; i < end; i++) {
      result.push({ item: props.items[i], index: i });
    }
    return result;
  };

  const offsetY = () => startIndex() * rowHeight();

  const handleScroll = () => {
    setScrollTop(containerRef.scrollTop);
    // Fire onReachEnd when scrolled near the bottom
    if (props.onReachEnd) {
      const end = endIndex();
      if (end >= props.items.length - (props.overscan ?? 3)) {
        props.onReachEnd();
      }
    }
  };

  onMount(() => {
    setContainerHeight(containerRef.clientHeight);

    const observer = new ResizeObserver(() => {
      setContainerHeight(containerRef.clientHeight);
    });
    observer.observe(containerRef);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      ref={containerRef!}
      class={props.class}
      style={{ overflow: 'auto', position: 'relative', contain: 'strict' }}
      onScroll={handleScroll}
    >
      <div style={{ height: `${totalHeight()}px`, position: 'relative' }}>
        <div
          style={{
            transform: `translateY(${offsetY()}px)`,
            position: 'absolute',
            top: '0',
            left: '0',
            right: '0',
          }}
        >
          <For each={visibleItems()}>
            {(entry) => props.children(entry.item, () => entry.index)}
          </For>
        </div>
      </div>
    </div>
  );
}

export default VirtualList;
