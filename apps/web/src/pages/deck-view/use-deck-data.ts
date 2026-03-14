import { createResource, createSignal, createEffect, createMemo } from 'solid-js';
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

  const [cardsResource, { refetch: refetchCards }] = createResource(
    () => params.deckId,
    async (deckId) => {
      const { data } = await api.cards['by-deck']({ deckId }).get();
      const list = Array.isArray(data) ? data : ((data as any)?.items ?? []);
      return (list as CardItem[]).sort((a, b) => a.sortOrder - b.sortOrder);
    },
  );

  // Local signal for card list — allows optimistic reorder updates
  const [localCards, setLocalCards] = createSignal<CardItem[]>([]);

  // Sync local signal whenever the resource loads/refetches
  createEffect(() => {
    const data = cardsResource();
    if (data) setLocalCards(data);
  });

  const cards = localCards;
  const cardLoading = () => cardsResource.loading;

  const sortedFields = createMemo(() =>
    [...(template()?.fields ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
  );

  const cardCount = () => localCards().length;

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
  };
}
