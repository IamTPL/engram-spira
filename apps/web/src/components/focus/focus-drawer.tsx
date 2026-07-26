import {
  type Component,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  Clock,
  Dice1,
  Dice2,
  Dice3,
  Dice4,
  Dice5,
  Dice6,
  Flame,
  Minus,
  Play,
  Plus,
  Settings2,
  Square,
  Target,
  X,
} from 'lucide-solid';
import { Button } from '@/components/ui/button';
import {
  closeFocusDrawer,
  durationMin,
  formatFocusTime,
  getStats,
  isDrawerOpen,
  isRunning,
  remainingSeconds,
  rewardLabels,
  setDurationMin,
  showReward,
  startFocusSession,
  stopFocusSession,
  updateRewardLabel,
} from '@/stores/focus.store';
import {
  playBreakTimeChime,
  requestNotificationPermission,
  sendBreakTimeNotification,
} from './focus-sounds';
import RewardPopup from './reward-popup';

const DURATION_STEPS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120];
const DICE_ICONS = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const DurationStepper: Component = () => {
  const currentIndex = () => {
    const currentDuration = durationMin();
    let closestIndex = 0;
    let closestDifference = Infinity;

    for (let index = 0; index < DURATION_STEPS.length; index++) {
      const difference = Math.abs(DURATION_STEPS[index] - currentDuration);
      if (difference < closestDifference) {
        closestDifference = difference;
        closestIndex = index;
      }
    }

    return closestIndex;
  };

  return (
    <div class="mb-8 flex items-center gap-4">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Use a shorter focus duration"
        disabled={currentIndex() <= 0}
        onClick={() =>
          setDurationMin(DURATION_STEPS[Math.max(0, currentIndex() - 1)])
        }
      >
        <Minus class="h-4 w-4" />
      </Button>

      <div class="min-w-24 text-center">
        <span class="text-sm font-semibold text-foreground">
          {Math.round(durationMin())} min
        </span>
        <p class="text-xs text-muted-foreground">Focus duration</p>
      </div>

      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Use a longer focus duration"
        disabled={currentIndex() >= DURATION_STEPS.length - 1}
        onClick={() =>
          setDurationMin(
            DURATION_STEPS[
              Math.min(DURATION_STEPS.length - 1, currentIndex() + 1)
            ],
          )
        }
      >
        <Plus class="h-4 w-4" />
      </Button>
    </div>
  );
};

