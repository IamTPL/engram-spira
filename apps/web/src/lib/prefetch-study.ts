import { api, getApiError } from '@/api/client';
import { queryClient } from '@/lib/query-client';

/** Warms ['studyData', deckId, 'due', ''] — the key StudyModePage reads first. */
export function prefetchStudyDeck(deckId: string | undefined) {
  if (!deckId) return;
  void queryClient.prefetchQuery({
    queryKey: ['studyData', deckId, 'due', ''],
    queryFn: async () => {
      const { data, error } = await (api.study.deck as any)[deckId].get({ query: {} });
      // Unlike the study page's own queryFn, this one must throw rather than
      // return null on failure: prefetchQuery swallows the rejection and
      // leaves the cache entry in an `error` state with no cached data, so
      // TanStack's default retryOnMount refetches it when StudyModePage
      // mounts — running the page's queryFn (which calls setStudyError) for
      // real instead of quietly seeding a fresh "no cards" null that the
      // page would render as "All caught up".
      if (error || !data) {
        throw new Error(error ? getApiError(error) : 'Failed to load study cards');
      }
      return data;
    },
    // Reused only when the page mounts within seconds of the hover; anything
    // older is refetched so card edits and finished sessions are never masked.
    staleTime: 5_000,
  });
}
