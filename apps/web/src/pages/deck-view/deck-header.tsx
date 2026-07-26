import {
  type Component,
  Show,
  createSignal,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { api, getApiError } from '@/api/client';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/stores/toast.store';
import {
  ArrowLeft,
  Plus,
  Play,
  Layers,
  Search,
  Hash,
  Sparkles,
  CheckSquare,
  BarChart3,
  Pencil,
  ChevronDown,
} from 'lucide-solid';
import type { DeckData, TemplateData } from './use-deck-data';

interface DeckHeaderProps {
  deckId: string;
  deck: () => DeckData | null | undefined;
  template: () => TemplateData | null | undefined;
  cardCount: () => number;
  searchQuery: () => string;
  immediateSearchQuery: () => string;
  setSearchQuery: (v: string) => void;
  showAddCard: () => boolean;
  setShowAddCard: (v: boolean) => void;
  setAddInputs: (v: Record<string, unknown>) => void;
  showAiModal: () => boolean;
  setShowAiModal: (v: boolean) => void;
  selectMode: () => boolean;
  toggleSelectMode: () => void;
  showAnalytics: () => boolean;
  toggleAnalytics: () => void;
}

const DeckHeader: Component<DeckHeaderProps> = (props) => {
  const navigate = useNavigate();
  const [isEditingName, setIsEditingName] = createSignal(false);
  const [editName, setEditName] = createSignal('');
  const [savingName, setSavingName] = createSignal(false);
  let nameInputRef: HTMLInputElement | undefined;

  const startEditName = () => {
    setEditName(props.deck()?.name ?? '');
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
    const oldName = props.deck()?.name ?? '';
    if (!newName || newName === oldName) {
      cancelEditName();
      return;
    }
    setSavingName(true);
    try {
      const { error } = await (api.decks as any)[props.deckId].patch({ name: newName });
      if (error) throw new Error(getApiError(error));
      queryClient.invalidateQueries({ queryKey: ['deck', props.deckId] });
      toast.success('Deck renamed');
      setIsEditingName(false);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to rename deck');
    } finally {
      setSavingName(false);
    }
  };

  const handleNameKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEditName();
    } else if (e.key === 'Escape') {
      cancelEditName();
    }
  };

  return (
    <header class="z-20 shrink-0 border-b bg-background px-4 py-2 sm:px-6">
      <div class="mx-auto max-w-6xl">
        <div class="flex flex-col gap-2.5 lg:grid lg:grid-cols-[minmax(11rem,1fr)_minmax(13rem,18rem)_auto_auto] lg:items-center lg:gap-3">
          <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 lg:contents">
            <div class="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Back to folder"
                title="Back to folder"
                onClick={() => {
                  const folderId = props.deck()?.folderId;
                  navigate(folderId ? `/folder/${folderId}` : '/');
                }}
              >
                <ArrowLeft class="h-4 w-4" />
              </Button>

              <div class="min-w-0 flex-1">
                <Show
                  when={!isEditingName()}
                  fallback={
                    <input
                      ref={nameInputRef}
                      type="text"
                      value={editName()}
                      onInput={(e) => setEditName(e.currentTarget.value)}
                      onKeyDown={handleNameKeyDown}
                      onBlur={() => saveEditName()}
                      disabled={savingName()}
                      aria-label="Deck name"
                      class="h-7 w-full min-w-0 border-0 border-b-2 border-primary bg-transparent px-0 text-lg font-semibold leading-6 tracking-tight outline-none sm:text-xl"
                    />
                  }
                >
                  <div class="group flex min-w-0 items-center gap-0.5">
                    <h1 class="truncate text-lg font-semibold leading-6 tracking-tight text-foreground sm:text-xl">
                      {props.deck()?.name ?? 'Loading...'}
                    </h1>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="h-7 w-7 shrink-0 text-muted-foreground opacity-70 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      onClick={startEditName}
                      aria-label="Rename deck"
                      title="Rename deck"
                    >
                      <Pencil class="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </Show>

                <div class="mt-0.5 flex min-w-0 items-center gap-2.5 overflow-hidden text-[11px] leading-4 text-muted-foreground">
                  <Show when={props.template()}>
                    <span class="inline-flex min-w-0 items-center gap-1">
                      <Layers class="h-3 w-3 shrink-0" />
                      <span class="truncate">{props.template()!.name}</span>
                    </span>
                  </Show>
                  <span class="inline-flex shrink-0 items-center gap-1">
                    <Hash class="h-3 w-3" />
                    {props.cardCount()} card
                    {props.cardCount() !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </div>

            <Button
              onClick={() => navigate(`/study/${props.deck()?.id ?? ''}`)}
              disabled={!props.deck()?.id}
              size="sm"
              class="h-8 shrink-0 justify-self-end px-3 shadow-sm lg:col-start-4 lg:row-start-1"
              aria-label="Study this deck"
              title="Study this deck"
            >
              <Play class="h-4 w-4" />
              <span class="hidden sm:inline">Study</span>
            </Button>
          </div>

          <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 lg:contents">
            <div class="relative min-w-0 lg:col-start-2 lg:row-start-1">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Search cards in this deck"
                placeholder="Search cards"
                class="h-8 bg-card pl-8 text-xs"
                value={props.immediateSearchQuery()}
                onInput={(e) => props.setSearchQuery(e.currentTarget.value)}
              />
            </div>

            <div class="flex min-w-0 items-center justify-end gap-1 lg:col-start-3 lg:row-start-1">
              <Button
                variant="outline"
                size="sm"
                class="h-8 px-2.5"
                onClick={() => {
                  props.setAddInputs({});
                  props.setShowAddCard(true);
                }}
                disabled={props.showAddCard()}
              >
                <Plus class="h-4 w-4" />
                Add card
              </Button>

              <div class="hidden items-center gap-0.5 2xl:flex">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => props.setShowAiModal(true)}
                  disabled={props.showAiModal()}
                  class="text-learning hover:bg-learning-surface hover:text-learning"
                >
                  <Sparkles class="h-4 w-4" />
                  Generate with AI
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={props.toggleAnalytics}
                  aria-pressed={props.showAnalytics()}
                  class={cn(
                    props.showAnalytics() &&
                      'bg-accent text-accent-foreground',
                  )}
                >
                  <BarChart3 class="h-4 w-4" />
                  Analytics
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={props.toggleSelectMode}
                  aria-pressed={props.selectMode()}
                  class={cn(
                    props.selectMode() && 'bg-accent text-accent-foreground',
                  )}
                >
                  <CheckSquare class="h-4 w-4" />
                  {props.selectMode() ? 'Exit selection' : 'Select cards'}
                </Button>
              </div>

              <div class="2xl:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <Button
                      variant="ghost"
                      size="sm"
                      class={cn(
                        'h-8 px-2.5',
                        (props.showAnalytics() || props.selectMode()) &&
                          'bg-accent text-accent-foreground',
                      )}
                      aria-label="More deck actions"
                    >
                      Actions
                      <ChevronDown class="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" class="w-52">
                    <DropdownMenuItem
                      onSelect={() => props.setShowAiModal(true)}
                      disabled={props.showAiModal()}
                    >
                      <Sparkles class="h-4 w-4 text-learning" />
                      Generate with AI
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={props.toggleAnalytics}
                      aria-pressed={props.showAnalytics()}
                    >
                      <BarChart3 class="h-4 w-4 text-muted-foreground" />
                      {props.showAnalytics()
                        ? 'Hide analytics'
                        : 'Show analytics'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={props.toggleSelectMode}
                      aria-pressed={props.selectMode()}
                    >
                      <CheckSquare class="h-4 w-4 text-muted-foreground" />
                      {props.selectMode()
                        ? 'Exit selection'
                        : 'Select cards'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default DeckHeader;
