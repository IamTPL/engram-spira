import { Show, type Component } from 'solid-js';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-solid';

interface BulkActionsBarProps {
  selectedCount: number;
  totalCount: number;
  bulkDeleting: boolean;
  onSelectAll: () => void;
  onBulkDelete: () => void;
}

const BulkActionsBar: Component<BulkActionsBarProps> = (props) => {
  return (
    <div
      class="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-xs sm:flex-row sm:items-center"
      role="toolbar"
      aria-label="Bulk card actions"
    >
      <div class="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={props.onSelectAll}>
          {props.totalCount > 0 && props.selectedCount === props.totalCount
            ? 'Deselect all'
            : 'Select all'}
        </Button>
        <span
          class="text-sm tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {props.selectedCount} of {props.totalCount} selected
        </span>
      </div>
      <div class="sm:ml-auto">
        <Button
          variant="destructive"
          size="sm"
          class="w-full sm:w-auto"
          disabled={props.selectedCount === 0 || props.bulkDeleting}
          onClick={props.onBulkDelete}
          loading={props.bulkDeleting}
        >
          <Show when={!props.bulkDeleting}>
            <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
          </Show>
          Delete selected ({props.selectedCount})
        </Button>
      </div>
    </div>
  );
};

export default BulkActionsBar;
