import {
  type Component,
  createSignal,
  createMemo,
  onMount,
  onCleanup,
  batch,
  Show,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
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
import { Button } from '@/components/ui/button';
import { REVIEW_ACTIONS, KEYBOARD_SHORTCUTS } from '@/constants';
import { ArrowLeft, CheckCircle, RotateCcw, Shuffle } from 'lucide-solid';

const InterleavedStudyPage: Component = () => {
  const navigate = useNavigate();

  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [isFlipped, setIsFlipped] = createSignal(false);
  const [reviewing, setReviewing] = createSignal(false);
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

  const studyQuery = createQuery(() => ({
    queryKey: ['interleavedStudy'],
    queryFn: async () => {
      const { data } = await (api.study as any).interleaved.auto.get({
        query: { topN: 5, limit: 50 },
      });
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
        deckIds: string[];
      } | null;
    },
  }));
  const studyData = () => studyQuery.data;

  const reviewBatchMutation = createMutation(() => ({
    mutationFn: async (items: { cardId: string; action: ReviewAction }[]) => {
      const { error } = await (api.study as any)['review-batch'].post({
        items,
      });
      if (error) throw new Error(getApiError(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interleavedStudy'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  }));

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
      batch(() => {
        setStats((s) => ({
          ...s,
          again: action === REVIEW_ACTIONS.AGAIN ? s.again + 1 : s.again,
          hard: action === REVIEW_ACTIONS.HARD ? s.hard + 1 : s.hard,
          good: action === REVIEW_ACTIONS.GOOD ? s.good + 1 : s.good,
          easy: action === REVIEW_ACTIONS.EASY ? s.easy + 1 : s.easy,
        }));
        setIsFlipped(false);
        setCurrentIndex((i) => i + 1);
      });
    } finally {
      setReviewing(false);
    }
  };

  const handleRestart = () => {
    batch(() => {
      setCurrentIndex(0);
      setStats({ again: 0, hard: 0, good: 0, easy: 0 });
      setIsFlipped(false);
    });
    queryClient.invalidateQueries({ queryKey: ['interleavedStudy'] });
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

  onMount(() => document.addEventListener('keydown', handleKeyDown));
  onCleanup(() => {
    void flushPendingReviews(true);
    document.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <header class="flex shrink-0 items-center justify-between border-b bg-card/70 px-3 py-3 sm:px-5">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft class="mr-2 h-4 w-4" />
          <span class="hidden sm:inline">Dashboard</span>
        </Button>
        <div class="text-center">
          <div class="flex items-center justify-center gap-1.5">
            <Shuffle class="h-3.5 w-3.5 text-learning" />
            <p class="text-sm font-semibold">Interleaved review</p>
          </div>
          <Show when={studyData()}>
            <p class="mt-0.5 text-xs tabular-nums text-muted-foreground">
              {currentIndex()} / {studyData()!.due} cards
              {studyData()!.deckIds?.length
                ? ` from ${studyData()!.deckIds.length} decks`
                : ''}
            </p>
          </Show>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRestart}
          aria-label="Restart session"
        >
          <RotateCcw class="h-4 w-4" />
        </Button>
      </header>

      <div
        class="h-1 shrink-0 bg-muted"
        role="progressbar"
        aria-label="Study progress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={progress()}
      >
        <div
          class="h-full bg-foreground transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${progress()}%` }}
        />
      </div>

      <main class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8 pb-24 sm:px-8 md:pb-8">
        <Show
          when={!studyQuery.isLoading}
          fallback={
            <div class="w-full max-w-xl space-y-4">
              <div class="h-[22rem] animate-pulse rounded-xl border bg-muted/55" />
              <p class="text-center text-sm text-muted-foreground">
                Building your review mix...
              </p>
            </div>
          }
        >
          <Show when={!studyQuery.isError}>
            <Show
              when={currentCard()}
              fallback={
                <div class="w-full max-w-lg rounded-xl border bg-card p-6 text-center shadow-sm sm:p-8">
                  <div class="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg border border-new/25 bg-new/10 text-new">
                    <CheckCircle class="h-6 w-6" />
                  </div>

                  <Show
                    when={hasReviewedCards()}
                    fallback={
                      <div>
                        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Queue clear
                        </p>
                        <h1 class="mt-2 text-2xl font-semibold tracking-tight">
                          All caught up
                        </h1>
                        <p class="mt-2 text-sm text-muted-foreground">
                          No cards are due across your decks.
                        </p>
                      </div>
                    }
                  >
                    <div>
                      <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Review complete
                      </p>
                      <h1 class="mt-2 text-2xl font-semibold tracking-tight">
                        Session complete
                      </h1>
                      <p class="mt-2 text-sm text-muted-foreground">
                        You reviewed cards from multiple decks.
                      </p>
                    </div>
                  </Show>

                  <Show when={hasReviewedCards()}>
                    <div class="mt-6 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                      <SessionStat
                        label="Again"
                        value={stats().again}
                        class="text-destructive"
                      />
                      <SessionStat
                        label="Hard"
                        value={stats().hard}
                        class="text-risk"
                      />
                      <SessionStat
                        label="Good"
                        value={stats().good}
                        class="text-due"
                      />
                      <SessionStat
                        label="Easy"
                        value={stats().easy}
                        class="text-new"
                      />
                    </div>
                  </Show>

                  <Button class="mt-6" onClick={() => navigate('/')}>
                    Back to dashboard
                  </Button>
                </div>
              }
            >
              <div class="w-full max-w-2xl">
                <Flashcard
                  fields={currentCard()!.fields}
                  isFlipped={isFlipped()}
                  onFlip={() => setIsFlipped((flipped) => !flipped)}
                />

                <StudyControls
                  onAgain={() => handleReview(REVIEW_ACTIONS.AGAIN)}
                  onHard={() => handleReview(REVIEW_ACTIONS.HARD)}
                  onGood={() => handleReview(REVIEW_ACTIONS.GOOD)}
                  onEasy={() => handleReview(REVIEW_ACTIONS.EASY)}
                  disabled={reviewing()}
                  visible={isFlipped()}
                />
              </div>
            </Show>
          </Show>
          <Show when={studyQuery.isError}>
            <div class="w-full max-w-md rounded-xl border border-destructive/25 bg-destructive-surface p-6 text-center">
              <h1 class="font-semibold text-destructive">
                Could not load your review
              </h1>
              <p class="mt-2 text-sm text-muted-foreground">
                Check your connection, then try again.
              </p>
              <Button
                variant="outline"
                class="mt-5"
                onClick={() => studyQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          </Show>
        </Show>
      </main>
    </div>
  );
};

const SessionStat: Component<{
  label: string;
  value: number;
  class: string;
}> = (props) => (
  <div class="rounded-lg border bg-muted/25 px-3 py-3">
    <p class={`text-xl font-semibold tabular-nums ${props.class}`}>
      {props.value}
    </p>
    <p class="mt-0.5 text-xs text-muted-foreground">{props.label}</p>
  </div>
);

export default InterleavedStudyPage;