const FocusDrawer: Component = () => {
  let panelRef: HTMLElement | undefined;
  const [showSettings, setShowSettings] = createSignal(false);

  createEffect(() => {
    if (!isDrawerOpen() || showReward()) return;

    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusFrame = requestAnimationFrame(() => panelRef?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFocusDrawer();
        return;
      }

      if (event.key !== 'Tab' || !panelRef) return;

      const focusable = Array.from(
        panelRef.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === panelRef)
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

  createEffect(() => {
    if (isDrawerOpen()) {
      void requestNotificationPermission();
    }
  });

  createEffect(() => {
    if (showReward()) {
      playBreakTimeChime();
      sendBreakTimeNotification();
    }
  });

  const timeDisplay = () =>
    formatFocusTime(
      isRunning() ? remainingSeconds() : Math.round(durationMin() * 60),
    );

  const progress = createMemo(() => {
    if (!isRunning()) return 0;
    const total = durationMin() * 60;
    return Math.max(0, Math.min(1, 1 - remainingSeconds() / total));
  });

  const stats = createMemo(() => getStats());
  const circumference = 2 * Math.PI * 90;

  return (
    <>
      <Show when={isDrawerOpen()}>
        <Portal>
          <div class="fixed inset-0 z-50">
            <button
              type="button"
              tabindex="-1"
              aria-label="Close Focus Mode"
              class="absolute inset-0 cursor-default bg-overlay motion-safe:animate-fade-in"
              onClick={closeFocusDrawer}
            />

            <section
              ref={(element) => {
                panelRef = element;
              }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="focus-dialog-title"
              aria-describedby="focus-dialog-description"
              tabindex="-1"
              class="absolute inset-y-0 right-0 flex w-full flex-col border-l bg-card shadow-xl outline-none sm:w-[420px] motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-300"
            >
              <header class="flex h-16 shrink-0 items-center justify-between border-b px-5">
                <div class="flex min-w-0 items-center gap-3">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <Target class="h-4 w-4" />
                  </span>
                  <div class="min-w-0">
                    <h2
                      id="focus-dialog-title"
                      class="truncate text-base font-semibold"
                    >
                      Focus Mode
                    </h2>
                    <p
                      id="focus-dialog-description"
                      class="truncate text-xs text-muted-foreground"
                    >
                      Focus now, choose a reward after.
                    </p>
                  </div>
                </div>

                <div class="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="h-9 w-9"
                    aria-label="Customize rewards"
                    aria-controls="focus-reward-settings"
                    aria-expanded={showSettings()}
                    onClick={() => setShowSettings((visible) => !visible)}
                  >
                    <Settings2 class="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="h-9 w-9"
                    aria-label="Close Focus Mode"
                    onClick={closeFocusDrawer}
                  >
                    <X class="h-4 w-4" />
                  </Button>
                </div>
              </header>

              <div class="min-h-0 flex-1 overflow-y-auto">
                <div class="flex min-h-[480px] flex-col items-center justify-center px-6 py-8">
                  <div class="relative mb-8 h-56 w-56" aria-hidden="true">
                    <svg class="h-full w-full -rotate-90" viewBox="0 0 200 200">
                      <circle
                        cx="100"
                        cy="100"
                        r="90"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="6"
                        class="text-muted"
                      />
                      <circle
                        cx="100"
                        cy="100"
                        r="90"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="6"
                        stroke-linecap="round"
                        stroke-dasharray={circumference.toString()}
                        stroke-dashoffset={(
                          circumference *
                          (1 - progress())
                        ).toString()}
                        class="text-primary transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
                      />
                    </svg>

                    <div class="absolute inset-0 flex flex-col items-center justify-center">
                      <span class="text-4xl font-bold tracking-tight text-foreground tabular-nums">
                        {timeDisplay()}
                      </span>
                      <span class="mt-1 text-xs text-muted-foreground">
                        {isRunning() ? 'Focusing' : 'Ready'}
                      </span>
                    </div>
                  </div>

                  <p class="sr-only" role="timer" aria-live="off">
                    {isRunning()
                      ? `${timeDisplay()} remaining`
                      : `${Math.round(durationMin())} minute timer ready`}
                  </p>

                  <Show when={!isRunning()}>
                    <DurationStepper />
                  </Show>

                  <Show
                    when={!isRunning()}
                    fallback={
                      <Button
                        type="button"
                        variant="destructive"
                        size="lg"
                        class="h-11 min-w-44 active:translate-y-px"
                        onClick={stopFocusSession}
                      >
                        <Square class="h-4 w-4" />
                        Stop session
                      </Button>
                    }
                  >
                    <Button
                      type="button"
                      size="lg"
                      class="h-11 min-w-44 active:translate-y-px"
                      onClick={startFocusSession}
                    >
                      <Play class="h-4 w-4" />
                      Start focus
                    </Button>
                  </Show>

                  <p class="mt-4 max-w-72 text-center text-xs leading-5 text-muted-foreground">
                    {isRunning()
                      ? 'Close this panel and keep working. Your timer will continue.'
                      : 'Choose a duration, then study here or focus on another task.'}
                  </p>
                </div>

                <Show when={showSettings()}>
                  <section
                    id="focus-reward-settings"
                    class="border-t bg-muted/20 px-6 py-5 motion-safe:animate-fade-in"
                  >
                    <h3 class="mb-1 text-sm font-semibold">
                      Dice rewards
                    </h3>
                    <p class="mb-4 text-xs text-muted-foreground">
                      Each reward maps to one face of the dice.
                    </p>

                    <div class="space-y-3">
                      <Index each={rewardLabels()}>
                        {(label, index) => {
                          const Icon = DICE_ICONS[index];
                          const inputId = `focus-reward-${index + 1}`;

                          return (
                            <div class="flex items-center gap-3">
                              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
                                <Icon class="h-4 w-4" />
                              </span>
                              <div class="min-w-0 flex-1">
                                <label class="sr-only" for={inputId}>
                                  Reward {index + 1}
                                </label>
                                <input
                                  id={inputId}
                                  type="text"
                                  value={label()}
                                  onInput={(event) =>
                                    updateRewardLabel(
                                      index,
                                      event.currentTarget.value,
                                    )
                                  }
                                  class="h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                                  maxLength={40}
                                />
                              </div>
                            </div>
                          );
                        }}
                      </Index>
                    </div>
                  </section>
                </Show>

                <section class="border-t px-6 py-5">
                  <h3 class="mb-3 text-sm font-semibold">
                    Today's progress
                  </h3>
                  <div class="grid grid-cols-3 gap-3">
                    <div class="rounded-md border bg-muted/30 p-3 text-center">
                      <Clock class="mx-auto mb-1 h-4 w-4 text-info" />
                      <p class="text-lg font-bold tabular-nums">
                        {stats().todayMinutes}
                      </p>
                      <p class="text-xs text-muted-foreground">Minutes</p>
                    </div>
                    <div class="rounded-md border bg-muted/30 p-3 text-center">
                      <Target class="mx-auto mb-1 h-4 w-4 text-success" />
                      <p class="text-lg font-bold tabular-nums">
                        {stats().todaySessions}
                      </p>
                      <p class="text-xs text-muted-foreground">Sessions</p>
                    </div>
                    <div class="rounded-md border bg-muted/30 p-3 text-center">
                      <Flame class="mx-auto mb-1 h-4 w-4 text-warning" />
                      <p class="text-lg font-bold tabular-nums">
                        {stats().streak}
                      </p>
                      <p class="text-xs text-muted-foreground">Day streak</p>
                    </div>
                  </div>
                </section>
              </div>
            </section>
          </div>
        </Portal>
      </Show>

      <RewardPopup />
    </>
  );
};

export default FocusDrawer;
