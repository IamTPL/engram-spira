import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
} from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Layers,
  Library,
  LogOut,
  PanelLeft,
  Plus,
  RefreshCcw,
  Settings,
  Sparkles,
} from 'lucide-solid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  experienceQueryKeys,
  getLibraryExplorer,
} from '@/lib/experience-api';
import { currentUser, logout } from '@/stores/auth.store';
import { openSearch } from '@/stores/search.store';
import { cn } from '@/lib/utils';
import { useRegisterActionContext } from './app-shell-context';
import {
  buildInitialExpansion,
  findLibrarySelectionContext,
  type LibraryClass,
} from './library-explorer-state';

type LibraryExplorerProps = {
  onCollapse: () => void;
  onNavigate?: () => void;
};

type RouteSelection = {
  classId?: string;
  folderId?: string;
  deckId?: string;
};

function routeSelection(pathname: string): RouteSelection {
  const deckMatch = pathname.match(/^\/deck\/([^/?#]+)/);
  if (deckMatch) return { deckId: deckMatch[1] };

  const folderMatch = pathname.match(/^\/folder\/([^/?#]+)/);
  if (folderMatch) return { folderId: folderMatch[1] };

  return {};
}

export const LibraryExplorer: Component<LibraryExplorerProps> = (props) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedClasses, setExpandedClasses] = createSignal<
    Record<string, boolean>
  >({});
  const [expandedFolders, setExpandedFolders] = createSignal<
    Record<string, boolean>
  >({});
  const [selected, setSelected] = createSignal<RouteSelection>({});
  const [initialized, setInitialized] = createSignal(false);

  const explorerQuery = createQuery(() => ({
    queryKey: experienceQueryKeys.libraryExplorer(),
    queryFn: getLibraryExplorer,
    enabled: !!currentUser()?.id,
    staleTime: 60_000,
  }));

  const classes = () => explorerQuery.data?.data.classes ?? [];
  const recentDeckIds = () => explorerQuery.data?.data.recentDeckIds ?? [];
  const recentDeckSet = createMemo(() => new Set(recentDeckIds()));
  const selectedContext = createMemo(() =>
    findLibrarySelectionContext(classes(), selected()),
  );

  useRegisterActionContext(selectedContext, [
    'selectedClassId',
    'selectedFolderId',
    'selectedDeckId',
  ]);

  createEffect(() => {
    const data = classes();
    if (data.length === 0) return;

    const route = routeSelection(location.pathname);
    if (route.classId || route.folderId || route.deckId) {
      setSelected(route);
    }

    if (initialized()) return;

    const expansion = buildInitialExpansion(data, recentDeckIds(), route);
    setExpandedClasses(
      Object.fromEntries(expansion.classIds.map((id) => [id, true])),
    );
    setExpandedFolders(
      Object.fromEntries(expansion.folderIds.map((id) => [id, true])),
    );
    setInitialized(true);
  });

  const totals = createMemo(() =>
    classes().reduce(
      (acc, cls) => ({
        folders: acc.folders + cls.folderCount,
        decks: acc.decks + cls.deckCount,
        cards: acc.cards + cls.cardCount,
        due: acc.due + cls.dueCount,
      }),
      { folders: 0, decks: 0, cards: 0, due: 0 },
    ),
  );

  const toggleClass = (id: string) => {
    setExpandedClasses((current) => ({ ...current, [id]: !current[id] }));
  };

  const toggleFolder = (id: string) => {
    setExpandedFolders((current) => ({ ...current, [id]: !current[id] }));
  };

  const navigateTo = (href: string) => {
    navigate(href);
    props.onNavigate?.();
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div class="flex h-full min-h-0 w-full flex-col bg-background">
      <div class="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
          onClick={() => navigateTo('/')}
        >
          <img src="/logo-engram.webp" alt="" class="h-7 w-auto" />
          <span class="truncate text-sm font-semibold">Engram Spira</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          aria-label="Collapse library"
          onClick={props.onCollapse}
        >
          <PanelLeft class="h-4 w-4" />
        </Button>
      </div>

      <div class="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
        <div class="min-w-0">
          <p class="text-xs font-medium uppercase text-muted-foreground">
            Library
          </p>
          <p class="truncate text-xs text-muted-foreground">
            {totals().decks} decks, {totals().cards} cards
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="h-8 gap-1.5"
          onClick={openSearch}
        >
          <Plus class="h-3.5 w-3.5" />
          Create
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <Show when={!explorerQuery.isLoading} fallback={<ExplorerSkeleton />}>
          <Show when={!explorerQuery.isError} fallback={<ExplorerError onRetry={() => explorerQuery.refetch()} />}>
            <Show
              when={classes().length > 0}
              fallback={<ExplorerEmpty onAction={openSearch} />}
            >
              <div class="space-y-1">
                <For each={classes()}>
                  {(cls) => (
                    <ClassNode
                      cls={cls}
                      expanded={!!expandedClasses()[cls.id]}
                      selected={selected().classId === cls.id}
                      onToggle={() => {
                        setSelected({ classId: cls.id });
                        toggleClass(cls.id);
                      }}
                      folderExpanded={(folderId) =>
                        !!expandedFolders()[folderId]
                      }
                      selectedFolderId={selected().folderId}
                      selectedDeckId={selected().deckId}
                      recentDeckSet={recentDeckSet()}
                      onFolderClick={(folderId) => {
                        setSelected({ folderId });
                        setExpandedClasses((current) => ({
                          ...current,
                          [cls.id]: true,
                        }));
                        setExpandedFolders((current) => ({
                          ...current,
                          [folderId]: true,
                        }));
                        navigateTo(`/folder/${folderId}`);
                      }}
                      onFolderToggle={(folderId) => toggleFolder(folderId)}
                      onDeckClick={(deckId) => {
                        setSelected({ deckId });
                        navigateTo(`/deck/${deckId}`);
                      }}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </div>

      <ExplorerFooter onLogout={handleLogout} />
    </div>
  );
};

const ClassNode: Component<{
  cls: LibraryClass;
  expanded: boolean;
  selected: boolean;
  selectedFolderId?: string;
  selectedDeckId?: string;
  recentDeckSet: Set<string>;
  folderExpanded: (folderId: string) => boolean;
  onToggle: () => void;
  onFolderClick: (folderId: string) => void;
  onFolderToggle: (folderId: string) => void;
  onDeckClick: (deckId: string) => void;
}> = (props) => (
  <div>
    <button
      type="button"
      class={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent',
        props.selected && 'bg-accent text-foreground',
      )}
      onClick={props.onToggle}
    >
      <Show
        when={props.expanded}
        fallback={<ChevronRight class="h-3.5 w-3.5 text-muted-foreground" />}
      >
        <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
      </Show>
      <Layers class="h-4 w-4 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1 truncate font-medium">{props.cls.name}</span>
      <CountPill count={props.cls.dueCount} tone="due" />
    </button>

    <Show when={props.expanded}>
      <div class="ml-4 mt-1 space-y-1 border-l pl-2">
        <For each={props.cls.folders}>
          {(folder) => (
            <div>
              <div
                class={cn(
                  'flex w-full items-center gap-1 rounded-md px-1 py-1 text-sm hover:bg-accent',
                  props.selectedFolderId === folder.id &&
                    'bg-accent text-foreground',
                )}
              >
                <button
                  type="button"
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                  aria-label={
                    props.folderExpanded(folder.id)
                      ? 'Collapse folder'
                      : 'Expand folder'
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onFolderToggle(folder.id);
                  }}
                >
                  <Show
                    when={props.folderExpanded(folder.id)}
                    fallback={<ChevronRight class="h-3.5 w-3.5" />}
                  >
                    <ChevronDown class="h-3.5 w-3.5" />
                  </Show>
                </button>
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left"
                  onClick={() => props.onFolderClick(folder.id)}
                >
                  <Folder class="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span class="min-w-0 flex-1 truncate">{folder.name}</span>
                  <CountPill count={folder.dueCount} tone="due" />
                </button>
              </div>

              <Show when={props.folderExpanded(folder.id)}>
                <div class="ml-7 mt-1 space-y-0.5">
                  <For each={folder.decks}>
                    {(deck) => (
                      <button
                        type="button"
                        class={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                          props.selectedDeckId === deck.id &&
                            'bg-accent text-foreground',
                        )}
                        onClick={() => props.onDeckClick(deck.id)}
                      >
                        <Library class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span class="min-w-0 flex-1 truncate">{deck.name}</span>
                        <Show when={props.recentDeckSet.has(deck.id)}>
                          <Badge variant="muted" class="hidden h-5 px-1.5 text-[10px] sm:inline-flex">
                            Recent
                          </Badge>
                        </Show>
                        <CountPill count={deck.dueCount} tone="due" />
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  </div>
);

const CountPill: Component<{ count: number; tone?: 'due' }> = (props) => (
  <Show when={props.count > 0}>
    <span class="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
      {props.count}
    </span>
  </Show>
);

const ExplorerSkeleton: Component = () => (
  <div class="space-y-2">
    <For each={[1, 2, 3, 4, 5]}>
      {() => <Skeleton shape="text" height="34px" />}
    </For>
  </div>
);

const ExplorerError: Component<{ onRetry: () => void }> = (props) => (
  <div class="rounded-md border border-destructive/30 bg-destructive/5 p-3">
    <p class="text-sm font-medium text-foreground">Library unavailable</p>
    <p class="mt-1 text-xs text-muted-foreground">Refresh the explorer.</p>
    <Button
      variant="outline"
      size="sm"
      class="mt-3 h-8 gap-1.5"
      onClick={props.onRetry}
    >
      <RefreshCcw class="h-3.5 w-3.5" />
      Retry
    </Button>
  </div>
);

const ExplorerEmpty: Component<{ onAction: () => void }> = (props) => (
  <div class="rounded-md border border-dashed p-4 text-center">
    <Sparkles class="mx-auto h-8 w-8 text-muted-foreground/60" />
    <p class="mt-3 text-sm font-medium text-foreground">No library items</p>
    <div class="mt-4 grid gap-2">
      <Button variant="outline" size="sm" onClick={props.onAction}>
        Create deck
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onAction}>
        Import CSV
      </Button>
    </div>
  </div>
);

const ExplorerFooter: Component<{ onLogout: () => void }> = (props) => {
  const navigate = useNavigate();
  const userInitial = () => currentUser()?.email?.charAt(0).toUpperCase() ?? '?';

  return (
    <div class="shrink-0 border-t p-3">
      <div class="flex items-center gap-3">
        <Show
          when={currentUser()?.avatarUrl}
          fallback={
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
              {userInitial()}
            </div>
          }
        >
          <img
            src={currentUser()!.avatarUrl!}
            alt=""
            class="h-9 w-9 shrink-0 rounded-full object-cover"
          />
        </Show>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">
            {currentUser()?.email?.split('@')[0]}
          </p>
          <p class="truncate text-xs text-muted-foreground">
            {currentUser()?.email}
          </p>
        </div>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          class="h-8 gap-1.5"
          onClick={() => navigate('/settings')}
        >
          <Settings class="h-3.5 w-3.5" />
          Settings
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-8 gap-1.5 text-muted-foreground"
          onClick={props.onLogout}
        >
          <LogOut class="h-3.5 w-3.5" />
          Log out
        </Button>
      </div>
    </div>
  );
};
