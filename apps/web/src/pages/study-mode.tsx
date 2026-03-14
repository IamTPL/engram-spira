import {
  type Component,
  createSignal,
  createResource,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  batch,
  Show,
  For,
} from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import { api, getApiError } from '@/api/client';
import type { ReviewAction } from '@/../../api/src/shared/constants';
import Flashcard from '@/components/flashcard/flashcard';
import StudyControls from '@/components/flashcard/study-controls';
import { Button } from '@/components/ui/button';
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

const StudyModePage: Component = () => {
  const params = useParams<{ deckId: string }>();
  const navigate = useNavigate();

  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [isFlipped, setIsFlipped] = createSignal(false);
  const [reviewing, setReviewing] = createSignal(false);
  const [studyMode, setStudyMode] = createSignal<'due' | 'all'>('due');
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

  // Fetch deck name
  const [deck] = createResource(
    () => params.deckId,
    async (deckId) => {
      const { data } = await (api.decks as any)[deckId].get();
      return data as { id: string; name: string } | null;
    },
  );

  const [studyData, { refetch }] = createResource(
    () => ({ deckId: params.deckId, mode: studyMode() }),
    async ({ deckId, mode }) => {
      const { data, error } = await (api.study.deck as any)[deckId].get({
        query: mode === 'all' ? { mode: 'all' } : {},
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
  );

  // Fetch review schedule — only when there are no due cards and in due mode
  const [schedule] = createResource(
    () => {
      const data = studyData();
      return data && data.due === 0 && studyMode() === 'due'
        ? params.deckId
        : null;
    },
    async (deckId) => {
      const { data } = await (api.study.deck as any)[deckId].schedule.get();
      return data as {
        totalCards: number;
        learnedCards: number;
        upcoming: { daysFromNow: number; count: number; date: string }[];
        dueSoon: number;
        nextReviewDate: string | null;
      } | null;
    },
  );

  const currentCard = createMemo(() => {
    const data = studyData();
    if (!data || data.cards.length === 0) return null;
    const idx = currentIndex();
    return idx < data.cards.length ? data.cards[idx] : null;
  });

  const progress = createMemo(() => {
    const data = studyData();
    if (!data || data.due === 0) return 100;
    return Math.round((currentIndex() / data.due) * 100);
  });

  const hasReviewedCards = createMemo(() =>
    stats().again + stats().hard + stats().good + stats().easy > 0
  );

  const flushPendingReviews = async (force = false) => {
    const pending = pendingReviews();
    if (pending.length === 0) return;
    if (!force && pending.length < 8) return;

    const { error: reviewBatchError } = await (api.study as any)['review-batch'].post({ items: pending });
    if (reviewBatchError) throw new Error(getApiError(reviewBatchError));
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
      });

      // If we just reviewed the last card in this batch, auto-refetch
      // to pick up learning/relearning cards that became due during the session
      const data = studyData();
      if (data && nextIndex >= data.cards.length && studyMode() === 'due') {
        await flushPendingReviews(true);
        setCheckingMore(true);
        // Brief delay for SM-2 learning cards to become due
        await new Promise((r) => setTimeout(r, 1500));
        const result = await refetch();
        if (result && result.cards.length > 0) {
          setCurrentIndex(0); // continue with new batch seamlessly
        }
        setCheckingMore(false);
      }
    } finally {
      setReviewing(false);
    }
  };

  const handleRestart = () => {
    batch(() => {
      setCurrentIndex(0);
      setStats({ again: 0, hard: 0, good: 0, easy: 0 });
      setIsFlipped(false);
      setStudyMode('due');
    });
    refetch();
  };

  // Continue session without resetting stats (used by countdown timer)
  const handleContinue = () => {
    batch(() => {
      setCurrentIndex(0);
      setIsFlipped(false);
      setStudyMode('due');
    });
    refetch();
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
      await (api.study.deck as any)[params.deckId]['reset-progress'].post();
      batch(() => {
        setCurrentIndex(0);
        setStats({ again: 0, hard: 0, good: 0, easy: 0 });
        setIsFlipped(false);
        setStudyMode('due');
      });
      refetch();
    } catch {
      // ignore
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === KEYBOARD_SHORTCUTS.FLIP) {
      e.preventDefault();
      setIsFlipped((f) => !f);
    } else if (e.key === KEYBOARD_SHORTCUTS.AGAIN && isFlipped()) {
      handleReview(REVIEW_ACTIONS.AGAIN);
    } else if (e.key === KEYBOARD_SHORTCUTS.HARD && isFlipped()) {
      handleReview(REVIEW_ACTIONS.HARD);
    } else if (e.key === KEYBOARD_SHORTCUTS.GOOD && isFlipped()) {
      handleReview(REVIEW_ACTIONS.GOOD);
    } else if (e.key === KEYBOARD_SHORTCUTS.EASY && isFlipped()) {
      handleReview(REVIEW_ACTIONS.EASY);
    }
  };

  // Countdown timer: auto-refetch when next due-soon card becomes due
  const [countdown, setCountdown] = createSignal('');

  createEffect(() => {
    const sched = schedule();
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
    <div class="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <div class="border-b bg-card px-4 sm:px-6 py-3 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/deck/${params.deckId}`)}
        >
          <ArrowLeft class="h-4 w-4 mr-2" />
          Back
        </Button>
        <div class="text-center">
          <Show when={deck()}>
            <p class="text-sm font-medium truncate max-w-48 sm:max-w-xs">
              {deck()!.name}
            </p>
          </Show>
          <Show when={studyData()}>
            <p class="text-xs text-muted-foreground tabular-nums">
              {currentIndex()} / {studyData()!.due} cards
              <span class="ml-2 font-medium text-primary">{progress()}%</span>
            </p>
          </Show>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRestart}
          title="Restart session"
        >
          <RotateCcw class="h-4 w-4" />
        </Button>
      </div>

      {/* Progress bar */}
      <div class="h-1 bg-muted">
        <div
          class="h-full btn-gradient transition-[width] duration-500 ease-out rounded-r-full"
          style={{ width: `${progress()}%` }}
        />
      </div>

      {/* Main content */}
      <div class="flex-1 flex flex-col items-center justify-center p-8">
        <Show when={studyError()}>
          <div class="text-center space-y-4 max-w-sm">
            <p class="text-destructive font-medium">{studyError()}</p>
            <Button
              variant="outline"
              onClick={() => navigate(`/deck/${params.deckId}`)}
            >
              <ArrowLeft class="h-4 w-4 mr-2" />
              Back to Deck
            </Button>
          </div>
        </Show>
        <Show when={!studyError()}>
          <Show
            when={!studyData.loading && !checkingMore()}
            fallback={
              <div class="w-full max-w-lg space-y-6 px-4">
                <div class="animate-pulse space-y-4">
                  <div class="h-48 rounded-2xl bg-muted" />
                  <div class="space-y-2 px-2">
                    <div class="h-4 w-3/4 rounded bg-muted" />
                    <div class="h-4 w-1/2 rounded bg-muted" />
                  </div>
                  <div class="flex justify-center gap-3 pt-4">
                    <div class="h-10 w-20 rounded-lg bg-muted" />
                    <div class="h-10 w-20 rounded-lg bg-muted" />
                    <div class="h-10 w-20 rounded-lg bg-muted" />
                    <div class="h-10 w-20 rounded-lg bg-muted" />
                  </div>
                </div>
                <p class="text-center text-sm text-muted-foreground">
                  {checkingMore()
                    ? 'Checking for more cards...'
                    : 'Loading cards...'}
                </p>
              </div>
            }
          >
            <Show
              when={currentCard()}
              fallback={
                <div class="text-center space-y-6 max-w-sm w-full">
                  <CheckCircle class="h-16 w-16 text-green-500 mx-auto" />

                  {/* Title changes based on whether a session was just completed */}
                  <Show
                    when={hasReviewedCards()}
                    fallback={
                      <div>
                        <h2 class="text-2xl font-bold">All caught up!</h2>
                        <p class="text-muted-foreground mt-1">
                          No cards are due right now.
                        </p>
                      </div>
                    }
                  >
                    <div>
                      <h2 class="text-2xl font-bold">Session Complete!</h2>
                      <p class="text-muted-foreground mt-1">
                        You've reviewed all due cards.
                      </p>
                    </div>
                  </Show>

                  {/* Session stats — only shown when a session was completed */}
                  <Show
                    when={hasReviewedCards()}
                  >
                    <div class="grid grid-cols-4 gap-3 text-center">
                      <div class="rounded-lg border p-3 bg-card">
                        <p class="text-2xl font-bold text-destructive">
                          {stats().again}
                        </p>
                        <p class="text-xs text-muted-foreground mt-0.5">
                          Again
                        </p>
                      </div>
                      <div class="rounded-lg border p-3 bg-card">
                        <p class="text-2xl font-bold text-amber-500">
                          {stats().hard}
                        </p>
                        <p class="text-xs text-muted-foreground mt-0.5">Hard</p>
                      </div>
                      <div class="rounded-lg border p-3 bg-card">
                        <p class="text-2xl font-bold text-green-500">
                          {stats().good}
                        </p>
                        <p class="text-xs text-muted-foreground mt-0.5">Good</p>
                      </div>
                      <div class="rounded-lg border p-3 bg-card">
                        <p class="text-2xl font-bold text-palette-5">
                          {stats().easy}
                        </p>
                        <p class="text-xs text-muted-foreground mt-0.5">Easy</p>
                      </div>
                    </div>
                  </Show>

                  {/* Deck progress */}
                  <Show when={schedule()}>
                    <div class="rounded-lg border bg-card p-3 flex items-center justify-between gap-3">
                      <div class="flex items-center gap-2 text-muted-foreground">
                        <BookOpen class="h-4 w-4" />
                        <span class="text-sm">Cards learned</span>
                      </div>
                      <span class="text-sm font-semibold">
                        {schedule()!.learnedCards} / {schedule()!.totalCards}
                      </span>
                    </div>
                  </Show>

                  {/* Upcoming review schedule */}
                  <Show when={schedule() && schedule()!.upcoming.length > 0}>
                    <div class="space-y-2 w-full text-left">
                      <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Calendar class="h-4 w-4" />
                        <span>Upcoming reviews</span>
                      </div>
                      <div class="space-y-1.5">
                        <For each={schedule()!.upcoming.slice(0, 5)}>
                          {(item) => (
                            <div class="flex items-center justify-between rounded-lg border px-3 py-2 bg-card">
                              <span class="text-sm text-muted-foreground">
                                {item.daysFromNow === 1
                                  ? 'Tomorrow'
                                  : `In ${item.daysFromNow} days`}
                              </span>
                              <span class="text-sm font-semibold">
                                {item.count}{' '}
                                {item.count === 1 ? 'word' : 'words'}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* Cards due soon (within ~1 hour) — with countdown */}
                  <Show when={schedule() && schedule()!.dueSoon > 0}>
                    <div class="rounded-lg border bg-amber-500/10 border-amber-500/30 p-3 space-y-2">
                      <div class="flex items-center justify-between gap-3">
                        <div class="flex items-center gap-2 text-warning">
                          <Timer class="h-4 w-4" />
                          <span class="text-sm font-medium">
                            {schedule()!.dueSoon}{' '}
                            {schedule()!.dueSoon === 1 ? 'card' : 'cards'}{' '}
                            coming back soon
                          </span>
                        </div>
                        <Show when={countdown()}>
                          <span class="text-sm font-mono font-semibold tabular-nums text-warning">
                            {countdown()}
                          </span>
                        </Show>
                      </div>
                      <p class="text-xs text-muted-foreground">
                        Cards you struggled with will reappear automatically.
                      </p>
                    </div>
                  </Show>

                  {/* Fully mastered — only when no upcoming AND no due soon */}
                  <Show
                    when={
                      schedule() &&
                      schedule()!.upcoming.length === 0 &&
                      schedule()!.dueSoon === 0 &&
                      schedule()!.learnedCards > 0
                    }
                  >
                    <p class="text-sm text-muted-foreground">
                      🎉 All {schedule()!.learnedCards} cards are fully
                      mastered!
                    </p>
                  </Show>

                  <div class="flex flex-col gap-2 justify-center w-full">
                    <Show when={studyData()?.total && studyData()!.total > 0}>
                      <Button class="w-full" onClick={handleReviewAll}>
                        <RefreshCw class="h-4 w-4 mr-2" />
                        Review All Cards ({studyData()?.total ?? 0})
                      </Button>
                    </Show>
                    <Show when={studyData()?.total && studyData()!.total > 0}>
                      <Button
                        variant="outline"
                        class="w-full text-destructive hover:text-destructive"
                        onClick={handleResetProgress}
                      >
                        <RotateCcw class="h-4 w-4 mr-2" />
                        Reset All Progress
                      </Button>
                    </Show>
                    <div class="flex gap-2 justify-center">
                      <Button
                        variant="outline"
                        onClick={() => navigate(`/deck/${params.deckId}`)}
                      >
                        Back to Deck
                      </Button>
                    </div>
                  </div>
                </div>
              }
            >
              <Flashcard
                fields={currentCard()!.fields}
                isFlipped={isFlipped()}
                onFlip={() => setIsFlipped((f) => !f)}
              />

              <Show when={isFlipped()}>
                <StudyControls
                  onAgain={() => handleReview(REVIEW_ACTIONS.AGAIN)}
                  onHard={() => handleReview(REVIEW_ACTIONS.HARD)}
                  onGood={() => handleReview(REVIEW_ACTIONS.GOOD)}
                  onEasy={() => handleReview(REVIEW_ACTIONS.EASY)}
                  disabled={reviewing()}
                />
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default StudyModePage;
