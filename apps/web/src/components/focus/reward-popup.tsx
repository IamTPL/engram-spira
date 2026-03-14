import {
  type Component,
  Show,
  For,
  createSignal,
  createEffect,
  lazy,
  Suspense,
} from 'solid-js';
import {
  showReward,
  closeReward,
  startFocusSession,
} from '@/stores/focus.store';
import type { Reward } from './dodecahedron-dice';
import { playDiceRollSound, playRewardRevealSound } from './focus-sounds';
import { X, RotateCcw, Play } from 'lucide-solid';
import Spinner from '@/components/ui/spinner';

// Lazy-load CubeDice — pulls in Three.js (~500KB), only needed when reward popup opens
const CubeDice = lazy(() => import('./dodecahedron-dice'));

/* ══════════════════════════════════════════════════════════════
   REWARD POPUP
   — Full-screen overlay with the 3D dodecahedron dice
   — User clicks dice to roll → result with confetti
   — 1 free re-roll allowed per session
   — Next Session disabled until dice has been rolled
   ══════════════════════════════════════════════════════════════ */

const RewardPopup: Component = () => {
  const [rolling, setRolling] = createSignal(false);
  const [result, setResult] = createSignal<Reward | null>(null);
  const [showResult, setShowResult] = createSignal(false);
  /** How many re-rolls remain (user gets 1 after first roll) */
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

  // Reset state when popup opens
  createEffect(() => {
    if (showReward()) {
      setResult(null);
      setShowResult(false);
      setRolling(false);
      setRerollsLeft(1);
      setConfettiPieces([]);
    }
  });

  const handleResult = (reward: Reward) => {
    setResult(reward);
    playRewardRevealSound();

    // Trigger confetti
    const colors = [
      '#3b82f6',
      '#60a5fa',
      '#f59e0b',
      '#10b981',
      '#ef4444',
      '#8b5cf6',
      '#ec4899',
    ];
    const pieces = Array.from({ length: 40 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 8 + 4,
      borderRadius: Math.random() > 0.5 ? '50%' : '2px',
    }));
    setConfettiPieces(pieces);

    // Show result card with slight delay for drama
    setTimeout(() => setShowResult(true), 300);
  };

  const handleRollingChange = (isRolling: boolean) => {
    setRolling(isRolling);
    if (isRolling) {
      playDiceRollSound();
      setShowResult(false);
      setResult(null);
      setConfettiPieces([]);
    }
  };

  const handleReroll = () => {
    if (rerollsLeft() <= 0) return;
    setRerollsLeft((n) => n - 1);
    setShowResult(false);
    setResult(null);
    setConfettiPieces([]);
    setRolling(true);
  };

  const handleStartNext = () => {
    closeReward();
    startFocusSession();
  };

  const handleDismiss = () => {
    closeReward();
  };

  /** Reward label for display — maps face number to reward */
  const rewardDisplay = () => {
    const r = result();
    if (!r) return null;
    return r;
  };

  return (
    <Show when={showReward()}>
      <div class="fixed inset-0 z-100 flex items-center justify-center">
        {/* Backdrop */}
        <div class="absolute inset-0 bg-black/60 backdrop-blur-md" />

        {/* Confetti */}
        <div class="absolute inset-0 pointer-events-none overflow-hidden">
          <For each={confettiPieces()}>
            {(piece) => (
              <div
                class="absolute top-0 animate-confetti-fall"
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

        {/* Main content */}
        <div class="relative z-10 w-full max-w-md mx-4 animate-scale-in">
          {/* Close button */}
          <button
            onClick={handleDismiss}
            class="absolute -top-2 -right-2 z-20 h-8 w-8 rounded-full bg-card border shadow-md flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X class="h-4 w-4" />
          </button>

          {/* Card */}
          <div class="bg-card rounded-2xl shadow-2xl border overflow-hidden">
            {/* Header */}
            <div class="text-center px-6 pt-6 pb-2">
              <h2 class="text-xl font-bold text-foreground">🎉 Break Time!</h2>
              <p class="text-sm text-muted-foreground mt-1">
                {showResult()
                  ? 'Here is your reward!'
                  : 'Click the dice to roll for your reward'}
              </p>
            </div>

            {/* 3D Dice (lazy-loaded with Three.js) */}
            <div class="px-6 py-4">
              <Suspense fallback={<div class="w-full aspect-square max-w-72 mx-auto flex items-center justify-center"><Spinner size="lg" /></div>}>
                <CubeDice
                  onResult={handleResult}
                  rolling={rolling()}
                  onRollingChange={handleRollingChange}
                />
              </Suspense>
            </div>

            {/* Result card */}
            <Show when={showResult() && rewardDisplay()}>
              {(reward) => (
                <div class="px-6 pb-4">
                  <div class="rounded-xl p-4 border animate-fade-in bg-palette-1/15 border-palette-1/30">
                    <div class="flex items-center gap-3">
                      <span class="text-3xl text-palette-5">
                        <Show when={reward()}>
                          {(r) => {
                            const Icon = r().icon;
                            return <Icon class="h-8 w-8" />;
                          }}
                        </Show>
                      </span>
                      <div>
                        <p class="font-semibold text-foreground">
                          {reward().label}
                        </p>
                        <p class="text-xs text-muted-foreground">
                          Enjoy your well-deserved break!
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Show>

            {/* Actions */}
            <div class="px-6 pb-6 flex gap-3">
              <Show when={showResult()}>
                <button
                  onClick={handleReroll}
                  disabled={rerollsLeft() <= 0}
                  class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RotateCcw class="h-3.5 w-3.5" />
                  Re-roll
                  <Show when={rerollsLeft() > 0}>
                    <span class="text-xs text-muted-foreground">
                      ({rerollsLeft()})
                    </span>
                  </Show>
                </button>
              </Show>
              <button
                onClick={handleStartNext}
                disabled={!showResult()}
                class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl btn-gradient text-slate-800 text-sm font-semibold shadow-md hover:shadow-lg hover:opacity-90 transition-[opacity,box-shadow,transform] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play class="h-3.5 w-3.5" />
                Next Session
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default RewardPopup;
