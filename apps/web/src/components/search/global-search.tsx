import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { Portal } from 'solid-js/web';
import { api, getApiError } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppShell } from '@/components/app-shell/app-shell-context';
import { commandActionRunner } from '@/lib/command-actions';
import { createDebouncedSignal } from '@/lib/create-debounced-signal';
import {
  experienceQueryKeys,
  getLibraryExplorer,
} from '@/lib/experience-api';
import { queryClient } from '@/lib/query-client';
import { closeSearch, openSearch, searchOpen } from '@/stores/search.store';
import { toast } from '@/stores/toast.store';
import type {
  CommandActionRef,
  CommandResult,
  CommandSearchResponse,
} from '../../../../api/src/modules/experience/experience.types';
import {
  ArrowRight,
  BookOpen,
  Command as CommandIcon,
  FileText,
  FolderOpen,
  ChevronLeft,
  FolderPlus,
  Layers,
  Library,
  Settings,
  Sparkles,
  X,
} from 'lucide-solid';

type FlattenedResult = CommandResult & {
  groupId: CommandSearchResponse['groups'][number]['id'];
  groupLabel: string;
};

const resultIcons: Record<CommandResult['type'], Component<{ class?: string }>> = {
  action: Sparkles,
  card: FileText,
  deck: BookOpen,
  folder: FolderOpen,
  class: Layers,
  doc: Library,
  setting: Settings,
};

