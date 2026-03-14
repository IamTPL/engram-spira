import { createSignal, createResource, onCleanup } from 'solid-js';
import { api } from '@/api/client';
import { currentUser } from './auth.store';
import { NOTIFICATIONS_POLL_MS } from '@/constants';

interface DueDeckNotification {
  deckId: string;
  deckName: string;
  dueCount: number;
}

// Single shared resource — avoids duplicate polling from header + sidebar-footer
const [dueDecks, { refetch: refetchDue }] = createResource(
  () => currentUser()?.id,
  async () => {
    const { data } = await (api.notifications as any)['due-decks'].get();
    return (data ?? []) as DueDeckNotification[];
  },
);

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
const totalDue = () => (dueDecks() ?? []).reduce((sum, d) => sum + d.dueCount, 0);
const hasDue = () => totalDue() > 0;

export {
  dueDecks,
  refetchDue,
  totalDue,
  hasDue,
};
export type { DueDeckNotification };
