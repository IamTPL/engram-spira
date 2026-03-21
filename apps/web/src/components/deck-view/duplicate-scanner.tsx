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
    <div>
      {/* Scan button */}
      <Show when={!scanned() || dismissed()}>
        <Button
          variant="outline"
          size="sm"
          onClick={handleScan}
          disabled={scanning()}
          class="text-xs"
        >
          <Show when={scanning()} fallback={<ScanSearch class="h-3.5 w-3.5 mr-1.5" />}>
            <Loader2 class="h-3.5 w-3.5 mr-1.5 animate-spin" />
          </Show>
          {scanning() ? 'Scanning...' : 'Check Duplicates'}
        </Button>
      </Show>

      {/* Results */}
      <Show when={scanned() && pairs().length > 0 && !dismissed()}>
        <div class="rounded-xl border border-amber-400/30 bg-amber-500/5 p-4 mt-3 animate-fade-in">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <AlertTriangle class="h-4 w-4 text-amber-500" />
              <span class="text-sm font-semibold">
                {pairs().length} duplicate{pairs().length !== 1 ? 's' : ''} found
              </span>
            </div>
            <div class="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning()} class="text-xs h-7">
                <Show when={scanning()} fallback="Re-scan">
                  <Loader2 class="h-3 w-3 mr-1 animate-spin" /> Scanning
                </Show>
              </Button>
              <button
                class="text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setDismissed(true)}
              >
                <X class="h-4 w-4" />
              </button>
            </div>
          </div>

          <div class="space-y-2 max-h-[400px] overflow-y-auto">
            <For each={pairs()}>
              {(pair, idx) => (
                <div class="rounded-lg bg-card border overflow-hidden">
                  {/* Collapsed header — click to expand */}
                  <button
                    class="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
                    onClick={() => toggleExpand(idx())}
                  >
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                      <span class="font-medium capitalize">{pair.word}</span>
                      <span class="text-muted-foreground">— 2 cards with same word</span>
                    </div>
                    <Show when={expandedIdx() === idx()} fallback={<ChevronDown class="h-3.5 w-3.5 text-muted-foreground shrink-0" />}>
                      <ChevronUp class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </Show>
                  </button>

                  {/* Expanded compare view */}
                  <Show when={expandedIdx() === idx()}>
                    <div class="border-t px-3 py-3">
                      <div class="grid grid-cols-2 gap-3">
                        {/* Card A */}
                        <CompareCard
                          label="Card A"
                          fields={pair.fieldsA}
                          cardId={pair.cardA}
                          deleting={deleting()}
                          onDelete={() => handleDelete(pair.cardA, idx())}
                        />
                        {/* Card B */}
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
    </div>
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
    <div class="rounded-lg border bg-muted/30 p-3 text-xs space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{props.label}</span>
      </div>
      <div>
        <span class="font-semibold text-sm">{word()}</span>
        <Show when={ipa()}>
          <span class="text-muted-foreground ml-2">/{ipa()}/</span>
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
        class="w-full h-7 text-xs mt-2"
        onClick={props.onDelete}
        disabled={!!props.deleting}
      >
        <Show when={isDeleting()} fallback={<><Trash2 class="h-3 w-3 mr-1" /> Delete this card</>}>
          <Loader2 class="h-3 w-3 mr-1 animate-spin" /> Deleting...
        </Show>
      </Button>
    </div>
  );
};

export default DuplicateScanner;
