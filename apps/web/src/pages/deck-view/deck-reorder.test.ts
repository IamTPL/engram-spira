import { describe, expect, it } from 'bun:test';
import {
  createDragAutoScroller,
  getEdgeScrollVelocity,
} from '@/lib/drag-auto-scroll';
import {
  getDropPosition,
  reorderCards,
  replaceCardsAcrossPages,
} from './deck-reorder';
import type { CardItem } from './types';

const cards = ['a', 'b', 'c', 'd'].map(
  (id, sortOrder) =>
    ({
      id,
      deckId: 'deck',
      sortOrder,
      fields: [],
    }) as CardItem,
);

const ids = (items: CardItem[] | null) => items?.map((card) => card.id);

describe('deck card reorder', () => {
  it('moves a card before an earlier target', () => {
    expect(ids(reorderCards(cards, 'c', 'a', 'before'))).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
  });

  it('moves a card after a later target', () => {
    expect(ids(reorderCards(cards, 'a', 'c', 'after'))).toEqual([
      'b',
      'c',
      'a',
      'd',
    ]);
  });

  it('does not submit an unchanged adjacent order', () => {
    expect(reorderCards(cards, 'b', 'c', 'before')).toBeNull();
    expect(reorderCards(cards, 'c', 'b', 'after')).toBeNull();
  });

  it('safely ignores a source or target outside the canonical list', () => {
    expect(reorderCards(cards, 'missing', 'b', 'before')).toBeNull();
    expect(reorderCards(cards, 'a', 'missing', 'after')).toBeNull();
  });

  it('supports consecutive reorders without cloning card objects', () => {
    const firstOrder = reorderCards(cards, 'a', 'c', 'after');
    expect(firstOrder).not.toBeNull();

    const secondOrder = reorderCards(firstOrder!, 'd', 'b', 'before');
    expect(ids(secondOrder)).toEqual(['d', 'b', 'c', 'a']);
    expect(secondOrder?.[0]).toBe(cards[3]);
    expect(secondOrder?.[1]).toBe(cards[1]);
    expect(secondOrder?.[2]).toBe(cards[2]);
    expect(secondOrder?.[3]).toBe(cards[0]);
  });
});

describe('deck card infinite-query cache', () => {
  it('preserves page sizes, metadata, and card references', () => {
    const pages = [
      {
        items: cards.slice(0, 2),
        total: 4,
        nextCursor: 8,
        hasMore: true,
      },
      {
        items: cards.slice(2),
        total: 4,
        nextCursor: null,
        hasMore: false,
      },
    ];
    const orderedCards = [cards[3], cards[1], cards[2], cards[0]];

    const nextPages = replaceCardsAcrossPages(pages, orderedCards);

    expect(nextPages.map((page) => page.items.length)).toEqual([2, 2]);
    expect(nextPages[0].nextCursor).toBe(1);
    expect(nextPages[1].nextCursor).toBeNull();
    expect(nextPages[1].hasMore).toBe(false);
    expect(nextPages[0].items[0]).toBe(cards[3]);
    expect(nextPages[1].items[1]).toBe(cards[0]);
    expect(pages[0].items).toEqual(cards.slice(0, 2));
  });
});

describe('deck card drop position', () => {
  const bounds = { top: 100, height: 120 };

  it('uses the row midpoint as the insertion boundary', () => {
    expect(getDropPosition(120, bounds)).toBe('before');
    expect(getDropPosition(180, bounds)).toBe('after');
  });
});

describe('drag edge auto-scroll velocity', () => {
  const bounds = { top: 100, bottom: 700 };

  it('stays still outside both edge zones', () => {
    expect(getEdgeScrollVelocity(300, bounds)).toBe(0);
  });

  it('scrolls up at the top edge and down at the bottom edge', () => {
    expect(getEdgeScrollVelocity(110, bounds)).toBeLessThan(0);
    expect(getEdgeScrollVelocity(690, bounds)).toBeGreaterThan(0);
  });

  it('clamps acceleration when the pointer leaves the bounds', () => {
    expect(getEdgeScrollVelocity(0, bounds)).toBe(-960);
    expect(getEdgeScrollVelocity(800, bounds)).toBe(960);
  });

  it('advances the scroll container after initializing its frame clock', () => {
    const originalRequestFrame = globalThis.requestAnimationFrame;
    const originalCancelFrame = globalThis.cancelAnimationFrame;
    const frames: FrameRequestCallback[] = [];
    let nextFrameId = 1;
    let scrollCallbacks = 0;
    const container = {
      scrollTop: 100,
      scrollHeight: 1_000,
      clientHeight: 200,
      getBoundingClientRect: () => ({
        top: 0,
        right: 300,
        bottom: 200,
        left: 0,
      }),
    } as HTMLElement;

    globalThis.requestAnimationFrame = (callback) => {
      frames.push(callback);
      return nextFrameId++;
    };
    globalThis.cancelAnimationFrame = () => {};

    try {
      const scroller = createDragAutoScroller(
        () => container,
        () => scrollCallbacks++,
      );
      scroller.updatePointer(150, 195);

      frames.shift()?.(0);
      expect(container.scrollTop).toBe(100);

      frames.shift()?.(16);
      expect(container.scrollTop).toBeGreaterThan(100);
      expect(scrollCallbacks).toBe(1);
      scroller.stop();
    } finally {
      globalThis.requestAnimationFrame = originalRequestFrame;
      globalThis.cancelAnimationFrame = originalCancelFrame;
    }
  });

  it('restarts cleanly for a second drag session', () => {
    const originalRequestFrame = globalThis.requestAnimationFrame;
    const originalCancelFrame = globalThis.cancelAnimationFrame;
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const container = {
      scrollTop: 100,
      scrollHeight: 1_000,
      clientHeight: 200,
      getBoundingClientRect: () => ({
        top: 0,
        right: 300,
        bottom: 200,
        left: 0,
      }),
    } as HTMLElement;

    globalThis.requestAnimationFrame = (callback) => {
      const frameId = nextFrameId++;
      frames.set(frameId, callback);
      return frameId;
    };
    globalThis.cancelAnimationFrame = (frameId) => {
      frames.delete(frameId);
    };

    const runNextFrame = (timestamp: number) => {
      const entry = frames.entries().next().value;
      if (!entry) return;
      const [frameId, callback] = entry;
      frames.delete(frameId);
      callback(timestamp);
    };

    try {
      const scroller = createDragAutoScroller(() => container);

      scroller.updatePointer(150, 195);
      runNextFrame(0);
      runNextFrame(16);
      const firstSessionScrollTop = container.scrollTop;
      expect(firstSessionScrollTop).toBeGreaterThan(100);
      scroller.stop();
      expect(frames.size).toBe(0);

      scroller.updatePointer(150, 195);
      runNextFrame(32);
      runNextFrame(48);
      expect(container.scrollTop).toBeGreaterThan(firstSessionScrollTop);
      scroller.stop();
      expect(frames.size).toBe(0);
    } finally {
      globalThis.requestAnimationFrame = originalRequestFrame;
      globalThis.cancelAnimationFrame = originalCancelFrame;
    }
  });
});