function currentDeckId(pathname: string) {
  const deckMatch = pathname.match(/^\/deck\/([^/?#]+)/);
  if (deckMatch) return deckMatch[1];
  const studyMatch = pathname.match(/^\/study\/([^/?#]+)/);
  return studyMatch?.[1];
}

const GlobalSearch: Component = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [debouncedQuery, setQuery, immediateQuery] = createDebouncedSignal(
    '',
    180,
  );
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [folderDraft, setFolderDraft] = createSignal<{
    classId: string;
    name: string;
  } | null>(null);
  const [submittingFolder, setSubmittingFolder] = createSignal(false);
  const shell = useAppShell();
  let inputRef: HTMLInputElement | undefined;
  let folderNameRef: HTMLInputElement | undefined;

  const commandQuery = createQuery(() => ({
    queryKey: ['command-search', debouncedQuery(), location.pathname],
    queryFn: async () => {
      const q = debouncedQuery().trim();
      if (!q) return null;
      const { data, error } = await (api.command as any).search.get({
        query: {
          q,
          limit: 24,
          currentRoute: location.pathname,
        },
      });
      if (error) throw new Error(getApiError(error));
      return data as CommandSearchResponse;
    },
    enabled: searchOpen() && debouncedQuery().trim().length > 0,
    staleTime: 15_000,
  }));

  const groups = () => commandQuery.data?.groups ?? [];
  const flattened = createMemo<FlattenedResult[]>(() =>
    groups().flatMap((group) =>
      group.results.map((result) => ({
        ...result,
        groupId: group.id,
        groupLabel: group.label,
      })),
    ),
  );
  const enabledResults = createMemo(() =>
    flattened().filter((result) => !result.disabledReason),
  );
  const hasQuery = () => immediateQuery().trim().length > 0;
  const isLoading = () => commandQuery.isFetching && hasQuery();

  createEffect(() => {
    flattened();
    setSelectedIndex(0);
  });

  createEffect(() => {
    if (searchOpen()) {
      setTimeout(() => inputRef?.focus(), 40);
    } else {
      setQuery('');
      setSelectedIndex(0);
      setFolderDraft(null);
    }
  });

  // Reuses the explorer cache the sidebar already fills — no extra request.
  const explorerQuery = createQuery(() => ({
    queryKey: experienceQueryKeys.libraryExplorer(),
    queryFn: getLibraryExplorer,
    enabled: !!folderDraft(),
    staleTime: 60_000,
  }));

  const classOptions = () => explorerQuery.data?.data.classes ?? [];

  /** Explicit pick wins, then the sidebar selection, then the first class. */
  const draftClassId = () => {
    const draft = folderDraft();
    if (!draft) return '';
    return (
      draft.classId ||
      shell.actionContext().selectedClassId ||
      classOptions()[0]?.id ||
      ''
    );
  };

  const openFolderDraft = () => {
    setFolderDraft({ classId: '', name: '' });
    setTimeout(() => folderNameRef?.focus(), 40);
  };

  const submitFolderDraft = async (event: Event) => {
    event.preventDefault();
    const draft = folderDraft();
    if (!draft || submittingFolder()) return;

    const classId = draftClassId();
    if (!classId) {
      toast.error('Pick a library first');
      return;
    }

    setSubmittingFolder(true);
    const result = await commandActionRunner.run(
      {
        id: 'folder.create',
        label: 'Create folder',
        params: { classId, name: draft.name },
      },
      shell.actionContext(),
    );
    setSubmittingFolder(false);

    if (result.status !== 'success') {
      toast.error(
        result.status === 'error' ? result.message : 'Could not create folder',
      );
      return;
    }

    for (const key of result.invalidate ?? []) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
    setFolderDraft(null);
    closeSearch();
    toast.success(result.message ?? 'Folder created');
    if (result.navigateTo) navigate(result.navigateTo);
  };

  const runAction = (action: CommandActionRef | null) => {
    const deckId = currentDeckId(location.pathname);
    if (!action) return;

    if (action.id === 'start-study' && deckId) {
      navigate(`/study/${deckId}`);
      return;
    }

    if ((action.id === 'create-card' || action.id === 'import-cards') && deckId) {
      navigate(`/deck/${deckId}`);
      return;
    }

    if (action.id === 'create-deck') {
      navigate('/');
      return;
    }

    navigate('/');
  };

  const handleSelect = (result: FlattenedResult) => {
    if (result.disabledReason) return;
    // Stays inside the palette: the folder needs a name and a target class.
    if (result.action?.id === 'create-folder') {
      openFolderDraft();
      return;
    }
    closeSearch();
    if (result.href) {
      navigate(result.href);
      return;
    }
    runAction(result.action);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
      return;
    }

    if (!searchOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      if (folderDraft()) {
        setFolderDraft(null);
        setTimeout(() => inputRef?.focus(), 40);
      } else {
        closeSearch();
      }
      return;
    }

    // The draft form owns arrow keys and Enter while it is open.
    if (folderDraft()) return;

    const items = enabledResults();
    if (items.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[selectedIndex()];
      if (item) handleSelect(item);
    }
  };

  onMount(() => document.addEventListener('keydown', handleKeyDown));
  onCleanup(() => document.removeEventListener('keydown', handleKeyDown));

  const resultIcon = (type: CommandResult['type']) => resultIcons[type];

  return (
    <Show when={searchOpen()}>
      <Portal>
        <div class="fixed inset-0 z-50 flex items-stretch justify-stretch md:items-start md:justify-center md:pt-[12vh]">
          <button
            class="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm animate-fade-in"
            aria-label="Close command center"
            onClick={closeSearch}
          />

          <div class="relative z-10 flex h-full w-full animate-scale-in md:h-auto md:max-w-2xl md:px-3">
            <Command
              shouldFilter={false}
              class="flex h-full flex-col overflow-hidden rounded-none border-0 bg-popover shadow-xl md:h-auto md:rounded-lg md:border"
            >
              <div class="relative [&_[data-cmdk-input-wrapper]]:pr-12">
                <CommandInput
                  ref={inputRef}
                  value={immediateQuery()}
                  onValueChange={setQuery}
                  placeholder="Search commands, decks, cards and settings"
                  class="h-12"
                />
                <button
                  class="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={closeSearch}
                >
                  <X class="h-4 w-4" />
                  <span class="sr-only">Close</span>
                </button>
              </div>

              <CommandList class="max-h-none flex-1 md:max-h-[460px]">
                <Show when={folderDraft()}>
                  {(draft) => (
                    <form
                      class="space-y-4 p-4"
                      onSubmit={submitFolderDraft}
                      onKeyDown={(event) => {
                        if (
                          event.key === 'Enter' ||
                          event.key === 'ArrowUp' ||
                          event.key === 'ArrowDown'
                        ) {
                          event.stopPropagation();
                        }
                      }}
                    >
                      <div class="flex items-center gap-2">
                        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <FolderPlus class="h-4 w-4" />
                        </span>
                        <div class="min-w-0 flex-1">
                          <p class="text-sm font-medium">Create folder</p>
                          <p class="text-xs text-muted-foreground">
                            Adds a folder inside the selected library.
                          </p>
                        </div>
                      </div>

                      <div class="space-y-1.5">
                        <label
                          for="command-folder-class"
                          class="text-xs font-medium text-muted-foreground"
                        >
                          Library
                        </label>
                        <select
                          id="command-folder-class"
                          class="h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={draftClassId()}
                          disabled={classOptions().length === 0}
                          onChange={(event) =>
                            setFolderDraft({
                              ...draft(),
                              classId: event.currentTarget.value,
                            })
                          }
                        >
                          <For each={classOptions()}>
                            {(option) => (
                              <option value={option.id}>{option.name}</option>
                            )}
                          </For>
                        </select>
                      </div>

                      <div class="space-y-1.5">
                        <label
                          for="command-folder-name"
                          class="text-xs font-medium text-muted-foreground"
                        >
                          Folder name
                        </label>
                        <input
                          id="command-folder-name"
                          ref={folderNameRef}
                          class="h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          placeholder="Family"
                          value={draft().name}
                          onInput={(event) =>
                            setFolderDraft({
                              ...draft(),
                              name: event.currentTarget.value,
                            })
                          }
                        />
                      </div>

                      <div class="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          class="gap-1.5"
                          onClick={() => {
                            setFolderDraft(null);
                            setTimeout(() => inputRef?.focus(), 40);
                          }}
                        >
                          <ChevronLeft class="h-3.5 w-3.5" />
                          Back
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={
                            submittingFolder() ||
                            draft().name.trim().length === 0 ||
                            !draftClassId()
                          }
                        >
                          {submittingFolder() ? 'Creating…' : 'Create folder'}
                        </Button>
                      </div>
                    </form>
                  )}
                </Show>

                <Show when={!folderDraft() && isLoading()}>
                  <div class="space-y-2 p-3">
                    <For each={[1, 2, 3, 4]}>
                      {() => <Skeleton shape="text" height="44px" />}
                    </For>
                  </div>
                </Show>

                <Show when={!folderDraft() && !isLoading() && !hasQuery()}>
                  <div class="px-5 py-8 text-center">
                    <CommandIcon class="mx-auto h-8 w-8 text-muted-foreground/50" />
                    <p class="mt-3 text-sm font-medium">Command center</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                      Type a deck, card, action or setting.
                    </p>
                  </div>
                </Show>

                <Show
                  when={
                    !folderDraft() &&
                    !isLoading() &&
                    hasQuery() &&
                    flattened().length === 0
                  }
                >
                  <CommandEmpty>No matching commands.</CommandEmpty>
                </Show>

                <Show
                  when={!folderDraft() && !isLoading() && flattened().length > 0}
                >
                  <For each={groups().filter((group) => group.results.length > 0)}>
                    {(group) => (
                      <CommandGroup heading={group.label}>
                        <For each={group.results}>
                          {(result) => {
                            const Icon = resultIcon(result.type);
                            const selected = () =>
                              enabledResults()[selectedIndex()]?.id === result.id &&
                              enabledResults()[selectedIndex()]?.type === result.type;
                            return (
                              <CommandItem
                                value={`${group.id}-${result.type}-${result.id}`}
                                disabled={!!result.disabledReason}
                                onSelect={() =>
                                  handleSelect({
                                    ...result,
                                    groupId: group.id,
                                    groupLabel: group.label,
                                  })
                                }
                                onMouseEnter={() => {
                                  const index = enabledResults().findIndex(
                                    (item) =>
                                      item.id === result.id &&
                                      item.type === result.type,
                                  );
                                  if (index >= 0) setSelectedIndex(index);
                                }}
                                class={`gap-3 rounded-md px-3 py-2.5 ${selected() ? 'bg-accent' : ''}`}
                              >
                                <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                  <Icon class="h-4 w-4" />
                                </div>
                                <div class="min-w-0 flex-1">
                                  <p class="truncate text-sm font-medium">
                                    {result.title}
                                  </p>
                                  <Show when={result.subtitle || result.disabledReason}>
                                    <p class="truncate text-xs text-muted-foreground">
                                      {result.disabledReason ?? result.subtitle}
                                    </p>
                                  </Show>
                                </div>
                                <Badge variant="muted" class="hidden shrink-0 sm:inline-flex">
                                  {result.type}
                                </Badge>
                                <ArrowRight class="h-4 w-4 shrink-0 text-muted-foreground" />
                              </CommandItem>
                            );
                          }}
                        </For>
                      </CommandGroup>
                    )}
                  </For>
                </Show>
              </CommandList>

              <div class="flex items-center justify-between border-t px-4 py-2 text-[11px] text-muted-foreground">
                <span class="inline-flex items-center gap-2">
                  <kbd class="rounded border bg-muted px-1.5 py-0.5">Esc</kbd>
                  close
                </span>
                <span class="inline-flex items-center gap-2">
                  <kbd class="rounded border bg-muted px-1.5 py-0.5">Enter</kbd>
                  open
                </span>
              </div>
            </Command>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export default GlobalSearch;
