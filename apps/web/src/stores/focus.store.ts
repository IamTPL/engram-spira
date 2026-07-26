import { createSignal } from 'solid-js';

/* ══════════════════════════════════════════════════════════════
   FOCUS MODE STORE
   — Manages timer state, session history, and drawer visibility.
   — Persists to localStorage so refresh doesn't lose progress.
   ══════════════════════════════════════════════════════════════ */

// ── Types ─────────────────────────────────────────────────────
export interface FocusSession {
  startedAt: number; // epoch ms
  durationMs: number; // planned duration
  completedAt?: number; // epoch ms when session ended
}

export interface FocusStats {
  todayMinutes: number;
  todaySessions: number;
  streak: number; // consecutive days with at least 1 session
}

// ── Constants ─────────────────────────────────────────────────
const STORAGE_KEY = 'engram-focus';
const DEFAULT_DURATION_MIN = 30;
const MIN_DURATION = 5;
const MAX_DURATION = 120;
/** Keep at most this many sessions in localStorage to prevent bloat */
const MAX_PERSISTED_SESSIONS = 200;

// ── Persistence helpers ───────────────────────────────────────
interface PersistedState {
  durationMin: number;
  sessions: FocusSession[];
  activeStart: number | null;
  activeDurationMs: number | null;
  rewardLabels?: string[];
}

function load(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PersistedState;
  } catch {
    /* noop */
  }
  return {
    durationMin: DEFAULT_DURATION_MIN,
    sessions: [],
    activeStart: null,
    activeDurationMs: null,
    rewardLabels: undefined,
  };
}

