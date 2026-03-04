import {
  type Component,
  createSignal,
  createResource,
  Show,
  For,
} from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Header from '@/components/layout/header';
import Sidebar from '@/components/layout/sidebar';
import { toast } from '@/stores/toast.store';
import { ROUTES } from '@/constants';
import {
  ArrowLeft,
  BookOpen,
  Plus,
  X,
  Layers,
  ChevronRight,
  Search,
} from 'lucide-solid';

// ── Gradient presets for deck cards ───────────────────────────────────
// Harmonize with the project's blue/slate palette
const DECK_CARD_GRADIENTS = [
  'from-blue-500 to-blue-700',
  'from-teal-500 to-teal-700',
  'from-indigo-500 to-indigo-700',
  'from-cyan-500 to-cyan-700',
  'from-blue-600 to-indigo-600',
  'from-slate-600 to-slate-800',
  'from-sky-500 to-blue-600',
  'from-violet-500 to-purple-700',
] as const;

interface DeckItem {
  id: string;
  name: string;
  folderId: string;
  cardTemplateId: string;
  cardCount: number;
}

interface TemplateItem {
  id: string;
  name: string;
  isSystem: boolean;
}

const FolderViewPage: Component = () => {
  const params = useParams<{ folderId: string }>();
  const navigate = useNavigate();

  // ── Search ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = createSignal('');

  // ── Create Deck state ───────────────────────────────────────────────
  const [showNewDeck, setShowNewDeck] = createSignal(false);
  const [newDeckName, setNewDeckName] = createSignal('');
  const [newDeckTemplateId, setNewDeckTemplateId] = createSignal('');
  const [creating, setCreating] = createSignal(false);

  // ── Data ────────────────────────────────────────────────────────────
  const [folder] = createResource(
    () => params.folderId,
    async (folderId) => {
      const { data } = await (api.folders as any)[folderId].get();
      return data as { id: string; name: string; classId: string } | null;
    },
  );

  const [decks, { refetch: refetchDecks }] = createResource(
    () => params.folderId,
    async (folderId) => {
      const { data } = await api.decks['by-folder']({ folderId }).get();
      return (data ?? []) as DeckItem[];
    },
  );

  const [templates] = createResource(async () => {
    const { data } = await api['card-templates'].get();
    return (data ?? []) as TemplateItem[];
  });

  // ── Filtered decks ──────────────────────────────────────────────────
  const filteredDecks = () => {
    const q = searchQuery().toLowerCase().trim();
    const all = decks() ?? [];
    if (!q) return all;
    return all.filter((d) => d.name.toLowerCase().includes(q));
  };

  const deckCount = () => decks()?.length ?? 0;

  // ── Create deck handler ─────────────────────────────────────────────
  const handleCreateDeck = async (e: Event) => {
    e.preventDefault();
    const name = newDeckName().trim();
    const templateId = newDeckTemplateId();
    if (!name || !templateId) return;
    setCreating(true);
    try {
      await api.decks['by-folder']({ folderId: params.folderId }).post({
        name,
        cardTemplateId: templateId,
      });
      setNewDeckName('');
      setNewDeckTemplateId('');
      setShowNewDeck(false);
      refetchDecks();
      toast.success('Deck created successfully');
    } catch {
      toast.error('Failed to create deck');
    } finally {
      setCreating(false);
    }
  };

  const getGradient = (index: number) =>
    DECK_CARD_GRADIENTS[index % DECK_CARD_GRADIENTS.length];

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div class="h-screen flex flex-col">
      <Header />
      <div class="flex flex-1 overflow-hidden">
        <Sidebar />

        <main class="flex-1 overflow-y-auto">
          {/* ── Hero header ── */}
          <div class="border-b bg-card px-6 py-5">
            <div class="max-w-5xl mx-auto">
              <div class="flex items-center gap-3 mb-3">
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 shrink-0"
                  onClick={() => navigate(ROUTES.DASHBOARD)}
                >
                  <ArrowLeft class="h-4 w-4" />
                </Button>
                <div class="flex-1 min-w-0">
                  <h1 class="text-xl font-bold truncate leading-tight">
                    {folder()?.name ?? 'Loading...'}
                  </h1>
                  <span class="text-sm text-muted-foreground">
                    {deckCount()} deck{deckCount() !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Actions row */}
              <div class="flex items-center gap-3">
                <Button
                  onClick={() => {
                    setNewDeckName('');
                    setNewDeckTemplateId(templates()?.[0]?.id ?? '');
                    setShowNewDeck(true);
                  }}
                  disabled={showNewDeck()}
                >
                  <Plus class="h-4 w-4 mr-2" />
                  New Deck
                </Button>

                {/* Search */}
                <Show when={deckCount() > 0}>
                  <div class="ml-auto relative max-w-xs w-full">
                    <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search decks..."
                      class="pl-9 h-9 text-sm"
                      value={searchQuery()}
                      onInput={(e) => setSearchQuery(e.currentTarget.value)}
                    />
                  </div>
                </Show>
              </div>
            </div>
          </div>

          {/* ── Content ── */}
          <div class="p-6">
            <div class="max-w-5xl mx-auto">
              {/* Create deck form */}
              <Show when={showNewDeck()}>
                <form
                  onSubmit={handleCreateDeck}
                  class="border rounded-xl p-5 bg-card shadow-sm mb-6 animate-fade-in space-y-3"
                >
                  <div class="flex items-center justify-between">
                    <h3 class="font-semibold text-foreground">New Deck</h3>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      class="h-8 w-8"
                      onClick={() => setShowNewDeck(false)}
                    >
                      <X class="h-4 w-4" />
                    </Button>
                  </div>
                  <Input
                    placeholder="Deck name..."
                    value={newDeckName()}
                    onInput={(e) => setNewDeckName(e.currentTarget.value)}
                    autofocus
                  />
                  <select
                    class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={newDeckTemplateId()}
                    onChange={(e) =>
                      setNewDeckTemplateId(e.currentTarget.value)
                    }
                  >
                    <option value="" disabled>
                      Select template...
                    </option>
                    <For each={templates() ?? []}>
                      {(t) => <option value={t.id}>{t.name}</option>}
                    </For>
                  </select>
                  <div class="flex gap-2">
                    <Button
                      type="submit"
                      disabled={
                        creating() ||
                        !newDeckName().trim() ||
                        !newDeckTemplateId()
                      }
                    >
                      {creating() ? 'Creating...' : 'Create Deck'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowNewDeck(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </Show>

              {/* Loading */}
              <Show when={decks.loading}>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <For each={[1, 2, 3]}>
                    {() => (
                      <div class="h-40 rounded-2xl bg-muted animate-pulse" />
                    )}
                  </For>
                </div>
              </Show>

              {/* Deck grid */}
              <Show when={!decks.loading}>
                <Show
                  when={filteredDecks().length > 0}
                  fallback={
                    <div class="text-center py-20">
                      <Show
                        when={deckCount() === 0}
                        fallback={
                          <p class="text-muted-foreground text-sm">
                            No results for &ldquo;{searchQuery()}&rdquo;
                          </p>
                        }
                      >
                        <div class="inline-flex h-16 w-16 rounded-full bg-muted items-center justify-center mb-4">
                          <BookOpen class="h-7 w-7 text-muted-foreground" />
                        </div>
                        <p class="text-foreground font-medium mb-1">
                          No decks yet
                        </p>
                        <p class="text-muted-foreground text-sm mb-4">
                          Create your first deck to start studying!
                        </p>
                        <Button
                          onClick={() => {
                            setNewDeckName('');
                            setNewDeckTemplateId(templates()?.[0]?.id ?? '');
                            setShowNewDeck(true);
                          }}
                        >
                          <Plus class="h-4 w-4 mr-2" />
                          Create Deck
                        </Button>
                      </Show>
                    </div>
                  }
                >
                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <For each={filteredDecks()}>
                      {(deck, index) => (
                        <button
                          class="group relative overflow-hidden rounded-2xl p-5 text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          onClick={() => navigate(`/deck/${deck.id}`)}
                        >
                          {/* Gradient background */}
                          <div
                            class={`absolute inset-0 bg-linear-to-br ${getGradient(index())} opacity-90`}
                          />

                          {/* Decorative wave */}
                          <div class="absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-white/10" />
                          <div class="absolute -top-4 -right-10 h-20 w-20 rounded-full bg-white/5" />

                          {/* Content */}
                          <div class="relative z-10 flex flex-col h-full min-h-30">
                            {/* Deck name */}
                            <h3 class="text-lg font-bold text-white leading-tight mb-1 line-clamp-2">
                              {deck.name}
                            </h3>

                            {/* Card count */}
                            <p class="text-white/80 text-sm mb-auto">
                              {deck.cardCount}{' '}
                              {deck.cardCount === 1 ? 'card' : 'cards'}
                            </p>

                            {/* Bottom row */}
                            <div class="flex items-center justify-between mt-4">
                              {/* Template badge */}
                              <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-white/20 text-white/90 font-medium">
                                <Layers class="h-3 w-3" />
                                <TemplateName
                                  templateId={deck.cardTemplateId}
                                  templates={templates() ?? []}
                                />
                              </span>

                              {/* Arrow */}
                              <ChevronRight class="h-5 w-5 text-white/60 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                            </div>
                          </div>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

// ── Helper to resolve template name by ID ────────────────────────────
const TemplateName: Component<{
  templateId: string;
  templates: TemplateItem[];
}> = (props) => {
  const name = () =>
    props.templates.find((t) => t.id === props.templateId)?.name ?? 'Template';
  return <span>{name()}</span>;
};

export default FolderViewPage;
