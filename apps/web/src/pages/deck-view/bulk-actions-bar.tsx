import { type Component } from 'solid-js';
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
    <div class="flex items-center gap-3 p-3 border rounded-xl bg-accent/50">
      <Button variant="ghost" size="sm" onClick={props.onSelectAll}>
        {props.selectedCount === props.totalCount
          ? 'Deselect All'
          : 'Select All'}
      </Button>
      <span class="text-sm text-muted-foreground">
        {props.selectedCount} selected
      </span>
      <div class="ml-auto flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={props.selectedCount === 0 || props.bulkDeleting}
          onClick={props.onBulkDelete}
        >
          <Trash2 class="h-3.5 w-3.5 mr-1.5" />
          {props.bulkDeleting
            ? 'Deleting...'
            : `Delete (${props.selectedCount})`}
        </Button>
      </div>
    </div>
  );
};

export default BulkActionsBar;
