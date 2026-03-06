import {
  type Component,
  createSignal,
  createResource,
  onMount,
  onCleanup,
  Show,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { api } from '@/api/client';
import type { ReviewAction } from '@/../../api/src/shared/constants';
import Flashcard from '@/components/flashcard/flashcard';
import StudyControls from '@/components/flashcard/study-controls';
import { Button } from '@/components/ui/button';
import { REVIEW_ACTIONS, KEYBOARD_SHORTCUTS } from '@/constants';
import { ArrowLeft, CheckCircle, RotateCcw, Shuffle } from 'lucide-solid';

const InterleavedStudyPage: Component = () => {
  const navigate = useNavigate();

  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [isFlipped, setIsFlipped] = createSignal(false);
  const [reviewing, setReviewing] = createSignal(false);

  // Session stats
  const [stats, setStats] = createSignal({
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  });

  const [studyData, { refetch }] = createResource(async () => {
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
  });

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
      setStats((s) => ({
        ...s,
        again: action === REVIEW_ACTIONS.AGAIN ? s.again + 1 : s.again,
        hard: action === REVIEW_ACTIONS.HARD ? s.hard + 1 : s.hard,
        good: action === REVIEW_ACTIONS.GOOD ? s.good + 1 : s.good,
        easy: action === REVIEW_ACTIONS.EASY ? s.easy + 1 : s.easy,
      }));
      setIsFlipped(false);
      setCurrentIndex((i) => i + 1);
    } finally {
      setReviewing(false);
    }
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setStats({ again: 0, hard: 0, good: 0, easy: 0 });
    setIsFlipped(false);
    refetch();
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

  onMount(() => document.addEventListener('keydown', handleKeyDown));
  onCleanup(() => document.removeEventListener('keydown', handleKeyDown));

  return (
    <div class="min-h-screen flex flex-col">
      {/* Top bar */}
      <div class="border-b px-6 py-3 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft class="h-4 w-4 mr-2" />
          Back
        </Button>
        <div class="text-center">
          <div class="flex items-center gap-1.5">
            <Shuffle class="h-3.5 w-3.5 text-palette-5" />
            <p class="text-sm font-medium">Interleaved Study</p>
          </div>
          <Show when={studyData()}>
            <p class="text-xs text-muted-foreground">
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
          title="Restart session"
        >
          <RotateCcw class="h-4 w-4" />
        </Button>
      </div>

      {/* Progress bar */}
      <div class="h-1 bg-secondary">
        <div
          class="h-full bg-palette-5 transition-all duration-300"
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

                <Show
                  when={stats().again + stats().hard + stats().good > 0}
                  fallback={
                    <div>
                      <h2 class="text-2xl font-bold">All caught up!</h2>
                      <p class="text-muted-foreground mt-1">
                        No cards are due across your decks.
                      </p>
                    </div>
                  }
                >
                  <div>
                    <h2 class="text-2xl font-bold">Session Complete!</h2>
                    <p class="text-muted-foreground mt-1">
                      You've reviewed cards from multiple decks.
                    </p>
                  </div>
                </Show>

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

                <Button variant="outline" onClick={() => navigate('/')}>
                  Back to Dashboard
                </Button>
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
      </div>
    </div>
  );
};

export default InterleavedStudyPage;
