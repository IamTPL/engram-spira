import { Show, For } from 'solid-js';
import { Plus, X } from 'lucide-solid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSidebar } from './sidebar-context';
import { SidebarClassItem } from './sidebar-class-item';

export function SidebarClassList() {
  const {
    classes,
    classesLoading,
    showNewClass,
    setShowNewClass,
    newClassName,
    setNewClassName,
    handleCreateClass,
  } = useSidebar();

  return (
    <>
      {/* Library header */}
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Library
        </h2>
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          title="New Class"
          onClick={() => {
            setShowNewClass(!showNewClass());
            setNewClassName('');
          }}
        >
          <Plus class="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* New Class form */}
      <Show when={showNewClass()}>
        <form onSubmit={handleCreateClass} class="mb-3 flex gap-1">
          <Input
            placeholder="Class name..."
            value={newClassName()}
            onInput={(e) => setNewClassName(e.currentTarget.value)}
            class="h-7 text-xs"
            autofocus
          />
          <Button type="submit" size="icon" class="h-7 w-7 shrink-0">
            <Plus class="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="h-7 w-7 shrink-0"
            onClick={() => setShowNewClass(false)}
          >
            <X class="h-3 w-3" />
          </Button>
        </form>
      </Show>

      {/* Classes list */}
      <Show
        when={!classesLoading()}
        fallback={
          <div class="space-y-2 mt-2">
            <For each={[1, 2, 3]}>
              {() => <div class="h-7 rounded-md bg-muted animate-pulse" />}
            </For>
          </div>
        }
      >
        <Show
          when={classes().length > 0}
          fallback={
            <p class="text-xs text-muted-foreground text-center py-6 leading-relaxed">
              No classes yet.
              <br />
              Click <strong>+</strong> to create one.
            </p>
          }
        >
          <nav class="space-y-0.5">
            <For each={classes()}>
              {(cls) => <SidebarClassItem cls={cls} />}
            </For>
          </nav>
        </Show>
      </Show>
    </>
  );
}
