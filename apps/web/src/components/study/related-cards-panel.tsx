import { type Component, Show, For, createSignal } from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { api } from '@/api/client';
import { currentUser } from '@/stores/auth.store';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, Link2, Sparkles } from 'lucide-solid';

interface RelatedCard {
  cardId: string;
  deckId: string;
  deckName: string;
  source: 'link' | 'semantic';
  similarity: number | null;
  linkType: string | null;
  fields: { fieldName: string; side: string; value: unknown }[];
}

interface RelatedCardsPanelProps {
  cardId: string | undefined;
  show: boolean;
}

const RelatedCardsPanel: Component<RelatedCardsPanelProps> = (props) => {
  const [expanded, setExpanded] = createSignal(true);

  const relatedQuery = createQuery(() => ({
    queryKey: ['related-cards', props.cardId, currentUser()?.id],
    queryFn: async () => {
      if (!props.cardId) return null;
      const { data } = await (api.study as any).recommendations[props.cardId].get({
        query: { limit: 5 },
      });
      return data as { related: RelatedCard[] } | null;
    },
    enabled: !!props.cardId && !!currentUser()?.id && props.show,
    staleTime: 60_000,
  }));

  const related = () => relatedQuery.data?.related ?? [];

  const getPreview = (card: RelatedCard): string => {
    const front = card.fields.find((f) => f.side === 'front');
    if (!front) return '';
    const val = front.value;
    if (typeof val === 'string') return val.slice(0, 80);
    if (val && typeof val === 'object' && 'text' in val)
      return String((val as { text: unknown }).text).slice(0, 80);
    return '';
  };

  return (
    <Show when={props.show && related().length > 0}>
      <div class="w-full max-w-lg mt-4 animate-fade-in">
        <button
          class="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
          onClick={() => setExpanded((v) => !v)}
        >
          <Show when={expanded()} fallback={<ChevronDown class="h-3.5 w-3.5" />}>
            <ChevronUp class="h-3.5 w-3.5" />
          </Show>
          Related cards ({related().length})
        </button>

        <Show when={expanded()}>
          <div class="space-y-1.5">
            <For each={related()}>
              {(card) => (
                <div class="flex items-center gap-3 px-3 py-2 rounded-lg border bg-card/50 text-sm">
                  <div class="shrink-0">
                    <Show
                      when={card.source === 'link'}
                      fallback={<Sparkles class="h-3.5 w-3.5 text-palette-5" />}
                    >
                      <Link2 class="h-3.5 w-3.5 text-muted-foreground" />
                    </Show>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-xs font-medium truncate">{getPreview(card)}</p>
                    <p class="text-[10px] text-muted-foreground truncate">
                      {card.deckName}
                      {card.linkType ? ` · ${card.linkType}` : ''}
                    </p>
                  </div>
                  <Show when={card.similarity !== null}>
                    <Badge variant="muted" class="text-[10px] shrink-0">
                      {Math.round(card.similarity! * 100)}%
                    </Badge>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default RelatedCardsPanel;
