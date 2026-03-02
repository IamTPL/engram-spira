import { type Component, For, Index, Show, createSignal } from 'solid-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X } from 'lucide-solid';

interface ArrayInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  maxItems?: number;
}

const ArrayInput: Component<ArrayInputProps> = (props) => {
  const [newItem, setNewItem] = createSignal('');

  const addItem = () => {
    const item = newItem().trim();
    if (!item) return;
    const max = props.maxItems ?? Infinity;
    if (props.value.length >= max) return;
    props.onChange([...props.value, item]);
    setNewItem('');
  };

  // Flush any pending text into the array (called before form submit)
  const flush = () => {
    const item = newItem().trim();
    if (!item) return;
    const max = props.maxItems ?? Infinity;
    if (props.value.length >= max) return;
    props.onChange([...props.value, item]);
    setNewItem('');
  };

  const removeItem = (index: number) => {
    props.onChange(props.value.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, val: string) => {
    const next = [...props.value];
    next[index] = val;
    props.onChange(next);
  };

  const atMax = () =>
    props.maxItems !== undefined && props.value.length >= props.maxItems;

  return (
    <div class="space-y-2">
      {/* Existing items — Index tracks by position, not value, so inputs keep focus */}
      <Index each={props.value}>
        {(item, i) => (
          <div class="flex gap-1.5">
            <Input
              value={item()}
              onInput={(e) => updateItem(i, e.currentTarget.value)}
              placeholder={`Item ${i + 1}`}
              class="h-8 text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => removeItem(i)}
            >
              <X class="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </Index>

      {/* Add new item row */}
      <Show when={!atMax()}>
        <div class="flex gap-1.5">
          <Input
            value={newItem()}
            onInput={(e) => setNewItem(e.currentTarget.value)}
            placeholder={props.placeholder ?? 'Add item...'}
            class="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addItem();
              }
            }}
            onBlur={() => flush()}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            class="h-8 w-8 shrink-0"
            onClick={addItem}
            disabled={!newItem().trim()}
          >
            <Plus class="h-3.5 w-3.5" />
          </Button>
        </div>
      </Show>

      {/* Counter */}
      <Show when={props.maxItems !== undefined}>
        <p class="text-xs text-muted-foreground">
          {props.value.length} / {props.maxItems} items
        </p>
      </Show>
    </div>
  );
};

export default ArrayInput;
export { ArrayInput };