function save(state: PersistedState) {
  // Trim old sessions to prevent localStorage bloat over months of usage
  if (state.sessions.length > MAX_PERSISTED_SESSIONS) {
    state.sessions = state.sessions.slice(-MAX_PERSISTED_SESSIONS);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ── Signals ───────────────────────────────────────────────────
const initial = load();
const initialDurationMin = Number.isFinite(initial.durationMin)
  ? Math.max(MIN_DURATION, Math.min(MAX_DURATION, initial.durationMin))
  : DEFAULT_DURATION_MIN;
const hasActiveSession =
  initial.activeStart !== null && initial.activeDurationMs !== null;
const initialRemainingSeconds = hasActiveSession
  ? Math.max(
      0,
      Math.ceil(
        (initial.activeStart! +
          initial.activeDurationMs! -
          Date.now()) /
          1000,
      ),
    )
  : 0;

/** Is the focus drawer open? */
const [isDrawerOpen, setDrawerOpen] = createSignal(false);

/** Configured focus duration in minutes */
const [durationMin, setDurationMinSignal] = createSignal(initialDurationMin);

/** Is a focus session actively running? */
const [isRunning, setIsRunning] = createSignal(hasActiveSession);

/** Epoch ms when current session started (null if not running) */
const [sessionStart, setSessionStart] = createSignal<number | null>(
  hasActiveSession ? initial.activeStart : null,
);

/** Remaining seconds on the timer */
const [remainingSeconds, setRemainingSeconds] = createSignal(
  initialRemainingSeconds,
);

/** Completed sessions (persisted) */
const [sessions, setSessions] = createSignal<FocusSession[]>(initial.sessions);

/** Show reward popup after session completes */
const [showReward, setShowReward] = createSignal(false);

const DEFAULT_LABELS = [
  'Play a game',
  'Watch a movie',
  'Browse short videos',
  'Go outside for fresh air',
  'Free break',
  'Listen to favorite music',
];

/** Custom rewards set by user */
const [rewardLabels, setRewardLabelsSignal] = createSignal<string[]>(
  initial.rewardLabels || DEFAULT_LABELS,
);

/** Timer tick interval id */
let tickInterval: ReturnType<typeof setInterval> | null = null;

// ── Derived: stats ────────────────────────────────────────────
export function getStats(): FocusStats {
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();

  const todaySessions = sessions().filter(
    (s) => (s.completedAt ?? s.startedAt) >= todayStart,
  );
  const todayMinutes = Math.round(
    todaySessions.reduce((acc, s) => acc + s.durationMs / 60_000, 0),
  );

  // Streak: count consecutive days with sessions going backwards
  // Build a Set of date-strings for O(1) lookup instead of O(n) per day
  const allSessions = sessions();
  const daySet = new Set<number>();
  for (const s of allSessions) {
    const ts = s.completedAt ?? s.startedAt;
    // Floor to midnight
    const d = new Date(ts);
    daySet.add(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
  }

  let streak = 0;
  let checkDay = todayStart;
  while (daySet.has(checkDay)) {
    streak++;
    checkDay -= 86_400_000;
  }

  return { todayMinutes, todaySessions: todaySessions.length, streak };
}

export function formatFocusTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs
    .toString()
    .padStart(2, '0')}`;
}

// ── Timer logic ───────────────────────────────────────────────
function startTick() {
  stopTick();
  tickInterval = setInterval(() => {
    const start = sessionStart();
    if (!start) return;
    const elapsed = Date.now() - start;
    const totalMs = durationMin() * 60_000;
    const left = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
    setRemainingSeconds(left);

    if (left <= 0) {
      completeSession();
    }
  }, 250); // 4 Hz for smooth countdown
}

function stopTick() {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function completeSession() {
  const start = sessionStart();
  if (!start) return;

  stopTick();

  const session: FocusSession = {
    startedAt: start,
    durationMs: durationMin() * 60_000,
    completedAt: Date.now(),
  };

  setSessions((prev) => [...prev, session]);
  setIsRunning(false);
  setSessionStart(null);
  setRemainingSeconds(0);
  setShowReward(true);

  // Persist
  save({
    durationMin: durationMin(),
    sessions: sessions(),
    activeStart: null,
    activeDurationMs: null,
    rewardLabels: rewardLabels(),
  });
}

// ── Exported actions ──────────────────────────────────────────
export function openFocusDrawer() {
  setDrawerOpen(true);
}

export function closeFocusDrawer() {
  setDrawerOpen(false);
}

export function setDurationMin(min: number) {
  const clamped = Math.max(MIN_DURATION, Math.min(MAX_DURATION, min));
  setDurationMinSignal(clamped);
  save({
    durationMin: clamped,
    sessions: sessions(),
    activeStart: sessionStart(),
    activeDurationMs: sessionStart() ? durationMin() * 60_000 : null,
    rewardLabels: rewardLabels(),
  });
}

export function startFocusSession() {
  const now = Date.now();
  setSessionStart(now);
  setIsRunning(true);
  setRemainingSeconds(durationMin() * 60);
  startTick();

  save({
    durationMin: durationMin(),
    sessions: sessions(),
    activeStart: now,
    activeDurationMs: durationMin() * 60_000,
    rewardLabels: rewardLabels(),
  });
}

export function stopFocusSession() {
  stopTick();
  setIsRunning(false);
  setSessionStart(null);
  setRemainingSeconds(0);

  save({
    durationMin: durationMin(),
    sessions: sessions(),
    activeStart: null,
    activeDurationMs: null,
    rewardLabels: rewardLabels(),
  });
}

export function updateRewardLabel(index: number, newLabel: string) {
  const updated = [...rewardLabels()];
  updated[index] = newLabel;
  setRewardLabelsSignal(updated);
  save({
    durationMin: durationMin(),
    sessions: sessions(),
    activeStart: sessionStart(),
    activeDurationMs: sessionStart() ? durationMin() * 60_000 : null,
    rewardLabels: updated,
  });
}

export function closeReward() {
  setShowReward(false);
}

// ── Exports (signals) ─────────────────────────────────────────
export {
  isDrawerOpen,
  durationMin,
  isRunning,
  sessionStart,
  remainingSeconds,
  sessions,
  showReward,
  rewardLabels,
};

// ── Boot: resume running session if page was refreshed ────────
if (initial.activeStart !== null && initial.activeDurationMs !== null) {
  const elapsed = Date.now() - initial.activeStart;
  if (elapsed >= initial.activeDurationMs) {
    // Session completed while page was closed
    const session: FocusSession = {
      startedAt: initial.activeStart,
      durationMs: initial.activeDurationMs,
      completedAt: initial.activeStart + initial.activeDurationMs,
    };
    setSessions((prev) => [...prev, session]);
    setIsRunning(false);
    setSessionStart(null);
    setShowReward(true);
    save({
      durationMin: durationMin(),
      sessions: sessions(),
      activeStart: null,
      activeDurationMs: null,
      rewardLabels: rewardLabels(),
    });
  } else {
    // Resume countdown
    startTick();
  }
}
