import { type Component, Show, createMemo, createEffect, Index } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  isDrawerOpen,
  closeFocusDrawer,
  isRunning,
  remainingSeconds,
  durationMin,
  setDurationMin,
  startFocusSession,
  stopFocusSession,
  getStats,
  showReward,
  rewardLabels,
  updateRewardLabel,
} from '@/stores/focus.store';
import {
  playBreakTimeChime,
  sendBreakTimeNotification,
  requestNotificationPermission,
} from './focus-sounds';
import RewardPopup from './reward-popup';
import {
  X,
  Play,
  Square,
  Clock,
  Flame,
  Target,
  Minus,
  Plus,
  Settings2,
  Dice1,
  Dice2,
  Dice3,
  Dice4,
  Dice5,
  Dice6,
} from 'lucide-solid';
import { onCleanup, createSignal } from 'solid-js';

/* ══════════════════════════════════════════════════════════════
   FOCUS DRAWER
   — Slide-in panel from the right
   — Timer display, duration config, start/stop, stats
   ══════════════════════════════════════════════════════════════ */

// ── Extracted from IIFE to proper component (Solid.js best practice) ──
const DURATION_STEPS = [1 / 60, 5, 10, 15, 20, 25, 30, 45, 60, 90, 120];

const DurationStepper: Component = () => {
  const curIdx = () => {
    const cur = durationMin();
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < DURATION_STEPS.length; i++) {
      const d = Math.abs(DURATION_STEPS[i] - cur);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    return best;
  };

  return (
    <div class="flex items-center gap-4 mb-8">
      <button
        onClick={() =>
          setDurationMin(DURATION_STEPS[Math.max(0, curIdx() - 1)])
        }
        disabled={curIdx() <= 0}
        class="h-9 w-9 rounded-full border flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Minus class="h-4 w-4" />
      </button>
      <div class="text-center min-w-20">
        <span class="text-sm font-medium text-foreground">
          {durationMin() < 1 ? '1s' : `${Math.round(durationMin())} min`}
        </span>
        <p class="text-xs text-muted-foreground">Focus duration</p>
      </div>
      <button
        onClick={() =>
          setDurationMin(
            DURATION_STEPS[Math.min(DURATION_STEPS.length - 1, curIdx() + 1)],
          )
        }
        disabled={curIdx() >= DURATION_STEPS.length - 1}
        class="h-9 w-9 rounded-full border flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Plus class="h-4 w-4" />
      </button>
    </div>
  );
};

