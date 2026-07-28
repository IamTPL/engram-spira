import {
  For,
  Show,
  createMemo,
  createSignal,
  type Component,
} from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { useNavigate } from '@solidjs/router';
import {
  BrainCircuit,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock3,
  History,
  Play,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
} from 'lucide-solid';

import { api, getApiError } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { currentUser } from '@/stores/auth.store';
import {
  getMemoryHealthCalendarDate,
  getMemoryHealthPrimaryAction,
  getMemoryHealthPresentation,
  MEMORY_HEALTH_DETAILS_DAYS,
  memoryHealthKeys,
  shouldLoadMemoryHealthDetails,
  type MemoryHealthDate,
  type MemoryHealthDetails,
  type MemoryHealthOverview,
} from './memory-health-state';

interface MemoryHealthProps {
  deckId: string;
}

interface StatusMetricProps {
  label: string;
  count: number;
  description: string;
  tone: 'due' | 'risk' | 'success' | 'muted';
}

const STATUS_TONE_CLASSES = {
  due: 'border-due/25 bg-due/10 text-due',
  risk: 'border-risk/25 bg-risk/10 text-risk',
  success: 'border-success/25 bg-success-surface text-success',
  muted: 'border-border bg-muted/45 text-muted-foreground',
} as const;

const STATUS_SEGMENT_CLASSES = {
  due: 'bg-due',
  risk: 'bg-risk',
  success: 'bg-success',
  muted: 'bg-muted-foreground/35',
} as const;

const RATING_LABELS: Record<
  MemoryHealthDetails['recentReviews'][number]['rating'],
  string
> = {
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};

const RATING_BADGE_VARIANTS = {
  again: 'destructive',
  hard: 'warning',
  good: 'success',
  easy: 'info',
} as const;

