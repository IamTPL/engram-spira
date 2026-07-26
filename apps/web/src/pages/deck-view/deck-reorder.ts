import type { CardItem } from './types';

export type DropPosition = 'before' | 'after';

export function getDropPosition(
  pointerY: number,
  bounds: Pick<DOMRect, 'top' | 'height'>,
): DropPosition {
  return pointerY < bounds.top + bounds.height / 2 ? 'before' : 'after';
}

export function reorderCards(
  cards: CardItem[],
  sourceCardId: string,
  targetCardId: string,
  position: DropPosition,
) {
  if (sourceCardId === targetCardId) return null;

  const sourceIndex = cards.findIndex((card) => card.id === sourceCardId);
  if (sourceIndex < 0) return null;

  const nextCards = [...cards];
  const [movedCard] = nextCards.splice(sourceIndex, 1);
  const targetIndex = nextCards.findIndex((card) => card.id === targetCardId);
  if (targetIndex < 0) return null;

  const insertIndex = targetIndex + (position === 'after' ? 1 : 0);
  nextCards.splice(insertIndex, 0, movedCard);

  const orderChanged = nextCards.some(
    (card, index) => card.id !== cards[index]?.id,
  );
  return orderChanged ? nextCards : null;
}

export function replaceCardsAcrossPages<
  T,
  TPage extends {
    items: T[];
    nextCursor: number | null;
    hasMore: boolean;
  },
>(pages: TPage[], cards: T[]): TPage[] {
  let offset = 0;

  return pages.map((page) => {
    const items = cards.slice(offset, offset + page.items.length);
    offset += page.items.length;
    return {
      ...page,
      items,
      nextCursor: page.hasMore && items.length > 0 ? offset - 1 : null,
    };
  });
}
