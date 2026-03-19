import { type Component, Show, For, createMemo } from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { api } from '@/api/client';
import { currentUser } from '@/stores/auth.store';
import Skeleton from '@/components/ui/skeleton';
import { AlertTriangle, TrendingDown } from 'lucide-solid';

interface ForecastDay {
  date: string;
  atRiskCount: number;
  avgRetention: number;
}

const FORECAST_DAYS = 14;

const ForecastWidget: Component = () => {
  const forecastQuery = createQuery(() => ({
    queryKey: ['forecast', currentUser()?.id],
    queryFn: async () => {
      const { data } = await (api.study as any).forecast.get({
        query: { days: FORECAST_DAYS },
      });
      return data as { forecast: ForecastDay[] } | null;
    },
    enabled: !!currentUser()?.id,
    staleTime: 5 * 60_000,
  }));

  const forecast = () => forecastQuery.data?.forecast ?? [];

  const maxAtRisk = createMemo(() => {
    const f = forecast();
    if (f.length === 0) return 1;
    return Math.max(1, ...f.map((d) => d.atRiskCount));
  });

  const todayAtRisk = createMemo(() => {
    const f = forecast();
    return f.length > 0 ? f[0].atRiskCount : 0;
  });

  const todayRetention = createMemo(() => {
    const f = forecast();
    return f.length > 0 ? f[0].avgRetention : 1;
  });

  const hasData = createMemo(() => {
    const f = forecast();
    return f.length > 0 && f.some((d) => d.atRiskCount > 0 || d.avgRetention < 1);
  });

  const barColor = (count: number): string => {
    const ratio = count / maxAtRisk();
    if (ratio >= 0.7) return 'bg-destructive/80';
    if (ratio >= 0.4) return 'bg-amber-500/80';
    return 'bg-palette-5/60';
  };

  const formatDate = (dateStr: string): string => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const shortDay = (dateStr: string, index: number): string => {
    if (index === 0) return 'Today';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2);
  };

  const retentionColor = (r: number): string => {
    if (r >= 0.9) return 'text-green-500';
    if (r >= 0.7) return 'text-amber-500';
    return 'text-destructive';
  };

  return (
    <Show when={!forecastQuery.isLoading} fallback={<Skeleton shape="card" height="180px" />}>
      <Show when={hasData()}>
        <div class="rounded-xl border bg-section-gradient p-5">
          {/* Header */}
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <TrendingDown class="h-4 w-4 text-muted-foreground" />
              <h3 class="text-sm font-semibold">Forgetting Forecast</h3>
            </div>
            <span class="text-xs text-muted-foreground">Next {FORECAST_DAYS} days</span>
          </div>

          {/* At-risk summary */}
          <Show when={todayAtRisk() > 0}>
            <div class="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-400/30">
              <AlertTriangle class="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <span class="text-xs font-medium">
                {todayAtRisk()} card{todayAtRisk() !== 1 ? 's' : ''} at risk of forgetting today
              </span>
              <span class={`ml-auto text-xs font-semibold tabular-nums ${retentionColor(todayRetention())}`}>
                {Math.round(todayRetention() * 100)}% avg
              </span>
            </div>
          </Show>

          {/* Bar chart */}
          <div class="flex items-end gap-1 h-24">
            <For each={forecast()}>
              {(day, index) => {
                const height = () => {
                  if (maxAtRisk() === 0) return 4;
                  return Math.max(4, (day.atRiskCount / maxAtRisk()) * 100);
                };
                return (
                  <div
                    class="flex-1 flex flex-col items-center gap-1 group"
                    title={`${formatDate(day.date)}: ${day.atRiskCount} at-risk, ${Math.round(day.avgRetention * 100)}% retention`}
                  >
                    <div class="w-full flex items-end justify-center" style={{ height: '80px' }}>
                      <div
                        class={`w-full max-w-[20px] rounded-t-sm transition-all duration-300 ${barColor(day.atRiskCount)} group-hover:opacity-80`}
                        style={{ height: `${height()}%` }}
                      />
                    </div>
                    <span class={`text-[9px] leading-none ${index() === 0 ? 'font-semibold text-foreground' : 'text-muted-foreground/60'}`}>
                      {shortDay(day.date, index())}
                    </span>
                  </div>
                );
              }}
            </For>
          </div>

          {/* Legend */}
          <div class="flex items-center gap-3 mt-3 justify-end">
            <div class="flex items-center gap-1">
              <div class="h-2 w-2 rounded-sm bg-palette-5/60" />
              <span class="text-[10px] text-muted-foreground">Low</span>
            </div>
            <div class="flex items-center gap-1">
              <div class="h-2 w-2 rounded-sm bg-amber-500/80" />
              <span class="text-[10px] text-muted-foreground">Medium</span>
            </div>
            <div class="flex items-center gap-1">
              <div class="h-2 w-2 rounded-sm bg-destructive/80" />
              <span class="text-[10px] text-muted-foreground">High</span>
            </div>
          </div>
        </div>
      </Show>
    </Show>
  );
};

export default ForecastWidget;
