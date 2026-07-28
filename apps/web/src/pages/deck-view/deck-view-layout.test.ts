import { describe, expect, test } from 'bun:test';
import { getDeckViewLayout } from './deck-view-layout';

describe('deck view scroll ownership', () => {
  test('uses the analytics content as the only vertical scroll owner', () => {
    // Catches a nested card viewport that adds a second scrollbar and an
    // artificial empty region beneath the final loaded card.
    const layout = getDeckViewLayout(true);

    expect(layout.verticalScrollOwner).toBe('content');
    expect(layout.contentOverflowClass).toContain('overflow-y-auto');
    expect(layout.cardViewportOverflowClass).not.toContain('overflow-y-auto');
    expect(layout.cardRegionHeight).toBeUndefined();
  });

  test('keeps the card viewport scrollable when analytics is closed', () => {
    const layout = getDeckViewLayout(false);

    expect(layout.verticalScrollOwner).toBe('cards');
    expect(layout.contentOverflowClass).toBe('overflow-hidden');
    expect(layout.cardViewportOverflowClass).toContain('overflow-y-auto');
  });
});
