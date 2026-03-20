import { type Component, Show, For, createMemo, createSignal } from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { api } from '@/api/client';
import { currentUser } from '@/stores/auth.store';
import Skeleton from '@/components/ui/skeleton';
import { Activity } from 'lucide-solid';
import { toast } from '@/stores/toast.store';

interface HeatmapCard {
  cardId: string;
  retention: number;
  lastReviewed: string | null;
  nextReview: string;
  stability: number | null;
}

interface RetentionHeatmapProps {
  deckId: string;
}

const RetentionHeatmap: Component<RetentionHeatmapProps> = (props) => {
  const [hoveredCard, setHoveredCard] = createSignal<{
    card: HeatmapCard;
    x: number;
    y: number;
  } | null>(null);

  const heatmapQuery = createQuery(() => ({
    queryKey: ['retention-heatmap', props.deckId, currentUser()?.id],
    queryFn: async () => {
      const { data } = await (api.study as any)['retention-heatmap'].get({
        query: { deckId: props.deckId },
      });
      return data as { cards: HeatmapCard[] } | null;
    },
    enabled: !!props.deckId && !!currentUser()?.id,
    staleTime: 2 * 60_000,
  }));

  const cards = () => heatmapQuery.data?.cards ?? [];

  const avgRetention = createMemo(() => {
    const c = cards();
    if (c.length === 0) return null;
    const sum = c.reduce((s, card) => s + card.retention, 0);
    return Math.round((sum / c.length) * 100);
  });

  const retentionBuckets = createMemo(() => {
    const c = cards();
    const high = c.filter((card) => card.retention >= 0.8).length;
    const medium = c.filter((card) => card.retention >= 0.5 && card.retention < 0.8).length;
    const low = c.filter((card) => card.retention < 0.5).length;
    return { high, medium, low };
  });

  const cellColor = (retention: number): string => {
    if (retention >= 0.9) return 'bg-green-500/80';
    if (retention >= 0.8) return 'bg-green-500/50';
    if (retention >= 0.7) return 'bg-green-500/30';
    if (retention >= 0.6) return 'bg-amber-500/50';
    if (retention >= 0.5) return 'bg-amber-500/30';
    if (retention >= 0.3) return 'bg-destructive/40';
    return 'bg-destructive/70';
  };

  const retentionPct = (r: number) => `${Math.round(r * 100)}%`;

  const handleCellClick = (card: HeatmapCard) => {
    if (card.retention < 0.5) {
      toast.info('⚡ This card needs review! Consider studying it soon.');
    }
  };

  const handleCellHover = (card: HeatmapCard, event: MouseEvent) => {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const parent = target.closest('.rounded-xl') as HTMLElement;
    const parentRect = parent?.getBoundingClientRect() ?? rect;
    setHoveredCard({
      card,
      x: rect.left - parentRect.left + rect.width / 2,
      y: rect.top - parentRect.top,
    });
  };

  return (
    <Show when={!heatmapQuery.isLoading} fallback={<Skeleton shape="card" height="140px" />}>
      <Show when={cards().length > 0}>
        <div class="rounded-xl border bg-card p-4 relative">
          {/* Header */}
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <Activity class="h-4 w-4 text-muted-foreground" />
              <h3 class="text-sm font-semibold">Retention Map</h3>
            </div>
            <Show when={avgRetention() !== null}>
              <span class={`text-xs font-semibold tabular-nums ${
                avgRetention()! >= 80 ? 'text-green-500'
                  : avgRetention()! >= 60 ? 'text-amber-500'
                  : 'text-destructive'
              }`}>
                {avgRetention()}% avg
              </span>
            </Show>
          </div>

          {/* Grid */}
          <div class="flex flex-wrap gap-1">
            <For each={cards()}>
              {(card) => (
                <div
                  class={`h-4 w-4 rounded-sm transition-all ${cellColor(card.retention)} hover:scale-150 hover:z-10 ${card.retention < 0.5 ? 'cursor-pointer' : 'cursor-default'}`}
                  onClick={() => handleCellClick(card)}
                  onMouseEnter={(e) => handleCellHover(card, e)}
                  onMouseLeave={() => setHoveredCard(null)}
                />
              )}
            </For>
          </div>

          {/* Hover tooltip */}
          <Show when={hoveredCard()}>
            <div
              class="absolute z-20 bg-card border rounded-lg px-3 py-2 shadow-lg text-xs pointer-events-none whitespace-nowrap"
              style={{
                left: `${hoveredCard()!.x}px`,
                top: `${hoveredCard()!.y - 50}px`,
                transform: 'translateX(-50%)',
              }}
            >
              <p class="font-semibold tabular-nums">
                Retention: {retentionPct(hoveredCard()!.card.retention)}
              </p>
              <Show when={hoveredCard()!.card.lastReviewed}>
                <p class="text-muted-foreground mt-0.5">
                  Last: {new Date(hoveredCard()!.card.lastReviewed!).toLocaleDateString()}
                </p>
              </Show>
              <Show when={hoveredCard()!.card.retention < 0.5}>
                <p class="text-destructive mt-0.5 text-[10px]">Click to review</p>
              </Show>
            </div>
          </Show>

          {/* Summary row */}
          <div class="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
            <div class="flex items-center gap-1">
              <div class="h-2.5 w-2.5 rounded-sm bg-green-500/60" />
              <span>Strong ({retentionBuckets().high})</span>
            </div>
            <div class="flex items-center gap-1">
              <div class="h-2.5 w-2.5 rounded-sm bg-amber-500/50" />
              <span>Fading ({retentionBuckets().medium})</span>
            </div>
            <div class="flex items-center gap-1">
              <div class="h-2.5 w-2.5 rounded-sm bg-destructive/50" />
              <span>Weak ({retentionBuckets().low})</span>
            </div>
          </div>
        </div>
      </Show>
    </Show>
  );
};

export default RetentionHeatmap;
