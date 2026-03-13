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
import PageShell from '@/components/layout/page-shell';
import { toast } from '@/stores/toast.store';
import { ROUTES } from '@/constants';
import { resolvedTheme } from '@/stores/theme.store';
import {
  ArrowLeft,
  BookOpen,
  Plus,
  X,
  Layers,
  ChevronRight,
  Search,
} from 'lucide-solid';

// ── Pastel gradient presets for deck cards (palette priority order) ──────────
const DECK_CARD_COLORS = [
  'linear-gradient(135deg, #B2D8F1 0%, #AFE5E3 100%)', // sky → teal
  'linear-gradient(135deg, #F0CBF1 0%, #E2CFFC 100%)', // lavender → purple
  'linear-gradient(135deg, #B5CCFF 0%, #B2D8F1 100%)', // periwinkle → sky
  'linear-gradient(135deg, #AFE5E3 0%, #ABF6D0 100%)', // teal → mint
  'linear-gradient(135deg, #E2CFFC 0%, #FEC7E7 100%)', // purple → pink
  'linear-gradient(135deg, #FEC7E7 0%, #F0CBF1 100%)', // pink → lavender
  'linear-gradient(135deg, #ABF6D0 0%, #AFE5E3 100%)', // mint → teal
  'linear-gradient(135deg, #B5CCFF 0%, #ABF6D0 100%)', // periwinkle → mint
] as const;

// Dark mode: deeply muted (~40%) versions — lower saturation & brightness to reduce glare
const DECK_CARD_COLORS_DARK = [
  'linear-gradient(135deg, #4A7A8F 0%, #4A8A88 100%)', // deep sky → teal
  'linear-gradient(135deg, #8A6A8B 0%, #7A6A9A 100%)', // deep lavender → purple
  'linear-gradient(135deg, #5A6A9F 0%, #4A7A8F 100%)', // deep periwinkle → sky
  'linear-gradient(135deg, #4A8A88 0%, #4A9A7A 100%)', // deep teal → mint
  'linear-gradient(135deg, #7A6A9A 0%, #9A5A7A 100%)', // deep purple → pink
  'linear-gradient(135deg, #9A5A7A 0%, #8A6A8B 100%)', // deep pink → lavender
  'linear-gradient(135deg, #4A9A7A 0%, #4A8A88 100%)', // deep mint → teal
  'linear-gradient(135deg, #5A6A9F 0%, #4A9A7A 100%)', // deep periwinkle → mint
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
    resolvedTheme() === 'dark'
      ? DECK_CARD_COLORS_DARK[index % DECK_CARD_COLORS_DARK.length]!
      : DECK_CARD_COLORS[index % DECK_CARD_COLORS.length]!;

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <PageShell maxWidth={false} class="p-0">
      {/* ── Hero header ── */}
      <div class="border-b px-6 py-4">
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
                onChange={(e) => setNewDeckTemplateId(e.currentTarget.value)}
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
                    creating() || !newDeckName().trim() || !newDeckTemplateId()
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
                {() => <div class="h-40 rounded-2xl bg-muted animate-pulse" />}
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
                    <div
                      class="inline-flex h-16 w-16 rounded-full items-center justify-center mb-4"
                      style={{ background: '#B2D8F1' }}
                    >
                      <BookOpen class="h-7 w-7 text-slate-700" />
                    </div>
                    <p class="text-foreground font-medium mb-1">No decks yet</p>
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
                      class="group relative overflow-hidden rounded-2xl p-5 text-left transition-[transform,box-shadow] duration-200 hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      style={{ background: getGradient(index()) }}
                      onClick={() => navigate(`/deck/${deck.id}`)}
                    >
                      {/* Decorative shapes */}
                      <div class="absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-white/25 dark:bg-white/10" />
                      <div class="absolute -top-4 -right-10 h-20 w-20 rounded-full bg-white/15 dark:bg-white/5" />

                      {/* Content */}
                      <div class="relative z-10 flex flex-col h-full min-h-30">
                        {/* Deck name */}
                        <h3 class="text-lg font-bold text-slate-800 dark:text-white leading-tight mb-1 line-clamp-2">
                          {deck.name}
                        </h3>

                        {/* Card count */}
                        <p class="text-slate-600 dark:text-white/80 text-sm mb-auto">
                          {deck.cardCount}{' '}
                          {deck.cardCount === 1 ? 'card' : 'cards'}
                        </p>

                        {/* Bottom row */}
                        <div class="flex items-center justify-between mt-4">
                          {/* Template badge */}
                          <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-white/40 dark:bg-white/20 text-slate-700 dark:text-white/90 font-medium">
                            <Layers class="h-3 w-3" />
                            <TemplateName
                              templateId={deck.cardTemplateId}
                              templates={templates() ?? []}
                            />
                          </span>

                          {/* Arrow */}
                          <ChevronRight class="h-5 w-5 text-slate-500 dark:text-white/70 group-hover:text-slate-800 dark:group-hover:text-white group-hover:translate-x-0.5 transition-[color,transform]" />
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
    </PageShell>
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
