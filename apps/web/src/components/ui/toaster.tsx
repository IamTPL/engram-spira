import { type Component, For, Show } from 'solid-js';
import { toasts, removeToast, type Toast } from '@/stores/toast.store';
import { CheckCircle, XCircle, Info, X } from 'lucide-solid';

const iconFor = (type: Toast['type']) => {
  if (type === 'success') return CheckCircle;
  if (type === 'error') return XCircle;
  return Info;
};

const colorFor = (type: Toast['type']) => {
  if (type === 'success') return 'bg-card border-success/30 text-success';
  if (type === 'error') return 'bg-card border-destructive/30 text-destructive';
  return 'bg-card border-palette-5/30 text-palette-5';
};

const iconColorFor = (type: Toast['type']) => {
  if (type === 'success') return 'text-green-500';
  if (type === 'error') return 'text-destructive';
  return 'text-palette-5';
};

const Toaster: Component = () => {
  return (
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <For each={toasts()}>
        {(t) => {
          const Icon = iconFor(t.type);
          return (
            <div
              class={`flex items-center gap-3 min-w-64 max-w-sm px-4 py-3 rounded-lg border shadow-lg pointer-events-auto animate-slide-in ${colorFor(t.type)}`}
            >
              <Icon class={`h-4 w-4 shrink-0 ${iconColorFor(t.type)}`} />
              <span class="text-sm flex-1 text-foreground">{t.message}</span>
              <button
                class="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                onClick={() => removeToast(t.id)}
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>
          );
        }}
      </For>
    </div>
  );
};

export default Toaster;
