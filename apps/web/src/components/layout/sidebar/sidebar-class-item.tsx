import { Show, For } from 'solid-js';
import {
  GripVertical,
  ChevronRight,
  ChevronDown,
  Layers,
  Pencil,
  Trash2,
  Plus,
  X,
} from 'lucide-solid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSidebar, type ClassItem } from './sidebar-context';
import { SidebarFolderItem } from './sidebar-folder-item';
import { expandedClasses, toggleClass } from '@/stores/sidebar.store';

interface SidebarClassItemProps {
  cls: ClassItem;
}

export function SidebarClassItem(props: SidebarClassItemProps) {
  const {
    foldersByClass,
    renamingId,
    renamingType,
    renameValue,
    setRenameValue,
    confirmDeleteId,
    setConfirmDeleteId,
    dragType,
    dragId,
    dropTargetId,
    handleClassDragStart,
    handleClassDragOver,
    handleClassDrop,
    handleDragEnd,
    startRename,
    cancelRename,
    submitRename,
    handleDeleteClass,
    creatingFolderForClass,
    setCreatingFolderForClass,
    newFolderName,
    setNewFolderName,
    handleCreateFolder,
    openNewFolder,
  } = useSidebar();

  return (
    <div
      draggable={
        renamingId() !== props.cls.id && confirmDeleteId() !== props.cls.id
      }
      onDragStart={(e) => handleClassDragStart(props.cls.id, e)}
      onDragOver={(e) => handleClassDragOver(props.cls.id, e)}
      onDrop={(e) => handleClassDrop(props.cls.id, e)}
      onDragEnd={handleDragEnd}
      class={
        dragId() === props.cls.id && dragType() === 'class'
          ? 'opacity-40'
          : dropTargetId() === props.cls.id && dragType() === 'class'
            ? 'border-t-2 border-palette-5'
            : ''
      }
    >
      {/* Class row */}
      <div class="flex items-center gap-0 group">
        <span
          class="opacity-0 group-hover:opacity-60 cursor-grab active:cursor-grabbing shrink-0 text-muted-foreground"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <GripVertical class="h-3.5 w-3.5" />
        </span>
        <Show
          when={renamingId() === props.cls.id && renamingType() === 'class'}
          fallback={
            <button
              class="flex items-center gap-1.5 flex-1 px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left min-w-0"
              onClick={() => toggleClass(props.cls.id)}
            >
              <Show
                when={expandedClasses()[props.cls.id]}
                fallback={
                  <ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground" />
                }
              >
                <ChevronDown class="h-3 w-3 shrink-0 text-muted-foreground" />
              </Show>
              <Layers class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span class="truncate font-semibold">{props.cls.name}</span>
            </button>
          }
        >
          <input
            class="flex-1 mx-1 px-1.5 py-0.5 text-sm rounded border border-palette-5 bg-background outline-none min-w-0"
            value={renameValue()}
            onInput={(e) => setRenameValue(e.currentTarget.value)}
            onBlur={() => submitRename(props.cls.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitRename(props.cls.id);
              } else if (e.key === 'Escape') {
                cancelRename();
              }
            }}
            ref={(el) =>
              setTimeout(() => {
                el.focus();
                el.select();
              }, 0)
            }
          />
        </Show>
        {/* Action buttons */}
        <Show when={renamingId() !== props.cls.id}>
          <Show
            when={confirmDeleteId() === props.cls.id}
            fallback={
              <>
                <button
                  class="opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 transition-opacity"
                  title="Rename class"
                  onClick={(e) =>
                    startRename(e, 'class', props.cls.id, props.cls.name)
                  }
                >
                  <Pencil class="h-3 w-3" />
                </button>
                <button
                  class="opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent shrink-0 transition-opacity"
                  title="Delete class"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteId(props.cls.id);
                  }}
                >
                  <Trash2 class="h-3 w-3" />
                </button>
                <button
                  class="opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 transition-opacity"
                  title="Add folder"
                  onClick={(e) => openNewFolder(e, props.cls.id)}
                >
                  <Plus class="h-3 w-3" />
                </button>
              </>
            }
          >
            <span class="text-xs text-destructive font-medium whitespace-nowrap">
              Delete?
            </span>
            <button
              class="h-6 w-6 flex items-center justify-center rounded text-destructive hover:bg-destructive/10 shrink-0"
              onClick={(e) => handleDeleteClass(e, props.cls.id)}
            >
              <X class="h-3 w-3" />
            </button>
            <button
              class="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-accent shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDeleteId(null);
              }}
            >
              <X class="h-3 w-3 opacity-50" />
            </button>
          </Show>
        </Show>
      </div>

      {/* Expanded class content — folders only */}
      <Show when={expandedClasses()[props.cls.id]}>
        <div class="ml-4 mt-0.5 space-y-0.5">
          {/* New Folder form */}
          <Show when={creatingFolderForClass() === props.cls.id}>
            <form
              onSubmit={(e) => handleCreateFolder(e, props.cls.id)}
              class="flex gap-1 py-1"
            >
              <Input
                placeholder="Folder name..."
                value={newFolderName()}
                onInput={(e) => setNewFolderName(e.currentTarget.value)}
                class="h-6 text-xs"
                autofocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setCreatingFolderForClass(null);
                }}
              />
              <Button type="submit" size="icon" class="h-6 w-6 shrink-0">
                <Plus class="h-3 w-3" />
              </Button>
            </form>
          </Show>

          {/* Folders */}
          <For each={foldersByClass()[props.cls.id] ?? []}>
            {(folder) => (
              <SidebarFolderItem folder={folder} classId={props.cls.id} />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
