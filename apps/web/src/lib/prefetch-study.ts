import { api } from '@/api/client';
import { queryClient } from '@/lib/query-client';

/** Warms ['studyData', deckId, 'due', ''] — the key StudyModePage reads first. */
export function prefetchStudyDeck(deckId: string | undefined) {
  if (!deckId) return;
  void queryClient.prefetchQuery({
    queryKey: ['studyData', deckId, 'due', ''],
    queryFn: async () => {
      const { data, error } = await (api.study.deck as any)[deckId].get({ query: {} });
      if (error || !data) return null;
      return data;
    },
    staleTime: 60_000,
  });
}
