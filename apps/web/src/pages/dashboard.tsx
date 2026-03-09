import {
  type Component,
  For,
  Show,
  createResource,
  createMemo,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import Sidebar from '@/components/layout/sidebar';
import MobileNav from '@/components/layout/mobile-nav';
import { currentUser } from '@/stores/auth.store';
import { api } from '@/api/client';
import {
  STREAK_MESSAGES,
  HEATMAP_LEVELS,
  NOTIFICATIONS_POLL_MS,
  MONTHS,
} from '@/constants';
import {
  Flame,
  TrendingUp,
  CalendarDays,
  BookOpen,
  Zap,
  CheckCircle2,
  Shuffle,
} from 'lucide-solid';

// ── Types ────────────────────────────────────────────────────────────────────

interface StreakData {
  currentStreak: number;
  longestStreak: number;
  totalStudyDays: number;
  studiedToday: boolean;
}

interface ActivityRow {
  studyDate: string;
  cardsReviewed: number;
}

interface StatsData {
  totalCardsReviewed: number;
  totalStudyDays: number;
}

interface DueDeck {
  deckId: string;
  deckName: string;
  dueCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pick the right motivational message based on streak length */
function getStreakMessage(streak: number): string {
  for (const entry of STREAK_MESSAGES) {
    if (streak >= entry.min) return entry.message;
  }
  return STREAK_MESSAGES[STREAK_MESSAGES.length - 1]!.message;
}

/** Return the Tailwind classes for a heatmap cell based on cardsReviewed */
function getHeatmapClass(cardsReviewed: number): string {
  for (const level of HEATMAP_LEVELS) {
    if (cardsReviewed <= level.max) return level.classes;
  }
  return HEATMAP_LEVELS[HEATMAP_LEVELS.length - 1]!.classes;
}

/**
 * Build a 91-day grid (13 weeks × 7 days) ending today, aligned to Sunday.
 * Returns array of { date: 'YYYY-MM-DD', cardsReviewed }.
 */
function buildHeatmapGrid(activity: ActivityRow[]): {
  date: string;
  cardsReviewed: number;
  isToday: boolean;
  isFuture: boolean;
}[] {
  const activityMap = new Map(
    activity.map((a) => [a.studyDate, a.cardsReviewed]),
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  // Align grid end to the next Saturday (so rows are Sun→Sat)
  const dayOfWeek = today.getDay(); // 0=Sun, 6=Sat
  const daysUntilSat = (6 - dayOfWeek + 7) % 7;
  const gridEnd = new Date(today);
  gridEnd.setDate(gridEnd.getDate() + daysUntilSat);

  // 91 days = 13 weeks
  const GRID_DAYS = 91;
  const gridStart = new Date(gridEnd);
  gridStart.setDate(gridEnd.getDate() - GRID_DAYS + 1);

  const cells = [];
  for (let i = 0; i < GRID_DAYS; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    cells.push({
      date: dateStr,
      cardsReviewed: activityMap.get(dateStr) ?? 0,
      isToday: dateStr === todayStr,
      isFuture: d > today,
    });
  }
  return cells;
}

/** Extract month labels for the columns in the heatmap (one per week) */
function buildMonthLabels(grid: { date: string }[]): string[] {
  // One label per column (7 days), use the start date of each column
  const labels: string[] = [];
  let lastMonth = -1;
  for (let col = 0; col < 13; col++) {
    const cell = grid[col * 7];
    if (!cell) {
      labels.push('');
      continue;
    }
    const month = new Date(cell.date).getMonth();
    if (month !== lastMonth) {
      labels.push(MONTHS[month]!);
      lastMonth = month;
    } else {
      labels.push('');
    }
  }
  return labels;
}

// ── Stat Card ────────────────────────────────────────────────────────────────

const StatCard: Component<{
  label: string;
  value: string | number;
  icon: Component<{ class?: string }>;
  accent?: string;
}> = (props) => (
  <div class="rounded-xl border bg-card p-4 flex items-center gap-4">
    <div
      class={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${props.accent ?? 'bg-muted'}`}
    >
      <props.icon class="h-5 w-5" />
    </div>
    <div>
      <p class="text-2xl font-bold leading-none">{props.value}</p>
      <p class="text-xs text-muted-foreground mt-1">{props.label}</p>
    </div>
  </div>
);

// ── Dashboard Page ───────────────────────────────────────────────────────────

const DashboardPage: Component = () => {
  const navigate = useNavigate();

  // ── Data fetching ───────────────────────────────────────
  const [streakData] = createResource(
    () => currentUser()?.id,
    async () => {
      const { data } = await (api.study as any).streak.get();
      return data as StreakData | null;
    },
  );

  const [activityData] = createResource(
    () => currentUser()?.id,
    async () => {
      const { data } = await (api.study as any).activity.get({
        query: { days: 91 },
      });
      return (
        (data as { activity: ActivityRow[]; days: number } | null)?.activity ??
        []
      );
    },
  );

  const [statsData] = createResource(
    () => currentUser()?.id,
    async () => {
      const { data } = await (api.study as any).stats.get();
      return data as StatsData | null;
    },
  );

  const [dueDecks] = createResource(
    () => currentUser()?.id,
    async () => {
      const { data } = await (api.notifications as any)['due-decks'].get();
      return (data ?? []) as DueDeck[];
    },
  );

  // ── Computed ─────────────────────────────────────────────
  const heatmapGrid = createMemo(() => buildHeatmapGrid(activityData() ?? []));
  const monthLabels = createMemo(() => buildMonthLabels(heatmapGrid()));
  const totalDue = createMemo(() =>
    (dueDecks() ?? []).reduce((s, d) => s + d.dueCount, 0),
  );

  const streak = () => streakData()?.currentStreak ?? 0;
  const streakMessage = () => getStreakMessage(streak());

  return (
    <div class="h-screen flex overflow-hidden">
      <Sidebar />
      <div class="flex flex-col flex-1 overflow-hidden">
        <MobileNav />
        <main class="flex-1 p-6 overflow-y-auto pb-mobile-nav">
          <div class="max-w-3xl mx-auto space-y-6">
            {/* ── Greeting ─── */}
            <div>
              <h2 class="text-2xl font-bold">
                Welcome back
                <Show when={currentUser()?.email}>
                  {', '}
                  <span class="text-palette-5">
                    {currentUser()!.email.split('@')[0]}
                  </span>
                </Show>
                !
              </h2>
              <p class="text-muted-foreground text-sm mt-1">
                {new Date().toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>

            {/* ── Streak Hero Card ─── */}
            <div
              class={`relative rounded-2xl overflow-hidden border ${
                streak() > 0
                  ? 'bg-linear-to-br from-orange-500/10 via-red-500/5 to-yellow-500/10 border-orange-200 dark:border-orange-800/50'
                  : 'bg-muted/30 border-border'
              } p-6`}
            >
              <div class="flex items-center gap-6">
                {/* Flame + number */}
                <div class="flex flex-col items-center gap-1 shrink-0">
                  <div
                    class={`text-6xl select-none ${
                      streak() > 0
                        ? 'animate-[flame_2s_ease-in-out_infinite]'
                        : 'opacity-30 grayscale'
                    }`}
                    style={{
                      filter:
                        streak() > 0
                          ? 'drop-shadow(0 0 8px #f97316)'
                          : undefined,
                    }}
                  >
                    🔥
                  </div>
                </div>

                <div class="flex-1">
                  <div class="flex items-baseline gap-2">
                    <span class="text-5xl font-black tabular-nums leading-none">
                      {streak()}
                    </span>
                    <span class="text-lg font-semibold text-muted-foreground">
                      day{streak() !== 1 ? 's' : ''} streak
                    </span>
                  </div>
                  <p class="text-sm font-medium mt-2 text-foreground/80">
                    {streakMessage()}
                  </p>

                  {/* Studied today indicator */}
                  <div class="flex items-center gap-2 mt-3">
                    <Show
                      when={streakData()?.studiedToday}
                      fallback={
                        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span class="h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse" />
                          Study today to keep your streak!
                        </div>
                      }
                    >
                      <div class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
                        <CheckCircle2 class="h-3.5 w-3.5" />
                        Studied today ✓
                      </div>
                    </Show>
                  </div>
                </div>

                {/* Longest streak badge */}
                <Show when={(streakData()?.longestStreak ?? 0) > 0}>
                  <div class="shrink-0 text-center border rounded-xl px-4 py-3 bg-card">
                    <p class="text-2xl font-black">
                      {streakData()!.longestStreak}
                    </p>
                    <p class="text-xs text-muted-foreground mt-0.5">
                      best streak
                    </p>
                  </div>
                </Show>
              </div>

              {/* Due cards CTA */}
              <Show when={totalDue() > 0}>
                <div class="mt-4 pt-4 border-t border-orange-200/50 dark:border-orange-800/30 flex items-center justify-between">
                  <div class="flex items-center gap-2 text-sm">
                    <Zap class="h-4 w-4 text-yellow-500" />
                    <span class="font-medium">
                      {totalDue()} card{totalDue() !== 1 ? 's' : ''} due for
                      review
                    </span>
                  </div>
                  <button
                    class="text-xs font-semibold text-slate-700 dark:text-slate-400 hover:underline"
                    onClick={() => {
                      const first = dueDecks()?.[0];
                      if (first) navigate(`/study/${first.deckId}`);
                    }}
                  >
                    Start reviewing →
                  </button>
                </div>
              </Show>
            </div>

            {/* ── Stats Row ─── */}
            <div class="grid grid-cols-3 gap-3">
              <StatCard
                label="Cards reviewed"
                value={(statsData()?.totalCardsReviewed ?? 0).toLocaleString()}
                icon={BookOpen}
                accent="bg-palette-1 text-slate-700"
              />
              <StatCard
                label="Study days"
                value={statsData()?.totalStudyDays ?? 0}
                icon={CalendarDays}
                accent="bg-palette-7 text-slate-700"
              />
              <StatCard
                label="Longest streak"
                value={`${streakData()?.longestStreak ?? 0}d`}
                icon={TrendingUp}
                accent="bg-palette-2 text-slate-700"
              />
            </div>

            {/* ── Activity Heatmap ─── */}
            <div class="rounded-xl border bg-section-gradient p-5">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-sm font-semibold">Study Activity</h3>
                <span class="text-xs text-muted-foreground">Last 91 days</span>
              </div>

              {/* Month labels */}
              <div class="flex gap-1 mb-1 pl-8">
                <For each={monthLabels()}>
                  {(label) => (
                    <div class="w-[calc((100%-32px)/13)] text-[9px] text-muted-foreground font-medium">
                      {label}
                    </div>
                  )}
                </For>
              </div>

              {/* Grid: 7 rows (days) × 13 columns (weeks) */}
              <div class="flex gap-1">
                {/* Day labels */}
                <div class="flex flex-col gap-1 mr-1">
                  <For each={['S', 'M', 'T', 'W', 'T', 'F', 'S']}>
                    {(d) => (
                      <div class="h-3 w-3 text-[9px] text-muted-foreground/60 flex items-center justify-center leading-none">
                        {d}
                      </div>
                    )}
                  </For>
                </div>
                {/* Columns */}
                <For each={Array.from({ length: 13 }, (_, col) => col)}>
                  {(col) => (
                    <div class="flex flex-col gap-1 flex-1">
                      <For each={Array.from({ length: 7 }, (_, row) => row)}>
                        {(row) => {
                          const cell = () => heatmapGrid()[col * 7 + row];
                          return (
                            <Show when={cell()}>
                              {(c) => (
                                <div
                                  class={`h-3 rounded-sm transition-all ${
                                    c().isFuture
                                      ? 'opacity-0'
                                      : c().isToday
                                        ? `${getHeatmapClass(c().cardsReviewed)} ring-1 ring-palette-5 ring-offset-1`
                                        : getHeatmapClass(c().cardsReviewed)
                                  }`}
                                  title={`${c().date}: ${c().cardsReviewed} cards`}
                                />
                              )}
                            </Show>
                          );
                        }}
                      </For>
                    </div>
                  )}
                </For>
              </div>

              {/* Legend */}
              <div class="flex items-center gap-1.5 mt-3 justify-end">
                <span class="text-[10px] text-muted-foreground">Less</span>
                <For each={[0, 3, 10, 20, 30]}>
                  {(n) => (
                    <div class={`h-3 w-3 rounded-sm ${getHeatmapClass(n)}`} />
                  )}
                </For>
                <span class="text-[10px] text-muted-foreground">More</span>
              </div>
            </div>

            {/* ── Due Decks ─── */}
            <Show when={(dueDecks() ?? []).length > 0}>
              <div class="rounded-xl border bg-section-gradient p-5">
                <div class="flex items-center justify-between mb-4">
                  <div class="flex items-center gap-2">
                    <Zap class="h-4 w-4 text-yellow-500" />
                    <h3 class="text-sm font-semibold">
                      Ready to Review{' '}
                      <span class="text-muted-foreground font-normal">
                        ({(dueDecks() ?? []).length} deck
                        {(dueDecks() ?? []).length !== 1 ? 's' : ''})
                      </span>
                    </h3>
                  </div>
                  <Show when={(dueDecks() ?? []).length > 1}>
                    <button
                      class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-palette-5/40 text-slate-700 hover:bg-palette-5/60 transition-colors"
                      onClick={() => navigate('/study/interleaved')}
                    >
                      <Shuffle class="h-3.5 w-3.5" />
                      Interleaved Study
                    </button>
                  </Show>
                </div>
                <div class="space-y-2">
                  <For each={dueDecks() ?? []}>
                    {(deck) => (
                      <button
                        class="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-accent transition-colors text-left group"
                        onClick={() => navigate(`/study/${deck.deckId}`)}
                      >
                        <div class="h-9 w-9 rounded-lg bg-palette-1 flex items-center justify-center shrink-0">
                          <BookOpen class="h-4 w-4 text-slate-700" />
                        </div>
                        <div class="flex-1 min-w-0">
                          <p class="text-sm font-medium truncate">
                            {deck.deckName}
                          </p>
                          <p class="text-xs text-muted-foreground">
                            {deck.dueCount} card{deck.dueCount !== 1 ? 's' : ''}{' '}
                            due
                          </p>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-palette-6 text-slate-700">
                            {deck.dueCount} due
                          </span>
                          <span class="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                            Study →
                          </span>
                        </div>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* ── Empty state ─── */}
            <Show
              when={
                !dueDecks.loading &&
                (dueDecks() ?? []).length === 0 &&
                (statsData()?.totalCardsReviewed ?? 0) === 0
              }
            >
              <div class="rounded-xl border bg-card/50 p-8 text-center text-muted-foreground">
                <p class="text-4xl mb-3">📚</p>
                <p class="font-medium text-foreground">Nothing here yet</p>
                <p class="text-sm mt-1">
                  Create a class in the sidebar to start your study journey!
                </p>
              </div>
            </Show>
          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardPage;
