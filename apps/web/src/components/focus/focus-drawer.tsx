import { type Component, Show, createMemo, createEffect } from 'solid-js';
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
} from 'lucide-solid';
import { onCleanup } from 'solid-js';

/* ══════════════════════════════════════════════════════════════
   FOCUS DRAWER
   — Slide-in panel from the right
   — Timer display, duration config, start/stop, stats
   ══════════════════════════════════════════════════════════════ */

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

  return (
    <>
      {/* Backdrop */}
      <Show when={isDrawerOpen()}>
        <div
          class="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity"
          onClick={closeFocusDrawer}
        />
      </Show>

      {/* Drawer panel */}
      <div
        class={`fixed top-0 right-0 h-full w-full sm:w-105 z-50 bg-card border-l shadow-xl
          transform transition-transform duration-300 ease-out
          ${isDrawerOpen() ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div class="flex items-center justify-between px-6 py-4 border-b">
          <div class="flex items-center gap-2">
            <div class="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <Target class="h-4 w-4 text-blue-600 dark:text-blue-400" />
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
          <button
            onClick={closeFocusDrawer}
            class="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X class="h-4 w-4" />
          </button>
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
                  class="transition-all duration-300"
                />
                <defs>
                  <linearGradient
                    id="focusGradient"
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="100%"
                  >
                    <stop offset="0%" stop-color="#3b82f6" />
                    <stop offset="100%" stop-color="#60a5fa" />
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
              {(() => {
                const STEPS = [1 / 60, 5, 10, 15, 20, 25, 30, 45, 60, 90, 120];
                const curIdx = () => {
                  const cur = durationMin();
                  let best = 0;
                  let bestDiff = Infinity;
                  for (let i = 0; i < STEPS.length; i++) {
                    const d = Math.abs(STEPS[i] - cur);
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
                        setDurationMin(STEPS[Math.max(0, curIdx() - 1)])
                      }
                      disabled={curIdx() <= 0}
                      class="h-9 w-9 rounded-full border flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Minus class="h-4 w-4" />
                    </button>
                    <div class="text-center min-w-20">
                      <span class="text-sm font-medium text-foreground">
                        {durationMin() < 1
                          ? '1s'
                          : `${Math.round(durationMin())} min`}
                      </span>
                      <p class="text-xs text-muted-foreground">
                        Focus duration
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        setDurationMin(
                          STEPS[Math.min(STEPS.length - 1, curIdx() + 1)],
                        )
                      }
                      disabled={curIdx() >= STEPS.length - 1}
                      class="h-9 w-9 rounded-full border flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Plus class="h-4 w-4" />
                    </button>
                  </div>
                );
              })()}
            </Show>

            {/* Start / Stop button */}
            <Show
              when={!isRunning()}
              fallback={
                <button
                  onClick={stopFocusSession}
                  class="flex items-center gap-2 px-8 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm shadow-lg hover:shadow-xl transition-all duration-200 active:scale-95"
                >
                  <Square class="h-4 w-4" />
                  Stop Session
                </button>
              }
            >
              <button
                onClick={startFocusSession}
                class="flex items-center gap-2 px-8 py-3 rounded-xl bg-linear-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold text-sm shadow-lg hover:shadow-xl transition-all duration-200 active:scale-95"
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

          {/* Stats section */}
          <div class="border-t px-6 py-5 bg-muted/20">
            <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Today's Progress
            </h3>
            <div class="grid grid-cols-3 gap-3">
              <div class="text-center p-3 rounded-xl bg-card border">
                <div class="flex items-center justify-center mb-1">
                  <Clock class="h-4 w-4 text-blue-500" />
                </div>
                <p class="text-lg font-bold text-foreground">
                  {stats().todayMinutes}
                </p>
                <p class="text-xs text-muted-foreground">Minutes</p>
              </div>
              <div class="text-center p-3 rounded-xl bg-card border">
                <div class="flex items-center justify-center mb-1">
                  <Target class="h-4 w-4 text-green-500" />
                </div>
                <p class="text-lg font-bold text-foreground">
                  {stats().todaySessions}
                </p>
                <p class="text-xs text-muted-foreground">Sessions</p>
              </div>
              <div class="text-center p-3 rounded-xl bg-card border">
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
    </>
  );
};

export default FocusDrawer;