const FocusDrawer: Component = () => {
  // Escape key to close drawer
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isDrawerOpen()) {
      closeFocusDrawer();
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
  }

  // Request notification permission on first open
  createEffect(() => {
    if (isDrawerOpen()) {
      requestNotificationPermission();
    }
  });

  // Play sound + send notification when session completes
  createEffect(() => {
    if (showReward()) {
      playBreakTimeChime();
      sendBreakTimeNotification();
    }
  });

  // Format seconds to MM:SS
  const timeDisplay = createMemo(() => {
    const total = isRunning()
      ? remainingSeconds()
      : Math.round(durationMin() * 60);
    const mins = Math.floor(total / 60);
    const secs = Math.floor(total % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  });

  // Progress percentage (0 to 1)
  const progress = createMemo(() => {
    if (!isRunning()) return 0;
    const total = durationMin() * 60;
    const remaining = remainingSeconds();
    return Math.max(0, Math.min(1, 1 - remaining / total));
  });

  // Stats
  const stats = createMemo(() => getStats());

  // Circle progress (SVG)
  const circumference = 2 * Math.PI * 90; // radius = 90

  const [showSettings, setShowSettings] = createSignal(false);

  const DICE_ICONS = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];

  return (
    <>
      {/* Backdrop */}
      <Show when={isDrawerOpen()}>
        <Portal>
          <div
            class="fixed inset-0 z-40 bg-black/50 transition-opacity"
            onClick={closeFocusDrawer}
          />
        </Portal>
      </Show>

      {/* Drawer panel */}
      <Portal>
        <div
          class={`fixed top-0 right-0 h-full w-full sm:w-105 z-50 bg-card border-l shadow-xl
          transform transition-transform duration-300 ease-out
          ${isDrawerOpen() ? 'translate-x-0' : 'translate-x-full'}`}
        >
          {/* Header */}
          <div class="flex items-center justify-between px-6 py-4 border-b">
            <div class="flex items-center gap-2">
              <div class="h-8 w-8 rounded-lg bg-palette-1/20 flex items-center justify-center">
                <Target class="h-4 w-4 text-palette-1" />
              </div>
              <div>
                <h2 class="text-base font-semibold text-foreground">
                  Focus Mode
                </h2>
                <p class="text-xs text-muted-foreground">
                  Stay focused, earn rewards
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                onClick={() => setShowSettings(!showSettings())}
                class="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                title="Customize Rewards"
              >
                <Settings2 class="h-4 w-4" />
              </button>
              <button
                onClick={closeFocusDrawer}
                class="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div class="flex flex-col h-[calc(100%-65px)] overflow-y-auto">
            {/* Timer section */}
            <div class="flex-1 flex flex-col items-center justify-center px-6 py-8">
              {/* Circular timer */}
              <div class="relative w-56 h-56 mb-8">
                {/* SVG circle progress */}
                <svg class="w-full h-full -rotate-90" viewBox="0 0 200 200">
                  {/* Background circle */}
                  <circle
                    cx="100"
                    cy="100"
                    r="90"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="6"
                    class="text-muted/60"
                  />
                  {/* Progress circle */}
                  <circle
                    cx="100"
                    cy="100"
                    r="90"
                    fill="none"
                    stroke="url(#focusGradient)"
                    stroke-width="6"
                    stroke-linecap="round"
                    stroke-dasharray={circumference.toString()}
                    stroke-dashoffset={(
                      circumference *
                      (1 - progress())
                    ).toString()}
                    class="transition-[stroke-dashoffset] duration-300"
                  />
                  <defs>
                    <linearGradient
                      id="focusGradient"
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="100%"
                    >
                      <stop offset="0%" stop-color="#B5CCFF" />
                      <stop offset="100%" stop-color="#ABF6D0" />
                    </linearGradient>
                  </defs>
                </svg>

                {/* Timer text */}
                <div class="absolute inset-0 flex flex-col items-center justify-center">
                  <span class="text-4xl font-bold tracking-tight text-foreground tabular-nums">
                    {timeDisplay()}
                  </span>
                  <span class="text-xs text-muted-foreground mt-1">
                    {isRunning() ? 'Focusing...' : 'Ready'}
                  </span>
                </div>
              </div>

              {/* Duration setting (only when not running) */}
              <Show when={!isRunning()}>
                <DurationStepper />
              </Show>

              {/* Start / Stop button */}
              <Show
                when={!isRunning()}
                fallback={
                  <button
                    onClick={stopFocusSession}
                    class="flex items-center gap-2 px-8 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm shadow-lg hover:shadow-xl transition-[background-color,box-shadow,transform] duration-200 active:scale-95"
                  >
                    <Square class="h-4 w-4" />
                    Stop Session
                  </button>
                }
              >
                <button
                  onClick={startFocusSession}
                  class="btn-gradient flex items-center gap-2 px-8 py-3 rounded-xl text-slate-800 font-semibold text-sm shadow-lg hover:opacity-90 hover:shadow-xl transition-[opacity,box-shadow,transform] duration-200 active:scale-95"
                >
                  <Play class="h-4 w-4" />
                  Start Focus
                </button>
              </Show>

              {/* Hint text */}
              <p class="text-xs text-muted-foreground text-center mt-4 max-w-70">
                {isRunning()
                  ? 'Focus on your task. A reward awaits when the timer ends!'
                  : 'Set your focus duration and start. You can study on the app or work on anything outside.'}
              </p>
            </div>

            {/* Reward Settings Panel */}
            <Show when={showSettings()}>
              <div class="border-t px-6 py-5 bg-card animate-in slide-in-from-top-4 fade-in duration-300">
                <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                  Customize 6-Sided Dice Rewards
                </h3>
                <div class="space-y-3">
                  <Index each={rewardLabels()}>
                    {(label, idx) => {
                      const Icon = DICE_ICONS[idx];
                      return (
                        <div class="flex items-center gap-3">
                          <div class="h-8 w-8 rounded bg-blue-700/10 flex items-center justify-center text-blue-700 shrink-0 border border-blue-700/20">
                            <Icon class="h-5 w-5" />
                          </div>
                          <input
                            type="text"
                            value={label()}
                            onInput={(e) =>
                              updateRewardLabel(idx, e.currentTarget.value)
                            }
                            placeholder={`Reward ${idx + 1}`}
                            class="flex-1 bg-transparent border-b border-border/50 focus:border-blue-700 pb-1 text-sm text-foreground outline-none transition-colors"
                            maxLength={40}
                          />
                        </div>
                      );
                    }}
                  </Index>
                </div>
                <p class="text-[10px] text-muted-foreground mt-4 text-center">
                  These exactly map to the dice faces rolled after a session.
                </p>
              </div>
            </Show>

            {/* Stats section */}
            <div class="border-t px-6 py-5 bg-section-gradient">
              <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Today's Progress
              </h3>
              <div class="grid grid-cols-3 gap-3">
                <div class="text-center p-3 rounded-xl bg-bg-card-mint border">
                  <div class="flex items-center justify-center mb-1">
                    <Clock class="h-4 w-4 text-palette-3" />
                  </div>
                  <p class="text-lg font-bold text-foreground">
                    {stats().todayMinutes}
                  </p>
                  <p class="text-xs text-muted-foreground">Minutes</p>
                </div>
                <div class="text-center p-3 rounded-xl bg-bg-card-pink border">
                  <div class="flex items-center justify-center mb-1">
                    <Target class="h-4 w-4 text-palette-2" />
                  </div>
                  <p class="text-lg font-bold text-foreground">
                    {stats().todaySessions}
                  </p>
                  <p class="text-xs text-muted-foreground">Sessions</p>
                </div>
                <div class="text-center p-3 rounded-xl bg-bg-card-lavender border">
                  <div class="flex items-center justify-center mb-1">
                    <Flame class="h-4 w-4 text-orange-500" />
                  </div>
                  <p class="text-lg font-bold text-foreground">
                    {stats().streak}
                  </p>
                  <p class="text-xs text-muted-foreground">Day streak</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Reward Popup — rendered at root level */}
        <RewardPopup />
      </Portal>
    </>
  );
};

export default FocusDrawer;
