import { type Component, createSignal, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Skeleton from '@/components/ui/skeleton';
import { api, getApiError } from '@/api/client';
import { queryClient } from '@/lib/query-client';
import { experienceQueryKeys } from '@/lib/experience-api';
import { toast } from '@/stores/toast.store';
import { ROUTES } from '@/constants';
import {
  ChevronRight,
  FolderInput,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-solid';
import type { FolderData } from './use-folder-data';

interface FolderHeaderProps {
  folderId: string;
  folder: () => FolderData | null;
  isLoading: () => boolean;
  parentClassName: () => string | null;
  deckCount: () => number;
  cardCount: () => number;
  dueCount: () => number | null;
  searchQuery: () => string;
  setSearchQuery: (value: string) => void;
  showNewDeck: () => boolean;
  onNewDeck: () => void;
  onStudy: () => void;
  onMove: () => void;
  onDelete: () => void;
}

const FolderHeader: Component<FolderHeaderProps> = (props) => {
  const [isEditingName, setIsEditingName] = createSignal(false);
  const [editName, setEditName] = createSignal('');
  const [savingName, setSavingName] = createSignal(false);
  let nameInputRef: HTMLInputElement | undefined;

  const folderName = () => props.folder()?.name ?? '';
  const hasDecks = () => props.deckCount() > 0;

  const startEditName = () => {
    setEditName(folderName());
    setIsEditingName(true);
    queueMicrotask(() => {
      nameInputRef?.focus();
      nameInputRef?.select();
    });
  };

  const cancelEditName = () => {
    setIsEditingName(false);
    setEditName('');
  };

  const saveEditName = async () => {
    const newName = editName().trim();
    if (!newName || newName === folderName()) {
      cancelEditName();
      return;
    }

    setSavingName(true);
    try {
      const { error } = await (api.folders as any)[props.folderId].patch({
        name: newName,
      });
      if (error) throw new Error(getApiError(error));
      queryClient.invalidateQueries({ queryKey: ['folder', props.folderId] });
      queryClient.invalidateQueries({
        queryKey: experienceQueryKeys.libraryExplorer(),
      });
      toast.success('Folder renamed');
      setIsEditingName(false);
    } catch (error: any) {
      toast.error(error?.message ?? 'Failed to rename folder');
    } finally {
      setSavingName(false);
    }
  };

  const handleNameKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveEditName();
    } else if (event.key === 'Escape') {
      cancelEditName();
    }
  };

  return (
    <header class="space-y-4 border-b pb-5">
      <nav
        aria-label="Breadcrumb"
        class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
      >
        <A
          href={ROUTES.DASHBOARD}
          class="shrink-0 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Library
        </A>
        <Show when={props.parentClassName()}>
          <ChevronRight
            aria-hidden="true"
            class="hidden h-3 w-3 shrink-0 opacity-60 sm:block"
          />
          <span class="hidden max-w-56 truncate sm:inline">
            {props.parentClassName()}
          </span>
        </Show>
        <ChevronRight aria-hidden="true" class="h-3 w-3 shrink-0 opacity-60" />
        <Show
          when={!props.isLoading()}
          fallback={<Skeleton width="90px" height="12px" />}
        >
          <span
            aria-current="page"
            class="max-w-64 truncate font-medium text-foreground"
          >
            {folderName()}
          </span>
        </Show>
      </nav>

      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex min-w-0 items-start gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-hero-border bg-hero text-hero-foreground shadow-xs">
            <FolderOpen class="h-4 w-4" />
          </div>

          <div class="min-w-0 flex-1">
            <Show
              when={!props.isLoading()}
              fallback={
                <div class="space-y-2 py-1">
                  <Skeleton width="180px" height="24px" />
                  <Skeleton width="220px" height="16px" />
                </div>
              }
            >
              <Show
                when={!isEditingName()}
                fallback={
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={editName()}
                    onInput={(event) => setEditName(event.currentTarget.value)}
                    onKeyDown={handleNameKeyDown}
                    onBlur={() => void saveEditName()}
                    disabled={savingName()}
                    aria-label="Folder name"
                    class="h-8 w-full min-w-0 border-0 border-b-2 border-primary bg-transparent px-0 text-xl font-semibold tracking-tight outline-none sm:text-2xl"
                  />
                }
              >
                <div class="group flex min-w-0 items-center gap-1">
                  <h1 class="truncate text-xl font-semibold tracking-tight sm:text-2xl">
                    {folderName()}
                  </h1>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 shrink-0 text-muted-foreground opacity-70 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                    onClick={startEditName}
                    aria-label="Rename folder"
                    title="Rename folder"
                  >
                    <Pencil class="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Show>

              <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span>
                  <span class="font-medium tabular-nums text-foreground">
                    {props.deckCount()}
                  </span>{' '}
                  {props.deckCount() === 1 ? 'deck' : 'decks'}
                </span>
                <span aria-hidden="true" class="opacity-50">
                  ·
                </span>
                <span>
                  <span class="font-medium tabular-nums text-foreground">
                    {props.cardCount()}
                  </span>{' '}
                  {props.cardCount() === 1 ? 'card' : 'cards'}
                </span>
                <Show when={(props.dueCount() ?? 0) > 0}>
                  <span aria-hidden="true" class="opacity-50">
                    ·
                  </span>
                  <span class="font-medium text-due">
                    <span class="tabular-nums">{props.dueCount()}</span> due
                  </span>
                </Show>
              </div>
            </Show>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <Show when={hasDecks()}>
            <Button onClick={props.onStudy} title="Study every deck in this folder">
              <Play class="h-4 w-4" />
              <span class="hidden sm:inline">Study</span>
            </Button>
          </Show>

          <Button
            variant={hasDecks() ? 'outline' : 'default'}
            onClick={props.onNewDeck}
            disabled={props.showNewDeck()}
          >
            <Plus class="h-4 w-4" />
            New deck
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button
                variant="ghost"
                size="icon"
                aria-label="More folder actions"
                title="More folder actions"
              >
                <MoreHorizontal class="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-52">
              <DropdownMenuItem onSelect={startEditName}>
                <Pencil class="h-4 w-4 text-muted-foreground" />
                Rename folder
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={props.onMove}>
                <FolderInput class="h-4 w-4 text-muted-foreground" />
                Move to library…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={props.onDelete}>
                <Trash2 class="h-4 w-4" />
                Delete folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Show when={hasDecks()}>
        <div class="relative max-w-md">
          <Search
            aria-hidden="true"
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search decks"
            placeholder="Search decks"
            class="pl-9"
            value={props.searchQuery()}
            onInput={(event) => props.setSearchQuery(event.currentTarget.value)}
          />
        </div>
      </Show>
    </header>
  );
};

export default FolderHeader;
