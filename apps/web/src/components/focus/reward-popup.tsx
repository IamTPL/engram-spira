import {
  type Component,
  For,
  Show,
  Suspense,
  createEffect,
  createSignal,
  lazy,
  onCleanup,
} from 'solid-js';
import { Gift, Play, RotateCcw, X } from 'lucide-solid';
import { Button } from '@/components/ui/button';
import {
  closeReward,
  showReward,
  startFocusSession,
} from '@/stores/focus.store';
import type { Reward } from './dodecahedron-dice';
import { playDiceRollSound, playRewardRevealSound } from './focus-sounds';

const CubeDice = lazy(() => import('./dodecahedron-dice'));
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const RewardPopup: Component = () => {
  let dialogRef: HTMLDivElement | undefined;
  const [rolling, setRolling] = createSignal(false);
  const [result, setResult] = createSignal<Reward | null>(null);
  const [showResult, setShowResult] = createSignal(false);
  const [rerollsLeft, setRerollsLeft] = createSignal(1);
  const [confettiPieces, setConfettiPieces] = createSignal<
    Array<{
      id: number;
      left: number;
      delay: number;
      color: string;
      size: number;
      borderRadius: string;
    }>
  >([]);

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  createEffect(() => {
    if (!showReward()) return;

    setResult(null);
    setShowResult(false);
    setRolling(false);
    setRerollsLeft(1);
    setConfettiPieces([]);

    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusFrame = requestAnimationFrame(() => dialogRef?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeReward();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef) return;

      const focusable = Array.from(
        dialogRef.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialogRef)
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      trigger?.focus();
    });
  });

  const handleResult = (reward: Reward) => {
    setResult(reward);
    playRewardRevealSound();

    if (!prefersReducedMotion()) {
      const colors = [
        'var(--color-info)',
        'var(--color-success)',
        'var(--color-warning)',
        'var(--color-destructive)',
        'var(--color-primary)',
      ];
      setConfettiPieces(
        Array.from({ length: 32 }, (_, index) => ({
          id: index,
          left: Math.random() * 100,
          delay: Math.random() * 0.35,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: Math.random() * 7 + 4,
          borderRadius: Math.random() > 0.5 ? '50%' : '2px',
        })),
      );
    }

    setShowResult(true);
  };

  const handleRollingChange = (nextRolling: boolean) => {
    setRolling(nextRolling);
    if (!nextRolling) return;

    playDiceRollSound();
    setShowResult(false);
    setResult(null);
    setConfettiPieces([]);
  };

  const handleRoll = () => {
    if (!rolling()) handleRollingChange(true);
  };

  const handleReroll = () => {
    if (rerollsLeft() <= 0 || rolling()) return;
    setRerollsLeft((remaining) => remaining - 1);
    handleRollingChange(true);
  };

  const handleStartNext = () => {
    closeReward();
    startFocusSession();
  };

  return (
    <Show when={showReward()}>
      <div class="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <button
          type="button"
          tabindex="-1"
          aria-label="Skip reward"
          class="absolute inset-0 cursor-default bg-overlay"
          onClick={closeReward}
        />

        <div
          ref={(element) => {
            dialogRef = element;
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reward-dialog-title"
          aria-describedby="reward-dialog-description"
          tabindex="-1"
          class="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border bg-card shadow-xl outline-none motion-safe:animate-scale-in"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="absolute right-3 top-3 z-20 h-8 w-8"
            aria-label="Close reward"
            onClick={closeReward}
          >
            <X class="h-4 w-4" />
          </Button>

          <header class="px-6 pb-2 pt-6 text-center">
            <span class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Gift class="h-5 w-5" />
            </span>
            <h2 id="reward-dialog-title" class="text-xl font-bold">
              Focus complete
            </h2>
            <p
              id="reward-dialog-description"
              class="mt-1 text-sm text-muted-foreground"
            >
              {showResult()
                ? 'Your break reward is ready.'
                : 'Roll the dice to choose your break.'}
            </p>
          </header>

          <div class="flex justify-center px-6 py-3">
            <Suspense
              fallback={
                <div class="aspect-square w-full max-w-72 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
              }
            >
              <CubeDice
                onResult={handleResult}
                rolling={rolling()}
                onRollingChange={handleRollingChange}
                disabled={showResult()}
              />
            </Suspense>
          </div>

          <Show when={showResult() && result()}>
            {(reward) => (
              <div class="px-6 pb-4" aria-live="polite">
                <div class="rounded-md border bg-muted/30 p-4">
                  <div class="flex items-center gap-3">
                    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-background text-primary">
                      <Show when={reward()}>
                        {(resolvedReward) => {
                          const Icon = resolvedReward().icon;
                          return <Icon class="h-5 w-5" />;
                        }}
                      </Show>
                    </span>
                    <div class="min-w-0">
                      <p class="font-semibold">{reward().label}</p>
                      <p class="text-xs text-muted-foreground">
                        Take the break, then return when you are ready.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <div class="flex gap-3 px-6 pb-6">
            <Show
              when={showResult()}
              fallback={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    class="flex-1"
                    onClick={closeReward}
                  >
                    Skip reward
                  </Button>
                  <Button
                    type="button"
                    class="flex-1 active:translate-y-px"
                    loading={rolling()}
                    onClick={handleRoll}
                  >
                    Roll reward
                  </Button>
                </>
              }
            >
              <Button
                type="button"
                variant="outline"
                class="flex-1"
                disabled={rerollsLeft() <= 0 || rolling()}
                onClick={handleReroll}
              >
                <RotateCcw class="h-4 w-4" />
                Reroll
                <Show when={rerollsLeft() > 0}>
                  <span class="text-xs text-muted-foreground">
                    {rerollsLeft()} left
                  </span>
                </Show>
              </Button>
              <Button
                type="button"
                class="flex-1 active:translate-y-px"
                onClick={handleStartNext}
              >
                <Play class="h-4 w-4" />
                Next session
              </Button>
            </Show>
          </div>

          <div
            class="pointer-events-none absolute inset-0 overflow-hidden"
            aria-hidden="true"
          >
            <For each={confettiPieces()}>
              {(piece) => (
                <span
                  class="absolute top-0 animate-confetti-fall motion-reduce:hidden"
                  style={{
                    left: `${piece.left}%`,
                    'animation-delay': `${piece.delay}s`,
                    width: `${piece.size}px`,
                    height: `${piece.size}px`,
                    'background-color': piece.color,
                    'border-radius': piece.borderRadius,
                  }}
                />
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default RewardPopup;