const StatusMetric: Component<StatusMetricProps> = (props) => (
  <div
    class={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-lg border px-3 py-3 ${STATUS_TONE_CLASSES[props.tone]}`}
  >
    <dt class="text-xs font-medium">{props.label}</dt>
    <dd class="text-lg font-semibold tabular-nums text-foreground">
      {props.count}
    </dd>
    <dd class="col-span-2 mt-1 text-xs leading-relaxed text-muted-foreground">
      {props.description}
    </dd>
  </div>
);

const MemoryHealth: Component<MemoryHealthProps> = (props) => {
  const navigate = useNavigate();
  const [detailsExpanded, setDetailsExpanded] = createSignal(false);
  const userId = () => currentUser()?.id ?? '';

  const overviewQuery = createQuery(() => ({
    queryKey: memoryHealthKeys.overview(props.deckId, userId()),
    queryFn: async () => {
      const { data, error } = await api.study['retention-overview'].get({
        query: { deckId: props.deckId },
      });
      if (error || !data) {
        throw new Error(
          error ? getApiError(error) : 'Memory health is unavailable',
        );
      }
      return data as MemoryHealthOverview;
    },
    enabled: Boolean(props.deckId && userId()),
    staleTime: 60_000,
    retry: 1,
  }));

  const detailsQuery = createQuery(() => ({
    queryKey: memoryHealthKeys.details(
      props.deckId,
      userId(),
      MEMORY_HEALTH_DETAILS_DAYS,
    ),
    queryFn: async () => {
      const { data, error } = await api.study['retention-details'].get({
        query: {
          deckId: props.deckId,
          days: MEMORY_HEALTH_DETAILS_DAYS,
        },
      });
      if (error || !data) {
        throw new Error(
          error ? getApiError(error) : 'Review history is unavailable',
        );
      }
      return data as MemoryHealthDetails;
    },
    enabled: shouldLoadMemoryHealthDetails(
      detailsExpanded(),
      props.deckId,
      userId(),
    ),
    staleTime: 5 * 60_000,
    retry: 1,
  }));

  const primaryAction = createMemo(() => {
    const overview = overviewQuery.data;
    return overview
      ? getMemoryHealthPrimaryAction(props.deckId, overview)
      : null;
  });

  const presentation = createMemo(() => {
    const overview = overviewQuery.data;
    return overview ? getMemoryHealthPresentation(overview) : null;
  });

  const workloadMaximum = createMemo(() =>
    Math.max(1, ...(detailsQuery.data?.workload.map((day) => day.count) ?? [])),
  );

  const dailyOutcomeMaximum = createMemo(() =>
    Math.max(
      1,
      ...(detailsQuery.data?.dailyOutcomes.map((day) => day.total) ?? []),
    ),
  );

  return (
    <Show
      when={!overviewQuery.isLoading || overviewQuery.data}
      fallback={
        <div role="status" aria-busy="true" aria-label="Loading memory health">
          <Skeleton shape="card" height="320px" />
        </div>
      }
    >
      <Show
        when={overviewQuery.data}
        fallback={
          <section
            class="rounded-xl border bg-card p-5"
            aria-labelledby="memory-health-error-title"
          >
            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3
                  id="memory-health-error-title"
                  class="text-sm font-semibold text-foreground"
                >
                  Memory health unavailable
                </h3>
                <p class="mt-1 text-sm text-muted-foreground">
                  {overviewQuery.error instanceof Error
                    ? overviewQuery.error.message
                    : 'This data could not be loaded right now.'}
                </p>
              </div>
              <Button
                variant="outline"
                class="min-h-11"
                onClick={() => void overviewQuery.refetch()}
              >
                <RefreshCw class="h-4 w-4" />
                Try again
              </Button>
            </div>
          </section>
        }
      >
        {(overviewAccessor) => (
          <section
            class="overflow-hidden rounded-xl border bg-card shadow-xs"
            aria-labelledby="memory-health-title"
          >
            <Show when={overviewQuery.isFetching && !overviewQuery.isLoading}>
              <span class="sr-only" role="status">
                Refreshing memory health
              </span>
            </Show>
            <div class="border-b bg-muted/20 px-4 py-4 sm:px-5">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="flex min-w-0 items-start gap-3">
                  <div class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-card text-primary shadow-xs">
                    <BrainCircuit class="h-4.5 w-4.5" />
                  </div>
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <h3
                        id="memory-health-title"
                        class="text-sm font-semibold text-foreground"
                      >
                        Memory health
                      </h3>
                      <Badge
                        variant={
                          overviewAccessor().algorithm === 'fsrs'
                            ? 'info'
                            : 'muted'
                        }
                      >
                        {overviewAccessor().algorithm === 'fsrs'
                          ? 'FSRS prediction'
                          : 'SM-2 schedule'}
                      </Badge>
                    </div>
                    <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                      A practical next step based on your active study
                      algorithm—not a second scheduler.
                    </p>
                  </div>
                </div>
                <div class="shrink-0 text-left sm:text-right">
                  <p class="text-xs font-medium text-muted-foreground">
                    {presentation()!.metric.label}
                  </p>
                  <p class="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                    {presentation()!.metric.value}
                  </p>
                  <p class="mt-0.5 max-w-xs text-xs text-muted-foreground">
                    {presentation()!.metric.description}
                  </p>
                </div>
              </div>
            </div>

            <div class="space-y-5 p-4 sm:p-5">
              <Show when={overviewQuery.isError}>
                <div
                  role="status"
                  class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-muted-foreground"
                >
                  <span>
                    Could not refresh. Showing the last loaded memory data.
                  </span>
                  <button
                    type="button"
                    class="min-h-11 rounded-md px-3 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
                    onClick={() => void overviewQuery.refetch()}
                  >
                    Retry
                  </button>
                </div>
              </Show>

              <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div>
                  <p class="text-base font-semibold text-foreground">
                    {presentation()!.headline.title}
                  </p>
                  <p class="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {presentation()!.headline.description}
                  </p>
                  <Show
                    when={
                      overviewAccessor().metric.kind === 'predicted_recall' &&
                      overviewAccessor().metric.target !== null
                    }
                  >
                    <p class="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ShieldCheck class="h-3.5 w-3.5 text-info" />
                      FSRS target:{' '}
                      {Math.round(overviewAccessor().metric.target! * 100)}%
                      predicted recall at review time.
                    </p>
                  </Show>
                  <Show
                    when={overviewAccessor().metric.kind === 'schedule_status'}
                  >
                    <p class="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock3 class="h-3.5 w-3.5" />
                      SM-2 uses due dates; this view intentionally does not
                      invent a recall percentage.
                    </p>
                  </Show>
                </div>
                <Show when={primaryAction()}>
                  {(actionAccessor) => (
                    <Button
                      size="lg"
                      class="min-h-11 w-full lg:w-auto"
                      onClick={() => navigate(actionAccessor().href)}
                    >
                      <Play class="h-4 w-4" />
                      {actionAccessor().label}
                    </Button>
                  )}
                </Show>
              </div>

              <Show when={overviewAccessor().summary.total > 0}>
                <dl
                  class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
                  aria-label="Memory health status"
                >
                  <For each={presentation()!.counts}>
                    {(item) => (
                      <StatusMetric
                        label={item.label}
                        count={item.count}
                        description={item.description}
                        tone={item.tone}
                      />
                    )}
                  </For>
                </dl>

                <figure class="rounded-lg border bg-background/45 p-3">
                  <div
                    class="flex h-2.5 overflow-hidden rounded-full bg-muted"
                    aria-hidden="true"
                  >
                    <For each={presentation()!.distribution}>
                      {(item) => (
                        <div
                          class={STATUS_SEGMENT_CLASSES[item.tone]}
                          style={{ width: `${item.percentage}%` }}
                        />
                      )}
                    </For>
                  </div>
                  <figcaption>
                    <p class="mt-2 text-xs font-medium text-foreground">
                      All cards by current status
                    </p>
                    <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                      <For each={presentation()!.distribution}>
                        {(item) => (
                          <li class="inline-flex items-center gap-1.5">
                            <span
                              class={`h-2 w-2 rounded-full ${STATUS_SEGMENT_CLASSES[item.tone]}`}
                              aria-hidden="true"
                            />
                            <span>
                              {item.label}: {item.count}
                            </span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </figcaption>
                </figure>
              </Show>

              <Show when={overviewAccessor().summary.unavailable > 0}>
                <p class="rounded-lg border border-dashed bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                  {overviewAccessor().summary.unavailable}{' '}
                  {overviewAccessor().summary.unavailable === 1
                    ? 'reviewed card has'
                    : 'reviewed cards have'}{' '}
                  incomplete scheduling data, so no prediction is shown.
                </p>
              </Show>

              <Show when={presentation()!.attention.length > 0}>
                <div>
                  <div class="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h4 class="text-sm font-semibold text-foreground">
                        Needs attention
                      </h4>
                      <p class="mt-0.5 text-xs text-muted-foreground">
                        Due cards are included in the action above. At-risk
                        cards remain advisory until their scheduled time.
                      </p>
                    </div>
                    <span class="text-xs tabular-nums text-muted-foreground">
                      Showing {presentation()!.attention.length} of{' '}
                      {overviewAccessor().attentionTotal}
                    </span>
                  </div>
                  <div class="mt-3 grid gap-2 md:grid-cols-2">
                    <For each={presentation()!.attention}>
                      {(card) => (
                        <div class="flex min-h-12 items-center gap-3 rounded-lg border bg-background/55 px-3 py-2.5">
                          <div
                            class={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                              card.status === 'due'
                                ? 'bg-due/10 text-due'
                                : 'bg-risk/10 text-risk'
                            }`}
                          >
                            <Show
                              when={card.status === 'due'}
                              fallback={<TrendingDown class="h-4 w-4" />}
                            >
                              <CalendarClock class="h-4 w-4" />
                            </Show>
                          </div>
                          <div class="min-w-0 flex-1">
                            <p class="truncate text-sm font-medium text-foreground">
                              {card.label}
                            </p>
                            <p class="mt-0.5 text-xs text-muted-foreground">
                              {card.status === 'due'
                                ? `Due ${formatShortDate(card.nextReviewAt)}`
                                : `Scheduled ${formatShortDate(card.nextReviewAt)}`}
                            </p>
                          </div>
                          <div class="shrink-0 text-right">
                            <Badge
                              variant={card.status === 'due' ? 'due' : 'risk'}
                            >
                              {card.status === 'due' ? 'Due' : 'At risk'}
                            </Badge>
                            <Show when={card.retention !== null}>
                              <p class="mt-1 text-xs tabular-nums text-muted-foreground">
                                {Math.round(card.retention! * 100)}% estimate
                              </p>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>

            <Show when={overviewAccessor().summary.total > 0}>
              <div class="border-t">
                <button
                  type="button"
                  class="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/25 sm:px-5"
                  aria-expanded={detailsExpanded()}
                  aria-controls="memory-health-details"
                  onClick={() => setDetailsExpanded((expanded) => !expanded)}
                >
                  <span class="flex items-center gap-2">
                    <History class="h-4 w-4 text-muted-foreground" />
                    Review history and upcoming workload
                  </span>
                  <Show
                    when={detailsExpanded()}
                    fallback={<ChevronDown class="h-4 w-4" />}
                  >
                    <ChevronUp class="h-4 w-4" />
                  </Show>
                </button>

                <Show when={detailsExpanded()}>
                  <div
                    id="memory-health-details"
                    class="border-t bg-muted/15 p-4 sm:p-5"
                    aria-live="polite"
                  >
                    <Show
                      when={!detailsQuery.isLoading || detailsQuery.data}
                      fallback={
                        <div
                          class="space-y-3"
                          role="status"
                          aria-busy="true"
                          aria-label="Loading review history"
                        >
                          <Skeleton height="88px" />
                          <Skeleton height="144px" />
                        </div>
                      }
                    >
                      <Show
                        when={detailsQuery.data}
                        fallback={
                          <div class="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p class="text-sm font-medium text-foreground">
                                Review history unavailable
                              </p>
                              <p class="mt-1 text-xs text-muted-foreground">
                                {detailsQuery.error instanceof Error
                                  ? detailsQuery.error.message
                                  : 'Please try again.'}
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              class="min-h-11"
                              onClick={() => void detailsQuery.refetch()}
                            >
                              <RefreshCw class="h-4 w-4" />
                              Try again
                            </Button>
                          </div>
                        }
                      >
                        {(detailsAccessor) => (
                          <div class="space-y-6">
                            <Show
                              when={
                                detailsQuery.isFetching &&
                                !detailsQuery.isLoading
                              }
                            >
                              <span class="sr-only" role="status">
                                Refreshing review history
                              </span>
                            </Show>
                            <Show when={detailsQuery.isError}>
                              <div
                                role="status"
                                class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-muted-foreground"
                              >
                                <span>
                                  Could not refresh. Showing the last loaded
                                  history.
                                </span>
                                <button
                                  type="button"
                                  class="min-h-11 rounded-md px-3 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
                                  onClick={() => void detailsQuery.refetch()}
                                >
                                  Retry
                                </button>
                              </div>
                            </Show>

                            <p class="rounded-lg border border-info/20 bg-info/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                              <Show
                                when={overviewAccessor().algorithm === 'fsrs'}
                                fallback={
                                  <>
                                    SM-2 determines when a card is due. The
                                    history below shows your actual answers and
                                    scheduled workload without estimating
                                    memory strength.
                                  </>
                                }
                              >
                                FSRS estimates future recall from your review
                                history. The outcomes below are your actual
                                answers, so use them to check the prediction
                                against real study results.
                              </Show>
                            </p>

                            <div>
                              <div class="flex flex-wrap items-end justify-between gap-2">
                                <div>
                                  <h4 class="text-sm font-semibold text-foreground">
                                    Observed review outcomes
                                  </h4>
                                  <p class="mt-0.5 text-xs text-muted-foreground">
                                    Last {detailsAccessor().rangeDays} days.
                                    Hard, Good, and Easy count as recalled;
                                    Again counts as missed.
                                  </p>
                                </div>
                                <p class="text-sm font-semibold tabular-nums text-foreground">
                                  <Show
                                    when={
                                      detailsAccessor().outcomes.recallRate !==
                                      null
                                    }
                                    fallback="No reviews in this period"
                                  >
                                    {Math.round(
                                      detailsAccessor().outcomes.recallRate! *
                                        100,
                                    )}
                                    % recalled
                                  </Show>
                                </p>
                              </div>
                              <dl class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                <For
                                  each={
                                    [
                                      ['Again', detailsAccessor().outcomes.again],
                                      ['Hard', detailsAccessor().outcomes.hard],
                                      ['Good', detailsAccessor().outcomes.good],
                                      ['Easy', detailsAccessor().outcomes.easy],
                                    ] as const
                                  }
                                >
                                  {(item) => (
                                    <div class="rounded-lg border bg-card px-3 py-2">
                                      <dt class="text-xs text-muted-foreground">
                                        {item[0]}
                                      </dt>
                                      <dd class="mt-0.5 text-base font-semibold tabular-nums text-foreground">
                                        {item[1]}
                                      </dd>
                                    </div>
                                  )}
                                </For>
                              </dl>
                            </div>

                            <Show
                              when={detailsAccessor().dailyOutcomes.length > 0}
                            >
                              <div>
                                <h4 class="text-sm font-semibold text-foreground">
                                  Review activity
                                </h4>
                                <ul class="mt-3 space-y-2">
                                  <For
                                    each={detailsAccessor().dailyOutcomes.slice(
                                      -10,
                                    )}
                                  >
                                    {(day) => (
                                      <li class="grid grid-cols-[5rem_minmax(0,1fr)_3rem] items-center gap-3 text-xs">
                                        <span class="text-muted-foreground">
                                          {formatCompactDate(day.date)}
                                        </span>
                                        <div
                                          class="h-2 overflow-hidden rounded-full bg-muted"
                                          aria-label={`${day.total} reviews, ${day.recalled} recalled`}
                                        >
                                          <div
                                            class="h-full rounded-full bg-info"
                                            style={{
                                              width: `${Math.max(
                                                4,
                                                (day.total /
                                                  dailyOutcomeMaximum()) *
                                                  100,
                                              )}%`,
                                            }}
                                          />
                                        </div>
                                        <span class="text-right tabular-nums text-muted-foreground">
                                          {day.total}
                                        </span>
                                      </li>
                                    )}
                                  </For>
                                </ul>
                              </div>
                            </Show>

                            <div>
                              <div>
                                <h4 class="text-sm font-semibold text-foreground">
                                  Next 14 days
                                </h4>
                                <p class="mt-0.5 text-xs text-muted-foreground">
                                  Scheduled workload; overdue cards are included
                                  in today.
                                </p>
                              </div>
                              <ol
                                class="mt-4 grid grid-cols-7 gap-x-1 gap-y-3 sm:grid-cols-[repeat(14,minmax(0,1fr))]"
                                aria-label="Upcoming review workload by day"
                              >
                                <For each={detailsAccessor().workload}>
                                  {(day, index) => (
                                    <li
                                      class="flex min-w-0 flex-col items-center"
                                      aria-label={`${formatLongDate(day.date)}: ${day.count} scheduled reviews`}
                                    >
                                      <span class="mb-1 text-[10px] font-medium tabular-nums text-foreground">
                                        {day.count}
                                      </span>
                                      <div class="flex h-16 w-full items-end">
                                        <div
                                          class={`w-full min-w-1 rounded-sm ${
                                            day.count > 0
                                              ? index() === 0
                                                ? 'bg-due'
                                                : 'bg-info/75'
                                              : 'bg-muted'
                                          }`}
                                          style={{
                                            height: `${Math.max(
                                              4,
                                              (day.count /
                                                workloadMaximum()) *
                                                64,
                                            )}px`,
                                          }}
                                          aria-hidden="true"
                                        />
                                      </div>
                                      <span class="mt-1 text-[10px] tabular-nums text-muted-foreground">
                                        {index() === 0
                                          ? 'Today'
                                          : formatDayOfMonth(day.date)}
                                      </span>
                                    </li>
                                  )}
                                </For>
                              </ol>
                            </div>

                            <Show
                              when={detailsAccessor().recentReviews.length > 0}
                            >
                              <div>
                                <h4 class="text-sm font-semibold text-foreground">
                                  Recent reviews
                                </h4>
                                <ol class="mt-3 divide-y rounded-lg border bg-card">
                                  <For each={detailsAccessor().recentReviews}>
                                    {(review) => (
                                      <li class="flex min-h-12 items-center gap-3 px-3 py-2.5">
                                        <div class="min-w-0 flex-1">
                                          <p class="truncate text-sm font-medium text-foreground">
                                            {review.label}
                                          </p>
                                          <p class="mt-0.5 text-xs text-muted-foreground">
                                            {formatReviewTimestamp(
                                              review.reviewedAt,
                                            )}{' '}
                                            · {review.elapsedDays}d elapsed ·{' '}
                                            {review.scheduledDays}d scheduled
                                          </p>
                                        </div>
                                        <Badge
                                          variant={
                                            RATING_BADGE_VARIANTS[review.rating]
                                          }
                                        >
                                          {RATING_LABELS[review.rating]}
                                        </Badge>
                                      </li>
                                    )}
                                  </For>
                                </ol>
                              </div>
                            </Show>

                            <Show
                              when={
                                detailsAccessor().outcomes.total === 0 &&
                                detailsAccessor().recentReviews.length === 0
                              }
                            >
                              <div class="rounded-lg border border-dashed bg-card px-4 py-6 text-center">
                                <p class="text-sm font-medium text-foreground">
                                  No review history yet
                                </p>
                                <p class="mt-1 text-xs text-muted-foreground">
                                  Complete a study session to see outcomes and
                                  workload here.
                                </p>
                              </div>
                            </Show>
                          </div>
                        )}
                      </Show>
                    </Show>
                  </div>
                </Show>
              </div>
            </Show>
          </section>
        )}
      </Show>
    </Show>
  );
};

function formatShortDate(value: MemoryHealthDate): string {
  const date = getTimestampDate(value);
  if (!date) return 'date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatCompactDate(value: MemoryHealthDate): string {
  const date = getMemoryHealthCalendarDate(value);
  if (!date) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatLongDate(value: MemoryHealthDate): string {
  const date = getMemoryHealthCalendarDate(value);
  if (!date) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatDayOfMonth(value: MemoryHealthDate): string {
  const date = getMemoryHealthCalendarDate(value);
  return date ? String(date.getDate()).padStart(2, '0') : '--';
}

function formatReviewTimestamp(value: MemoryHealthDate): string {
  const date = getTimestampDate(value);
  if (!date) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getTimestampDate(value: MemoryHealthDate): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export default MemoryHealth;
