import { type Component, Show, For } from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { api } from '@/api/client';
import { currentUser } from '@/stores/auth.store';
import { Progress } from '@/components/ui/progress';
import Skeleton from '@/components/ui/skeleton';
import { Layers } from 'lucide-solid';

interface SmartGroup {
  name: string;
  cardCount: number;
  avgRetention: number | null;
  sampleCardIds: string[];
}

const SmartGroupsWidget: Component = () => {
  const groupsQuery = createQuery(() => ({
    queryKey: ['smart-groups', currentUser()?.id],
    queryFn: async () => {
      const { data } = await (api.study as any)['smart-groups'].get({
        query: { topN: 5 },
      });
      return data as { groups: SmartGroup[] } | null;
    },
    enabled: !!currentUser()?.id,
    staleTime: 5 * 60_000,
  }));

  const groups = () => groupsQuery.data?.groups ?? [];

  const retentionVariant = (r: number | null): 'success' | 'warning' | 'destructive' | 'default' => {
    if (r === null) return 'default';
    if (r >= 0.8) return 'success';
    if (r >= 0.6) return 'warning';
    return 'destructive';
  };

  const retentionLabel = (r: number | null): string => {
    if (r === null) return 'No data';
    return `${Math.round(r * 100)}%`;
  };

  return (
    <Show when={!groupsQuery.isLoading} fallback={<Skeleton shape="card" height="120px" />}>
      <Show when={groups().length > 0}>
        <div class="rounded-xl border bg-section-gradient p-5">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <Layers class="h-4 w-4 text-muted-foreground" />
              <h3 class="text-sm font-semibold">Knowledge Areas</h3>
            </div>
            <span class="text-xs text-muted-foreground">
              {groups().length} topic{groups().length !== 1 ? 's' : ''}
            </span>
          </div>

          <div class="space-y-3">
            <For each={groups()}>
              {(group) => (
                <div class="flex items-center gap-3">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between mb-1">
                      <span class="text-sm font-medium capitalize truncate">
                        {group.name}
                      </span>
                      <span class="text-xs text-muted-foreground shrink-0 ml-2">
                        {group.cardCount} card{group.cardCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div class="flex items-center gap-2">
                      <Progress
                        value={group.avgRetention !== null ? group.avgRetention * 100 : 0}
                        variant={retentionVariant(group.avgRetention)}
                        size="sm"
                        class="flex-1"
                      />
                      <span class={`text-[10px] font-medium tabular-nums shrink-0 w-10 text-right ${
                        group.avgRetention === null
                          ? 'text-muted-foreground'
                          : group.avgRetention >= 0.8
                            ? 'text-green-500'
                            : group.avgRetention >= 0.6
                              ? 'text-amber-500'
                              : 'text-destructive'
                      }`}>
                        {retentionLabel(group.avgRetention)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </Show>
  );
};

export default SmartGroupsWidget;
