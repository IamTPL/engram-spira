import { createResource, createSignal, createMemo, batch } from 'solid-js';
import { useParams } from '@solidjs/router';
import { api } from '@/api/client';
import type { TemplateField, CardItem } from './types';

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

const PAGE_SIZE = 50;

export function useDeckData() {
  const params = useParams<{ deckId: string }>();

  const [deck] = createResource(
    () => params.deckId,
    async (deckId) => {
      const { data } = await (api.decks as any)[deckId].get();
      return data as DeckData | null;
    },
  );

  const [template] = createResource(
    () => deck()?.cardTemplateId,
    async (templateId) => {
      if (!templateId) return null;
      const { data } = await (api['card-templates'] as any)[templateId].get();
      return data as TemplateData | null;
    },
  );

  // ── Cursor-based pagination state ─────────────────────────────
  const [localCards, setLocalCards] = createSignal<CardItem[]>([]);
  const [totalCount, setTotalCount] = createSignal(0);
  const [nextCursor, setNextCursor] = createSignal<number | null>(null);
  const [hasMore, setHasMore] = createSignal(false);
  const [fetchingMore, setFetchingMore] = createSignal(false);

  // Initial page fetch (resets accumulator)
  const [cardsResource, { refetch: refetchCards }] = createResource(
    () => params.deckId,
    async (deckId) => {
      const { data } = await api.cards['by-deck']({ deckId }).get({
        query: { limit: PAGE_SIZE },
      });
      const payload = data as any;
      const items = Array.isArray(payload) ? payload : (payload?.items ?? []);
      const sorted = (items as CardItem[]).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );

      batch(() => {
        setLocalCards(sorted);
        setTotalCount(payload?.total ?? sorted.length);
        setNextCursor(payload?.nextCursor ?? null);
        setHasMore(payload?.hasMore ?? false);
      });

      return sorted;
    },
  );

  // Fetch next page and append to existing cards
  const fetchMore = async () => {
    const cursor = nextCursor();
    if (!hasMore() || cursor === null || fetchingMore()) return;

    setFetchingMore(true);
    try {
      const { data } = await api.cards['by-deck']({
        deckId: params.deckId,
      }).get({
        query: { limit: PAGE_SIZE, cursor },
      });
      const payload = data as any;
      const items = Array.isArray(payload) ? payload : (payload?.items ?? []);
      const sorted = (items as CardItem[]).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );

      batch(() => {
        setLocalCards((prev) => [...prev, ...sorted]);
        setNextCursor(payload?.nextCursor ?? null);
        setHasMore(payload?.hasMore ?? false);
      });
    } finally {
      setFetchingMore(false);
    }
  };

  const cards = localCards;
  const cardLoading = () => cardsResource.loading;

  const sortedFields = createMemo(() =>
    [...(template()?.fields ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
  );

  // Use server-reported total for accurate count
  const cardCount = () => totalCount();

  return {
    params,
    deck,
    template,
    cards,
    cardLoading,
    cardCount,
    sortedFields,
    localCards,
    setLocalCards,
    refetchCards,
    hasMore,
    fetchMore,
    fetchingMore,
  };
}
