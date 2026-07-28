export type DeckViewLayout = {
  verticalScrollOwner: 'cards' | 'content';
  contentOverflowClass: string;
  contentColumnClass: string;
  cardRegionClass: string;
  cardViewportOverflowClass: string;
  cardRegionHeight: string | undefined;
};

export function getDeckViewLayout(showAnalytics: boolean): DeckViewLayout {
  if (showAnalytics) {
    return {
      verticalScrollOwner: 'content',
      contentOverflowClass: 'overflow-y-auto overscroll-contain',
      contentColumnClass: '',
      cardRegionClass: 'flex-none',
      cardViewportOverflowClass: 'flex-none overflow-visible',
      cardRegionHeight: undefined,
    };
  }

  return {
    verticalScrollOwner: 'cards',
    contentOverflowClass: 'overflow-hidden',
    contentColumnClass: 'h-full',
    cardRegionClass: 'flex-1',
    cardViewportOverflowClass:
      'min-h-0 flex-1 overflow-y-auto overscroll-contain',
    cardRegionHeight: undefined,
  };
}
