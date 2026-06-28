import { type Component, For, Show, createMemo } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import PageShell from '@/components/layout/page-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import Skeleton from '@/components/ui/skeleton';
import { currentUser } from '@/stores/auth.store';
import { openSearch } from '@/stores/search.store';
import { api, getApiError } from '@/api/client';
import { toast } from '@/stores/toast.store';
import type {
  AggregateResponse,
  CommandActionRef,
  CommandCenterResponse,
  CommandCenterSections,
} from '../../../api/src/modules/experience/experience.types';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpen,
  Brain,
  CheckCircle2,
  Clock3,
  Command,
  Flame,
  Library,
  MailWarning,
  Plus,
  Search,
  Shuffle,
  Sparkles,
  TrendingDown,
  Zap,
} from 'lucide-solid';

type CommandCenterAggregate = AggregateResponse<
  CommandCenterResponse,
  CommandCenterSections
>;

const emptyQueue = {
  dueCount: 0,
  newCount: 0,
  learningCount: 0,
  atRiskCount: 0,
  nextAction: null,
};

const metricCopy = {
  due: {
    label: 'Due now',
    description: 'Ready for review',
  },
  new: {
    label: 'New cards',
    description: 'Waiting to start',
  },
  learning: {
    label: 'Learning',
    description: 'In active memory',
  },
  atRisk: {
    label: 'At risk',
    description: 'Review soon',
  },
} as const;

type DateLike = string | Date | null | undefined;

