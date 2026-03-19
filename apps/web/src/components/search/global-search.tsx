import {
  type Component,
  Show,
  For,
  createSignal,
  createEffect,
  onCleanup,
  onMount,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { Portal } from 'solid-js/web';
import { api, getApiError } from '@/api/client';
import { createDebouncedSignal } from '@/lib/create-debounced-signal';
import { searchOpen, closeSearch } from '@/stores/search.store';
import Skeleton from '@/components/ui/skeleton';
import { Search, FileText, ArrowRight, X } from 'lucide-solid';

interface SearchResult {
  cardId: string;
  deckId: string;
  deckName: string;
  similarity: number;
  fields: {
    fieldName: string;
    fieldType: string;
    side: string;
    value: unknown;
  }[];
}

const GlobalSearch: Component = () => {
  const navigate = useNavigate();
  const [debouncedQuery, setQuery, immediateQuery] = createDebouncedSignal(
    '',
    300,
  );
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const searchQuery = createQuery(() => ({
    queryKey: ['global-search', debouncedQuery()],
    queryFn: async () => {
      const q = debouncedQuery().trim();
      if (q.length < 2) return null;
      const { data, error } = await (api.search as any).get({
        query: { q, limit: 15 },
      });
      if (error) throw new Error(getApiError(error));
      return data as { results: SearchResult[]; query: string; total: number };
    },
    enabled: debouncedQuery().trim().length >= 2,
    staleTime: 30_000,
  }));

  const results = () => searchQuery.data?.results ?? [];
  const hasQuery = () => debouncedQuery().trim().length >= 2;
  const isLoading = () => searchQuery.isFetching && hasQuery();

  // Reset selection when results change
  createEffect(() => {
    results();
    setSelectedIndex(0);
  });

  // Focus input when modal opens
  createEffect(() => {
    if (searchOpen()) {
      setTimeout(() => inputRef?.focus(), 50);
    } else {
      setQuery('');
      setSelectedIndex(0);
    }
  });

  const handleSelect = (result: SearchResult) => {
    closeSearch();
    navigate(`/deck/${result.deckId}`);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!searchOpen()) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
      return;
    }

    const items = results();
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[selectedIndex()];
      if (item) handleSelect(item);
    }
  };

  onMount(() => document.addEventListener('keydown', handleKeyDown));
  onCleanup(() => document.removeEventListener('keydown', handleKeyDown));

  const getFieldPreview = (result: SearchResult): string => {
    const frontField = result.fields.find((f) => f.side === 'front');
    if (!frontField) return '';
    const val = frontField.value;
    if (typeof val === 'string') return val.slice(0, 120);
    if (val && typeof val === 'object' && 'text' in val)
      return String((val as { text: unknown }).text).slice(0, 120);
    return '';
  };

  const getBackPreview = (result: SearchResult): string => {
    const backField = result.fields.find((f) => f.side === 'back');
    if (!backField) return '';
    const val = backField.value;
    if (typeof val === 'string') return val.slice(0, 80);
    if (val && typeof val === 'object' && 'text' in val)
      return String((val as { text: unknown }).text).slice(0, 80);
    return '';
  };

  const similarityColor = (sim: number): string => {
    if (sim >= 0.8) return 'bg-green-500/15 text-green-600 dark:text-green-400';
    if (sim >= 0.6) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <Show when={searchOpen()}>
      <Portal>
        <div class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
          {/* Backdrop */}
          <div
            class="absolute inset-0 overlay-backdrop animate-fade-in"
            onClick={closeSearch}
          />

          {/* Search Panel */}
          <div class="relative z-10 w-full max-w-lg mx-4 animate-scale-in">
            <div class="rounded-xl border bg-card shadow-xl overflow-hidden">
              {/* Search Input */}
              <div class="flex items-center gap-3 px-4 border-b">
                <Search class="h-4 w-4 text-muted-foreground shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search across all your cards..."
                  class="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  value={immediateQuery()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                />
                <Show when={immediateQuery()}>
                  <button
                    class="shrink-0 p-1 rounded hover:bg-accent transition-colors"
                    onClick={() => setQuery('')}
                  >
                    <X class="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </Show>
                <kbd class="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div class="max-h-80 overflow-y-auto">
                {/* Loading */}
                <Show when={isLoading()}>
                  <div class="p-3 space-y-2">
                    <For each={[1, 2, 3]}>
                      {() => (
                        <div class="flex items-center gap-3 p-3 rounded-lg">
                          <Skeleton shape="text" width="100%" height="40px" />
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                {/* Results list */}
                <Show when={!isLoading() && hasQuery() && results().length > 0}>
                  <div class="p-2">
                    <For each={results()}>
                      {(result, index) => (
                        <button
                          class={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                            index() === selectedIndex()
                              ? 'bg-accent'
                              : 'hover:bg-accent/50'
                          }`}
                          onClick={() => handleSelect(result)}
                          onMouseEnter={() => setSelectedIndex(index())}
                        >
                          <div class="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                            <FileText class="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div class="flex-1 min-w-0">
                            <p class="text-sm font-medium truncate">
                              {getFieldPreview(result)}
                            </p>
                            <Show when={getBackPreview(result)}>
                              <p class="text-xs text-muted-foreground truncate mt-0.5">
                                {getBackPreview(result)}
                              </p>
                            </Show>
                            <div class="flex items-center gap-2 mt-1">
                              <span class="text-[10px] text-muted-foreground truncate">
                                {result.deckName}
                              </span>
                              <span
                                class={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${similarityColor(result.similarity)}`}
                              >
                                {Math.round(result.similarity * 100)}%
                              </span>
                            </div>
                          </div>
                          <ArrowRight class="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-2 opacity-0 group-hover:opacity-100" />
                        </button>
                      )}
                    </For>
                  </div>
                </Show>

                {/* No results */}
                <Show
                  when={
                    !isLoading() &&
                    hasQuery() &&
                    results().length === 0 &&
                    searchQuery.data
                  }
                >
                  <div class="px-4 py-8 text-center">
                    <p class="text-sm text-muted-foreground">
                      No cards found for "{debouncedQuery()}"
                    </p>
                  </div>
                </Show>

                {/* Empty state */}
                <Show when={!hasQuery()}>
                  <div class="px-4 py-8 text-center">
                    <Search class="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p class="text-sm text-muted-foreground">
                      Search across all your cards
                    </p>
                    <p class="text-xs text-muted-foreground/60 mt-1">
                      Type at least 2 characters to start
                    </p>
                  </div>
                </Show>
              </div>

              {/* Footer */}
              <Show when={results().length > 0}>
                <div class="border-t px-4 py-2 flex items-center justify-between text-[10px] text-muted-foreground">
                  <div class="flex items-center gap-3">
                    <span class="flex items-center gap-1">
                      <kbd class="inline-flex h-4 items-center rounded border bg-muted px-1 text-[10px]">
                        ↑↓
                      </kbd>
                      navigate
                    </span>
                    <span class="flex items-center gap-1">
                      <kbd class="inline-flex h-4 items-center rounded border bg-muted px-1 text-[10px]">
                        ↵
                      </kbd>
                      open
                    </span>
                  </div>
                  <span>{searchQuery.data?.total ?? 0} results</span>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export default GlobalSearch;
