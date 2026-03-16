import { createSignal, createRoot, createEffect, on } from 'solid-js';
import { api } from '@/api/client';
import { currentUser } from './auth.store';
import { NOTIFICATIONS_POLL_MS } from '@/constants';

interface DueDeckNotification {
  deckId: string;
  deckName: string;
  dueCount: number;
}

// Use plain signals instead of createResource to avoid triggering <Suspense>
// boundaries when the data is read inside the component tree.
const [dueDecks, setDueDecks] = createSignal<DueDeckNotification[]>([]);
const [dueDeckLoading, setDueDeckLoading] = createSignal(false);

async function refetchDue() {
  if (!currentUser()) return;
  setDueDeckLoading(true);
  try {
    const { data } = await (api.notifications as any)['due-decks'].get();
    setDueDecks((data ?? []) as DueDeckNotification[]);
  } catch {
    /* network errors are non-fatal for notifications */
  } finally {
    setDueDeckLoading(false);
  }
}

// Auto-fetch when currentUser changes (login / logout)
createRoot(() => {
  createEffect(
    on(
      () => currentUser()?.id,
      (id) => {
        if (id) {
          refetchDue();
        } else {
          setDueDecks([]);
        }
      },
    ),
  );
});

// Visibility-aware polling — pauses when tab is hidden to save battery/CPU
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (currentUser() && !document.hidden) refetchDue();
  }, NOTIFICATIONS_POLL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Start polling immediately, pause/resume on visibility change
function handleVisibilityChange() {
  if (document.hidden) {
    stopPolling();
  } else {
    // Refetch immediately when tab becomes visible again
    if (currentUser()) refetchDue();
    startPolling();
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', handleVisibilityChange);
  startPolling();
}

// Derived helpers
const totalDue = () => dueDecks().reduce((sum, d) => sum + d.dueCount, 0);
const hasDue = () => totalDue() > 0;

export { dueDecks, dueDeckLoading, refetchDue, totalDue, hasDue };
export type { DueDeckNotification };
