import { createRoot } from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { api } from '@/api/client';
import { currentUser } from './auth.store';
import { queryClient } from '@/lib/query-client';
import { NOTIFICATIONS_POLL_MS } from '@/constants';

interface DueDeckNotification {
  deckId: string;
  deckName: string;
  dueCount: number;
}

// Wrap in createRoot so reactive primitives have ownership outside components.
const { dueDecks, dueDeckLoading, refetchDue, totalDue, hasDue } = createRoot(
  () => {
    const notifQuery = createQuery(
      () => ({
        queryKey: ['notifications'],
        queryFn: async () => {
          const { data } = await (api.notifications as any)['due-decks'].get();
          return (data ?? []) as DueDeckNotification[];
        },
        enabled: !!currentUser(),
        refetchInterval: NOTIFICATIONS_POLL_MS,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
      }),
      () => queryClient,
    );

    const dueDecks = () => notifQuery.data ?? [];
    const dueDeckLoading = () => notifQuery.isLoading;
    const refetchDue = () =>
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    const totalDue = () => dueDecks().reduce((sum, d) => sum + d.dueCount, 0);
    const hasDue = () => totalDue() > 0;

    return { dueDecks, dueDeckLoading, refetchDue, totalDue, hasDue };
  },
);

export { dueDecks, dueDeckLoading, refetchDue, totalDue, hasDue };
export type { DueDeckNotification };
