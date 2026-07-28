import {
  type Component,
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  batch,
  Show,
  For,
} from 'solid-js';
import { useParams, useNavigate, useSearchParams } from '@solidjs/router';
import { createQuery, createMutation } from '@tanstack/solid-query';
import { api, getApiError } from '@/api/client';
import { queryClient } from '@/lib/query-client';
import type { ReviewAction } from '@/../../api/src/shared/constants';
import Flashcard from '@/components/flashcard/flashcard';
import StudyControls from '@/components/flashcard/study-controls';
import {
  isInteractiveStudyTarget,
  shouldIgnoreStudyShortcut,
} from '@/components/flashcard/study-keyboard';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import Skeleton from '@/components/ui/skeleton';
import { REVIEW_ACTIONS, KEYBOARD_SHORTCUTS } from '@/constants';
import {
  ArrowLeft,
  CheckCircle,
  RotateCcw,
  Calendar,
  BookOpen,
  RefreshCw,
  Timer,
} from 'lucide-solid';
import RelatedCardsPanel from '@/components/study/related-cards-panel';
import { memoryHealthKeys } from '@/components/deck-view/memory-health-state';
import { toast } from '@/stores/toast.store';
import { buildStudyDeckQuery, isStudyCluster } from './study-mode-state';

const StudyModePage: Component = () => {
  const params = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams<{ cardIds: string }>();

  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [isFlipped, setIsFlipped] = createSignal(false);
  const [reviewing, setReviewing] = createSignal(false);
  const [studyMode, setStudyMode] = createSignal<'due' | 'all'>('due');
  const clusterStudy = () => isStudyCluster(searchParams.cardIds);
  const effectiveStudyMode = () =>
    clusterStudy() ? 'all' : studyMode();
  const [checkingMore, setCheckingMore] = createSignal(false);
  const [pendingReviews, setPendingReviews] = createSignal<
    { cardId: string; action: ReviewAction }[]
  >([]);

  // Session stats
  const [stats, setStats] = createSignal({
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  });
  const [studyError, setStudyError] = createSignal<string | null>(null);
  const [lastAction, setLastAction] = createSignal<ReviewAction | null>(null);

  // Fetch deck name
  const deckQuery = createQuery(() => ({
    queryKey: ['deck', params.deckId],
    queryFn: async () => {
      const { data } = await (api.decks as any)[params.deckId].get();
      return (data as { id: string; name: string }) ?? null;
    },
    enabled: !!params.deckId,
  }));

  const studyQuery = createQuery(() => ({
    queryKey: [
      'studyData',
      params.deckId,
      effectiveStudyMode(),
      searchParams.cardIds ?? '',
    ],
    queryFn: async () => {
      const { data, error } = await (api.study.deck as any)[params.deckId].get({
        query: buildStudyDeckQuery(effectiveStudyMode(), searchParams.cardIds),
      });
      if (error || !data) {
        setStudyError(
          'Failed to load study cards. Please go back and try again.',
        );
        return null;
      }
      setStudyError(null);
      return data as {
        cards: {
          id: string;
          fields: {
            fieldName: string;
            fieldType: string;
            side: string;
            value: unknown;
            sortOrder: number;
          }[];
          progress: unknown;
        }[];
        total: number;
        due: number;
      };
    },
    enabled: !!params.deckId,
  }));

  // Fetch review schedule — only when there are no due cards and in due mode
  const scheduleQuery = createQuery(() => ({
    queryKey: ['schedule', params.deckId],
    queryFn: async () => {
      const { data } = await (api.study.deck as any)[
        params.deckId
      ].schedule.get();
      return data as {
        totalCards: number;
        learnedCards: number;
        upcoming: { daysFromNow: number; count: number; date: string }[];
        dueSoon: number;
        nextReviewDate: string | null;
      } | null;
    },
    enabled:
      !!params.deckId &&
      studyQuery.data?.due === 0 &&
      effectiveStudyMode() === 'due',
  }));

  const reviewBatchMutation = createMutation(() => ({
    mutationFn: async (items: { cardId: string; action: ReviewAction }[]) => {
      const { error } = await (api.study as any)['review-batch'].post({
        items,
      });
      if (error) throw new Error(getApiError(error));
    },
    onSuccess: () => {
      // NOTE: Do NOT invalidate studyData here — it causes a mid-session refetch
      // that replaces the cards array while currentIndex stays unchanged, triggering
      // premature "Session Complete". The batch-end handler in handleReview already
      // invalidates studyData explicitly when the current batch is exhausted.
      queryClient.invalidateQueries({ queryKey: ['schedule', params.deckId] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({
        queryKey: memoryHealthKeys.deck(params.deckId),
      });
    },
  }));

  const studyData = () => studyQuery.data;

  const currentCard = createMemo(() => {
    const data = studyData();
    if (!data || data.cards.length === 0) return null;
    const idx = currentIndex();
    return idx < data.cards.length ? data.cards[idx] : null;
  });

  const progress = createMemo(() => {
    const data = studyData();
    const total = data?.cards.length ?? 0;
    if (!data || total === 0) return 100;
    return Math.min(100, Math.round((currentIndex() / total) * 100));
  });

  const hasReviewedCards = createMemo(
    () => stats().again + stats().hard + stats().good + stats().easy > 0,
  );

  const flushPendingReviews = async (force = false) => {
    const pending = pendingReviews();
    if (pending.length === 0) return;
    if (!force && pending.length < 8) return;

    await reviewBatchMutation.mutateAsync(pending);
    setPendingReviews((prev) => prev.slice(pending.length));
  };

  const handleReview = async (action: ReviewAction) => {
    const card = currentCard();
    if (!card || reviewing()) return;

    setReviewing(true);
    try {
      setPendingReviews((prev) => [...prev, { cardId: card.id, action }]);
      await flushPendingReviews(false);
      const nextIndex = currentIndex() + 1;
      batch(() => {
        setStats((s) => ({
          ...s,
          again: action === REVIEW_ACTIONS.AGAIN ? s.again + 1 : s.again,
          hard: action === REVIEW_ACTIONS.HARD ? s.hard + 1 : s.hard,
          good: action === REVIEW_ACTIONS.GOOD ? s.good + 1 : s.good,
          easy: action === REVIEW_ACTIONS.EASY ? s.easy + 1 : s.easy,
        }));
        setIsFlipped(false);
        setCurrentIndex(nextIndex);
        setLastAction(action);
      });

      // If we just reviewed the last card in this batch, auto-refetch
      // to pick up learning/relearning cards that became due during the session
      const data = studyData();
      if (
        data &&
        nextIndex >= data.cards.length &&
        effectiveStudyMode() === 'due'
      ) {
        await flushPendingReviews(true);
        setCheckingMore(true);
        // Brief delay for SM-2 learning cards to become due
        await new Promise((r) => setTimeout(r, 1500));
        await queryClient.invalidateQueries({
          queryKey: ['studyData', params.deckId],
        });
        const refreshed = studyData();
        if (refreshed && refreshed.cards.length > 0) {
          setCurrentIndex(0); // continue with new batch seamlessly
        }
        setCheckingMore(false);
      }
    } finally {
      setReviewing(false);
    }
  };

  const invalidateStudy = () =>
    queryClient.invalidateQueries({ queryKey: ['studyData', params.deckId] });

  const handleRestart = () => {
    batch(() => {
      setCurrentIndex(0);
      setStats({ again: 0, hard: 0, good: 0, easy: 0 });
      setIsFlipped(false);
      setStudyMode('due');
    });
    invalidateStudy();
  };

  // Continue session without resetting stats (used by countdown timer)
  const handleContinue = () => {
    batch(() => {
      setCurrentIndex(0);
      setIsFlipped(false);
      setStudyMode('due');
    });
    invalidateStudy();
  };

  const handleReviewAll = () => {
    batch(() => {
      setCurrentIndex(0);
      setStats({ again: 0, hard: 0, good: 0, easy: 0 });
      setIsFlipped(false);
      setStudyMode('all');
    });
  };

  const handleResetProgress = async () => {
    try {
      const { error } = await (api.study.deck as any)[params.deckId][
        'reset-progress'
      ].post();
      if (error) {
        throw new Error(getApiError(error));
      }
      batch(() => {
        setCurrentIndex(0);
        setStats({ again: 0, hard: 0, good: 0, easy: 0 });
        setIsFlipped(false);
        setStudyMode('due');
      });
      invalidateStudy();
      queryClient.invalidateQueries({ queryKey: ['schedule', params.deckId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({
        queryKey: memoryHealthKeys.deck(params.deckId),
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to reset progress. Please try again.',
      );
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (shouldIgnoreStudyShortcut(e)) return;

    if (e.key === KEYBOARD_SHORTCUTS.FLIP) {
      if (isInteractiveStudyTarget(e.target)) return;
      e.preventDefault();
      setIsFlipped((f) => !f);
    } else if (e.key === KEYBOARD_SHORTCUTS.AGAIN && isFlipped()) {
      e.preventDefault();
      void handleReview(REVIEW_ACTIONS.AGAIN);
    } else if (e.key === KEYBOARD_SHORTCUTS.HARD && isFlipped()) {
      e.preventDefault();
      void handleReview(REVIEW_ACTIONS.HARD);
    } else if (e.key === KEYBOARD_SHORTCUTS.GOOD && isFlipped()) {
      e.preventDefault();
      void handleReview(REVIEW_ACTIONS.GOOD);
    } else if (e.key === KEYBOARD_SHORTCUTS.EASY && isFlipped()) {
      e.preventDefault();
      void handleReview(REVIEW_ACTIONS.EASY);
    }
  };

  // Countdown timer: auto-refetch when next due-soon card becomes due
  const [countdown, setCountdown] = createSignal('');

  createEffect(() => {
    const sched = scheduleQuery.data;
    if (!sched || !sched.nextReviewDate || sched.dueSoon === 0) {
      setCountdown('');
      return;
    }

    const nextDue = new Date(sched.nextReviewDate).getTime();
    let timer: ReturnType<typeof setInterval>;

    const tick = () => {
      const remaining = nextDue - Date.now();
      if (remaining <= 0) {
        setCountdown('');
        clearInterval(timer);
        // Auto-continue when cards become due (keep stats)
        handleContinue();
        return;
      }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${mins}:${secs.toString().padStart(2, '0')}`);
    };

    tick();
    timer = setInterval(tick, 1000);
    onCleanup(() => clearInterval(timer));
  });

  onMount(() => document.addEventListener('keydown', handleKeyDown));
  onCleanup(() => {
    void flushPendingReviews(true);
    document.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <header class="shrink-0 border-b bg-surface">
        <div class="grid h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 sm:px-5">
          <Button
            variant="ghost"
            size="sm"
            class="h-10 px-2 sm:px-3"
            onClick={() => navigate(`/deck/${params.deckId}`)}
            aria-label="Back to deck"
          >
            <ArrowLeft class="h-4 w-4 sm:mr-1.5" />
            <span class="hidden sm:inline">Deck</span>
          </Button>

          <div class="min-w-0 text-center">
            <Show
              when={deckQuery.data}
              fallback={<div class="mx-auto h-4 w-28 rounded-sm bg-muted" />}
            >
              <p class="truncate text-sm font-semibold text-foreground">
                {deckQuery.data!.name}
              </p>
            </Show>
            <Show when={studyData()}>
              <p class="mt-0.5 truncate text-[11px] font-medium tabular-nums text-muted-foreground">
                {Math.min(currentIndex(), studyData()!.cards.length)} of{' '}
                {studyData()!.cards.length}
                <span class="hidden sm:inline">
                  {' '}
                  {clusterStudy()
                    ? 'cluster cards'
                    : effectiveStudyMode() === 'all'
                      ? 'all cards'
                      : 'due cards'}
                </span>
                <span class="ml-2 text-foreground">{progress()}%</span>
              </p>
            </Show>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleRestart}
            title="Restart session"
            aria-label="Restart session"
          >
            <RotateCcw class="h-4 w-4" />
          </Button>
        </div>

        <div
          class="h-1 bg-muted"
          role="progressbar"
          aria-label="Study session progress"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={studyData() ? progress() : 0}
        >
          <div
            class="h-full rounded-r-full bg-foreground transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: studyData() ? `${progress()}%` : '0%' }}
          />
        </div>
      </header>

      <main class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div class="mx-auto flex min-h-full w-full max-w-4xl flex-col items-center justify-center px-4 py-6 sm:px-6 sm:py-8 lg:py-10">
        <Show when={studyError()}>
          <section
            class="w-full max-w-md space-y-4"
            aria-label="Study error"
          >
            <Alert variant="destructive" title="Unable to load study cards">
              {studyError()}
            </Alert>
            <Button
              variant="outline"
              class="w-full"
              onClick={() => navigate(`/deck/${params.deckId}`)}
            >
              <ArrowLeft class="h-4 w-4" />
              Back to deck
            </Button>
          </section>
        </Show>

        <Show when={!studyError()}>
          <Show
            when={!studyQuery.isLoading && !checkingMore()}
            fallback={
              <div
                class="w-full max-w-2xl space-y-5"
                role="status"
                aria-live="polite"
              >
                <Skeleton
                  shape="card"
                  class="h-[21rem] rounded-2xl sm:h-[24rem]"
                />
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <For each={[0, 1, 2, 3]}>
                    {() => <Skeleton class="h-14 rounded-lg" />}
                  </For>
                </div>
                <p class="text-center text-sm font-medium text-muted-foreground">
                  {checkingMore()
                    ? 'Checking for more cards'
                    : 'Loading study cards'}
                </p>
              </div>
            }
          >
            <Show
              when={currentCard()}
              fallback={
                <section
                  class="w-full max-w-2xl space-y-6 py-2"
                  aria-live="polite"
                  aria-label="Study session summary"
                >
                  <div class="text-center">
                    <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-new-fill text-new-fill-foreground">
                      <CheckCircle class="h-5 w-5" />
                    </div>

                    <Show
                      when={hasReviewedCards()}
                      fallback={
                        <>
                          <h1 class="text-2xl font-semibold tracking-tight">
                            All caught up
                          </h1>
                          <p class="mt-2 text-sm text-muted-foreground">
                            No cards are due right now.
                          </p>
                        </>
                      }
                    >
                      <h1 class="text-2xl font-semibold tracking-tight">
                        Session complete
                      </h1>
                      <p class="mt-2 text-sm text-muted-foreground">
                        You reviewed every card in this queue.
                      </p>
                    </Show>
                  </div>

                  <Show when={hasReviewedCards()}>
                    <div class="grid grid-cols-2 overflow-hidden rounded-xl border bg-card shadow-xs sm:grid-cols-4">
                      <div class="border-b border-r p-4 sm:border-b-0">
                        <p class="text-xl font-semibold tabular-nums text-destructive">
                          {stats().again}
                        </p>
                        <p class="mt-1 text-xs font-medium text-muted-foreground">
                          Again
                        </p>
                      </div>
                      <div class="border-b p-4 sm:border-b-0 sm:border-r">
                        <p class="text-xl font-semibold tabular-nums text-risk">
                          {stats().hard}
                        </p>
                        <p class="mt-1 text-xs font-medium text-muted-foreground">
                          Hard
                        </p>
                      </div>
                      <div class="border-r p-4">
                        <p class="text-xl font-semibold tabular-nums text-due">
                          {stats().good}
                        </p>
                        <p class="mt-1 text-xs font-medium text-muted-foreground">
                          Good
                        </p>
                      </div>
                      <div class="p-4">
                        <p class="text-xl font-semibold tabular-nums text-new">
                          {stats().easy}
                        </p>
                        <p class="mt-1 text-xs font-medium text-muted-foreground">
                          Easy
                        </p>
                      </div>
                    </div>
                  </Show>

                  <Show when={scheduleQuery.data}>
                    <div class="flex items-center justify-between gap-4 rounded-xl border bg-card p-4 shadow-xs">
                      <div class="flex min-w-0 items-center gap-3">
                        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-due-fill text-due-fill-foreground">
                          <BookOpen class="h-4 w-4" />
                        </span>
                        <div class="min-w-0">
                          <p class="truncate text-sm font-semibold">
                            Deck progress
                          </p>
                          <p class="text-xs text-muted-foreground">
                            Cards learned
                          </p>
                        </div>
                      </div>
                      <span class="shrink-0 text-sm font-semibold tabular-nums">
                        {scheduleQuery.data!.learnedCards} /{' '}
                        {scheduleQuery.data!.totalCards}
                      </span>
                    </div>
                  </Show>

                  <Show
                    when={
                      scheduleQuery.isLoading && effectiveStudyMode() === 'due'
                    }
                  >
                    <Skeleton class="h-20 w-full rounded-xl" />
                  </Show>

                  <Show
                    when={
                      scheduleQuery.data &&
                      scheduleQuery.data!.upcoming.length > 0
                    }
                  >
                    <div class="space-y-2 text-left">
                      <div class="flex items-center gap-2 text-sm font-semibold">
                        <Calendar class="h-4 w-4 text-due" />
                        <span>Upcoming reviews</span>
                      </div>
                      <div class="overflow-hidden rounded-xl border bg-card shadow-xs">
                        <For each={scheduleQuery.data!.upcoming.slice(0, 5)}>
                          {(item) => (
                            <div class="flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0">
                              <span class="text-sm text-muted-foreground">
                                {item.daysFromNow === 1
                                  ? 'Tomorrow'
                                  : `In ${item.daysFromNow} days`}
                              </span>
                              <span class="text-sm font-semibold tabular-nums">
                                {item.count}{' '}
                                {item.count === 1 ? 'card' : 'cards'}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  <Show
                    when={scheduleQuery.data && scheduleQuery.data!.dueSoon > 0}
                  >
                    <div class="space-y-2 rounded-xl border border-risk/25 bg-risk-surface p-4">
                      <div class="flex items-center justify-between gap-3">
                        <div class="flex min-w-0 items-center gap-2 text-risk">
                          <Timer class="h-4 w-4 shrink-0" />
                          <span class="text-sm font-medium">
                            {scheduleQuery.data!.dueSoon}{' '}
                            {scheduleQuery.data!.dueSoon === 1
                              ? 'card'
                              : 'cards'}{' '}
                            coming back soon
                          </span>
                        </div>
                        <Show when={countdown()}>
                          <span class="shrink-0 font-mono text-sm font-semibold tabular-nums text-risk">
                            {countdown()}
                          </span>
                        </Show>
                      </div>
                      <p class="text-xs text-muted-foreground">
                        Cards you struggled with will reappear automatically.
                      </p>
                    </div>
                  </Show>

                  <Show
                    when={
                      scheduleQuery.data &&
                      scheduleQuery.data!.upcoming.length === 0 &&
                      scheduleQuery.data!.dueSoon === 0 &&
                      scheduleQuery.data!.learnedCards > 0
                    }
                  >
                    <div class="flex items-center gap-3 rounded-xl border border-new/25 bg-new-surface p-4 text-left">
                      <CheckCircle class="h-5 w-5 shrink-0 text-new" />
                      <p class="text-sm font-medium text-new">
                        All {scheduleQuery.data!.learnedCards} cards are fully
                        mastered.
                      </p>
                    </div>
                  </Show>

                  <div class="flex w-full flex-col gap-2">
                    <Show when={studyData()?.total && studyData()!.total > 0}>
                      <Button class="w-full" onClick={handleReviewAll}>
                        <RefreshCw class="h-4 w-4" />
                        {clusterStudy()
                          ? 'Review this cluster'
                          : 'Review all cards'}{' '}
                        ({studyData()?.total ?? 0})
                      </Button>
                    </Show>
                    <Show
                      when={
                        !clusterStudy() &&
                        studyData()?.total &&
                        studyData()!.total > 0
                      }
                    >
                      <Button
                        variant="outline"
                        class="w-full border-destructive/25 text-destructive hover:bg-destructive-surface hover:text-destructive"
                        onClick={handleResetProgress}
                      >
                        <RotateCcw class="h-4 w-4" />
                        Reset all progress
                      </Button>
                    </Show>
                    <Button
                      variant="ghost"
                      class="w-full"
                      onClick={() => navigate(`/deck/${params.deckId}`)}
                    >
                      Back to deck
                    </Button>
                  </div>
                </section>
              }
            >
              <section
                class="w-full max-w-2xl"
                aria-label="Current study card"
              >
                <Flashcard
                  fields={currentCard()!.fields}
                  isFlipped={isFlipped()}
                  onFlip={() => setIsFlipped((f) => !f)}
                />

                <StudyControls
                  onAgain={() => handleReview(REVIEW_ACTIONS.AGAIN)}
                  onHard={() => handleReview(REVIEW_ACTIONS.HARD)}
                  onGood={() => handleReview(REVIEW_ACTIONS.GOOD)}
                  onEasy={() => handleReview(REVIEW_ACTIONS.EASY)}
                  disabled={reviewing()}
                  visible={isFlipped()}
                />

                <RelatedCardsPanel
                  cardId={currentCard()?.id}
                  show={lastAction() === REVIEW_ACTIONS.AGAIN}
                />
              </section>
            </Show>
          </Show>
        </Show>
        </div>
      </main>
    </div>
  );
};

export default StudyModePage;
