import { createSignal, createMemo, createEffect } from 'solid-js';
import { useParams } from '@solidjs/router';
import { createQuery, createInfiniteQuery } from '@tanstack/solid-query';
import { api } from '@/api/client';
import { queryClient } from '@/lib/query-client';
import { memoryHealthKeys } from '@/components/deck-view/memory-health-state';
import type { TemplateField, CardItem } from './types';
import { replaceCardsAcrossPages } from './deck-reorder';

export interface DeckData {
  id: string;
  name: string;
  folderId: string;
  cardTemplateId: string;
}

export interface TemplateData {
  id: string;
  name: string;
  fields: TemplateField[];
}

interface CardsPage {
  items: CardItem[];
  total: number;
  nextCursor: number | null;
  hasMore: boolean;
}

interface CardsInfiniteData {
  pages: CardsPage[];
  pageParams: unknown[];
}

const PAGE_SIZE = 50;

export function useDeckData() {
  const params = useParams<{ deckId: string }>();
  const cardsQueryKey = () => ['cards', params.deckId] as const;

  // Deck + cards fetch in PARALLEL (both depend only on deckId)
  const deckQuery = createQuery(() => ({
    queryKey: ['deck', params.deckId],
    queryFn: async () => {
      const { data } = await (api.decks as any)[params.deckId].get();
      return (data as DeckData) ?? null;
    },
    enabled: !!params.deckId,
  }));

  // Template depends on deck (needs cardTemplateId), sequential after deck.
  const templateQuery = createQuery(() => ({
    queryKey: ['template', deckQuery.data?.cardTemplateId],
    queryFn: async () => {
      const templateId = deckQuery.data?.cardTemplateId;
      if (!templateId) return null;
      const { data } = await (api['card-templates'] as any)[templateId].get();
      return (data as TemplateData) ?? null;
    },
    enabled: !!deckQuery.data?.cardTemplateId,
  }));

  // ── Cursor-based infinite query for cards ─────────────────────
  const cardsInfinite = createInfiniteQuery(() => ({
    queryKey: cardsQueryKey(),
    queryFn: async ({ pageParam }: { pageParam: number | undefined }) => {
      const query: Record<string, unknown> = { limit: PAGE_SIZE };
      if (pageParam != null) query.cursor = pageParam;
      const { data } = await api.cards['by-deck']({
        deckId: params.deckId,
      }).get({ query });
      const payload = data as any;
      const items = Array.isArray(payload) ? payload : (payload?.items ?? []);
      const sorted = (items as CardItem[]).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      return {
        items: sorted,
        total: payload?.total ?? sorted.length,
        nextCursor: payload?.nextCursor ?? null,
        hasMore: payload?.hasMore ?? false,
      } as CardsPage;
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage: CardsPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: !!params.deckId,
  }));

  // ── Local cards signal for optimistic updates (drag-drop reorder) ──
  const [localCards, setLocalCards] = createSignal<CardItem[]>([]);
  const [cardSyncPaused, setCardSyncPaused] = createSignal(false);

  // Sync infinite query pages → localCards whenever query data changes
  createEffect(() => {
    const syncPaused = cardSyncPaused();
    const pages = cardsInfinite.data?.pages;
    if (pages && !syncPaused) {
      setLocalCards(pages.flatMap((p) => p.items));
    }
  });

  const cards = localCards;
  const cardLoading = () => cardsInfinite.isLoading;
  const fetchingMore = () => cardsInfinite.isFetchingNextPage;

  const cardCount = () => {
    const pages = cardsInfinite.data?.pages;
    return pages?.[0]?.total ?? localCards().length;
  };

  const hasMore = () => cardsInfinite.hasNextPage ?? false;

  const fetchMore = () => {
    if (cardsInfinite.hasNextPage && !cardsInfinite.isFetchingNextPage) {
      cardsInfinite.fetchNextPage();
    }
  };

  const pauseCardSync = () => {
    setCardSyncPaused(true);
    return queryClient.cancelQueries({
      queryKey: cardsQueryKey(),
      exact: true,
    });
  };

  const resumeCardSync = () => {
    setCardSyncPaused(false);
  };

  const applyCardOrder = (orderedCards: CardItem[]) => {
    setLocalCards(orderedCards);
    queryClient.setQueryData<CardsInfiniteData>(
      cardsQueryKey(),
      (current) => {
        if (!current) return current;
        return {
          ...current,
          pages: replaceCardsAcrossPages(current.pages, orderedCards),
        };
      },
    );
  };

  const refetchCards = async () => {
    const invalidations: Promise<unknown>[] = [
      queryClient.invalidateQueries({
        queryKey: cardsQueryKey(),
        exact: true,
      }),
      queryClient.invalidateQueries({
        queryKey: memoryHealthKeys.deck(params.deckId),
      }),
    ];

    // Also invalidate folder's deck list so cardCount updates when navigating back
    const folderId = deck()?.folderId;
    if (folderId) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: ['decks', folderId] }),
      );
    }

    await Promise.all(invalidations);
  };

  // Resource-like accessors for backward compatibility
  const deck = () => deckQuery.data ?? null;
  const template = () => templateQuery.data ?? null;

  const sortedFields = createMemo(() =>
    [...(template()?.fields ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
  );

  return {
    params,
    deck,
    template,
    cards,
    cardLoading,
    cardCount,
    sortedFields,
    pauseCardSync,
    resumeCardSync,
    applyCardOrder,
    refetchCards,
    hasMore,
    fetchMore,
    fetchingMore,
  };
}
