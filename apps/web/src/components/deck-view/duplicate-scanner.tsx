import { type Component, Show, For, createSignal } from 'solid-js';
import { api, getApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/stores/toast.store';
import { ScanSearch, Loader2, AlertTriangle, X } from 'lucide-solid';

interface DuplicatePair {
  cardA: string;
  cardB: string;
  labelA: string;
  labelB: string;
  similarity: number;
}

interface DuplicateScannerProps {
  deckId: string;
}

const DuplicateScanner: Component<DuplicateScannerProps> = (props) => {
  const [scanning, setScanning] = createSignal(false);
  const [pairs, setPairs] = createSignal<DuplicatePair[]>([]);
  const [scanned, setScanned] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(false);

  const handleScan = async () => {
    setScanning(true);
    setPairs([]);
    setDismissed(false);
    try {
      const { data, error } = await (api.ai as any)['deck-duplicates'].post({
        deckId: props.deckId,
        threshold: 0.95,
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
                {pairs().length} potential duplicate{pairs().length !== 1 ? 's' : ''} found
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
          <div class="space-y-2 max-h-48 overflow-y-auto">
            <For each={pairs()}>
              {(pair) => (
                <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-card border text-xs">
                  <div class="flex items-center gap-2 min-w-0 flex-1">
                    <span class="text-muted-foreground truncate">
                      {pair.labelA}
                    </span>
                    <span class="text-muted-foreground shrink-0">↔</span>
                    <span class="text-muted-foreground truncate">
                      {pair.labelB}
                    </span>
                  </div>
                  <Badge
                    variant={pair.similarity >= 0.95 ? 'destructive' : 'warning'}
                    class="shrink-0 ml-2"
                  >
                    {Math.round(pair.similarity * 100)}%
                  </Badge>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default DuplicateScanner;
