import { type Component, Show, For, createSignal } from 'solid-js';
import { api, getApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { toast } from '@/stores/toast.store';
import {
  ScanSearch,
  Loader2,
  AlertTriangle,
  X,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-solid';
import { useQueryClient } from '@tanstack/solid-query';

interface FieldInfo {
  fieldName: string;
  side: string;
  value: unknown;
}

interface DuplicatePair {
  cardA: string;
  cardB: string;
  word: string;
  fieldsA: FieldInfo[];
  fieldsB: FieldInfo[];
}

interface DuplicateScannerProps {
  deckId: string;
}

/** Extract value from fields by name */
function getFieldValue(fields: FieldInfo[], name: string): string {
  const f = fields.find((fi) => fi.fieldName.toLowerCase() === name.toLowerCase());
  if (!f || f.value == null) return '';
  if (Array.isArray(f.value)) return (f.value as string[]).join(', ');
  return String(f.value);
}

const DuplicateScanner: Component<DuplicateScannerProps> = (props) => {
  const [scanning, setScanning] = createSignal(false);
  const [pairs, setPairs] = createSignal<DuplicatePair[]>([]);
  const [scanned, setScanned] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(false);
  const [expandedIdx, setExpandedIdx] = createSignal<number | null>(null);
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const queryClient = useQueryClient();

  const handleScan = async () => {
    setScanning(true);
    setPairs([]);
    setDismissed(false);
    setExpandedIdx(null);
    try {
      const { data, error } = await (api.ai as any)['deck-duplicates'].post({
        deckId: props.deckId,
      });
      if (error) throw new Error(getApiError(error));
      const result = data as { pairs: DuplicatePair[] };
      setPairs(result.pairs ?? []);
      setScanned(true);
      if ((result.pairs ?? []).length === 0) {
        toast.success('No duplicates found!');
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleDelete = async (cardId: string, pairIdx: number) => {
    setDeleting(cardId);
    try {
      const { error } = await (api.cards as any)[cardId].delete();
      if (error) throw new Error(getApiError(error));
      toast.success('Card deleted');
      // Remove this pair from the list
      setPairs((prev) => prev.filter((_, i) => i !== pairIdx));
      setExpandedIdx(null);
      // Invalidate cards query
      queryClient.invalidateQueries({ queryKey: ['cards'] });
      queryClient.invalidateQueries({ queryKey: ['cards-by-deck'] });
      queryClient.invalidateQueries({ queryKey: ['decks'] });
    } catch (err: any) {
      toast.error(err?.message ?? 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  const toggleExpand = (idx: number) => {
    setExpandedIdx((prev) => (prev === idx ? null : idx));
  };

  return (
    <section
      class="rounded-lg border bg-card p-4"
      aria-labelledby="duplicate-check-title"
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex items-start gap-2.5">
          <ScanSearch class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <h3
              id="duplicate-check-title"
              class="text-sm font-semibold text-foreground"
            >
              Duplicate check
            </h3>
            <p class="mt-0.5 text-xs text-muted-foreground">
              Compare cards that may repeat the same concept.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleScan}
          loading={scanning()}
          class="w-full text-xs sm:w-auto"
        >
          <Show when={!scanning()}>
            <ScanSearch class="h-3.5 w-3.5" />
          </Show>
          {scanned() ? 'Scan again' : 'Scan deck'}
        </Button>
      </div>

      <Show when={scanned() && pairs().length > 0 && !dismissed()}>
        <div class="mt-4 rounded-md border border-warning/30 bg-warning-surface p-3 motion-safe:animate-fade-in">
          <div class="mb-3 flex items-start justify-between gap-3">
            <div class="flex items-center gap-2">
              <AlertTriangle class="h-4 w-4 shrink-0 text-warning" />
              <span class="text-sm font-semibold text-foreground">
                {pairs().length} possible duplicate
                {pairs().length !== 1 ? 's' : ''}
              </span>
            </div>
            <button
              type="button"
              class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss duplicate results"
              title="Dismiss results"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <div class="max-h-[400px] space-y-2 overflow-y-auto">
            <For each={pairs()}>
              {(pair, idx) => (
                <div class="overflow-hidden rounded-md border bg-card">
                  <button
                    type="button"
                    class="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs transition-colors hover:bg-accent"
                    onClick={() => toggleExpand(idx())}
                    aria-expanded={expandedIdx() === idx()}
                    aria-controls={`duplicate-pair-${idx()}`}
                  >
                    <div class="min-w-0 flex-1">
                      <span class="font-medium capitalize text-foreground">
                        {pair.word}
                      </span>
                      <span class="ml-2 text-muted-foreground">
                        2 cards with the same term
                      </span>
                    </div>
                    <Show
                      when={expandedIdx() === idx()}
                      fallback={
                        <ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      }
                    >
                      <ChevronUp class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </Show>
                  </button>

                  <Show when={expandedIdx() === idx()}>
                    <div
                      id={`duplicate-pair-${idx()}`}
                      class="border-t px-3 py-3"
                    >
                      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <CompareCard
                          label="Card A"
                          fields={pair.fieldsA}
                          cardId={pair.cardA}
                          deleting={deleting()}
                          onDelete={() => handleDelete(pair.cardA, idx())}
                        />
                        <CompareCard
                          label="Card B"
                          fields={pair.fieldsB}
                          cardId={pair.cardB}
                          deleting={deleting()}
                          onDelete={() => handleDelete(pair.cardB, idx())}
                        />
                      </div>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={scanned() && pairs().length === 0}>
        <p class="mt-4 rounded-md bg-success-surface px-3 py-2 text-xs text-success">
          No duplicate cards were found.
        </p>
      </Show>
    </section>
  );
};

/** Side-by-side card comparison panel */
const CompareCard: Component<{
  label: string;
  fields: FieldInfo[];
  cardId: string;
  deleting: string | null;
  onDelete: () => void;
}> = (props) => {
  const word = () => getFieldValue(props.fields, 'word') || getFieldValue(props.fields, 'term');
  const definition = () => getFieldValue(props.fields, 'definition') || getFieldValue(props.fields, 'meaning');
  const ipa = () => getFieldValue(props.fields, 'ipa') || getFieldValue(props.fields, 'pronunciation');
  const example = () => getFieldValue(props.fields, 'examples') || getFieldValue(props.fields, 'example');

  const isDeleting = () => props.deleting === props.cardId;

  return (
    <div class="space-y-2 rounded-md border bg-card p-3 text-xs">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-muted-foreground">
          {props.label}
        </span>
      </div>
      <div>
        <span class="text-sm font-semibold text-foreground">{word()}</span>
        <Show when={ipa()}>
          <span class="ml-2 font-mono text-muted-foreground">/{ipa()}/</span>
        </Show>
      </div>
      <Show when={definition()}>
        <p class="text-muted-foreground leading-relaxed">{definition()}</p>
      </Show>
      <Show when={example()}>
        <p class="text-muted-foreground italic text-[11px]">{example()}</p>
      </Show>
      <Button
        variant="destructive"
        size="sm"
        class="mt-2 h-8 w-full text-xs"
        onClick={props.onDelete}
        disabled={!!props.deleting}
      >
        <Show
          when={isDeleting()}
          fallback={
            <>
              <Trash2 class="h-3 w-3" />
              Delete this card
            </>
          }
        >
          <Loader2 class="h-3 w-3 motion-safe:animate-spin" />
          Deleting...
        </Show>
      </Button>
    </div>
  );
};

export default DuplicateScanner;