function parseDateLike(value: DateLike) {
  if (!value) return null;
  const date =
    value instanceof Date
      ? value
      : new Date(
          /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value,
        );
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShortDate(value: DateLike) {
  const date = parseDateLike(value);
  if (!date) return 'No activity yet';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatWeekday(value: DateLike) {
  return (
    parseDateLike(value)?.toLocaleDateString('en-US', { weekday: 'short' }) ??
    'Soon'
  );
}

function formatGeneratedAt(value: string | undefined) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function retentionLabel(value: number | null) {
  if (value === null) return 'No retention data';
  return `${Math.round(value * 100)}% retention`;
}

function forecastHeight(count: number, max: number) {
  if (max <= 0) return 8;
  return Math.max(8, Math.round((count / max) * 100));
}

const MetricTile: Component<{
  label: string;
  description: string;
  value: number;
  icon: Component<{ class?: string }>;
  tone: string;
}> = (props) => (
  <Card class="rounded-lg shadow-none">
    <CardContent class="flex items-center gap-3 p-4">
      <div
        class={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${props.tone}`}
      >
        <props.icon class="h-5 w-5" />
      </div>
      <div class="min-w-0">
        <p class="text-2xl font-semibold leading-none tabular-nums">
          {props.value.toLocaleString()}
        </p>
        <p class="mt-1 truncate text-sm font-medium">{props.label}</p>
        <p class="truncate text-xs text-muted-foreground">{props.description}</p>
      </div>
    </CardContent>
  </Card>
);

const SectionShell: Component<{
  title: string;
  icon: Component<{ class?: string }>;
  aside?: string;
  children: any;
}> = (props) => (
  <Card class="rounded-lg shadow-none">
    <CardHeader class="flex-row items-center justify-between gap-3 space-y-0 p-4 pb-2">
      <div class="flex items-center gap-2">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <props.icon class="h-4 w-4" />
        </div>
        <CardTitle class="text-sm font-semibold">{props.title}</CardTitle>
      </div>
      <Show when={props.aside}>
        <span class="text-xs text-muted-foreground">{props.aside}</span>
      </Show>
    </CardHeader>
    <CardContent class="p-4 pt-2">{props.children}</CardContent>
  </Card>
);

const DashboardPage: Component = () => {
  const navigate = useNavigate();

  const commandCenterQuery = createQuery(() => ({
    queryKey: ['experience-command-center', currentUser()?.id],
    queryFn: async () => {
      const { data, error } = await (api.dashboard as any)['command-center'].get();
      if (error) throw new Error(getApiError(error));
      return data as CommandCenterAggregate | null;
    },
    enabled: !!currentUser()?.id,
    staleTime: 30_000,
  }));

  const aggregate = () => commandCenterQuery.data;
  const center = () => aggregate()?.data ?? null;
  const queue = () => center()?.reviewQueue ?? emptyQueue;
  const dueDecks = () => center()?.dueDecks ?? [];
  const recentDecks = () => center()?.recent.decks ?? [];
  const recentCards = () => center()?.recent.cards ?? [];
  const weakAreas = () => center()?.weakAreas ?? [];
  const forecastDays = () => center()?.forecast?.days ?? [];
  const notifications = () => center()?.notifications ?? [];
  const pendingSuggestions = () => center()?.pendingSuggestions;

  const totalWork = createMemo(
    () =>
      queue().dueCount +
      queue().newCount +
      queue().learningCount +
      queue().atRiskCount,
  );
  const firstDueDeck = () => dueDecks()[0];
  const maxForecastRisk = createMemo(() =>
    Math.max(1, ...forecastDays().map((day) => day.atRiskCount)),
  );
  const degradedSections = createMemo(() =>
    Object.entries(aggregate()?.meta.sections ?? {}).filter(
      ([, meta]) => meta.status === 'error',
    ),
  );

  const startReview = () => {
    const deck = firstDueDeck();
    navigate(deck ? `/study/${deck.id}` : '/study/interleaved');
  };

  const runAction = (action: CommandActionRef | null | undefined) => {
    if (!action) {
      startReview();
      return;
    }

    if (action.id === 'study.queue') {
      startReview();
      return;
    }

    if (action.id === 'study.smart-group') {
      navigate('/study/interleaved');
      return;
    }

    navigate('/');
  };

  return (
    <PageShell maxWidth="max-w-7xl">
      <Show
        when={!commandCenterQuery.isLoading}
        fallback={
          <div class="space-y-4">
            <Skeleton shape="card" height="180px" />
            <div class="grid gap-3 md:grid-cols-4">
              <Skeleton shape="card" height="96px" />
              <Skeleton shape="card" height="96px" />
              <Skeleton shape="card" height="96px" />
              <Skeleton shape="card" height="96px" />
            </div>
            <div class="grid gap-4 lg:grid-cols-2">
              <Skeleton shape="card" height="260px" />
              <Skeleton shape="card" height="260px" />
            </div>
          </div>
        }
      >
        <div class="space-y-5 animate-fade-in">
          <Show when={currentUser() && !currentUser()!.emailVerified}>
            <div class="flex flex-col gap-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div class="flex min-w-0 items-start gap-2 sm:items-center">
                <MailWarning class="h-4 w-4 shrink-0 text-amber-500" />
                <p class="text-sm leading-5 text-foreground">
                  Please verify your email address. Check your inbox for the link.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="h-8 self-start text-amber-700 hover:text-amber-700 dark:text-amber-300 sm:self-auto"
                onClick={async () => {
                  try {
                    await (api.auth as any)['resend-verification'].post();
                    toast.success('Verification email sent');
                  } catch {
                    toast.error('Failed to resend. Try again later.');
                  }
                }}
              >
                Resend
              </Button>
            </div>
          </Show>

          <Show when={commandCenterQuery.error}>
            <div class="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Command center could not load. Refresh or try again later.
            </div>
          </Show>

          <Show when={degradedSections().length > 0}>
            <div class="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              <AlertTriangle class="h-4 w-4 shrink-0" />
              Some optional sections are temporarily unavailable.
            </div>
          </Show>

          <div class="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
            <Card class="overflow-hidden rounded-lg border-primary/20 bg-card shadow-none">
              <CardContent class="p-5 md:p-6">
                <div class="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                  <div class="max-w-2xl">
                    <div class="mb-3 flex flex-wrap items-center gap-2">
                      <Badge variant={totalWork() > 0 ? 'default' : 'secondary'}>
                        {totalWork() > 0 ? 'Review ready' : 'Clear queue'}
                      </Badge>
                      <span class="text-xs text-muted-foreground">
                        Updated {formatGeneratedAt(aggregate()?.meta.generatedAt)}
                      </span>
                    </div>
                    <h1 class="text-3xl font-semibold tracking-tight md:text-4xl">
                      <Show
                        when={totalWork() > 0}
                        fallback="Your memory system is calm today."
                      >
                        {queue().dueCount.toLocaleString()} cards are ready now.
                      </Show>
                    </h1>
                    <p class="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                      <Show
                        when={firstDueDeck()}
                        fallback="Build momentum by creating a deck or opening a recent card."
                      >
                        Start with {firstDueDeck()!.name}, then sweep the rest with
                        interleaved study.
                      </Show>
                    </p>
                  </div>

                  <div class="flex flex-col gap-2 sm:flex-row md:flex-col">
                    <Button
                      size="lg"
                      class="h-11 justify-between gap-3"
                      onClick={() => runAction(queue().nextAction)}
                    >
                      <span class="inline-flex items-center gap-2">
                        <Zap class="h-4 w-4" />
                        Start review
                      </span>
                      <ArrowRight class="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="lg"
                      class="h-11 justify-between gap-3 bg-background"
                      onClick={() => navigate(firstDueDeck() ? `/deck/${firstDueDeck()!.id}` : '/')}
                    >
                      <span class="inline-flex items-center gap-2">
                        <Plus class="h-4 w-4" />
                        Add cards
                      </span>
                      <ArrowRight class="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <SectionShell title="Quick Command" icon={Command} aside="Cmd K">
              <div class="space-y-3">
                <button
                  class="flex w-full items-center justify-between rounded-lg border bg-background px-3 py-2.5 text-left transition-colors hover:bg-accent"
                  onClick={openSearch}
                >
                  <span class="inline-flex items-center gap-2 text-sm font-medium">
                    <Search class="h-4 w-4 text-muted-foreground" />
                    Search cards, decks and actions
                  </span>
                  <span class="text-xs text-muted-foreground">Open</span>
                </button>
                <div class="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    class="justify-start bg-background"
                    onClick={() => navigate('/study/interleaved')}
                  >
                    <Shuffle class="h-4 w-4" />
                    Interleaved
                  </Button>
                  <Button
                    variant="outline"
                    class="justify-start bg-background"
                    onClick={() => navigate('/docs')}
                  >
                    <Sparkles class="h-4 w-4" />
                    Guides
                  </Button>
                </div>
              </div>
            </SectionShell>
          </div>

          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              label={metricCopy.due.label}
              description={metricCopy.due.description}
              value={queue().dueCount}
              icon={Clock3}
              tone="bg-sky-500/12 text-sky-600 dark:text-sky-300"
            />
            <MetricTile
              label={metricCopy.new.label}
              description={metricCopy.new.description}
              value={queue().newCount}
              icon={BookOpen}
              tone="bg-emerald-500/12 text-emerald-600 dark:text-emerald-300"
            />
            <MetricTile
              label={metricCopy.learning.label}
              description={metricCopy.learning.description}
              value={queue().learningCount}
              icon={Brain}
              tone="bg-violet-500/12 text-violet-600 dark:text-violet-300"
            />
            <MetricTile
              label={metricCopy.atRisk.label}
              description={metricCopy.atRisk.description}
              value={queue().atRiskCount}
              icon={TrendingDown}
              tone="bg-amber-500/12 text-amber-600 dark:text-amber-300"
            />
          </div>

          <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
            <SectionShell
              title="Review Queue"
              icon={Zap}
              aside={`${dueDecks().length} deck${dueDecks().length === 1 ? '' : 's'}`}
            >
              <Show
                when={dueDecks().length > 0}
                fallback={
                  <div class="rounded-lg border border-dashed p-6 text-center">
                    <CheckCircle2 class="mx-auto h-8 w-8 text-emerald-500" />
                    <p class="mt-2 text-sm font-medium">Nothing due right now</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                      Recent cards and new decks are still one command away.
                    </p>
                  </div>
                }
              >
                <div class="divide-y">
                  <For each={dueDecks()}>
                    {(deck) => (
                      <button
                        class="flex w-full items-center gap-3 py-3 text-left first:pt-0 last:pb-0"
                        onClick={() => navigate(`/study/${deck.id}`)}
                      >
                        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <BookOpen class="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-sm font-medium">{deck.name}</p>
                          <p class="text-xs text-muted-foreground">
                            {deck.dueCount} due, {deck.newCount} new, last studied{' '}
                            {formatShortDate(deck.lastStudiedAt)}
                          </p>
                        </div>
                        <Badge variant="secondary" class="shrink-0">
                          Study
                        </Badge>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </SectionShell>

            <SectionShell title="Forecast" icon={TrendingDown} aside="7 days">
              <Show
                when={forecastDays().length > 0}
                fallback={
                  <p class="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                    Forecast data will appear after more review history is available.
                  </p>
                }
              >
                <div class="space-y-4">
                  <div class="flex h-28 items-end gap-2">
                    <For each={forecastDays()}>
                      {(day, index) => (
                        <div class="flex flex-1 flex-col items-center gap-2">
                          <div class="flex h-20 w-full items-end justify-center rounded-md bg-muted/50 px-1">
                            <div
                              class="w-full max-w-6 rounded-t-sm bg-amber-500/75"
                              style={{
                                height: `${forecastHeight(day.atRiskCount, maxForecastRisk())}%`,
                              }}
                            />
                          </div>
                          <span
                            class={`text-[10px] ${index() === 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                          >
                            {index() === 0
                              ? 'Now'
                              : formatWeekday(day.date)}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                  <div class="space-y-2">
                    <For each={forecastDays().slice(0, 3)}>
                      {(day) => (
                        <div class="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-xs">
                          <span>{formatShortDate(day.date)}</span>
                          <span class="font-medium">
                            {day.atRiskCount} at risk,{' '}
                            {retentionLabel(day.avgRetention)}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </SectionShell>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <SectionShell title="Recent Work" icon={Library}>
              <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
                <div>
                  <p class="mb-2 text-xs font-medium text-muted-foreground">
                    Decks
                  </p>
                  <div class="space-y-1">
                    <For each={recentDecks().slice(0, 4)}>
                      {(deck) => (
                        <button
                          class="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                          onClick={() => navigate(`/deck/${deck.id}`)}
                        >
                          <span class="truncate">{deck.name}</span>
                          <span class="ml-3 shrink-0 text-xs text-muted-foreground">
                            {formatShortDate(deck.updatedAt)}
                          </span>
                        </button>
                      )}
                    </For>
                    <Show when={recentDecks().length === 0}>
                      <p class="px-2 py-3 text-sm text-muted-foreground">
                        No recent decks.
                      </p>
                    </Show>
                  </div>
                </div>
                <div>
                  <p class="mb-2 text-xs font-medium text-muted-foreground">
                    Cards
                  </p>
                  <div class="space-y-1">
                    <For each={recentCards().slice(0, 4)}>
                      {(card) => (
                        <button
                          class="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                          onClick={() =>
                            navigate(`/deck/${card.deckId}?cardId=${card.id}`)
                          }
                        >
                          <span class="truncate">{card.title || 'Untitled card'}</span>
                          <span class="ml-3 shrink-0 text-xs text-muted-foreground">
                            {formatShortDate(card.updatedAt)}
                          </span>
                        </button>
                      )}
                    </For>
                    <Show when={recentCards().length === 0}>
                      <p class="px-2 py-3 text-sm text-muted-foreground">
                        No recent cards.
                      </p>
                    </Show>
                  </div>
                </div>
              </div>
            </SectionShell>

            <SectionShell
              title="Weak Areas"
              icon={Flame}
              aside={`${weakAreas().length} topic${weakAreas().length === 1 ? '' : 's'}`}
            >
              <Show
                when={weakAreas().length > 0}
                fallback={
                  <p class="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                    Weak areas appear after enough reviews are recorded.
                  </p>
                }
              >
                <div class="space-y-2">
                  <For each={weakAreas().slice(0, 5)}>
                    {(area) => (
                      <button
                        class="flex w-full items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5 text-left hover:bg-accent"
                        onClick={() => runAction(area.action)}
                      >
                        <div class="min-w-0">
                          <p class="truncate text-sm font-medium capitalize">
                            {area.label}
                          </p>
                          <p class="text-xs text-muted-foreground">
                            {area.cardCount} card{area.cardCount === 1 ? '' : 's'}
                          </p>
                        </div>
                        <span class="shrink-0 text-xs font-medium text-muted-foreground">
                          {retentionLabel(area.avgRetention)}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </SectionShell>
          </div>

          <Show
            when={
              totalWork() === 0 &&
              recentDecks().length === 0 &&
              recentCards().length === 0
            }
          >
            <EmptyState
              icon={Library}
              title="Create your first deck"
              description="Start with a class and one deck. The command center will fill itself as you study."
              class="rounded-lg border bg-card/50"
            />
          </Show>

          <Show when={pendingSuggestions() || notifications().length > 0}>
            <div class="grid gap-3 md:grid-cols-2">
              <Show when={pendingSuggestions()}>
                {(suggestions) => (
                  <div class="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
                    <Sparkles class="h-4 w-4 text-muted-foreground" />
                    <span>
                      {suggestions().duplicates} duplicates and{' '}
                      {suggestions().aiSuggestions} AI suggestions queued.
                    </span>
                  </div>
                )}
              </Show>
              <Show when={notifications().length > 0}>
                <div class="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
                  <Bell class="h-4 w-4 text-muted-foreground" />
                  <span>{notifications().length} notification ready.</span>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </PageShell>
  );
};

export default DashboardPage;
