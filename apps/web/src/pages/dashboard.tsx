import { type Component, For, Show, createMemo, createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import PageShell from '@/components/layout/page-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import Skeleton from '@/components/ui/skeleton';
import {
  currentUser,
  resendVerificationEmail,
} from '@/stores/auth.store';
import {
  durationMin,
  getStats,
  isRunning,
  openFocusDrawer,
  remainingSeconds,
} from '@/stores/focus.store';
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
  Flame,
  Library,
  MailWarning,
  Plus,
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

function formatFocusClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
}

const MetricSegment: Component<{
  label: string;
  description: string;
  value: number;
  icon: Component<{ class?: string }>;
  tone: string;
  divider: string;
}> = (props) => (
  <div class={`min-w-0 p-4 md:p-5 ${props.divider}`}>
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-medium text-muted-foreground">{props.label}</p>
        <p class="mt-1 text-2xl font-semibold leading-none tracking-tight tabular-nums">
          {props.value.toLocaleString()}
        </p>
        <p class="mt-1 hidden truncate text-xs text-muted-foreground md:block">
          {props.description}
        </p>
      </div>
      <div
        class={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${props.tone}`}
      >
        <props.icon class="h-4 w-4" />
      </div>
    </div>
  </div>
);

const SectionShell: Component<{
  title: string;
  icon: Component<{ class?: string }>;
  aside?: string;
  children: any;
}> = (props) => (
  <Card class="min-w-0 overflow-hidden rounded-xl shadow-none">
    <CardHeader class="flex-row items-center justify-between gap-3 space-y-0 p-5 pb-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <props.icon class="h-4 w-4 shrink-0 text-muted-foreground" />
        <CardTitle class="text-sm font-semibold">{props.title}</CardTitle>
      </div>
      <Show when={props.aside}>
        <span class="shrink-0 text-xs text-muted-foreground">{props.aside}</span>
      </Show>
    </CardHeader>
    <CardContent class="p-5 pt-0">{props.children}</CardContent>
  </Card>
);

const DashboardPage: Component = () => {
  const navigate = useNavigate();
  const [isResendingVerification, setIsResendingVerification] =
    createSignal(false);

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
  const focusStats = createMemo(() => getStats());
  const focusTimeLabel = () =>
    isRunning()
      ? formatFocusClock(remainingSeconds())
      : `${Math.round(durationMin())} min`;

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

  const handleResendVerification = async () => {
    if (isResendingVerification()) return;

    setIsResendingVerification(true);
    try {
      const result = await resendVerificationEmail();
      if (result.alreadyVerified) {
        toast.info('Your email is already verified.');
        return;
      }

      toast.success(
        'Verification request is being processed. Check your Inbox or Spam folder shortly.',
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Failed to resend verification email. Please try again.',
      );
    } finally {
      setIsResendingVerification(false);
    }
  };

  return (
    <PageShell maxWidth="max-w-7xl">
      <Show
        when={!commandCenterQuery.isLoading}
        fallback={
          <div class="space-y-5">
            <div class="space-y-2">
              <Skeleton width="92px" height="24px" />
              <Skeleton width="260px" height="16px" />
            </div>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
              <Skeleton shape="card" height="230px" />
              <Skeleton shape="card" height="230px" />
            </div>
            <Skeleton shape="card" height="112px" />
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Skeleton shape="card" height="260px" />
              <Skeleton shape="card" height="260px" />
            </div>
          </div>
        }
      >
        <div class="space-y-5 animate-fade-in">
          <header class="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 class="text-xl font-semibold tracking-tight md:text-2xl">Today</h1>
              <p class="mt-1 text-sm text-muted-foreground">
                Review what needs attention and keep your learning rhythm steady.
              </p>
            </div>
            <Show when={formatGeneratedAt(aggregate()?.meta.generatedAt)}>
              <span class="mt-1 text-xs text-muted-foreground md:mt-0">
                Updated {formatGeneratedAt(aggregate()?.meta.generatedAt)}
              </span>
            </Show>
          </header>

          <Show when={currentUser() && !currentUser()!.emailVerified}>
            <div class="flex flex-col gap-3 rounded-lg border border-risk/30 bg-risk-surface px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div class="flex min-w-0 items-start gap-2 md:items-center">
                <MailWarning class="h-4 w-4 shrink-0 text-risk" />
                <p class="text-sm leading-5 text-foreground">
                  Please verify your email address. Check your inbox for the link.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="h-8 self-start text-risk hover:text-risk md:self-auto"
                loading={isResendingVerification()}
                disabled={isResendingVerification()}
                onClick={handleResendVerification}
              >
                Resend
              </Button>
            </div>
          </Show>

          <Show when={commandCenterQuery.error}>
            <div class="rounded-lg border border-destructive/30 bg-destructive-surface px-4 py-3 text-sm text-destructive">
              Command center could not load. Refresh or try again later.
            </div>
          </Show>

          <Show when={degradedSections().length > 0}>
            <div class="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              <AlertTriangle class="h-4 w-4 shrink-0" />
              Some optional sections are temporarily unavailable.
            </div>
          </Show>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
            <Card class="overflow-hidden rounded-xl border-hero-border bg-hero text-hero-foreground shadow-none">
              <CardContent class="flex h-full flex-col p-5 md:p-6">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    class="border-hero-border bg-hero-subtle text-hero-foreground"
                  >
                    {totalWork() > 0 ? 'Review ready' : 'Queue clear'}
                  </Badge>
                  <span class="text-xs text-hero-muted">
                    {dueDecks().length} deck{dueDecks().length === 1 ? '' : 's'} in
                    queue
                  </span>
                </div>

                <div class="mt-7 max-w-2xl md:mt-9">
                  <h2 class="text-3xl font-semibold tracking-tight text-hero-foreground md:text-4xl">
                    <Show
                      when={totalWork() > 0}
                      fallback="You are caught up for now."
                    >
                      {totalWork().toLocaleString()} cards need your attention
                    </Show>
                  </h2>
                  <p class="mt-3 max-w-xl text-sm leading-6 text-hero-muted">
                    <Show
                      when={firstDueDeck()}
                      fallback="Build momentum by adding cards or starting an interleaved session."
                    >
                      Start with {firstDueDeck()!.name}, then continue with
                      interleaved study.
                    </Show>
                  </p>
                </div>

                <div class="mt-auto flex flex-col gap-2 pt-7 md:flex-row">
                  <Button
                    size="lg"
                    class="h-11 w-full justify-between gap-4 bg-hero-foreground text-hero hover:bg-hero-foreground/90 md:w-auto"
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
                    class="h-11 w-full gap-2 border-hero-border bg-transparent text-hero-foreground hover:bg-hero-subtle hover:text-hero-foreground md:w-auto"
                    onClick={() =>
                      navigate(firstDueDeck() ? `/deck/${firstDueDeck()!.id}` : '/')
                    }
                  >
                    <Plus class="h-4 w-4" />
                    Add cards
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card class="rounded-xl shadow-none">
              <CardContent class="flex h-full flex-col p-5 pt-5 sm:p-5 sm:pt-5">
                <div class="flex items-start justify-between gap-3">
                  <div class="flex min-w-0 items-center gap-2.5">
                    <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                      <Clock3 class="h-4 w-4" />
                    </div>
                    <div class="min-w-0">
                      <h2 class="text-sm font-semibold">Focus session</h2>
                      <p class="text-xs text-muted-foreground">
                        {isRunning() ? 'Timer in progress' : 'Ready when you are'}
                      </p>
                    </div>
                  </div>
                  <Badge variant={isRunning() ? 'default' : 'secondary'}>
                    {isRunning() ? 'Running' : 'Ready'}
                  </Badge>
                </div>

                <div class="mt-6">
                  <p class="text-3xl font-semibold tracking-tight tabular-nums">
                    {focusTimeLabel()}
                  </p>
                  <p class="mt-1 text-xs text-muted-foreground">
                    Complete a session to roll for a reward.
                  </p>
                </div>

                <Button
                  variant="outline"
                  class="mt-5 w-full justify-between"
                  onClick={openFocusDrawer}
                >
                  {isRunning() ? 'Continue focus' : 'Open focus'}
                  <ArrowRight class="h-4 w-4" />
                </Button>

                <div class="mt-5 grid grid-cols-3 border-t pt-4">
                  <div class="pr-2">
                    <p class="text-sm font-semibold tabular-nums">
                      {focusStats().todayMinutes}
                    </p>
                    <p class="mt-0.5 text-[11px] text-muted-foreground">Minutes</p>
                  </div>
                  <div class="border-l px-3">
                    <p class="text-sm font-semibold tabular-nums">
                      {focusStats().todaySessions}
                    </p>
                    <p class="mt-0.5 text-[11px] text-muted-foreground">Sessions</p>
                  </div>
                  <div class="border-l pl-3">
                    <p class="text-sm font-semibold tabular-nums">
                      {focusStats().streak}
                    </p>
                    <p class="mt-0.5 text-[11px] text-muted-foreground">Streak</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div class="grid grid-cols-2 overflow-hidden rounded-xl border bg-card md:grid-cols-4">
            <MetricSegment
              label={metricCopy.due.label}
              description={metricCopy.due.description}
              value={queue().dueCount}
              icon={Clock3}
              tone="bg-due-fill text-due-fill-foreground"
              divider="border-b md:border-b-0"
            />
            <MetricSegment
              label={metricCopy.new.label}
              description={metricCopy.new.description}
              value={queue().newCount}
              icon={BookOpen}
              tone="bg-new-fill text-new-fill-foreground"
              divider="border-b border-l md:border-b-0"
            />
            <MetricSegment
              label={metricCopy.learning.label}
              description={metricCopy.learning.description}
              value={queue().learningCount}
              icon={Brain}
              tone="bg-learning-fill text-learning-fill-foreground"
              divider="md:border-l"
            />
            <MetricSegment
              label={metricCopy.atRisk.label}
              description={metricCopy.atRisk.description}
              value={queue().atRiskCount}
              icon={TrendingDown}
              tone="bg-risk-fill text-risk-fill-foreground"
              divider="border-l"
            />
          </div>

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.75fr)]">
            <SectionShell
              title="Review Queue"
              icon={Zap}
              aside={`${dueDecks().length} deck${dueDecks().length === 1 ? '' : 's'}`}
            >
              <Show
                when={dueDecks().length > 0}
                fallback={
                  <div class="rounded-lg border border-dashed p-6 text-center">
                    <CheckCircle2 class="mx-auto h-8 w-8 text-new" />
                    <p class="mt-2 text-sm font-medium">Nothing due right now</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                      Add new cards or return when the next review is due.
                    </p>
                  </div>
                }
              >
                <div class="divide-y">
                  <For each={dueDecks()}>
                    {(deck) => (
                      <button
                        class="group flex min-h-14 w-full items-center gap-3 py-3 text-left first:pt-0 last:pb-0"
                        onClick={() => navigate(`/study/${deck.id}`)}
                      >
                        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-due-fill text-due-fill-foreground">
                          <BookOpen class="h-4 w-4" />
                        </div>
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-sm font-medium">{deck.name}</p>
                          <p class="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
                            <span class="font-medium text-due">
                              {deck.dueCount} due
                            </span>
                            <span class="font-medium text-new">
                              {deck.newCount} new
                            </span>
                            <span class="hidden md:inline">
                              Last studied {formatShortDate(deck.lastStudiedAt)}
                            </span>
                          </p>
                        </div>
                        <ArrowRight class="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
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
                          <div class="flex h-20 w-full items-end justify-center rounded-md bg-muted/80 px-1 ring-1 ring-inset ring-border/50">
                            <div
                              class="w-full max-w-6 rounded-t-sm bg-due-fill ring-1 ring-inset ring-foreground/10"
                              style={{
                                height: `${forecastHeight(day.atRiskCount, maxForecastRisk())}%`,
                              }}
                            />
                          </div>
                          <span
                            class={`text-[11px] ${index() === 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
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
                        <div class="flex flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2 text-xs md:flex-row md:items-center md:justify-between">
                          <span>{formatShortDate(day.date)}</span>
                          <span class="font-medium">
                            <span class="rounded-md bg-risk-surface px-1.5 py-0.5 font-medium text-risk">{day.atRiskCount} at risk</span>
                            {', '}
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

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SectionShell title="Recent Work" icon={Library}>
              <div class="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
                <div>
                  <p class="mb-2 text-xs font-medium text-muted-foreground">
                    Recent decks
                  </p>
                  <div class="space-y-1">
                    <For each={recentDecks().slice(0, 4)}>
                      {(deck) => (
                        <button
                          class="flex min-h-10 w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
                          onClick={() => navigate(`/deck/${deck.id}`)}
                        >
                          <span class="min-w-0 truncate font-medium">{deck.name}</span>
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
                    Recent cards
                  </p>
                  <div class="space-y-1">
                    <For each={recentCards().slice(0, 4)}>
                      {(card) => (
                        <button
                          class="flex min-h-10 w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
                          onClick={() =>
                            navigate(`/deck/${card.deckId}?cardId=${card.id}`)
                          }
                        >
                          <span class="min-w-0 truncate font-medium">
                            {card.title || 'Untitled card'}
                          </span>
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
                <div class="divide-y">
                  <For each={weakAreas().slice(0, 5)}>
                    {(area) => (
                      <button
                        class="group flex w-full items-center justify-between gap-3 py-3 text-left first:pt-0 last:pb-0"
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
                        <div class="flex shrink-0 items-center gap-2">
                          <span class="hidden text-xs font-medium text-risk md:inline">
                            {retentionLabel(area.avgRetention)}
                          </span>
                          <ArrowRight class="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                        </div>
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
              description="Start with a class and one deck. Today will fill with useful signals as you study."
              class="rounded-xl border bg-card/50"
            />
          </Show>

          <Show when={pendingSuggestions() || notifications().length > 0}>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Show when={pendingSuggestions()}>
                {(suggestions) => (
                  <div class="flex items-center gap-3 rounded-lg border border-info/25 bg-info-surface px-4 py-3 text-sm">
                    <Sparkles class="h-4 w-4 text-info" />
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
                  <span>
                    {notifications().length} notification
                    {notifications().length === 1 ? '' : 's'} ready.
                  </span>
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
