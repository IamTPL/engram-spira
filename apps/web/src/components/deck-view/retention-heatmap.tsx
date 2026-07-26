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
  let containerRef: HTMLElement | undefined;
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
    if (retention >= 0.9) return 'bg-success';
    if (retention >= 0.8) return 'bg-success/75';
    if (retention >= 0.7) return 'bg-success/50';
    if (retention >= 0.6) return 'bg-warning';
    if (retention >= 0.5) return 'bg-warning/65';
    if (retention >= 0.3) return 'bg-destructive/60';
    return 'bg-destructive';
  };

  const retentionPct = (r: number) => `${Math.round(r * 100)}%`;

  const handleCellClick = (card: HeatmapCard) => {
    if (card.retention < 0.5) {
      toast.info('This card needs review. Consider studying it soon.');
    }
  };

  const showCellTooltip = (card: HeatmapCard, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const parentRect = containerRef?.getBoundingClientRect() ?? rect;
    setHoveredCard({
      card,
      x: rect.left - parentRect.left + rect.width / 2,
      y: rect.top - parentRect.top,
    });
  };

  return (
    <Show
      when={!heatmapQuery.isLoading}
      fallback={<Skeleton shape="card" height="156px" />}
    >
      <Show
        when={!heatmapQuery.isError}
        fallback={
          <section class="rounded-lg border bg-card p-5">
            <h3 class="text-sm font-semibold text-foreground">
              Retention map unavailable
            </h3>
            <p class="mt-1 text-sm text-muted-foreground">
              Retention data could not be loaded right now.
            </p>
          </section>
        }
      >
        <section
          ref={containerRef}
          class="relative rounded-lg border bg-card p-4 sm:p-5"
          aria-labelledby="retention-map-title"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-center gap-2">
              <Activity class="h-4 w-4 text-muted-foreground" />
              <div>
                <h3
                  id="retention-map-title"
                  class="text-sm font-semibold text-foreground"
                >
                  Retention map
                </h3>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  Memory strength across reviewed cards
                </p>
              </div>
            </div>
            <Show when={avgRetention() !== null}>
              <span
                class={`shrink-0 text-sm font-semibold tabular-nums ${
                  avgRetention()! >= 80
                    ? 'text-success'
                    : avgRetention()! >= 60
                      ? 'text-warning'
                      : 'text-destructive'
                }`}
              >
                {avgRetention()}% average
              </span>
            </Show>
          </div>

          <Show
            when={cards().length > 0}
            fallback={
              <div class="mt-4 rounded-md border border-dashed bg-muted/35 px-4 py-6 text-center">
                <p class="text-sm font-medium text-foreground">
                  No retention data yet
                </p>
                <p class="mt-1 text-xs text-muted-foreground">
                  Review cards to build a retention history.
                </p>
              </div>
            }
          >
            <div
              class="mt-4 flex flex-wrap gap-1.5"
              aria-label="Card retention values"
            >
              <For each={cards()}>
                {(card) => (
                  <button
                    type="button"
                    class={`h-4 w-4 rounded-sm ring-offset-card transition-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-safe:hover:scale-125 ${cellColor(
                      card.retention,
                    )} ${
                      card.retention < 0.5
                        ? 'cursor-pointer'
                        : 'cursor-default'
                    }`}
                    onClick={() => handleCellClick(card)}
                    onMouseEnter={(e) =>
                      showCellTooltip(card, e.currentTarget)
                    }
                    onMouseLeave={() => setHoveredCard(null)}
                    onFocus={(e) => showCellTooltip(card, e.currentTarget)}
                    onBlur={() => setHoveredCard(null)}
                    aria-label={`Retention ${retentionPct(card.retention)}${
                      card.lastReviewed
                        ? `, last reviewed ${new Date(
                            card.lastReviewed,
                          ).toLocaleDateString()}`
                        : ''
                    }`}
                    aria-describedby={
                      hoveredCard()?.card.cardId === card.cardId
                        ? 'retention-cell-tooltip'
                        : undefined
                    }
                  />
                )}
              </For>
            </div>

            <Show when={hoveredCard()}>
              <div
                id="retention-cell-tooltip"
                role="tooltip"
                class="pointer-events-none absolute z-20 whitespace-nowrap rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
                style={{
                  left: `${hoveredCard()!.x}px`,
                  top: `${hoveredCard()!.y - 54}px`,
                  transform: 'translateX(-50%)',
                }}
              >
                <p class="font-semibold tabular-nums">
                  Retention: {retentionPct(hoveredCard()!.card.retention)}
                </p>
                <Show when={hoveredCard()!.card.lastReviewed}>
                  <p class="mt-0.5 text-muted-foreground">
                    Last review:{' '}
                    {new Date(
                      hoveredCard()!.card.lastReviewed!,
                    ).toLocaleDateString()}
                  </p>
                </Show>
                <Show when={hoveredCard()!.card.retention < 0.5}>
                  <p class="mt-0.5 text-destructive">Needs review</p>
                </Show>
              </div>
            </Show>

            <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <div class="flex items-center gap-1.5">
                <div class="h-2.5 w-2.5 rounded-sm bg-success" />
                <span>Strong ({retentionBuckets().high})</span>
              </div>
              <div class="flex items-center gap-1.5">
                <div class="h-2.5 w-2.5 rounded-sm bg-warning" />
                <span>Fading ({retentionBuckets().medium})</span>
              </div>
              <div class="flex items-center gap-1.5">
                <div class="h-2.5 w-2.5 rounded-sm bg-destructive" />
                <span>Weak ({retentionBuckets().low})</span>
              </div>
            </div>
          </Show>
        </section>
      </Show>
    </Show>
  );
};

export default RetentionHeatmap;
