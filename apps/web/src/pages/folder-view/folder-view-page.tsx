import { type Component, createMemo, createSignal, Show, For } from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import { api, getApiError } from '@/api/client';
import { queryClient } from '@/lib/query-client';
import { experienceQueryKeys } from '@/lib/experience-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import PageShell from '@/components/layout/page-shell';
import { toast } from '@/stores/toast.store';
import { ROUTES } from '@/constants';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Plus,
  X,
  Layers,
  Trash2,
  RotateCcw,
} from 'lucide-solid';
import FolderHeader from './folder-header';
import {
  useFolderData,
  type DeckItem,
  type TemplateItem,
} from './use-folder-data';

const FolderViewPage: Component = () => {
  const params = useParams<{ folderId: string }>();
  const navigate = useNavigate();

  const data = useFolderData(() => params.folderId);

  const [searchQuery, setSearchQuery] = createSignal('');
  const [showNewDeck, setShowNewDeck] = createSignal(false);
  const [newDeckName, setNewDeckName] = createSignal('');
  const [newDeckTemplateId, setNewDeckTemplateId] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [deckToDelete, setDeckToDelete] = createSignal<DeckItem | null>(null);
  const [deletingDeck, setDeletingDeck] = createSignal(false);
  const [showDeleteFolder, setShowDeleteFolder] = createSignal(false);
  const [deletingFolder, setDeletingFolder] = createSignal(false);
  const [showMoveFolder, setShowMoveFolder] = createSignal(false);
  const [moveTargetClassId, setMoveTargetClassId] = createSignal('');
  const [movingFolder, setMovingFolder] = createSignal(false);

  const filteredDecks = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    if (!query) return data.decks();
    return data
      .decks()
      .filter((deck) => deck.name.toLowerCase().includes(query));
  });

  const moveTargets = createMemo(() =>
    data.classes().filter((cls) => cls.id !== data.folder()?.classId),
  );

  const refetchDecks = () =>
    queryClient.invalidateQueries({ queryKey: ['decks', params.folderId] });
  const refetchLibrary = () =>
    queryClient.invalidateQueries({
      queryKey: experienceQueryKeys.libraryExplorer(),
    });

  const openNewDeck = () => {
    setNewDeckName('');
    setNewDeckTemplateId(data.templates()[0]?.id ?? '');
    setShowNewDeck(true);
  };

  const openMoveFolder = () => {
    setMoveTargetClassId(moveTargets()[0]?.id ?? '');
    setShowMoveFolder(true);
  };

  const startFolderStudy = () => {
    navigate(`/study/interleaved?folderId=${params.folderId}`);
  };

  const handleDeleteDeck = async (deckId: string) => {
    setDeletingDeck(true);
    try {
      const { error } = await (api.decks as any)[deckId].delete();
      if (error) throw new Error(getApiError(error));
      setDeckToDelete(null);
      await refetchDecks();
      refetchLibrary();
      toast.success('Deck deleted');
    } catch (error: any) {
      toast.error(error?.message ?? 'Failed to delete deck');
    } finally {
      setDeletingDeck(false);
    }
  };

  const handleDeleteFolder = async () => {
    setDeletingFolder(true);
    try {
      const { error } = await (api.folders as any)[params.folderId].delete();
      if (error) throw new Error(getApiError(error));
      setShowDeleteFolder(false);
      refetchLibrary();
      toast.success('Folder deleted');
      navigate(ROUTES.DASHBOARD);
    } catch (error: any) {
      toast.error(error?.message ?? 'Failed to delete folder');
    } finally {
      setDeletingFolder(false);
    }
  };

  const handleMoveFolder = async () => {
    const classId = moveTargetClassId();
    if (!classId) return;

    setMovingFolder(true);
    try {
      const { error } = await (api.folders as any)[params.folderId].move.patch({
        classId,
      });
      if (error) throw new Error(getApiError(error));
      setShowMoveFolder(false);
      queryClient.invalidateQueries({ queryKey: ['folder', params.folderId] });
      refetchLibrary();
      toast.success('Folder moved');
    } catch (error: any) {
      toast.error(error?.message ?? 'Failed to move folder');
    } finally {
      setMovingFolder(false);
    }
  };

  const handleCreateDeck = async (event: Event) => {
    event.preventDefault();
    const name = newDeckName().trim();
    const templateId = newDeckTemplateId();
    if (!name || !templateId) return;

    setCreating(true);
    try {
      const { error } = await api.decks['by-folder']({
        folderId: params.folderId,
      }).post({
        name,
        cardTemplateId: templateId,
      });
      if (error) throw new Error(getApiError(error));
      setShowNewDeck(false);
      await refetchDecks();
      refetchLibrary();
      toast.success('Deck created');
    } catch (error: any) {
      toast.error(error?.message ?? 'Failed to create deck');
    } finally {
      setCreating(false);
    }
  };

  return (
    <PageShell maxWidth="max-w-6xl" class="space-y-6">
      <Show
        when={!data.folderQuery.isError}
        fallback={
          <div class="rounded-xl border border-destructive/25 bg-destructive-surface p-5">
            <p class="font-medium text-destructive">Folder unavailable</p>
            <p class="mt-1 text-sm text-muted-foreground">
              This folder may have been deleted, or it does not belong to you.
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => data.folderQuery.refetch()}
              >
                <RotateCcw class="h-4 w-4" />
                Try again
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(ROUTES.DASHBOARD)}
              >
                <ArrowLeft class="h-4 w-4" />
                Back to Library
              </Button>
            </div>
          </div>
        }
      >
        <FolderHeader
          folderId={params.folderId}
          folder={data.folder}
          isLoading={() => data.folderQuery.isLoading}
          parentClassName={() => data.parentClass()?.name ?? null}
          deckCount={data.deckCount}
          cardCount={data.cardCount}
          dueCount={data.dueCount}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          showNewDeck={showNewDeck}
          onNewDeck={openNewDeck}
          onStudy={startFolderStudy}
          onMove={openMoveFolder}
          onDelete={() => setShowDeleteFolder(true)}
        />

        <Show when={showNewDeck()}>
          <form
            onSubmit={handleCreateDeck}
            class="rounded-xl border bg-card p-4 shadow-sm motion-safe:animate-fade-in sm:p-5"
          >
            <div class="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 class="font-semibold">Create a deck</h2>
                <p class="mt-1 text-sm text-muted-foreground">
                  Choose a template now. You can add or generate cards next.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="shrink-0"
                aria-label="Close new deck form"
                onClick={() => setShowNewDeck(false)}
              >
                <X class="h-4 w-4" />
              </Button>
            </div>

            <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <label class="grid gap-2 text-sm font-medium">
                Deck name
                <Input
                  placeholder="e.g. Product vocabulary"
                  value={newDeckName()}
                  onInput={(event) => setNewDeckName(event.currentTarget.value)}
                  autofocus
                />
              </label>
              <label class="grid gap-2 text-sm font-medium">
                Card template
                <select
                  class="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
                  value={newDeckTemplateId()}
                  onChange={(event) =>
                    setNewDeckTemplateId(event.currentTarget.value)
                  }
                >
                  <option value="" disabled>
                    Select a template
                  </option>
                  <For each={data.templates()}>
                    {(template) => (
                      <option value={template.id}>{template.name}</option>
                    )}
                  </For>
                </select>
              </label>
              <Button
                type="submit"
                disabled={
                  creating() || !newDeckName().trim() || !newDeckTemplateId()
                }
              >
                {creating() ? 'Creating...' : 'Create deck'}
              </Button>
            </div>
          </form>
        </Show>

        <Show when={data.decksQuery.isLoading}>
          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <For each={[1, 2, 3]}>
              {() => (
                <div class="h-60 animate-pulse rounded-xl border bg-muted/55" />
              )}
            </For>
          </div>
        </Show>

        <Show when={data.decksQuery.isError}>
          <div class="rounded-xl border border-destructive/25 bg-destructive-surface p-5">
            <p class="font-medium text-destructive">
              Could not load this folder
            </p>
            <p class="mt-1 text-sm text-muted-foreground">
              Check your connection and try again.
            </p>
            <Button
              variant="outline"
              size="sm"
              class="mt-4"
              onClick={() => data.decksQuery.refetch()}
            >
              <RotateCcw class="h-4 w-4" />
              Try again
            </Button>
          </div>
        </Show>

        <Show when={!data.decksQuery.isLoading && !data.decksQuery.isError}>
          <Show
            when={filteredDecks().length > 0}
            fallback={
              <div class="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed bg-card px-6 text-center">
                <div class="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                  <BookOpen class="h-5 w-5" />
                </div>
                <h2 class="font-semibold">
                  {data.deckCount() === 0 ? 'No decks yet' : 'No matching decks'}
                </h2>
                <p class="mt-2 max-w-sm text-sm text-muted-foreground">
                  {data.deckCount() === 0
                    ? 'Create a deck to organize cards and begin a focused study session.'
                    : `No decks match "${searchQuery()}". Try another search.`}
                </p>
                <Show when={data.deckCount() === 0}>
                  <Button class="mt-5" onClick={openNewDeck}>
                    <Plus class="h-4 w-4" />
                    Create your first deck
                  </Button>
                </Show>
              </div>
            }
          >
            <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <For each={filteredDecks()}>
                {(deck) => (
                  <article class="group relative isolate min-h-60 overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-[border-color,box-shadow,transform] motion-safe:duration-200 hover:border-foreground/25 hover:shadow-md focus-within:border-ring/60 focus-within:shadow-md motion-safe:hover:-translate-y-0.5">
                    <button
                      type="button"
                      aria-label={`Open ${deck.name}, ${deck.cardCount} ${
                        deck.cardCount === 1 ? 'card' : 'cards'
                      }`}
                      class="absolute inset-0 z-0 flex h-full w-full appearance-none flex-col p-5 text-left text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      onClick={() => navigate(`/deck/${deck.id}`)}
                    >
                      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-hero-border bg-hero text-hero-foreground shadow-xs">
                        <Layers class="h-4 w-4" />
                      </div>

                      <div class="mt-5 min-w-0">
                        <h2 class="line-clamp-2 text-lg font-semibold leading-snug tracking-tight">
                          {deck.name}
                        </h2>
                        <p class="mt-2 text-sm text-muted-foreground">
                          <span class="font-medium tabular-nums text-foreground">
                            {deck.cardCount}
                          </span>{' '}
                          {deck.cardCount === 1 ? 'card' : 'cards'}
                        </p>
                      </div>

                      <div class="mt-auto flex min-w-0 items-end justify-between gap-4 border-t border-border/80 pt-4">
                        <div class="min-w-0">
                          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Template
                          </p>
                          <p class="mt-1 truncate text-sm font-medium text-foreground">
                            <TemplateName
                              templateId={deck.cardTemplateId}
                              templates={data.templates()}
                            />
                          </p>
                        </div>
                        <span class="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-foreground">
                          Open deck
                          <ArrowRight class="h-3.5 w-3.5 transition-transform motion-safe:group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </button>

                    <Button
                      variant="ghost"
                      size="icon"
                      class="absolute right-3 top-3 z-10 h-10 w-10 text-muted-foreground hover:bg-destructive-surface hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      aria-label={`Delete ${deck.name}`}
                      title={`Delete ${deck.name}`}
                      onClick={() => setDeckToDelete(deck)}
                    >
                      <Trash2 class="h-4 w-4" />
                    </Button>
                  </article>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>

      <AlertDialog
        open={!!deckToDelete()}
        onOpenChange={(open) => {
          if (!open && !deletingDeck()) setDeckToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this deck?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deckToDelete()?.name}” and all {deckToDelete()?.cardCount ?? 0}{' '}
              cards in it will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingDeck()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingDeck()}
              onClick={() => {
                const deck = deckToDelete();
                if (deck) void handleDeleteDeck(deck.id);
              }}
            >
              {deletingDeck() ? 'Deleting...' : 'Delete deck'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showDeleteFolder()}
        onOpenChange={(open) => {
          if (!open && !deletingFolder()) setShowDeleteFolder(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this folder?</AlertDialogTitle>
            <AlertDialogDescription>
              “{data.folder()?.name}” will be permanently deleted
              {data.deckCount() > 0
                ? `, along with its ${data.deckCount()} ${
                    data.deckCount() === 1 ? 'deck' : 'decks'
                  } and every card inside them`
                : ''}
              .
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingFolder()}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingFolder()}
              onClick={() => void handleDeleteFolder()}
            >
              {deletingFolder() ? 'Deleting...' : 'Delete folder'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={showMoveFolder()}
        onOpenChange={(open) => {
          if (!open && !movingFolder()) setShowMoveFolder(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move folder</DialogTitle>
            <DialogDescription>
              Pick the library that should hold “{data.folder()?.name}”. Its
              decks and cards move with it.
            </DialogDescription>
          </DialogHeader>

          <Show
            when={moveTargets().length > 0}
            fallback={
              <p class="text-sm text-muted-foreground">
                There is no other library to move this folder into. Create one
                from the sidebar first.
              </p>
            }
          >
            <label class="grid gap-2 text-sm font-medium">
              Destination library
              <select
                class="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
                value={moveTargetClassId()}
                onChange={(event) =>
                  setMoveTargetClassId(event.currentTarget.value)
                }
              >
                <For each={moveTargets()}>
                  {(cls) => <option value={cls.id}>{cls.name}</option>}
                </For>
              </select>
            </label>
          </Show>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={movingFolder()}
              onClick={() => setShowMoveFolder(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                movingFolder() ||
                !moveTargetClassId() ||
                moveTargets().length === 0
              }
              loading={movingFolder()}
              onClick={() => void handleMoveFolder()}
            >
              Move folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

const TemplateName: Component<{
  templateId: string;
  templates: TemplateItem[];
}> = (props) => {
  const name = () =>
    props.templates.find((template) => template.id === props.templateId)
      ?.name ?? 'Template';
  return <span>{name()}</span>;
};

export default FolderViewPage;
