import {
  type Component,
  createSignal,
  createResource,
  onMount,
  onCleanup,
  Show,
  For,
} from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import { api } from '@/api/client';
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
} from 'lucide-solid';

const StudyModePage: Component = () => {
  const params = useParams<{ deckId: string }>();
  const navigate = useNavigate();

  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [isFlipped, setIsFlipped] = createSignal(false);
  const [reviewing, setReviewing] = createSignal(false);
  const [studyMode, setStudyMode] = createSignal<'due' | 'all'>('due');

  // Session stats
  const [stats, setStats] = createSignal({ again: 0, hard: 0, good: 0 });

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
      const { data } = await (api.study.deck as any)[deckId].get({
        query: mode === 'all' ? { mode: 'all' } : {},
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
        nextReviewDate: string | null;
      } | null;
    },
  );

  const currentCard = () => {
    const data = studyData();
    if (!data || data.cards.length === 0) return null;
    const idx = currentIndex();
    return idx < data.cards.length ? data.cards[idx] : null;
  };

  const progress = () => {
    const data = studyData();
    if (!data || data.due === 0) return 100;
    return Math.round((currentIndex() / data.due) * 100);
  };

  const handleReview = async (action: ReviewAction) => {
    const card = currentCard();
    if (!card || reviewing()) return;

    setReviewing(true);
    try {
      await (api.study.review.post as any)({
        cardId: card.id,
        action: action,
      });
      // Track stats
      setStats((s) => ({
        ...s,
        again: action === REVIEW_ACTIONS.AGAIN ? s.again + 1 : s.again,
        hard: action === REVIEW_ACTIONS.HARD ? s.hard + 1 : s.hard,
        good: action === REVIEW_ACTIONS.GOOD ? s.good + 1 : s.good,
      }));
      setIsFlipped(false);
      setCurrentIndex((i) => i + 1);
    } finally {
      setReviewing(false);
    }
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setStats({ again: 0, hard: 0, good: 0 });
    setIsFlipped(false);
    setStudyMode('due');
    refetch();
  };

  const handleReviewAll = () => {
    setCurrentIndex(0);
    setStats({ again: 0, hard: 0, good: 0 });
    setIsFlipped(false);
    setStudyMode('all');
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
    }
  };

  onMount(() => document.addEventListener('keydown', handleKeyDown));
  onCleanup(() => document.removeEventListener('keydown', handleKeyDown));

  return (
    <div class="min-h-screen flex flex-col">
      {/* Top bar */}
      <div class="border-b px-6 py-3 flex items-center justify-between">
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
            <p class="text-sm font-medium">{deck()!.name}</p>
          </Show>
          <Show when={studyData()}>
            <p class="text-xs text-muted-foreground">
              {currentIndex()} / {studyData()!.due} cards
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
      <div class="h-1 bg-secondary">
        <div
          class="h-full bg-primary transition-all duration-300"
          style={{ width: `${progress()}%` }}
        />
      </div>

      {/* Main content */}
      <div class="flex-1 flex flex-col items-center justify-center p-8">
        <Show
          when={!studyData.loading}
          fallback={<p class="text-muted-foreground">Loading cards...</p>}
        >
          <Show
            when={currentCard()}
            fallback={
              <div class="text-center space-y-6 max-w-sm w-full">
                <CheckCircle class="h-16 w-16 text-green-500 mx-auto" />

                {/* Title changes based on whether a session was just completed */}
                <Show
                  when={stats().again + stats().hard + stats().good > 0}
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
                <Show when={stats().again + stats().hard + stats().good > 0}>
                  <div class="grid grid-cols-3 gap-3 text-center">
                    <div class="rounded-lg border p-3 bg-card">
                      <p class="text-2xl font-bold text-destructive">
                        {stats().again}
                      </p>
                      <p class="text-xs text-muted-foreground mt-0.5">Again</p>
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
                              {item.count} {item.count === 1 ? 'word' : 'words'}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                {/* No upcoming cards at all */}
                <Show
                  when={
                    schedule() &&
                    schedule()!.upcoming.length === 0 &&
                    schedule()!.learnedCards > 0
                  }
                >
                  <p class="text-sm text-muted-foreground">
                    🎉 All {schedule()!.learnedCards} cards are fully mastered!
                  </p>
                </Show>

                <div class="flex flex-col gap-2 justify-center w-full">
                  <Show when={studyData()?.total && studyData()!.total > 0}>
                    <Button class="w-full" onClick={handleReviewAll}>
                      <RefreshCw class="h-4 w-4 mr-2" />
                      Review All Cards ({studyData()?.total ?? 0})
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
                disabled={reviewing()}
              />
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default StudyModePage;
