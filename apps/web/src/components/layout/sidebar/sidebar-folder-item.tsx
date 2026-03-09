import { Show } from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import { GripVertical, FolderOpen, Pencil, Trash2, X } from 'lucide-solid';
import { useSidebar } from './sidebar-context';
import { type FolderItem, closeMobileDrawer } from '@/stores/sidebar.store';

interface SidebarFolderItemProps {
  folder: FolderItem;
  classId: string;
}

export function SidebarFolderItem(props: SidebarFolderItemProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    renamingId,
    renamingType,
    renameValue,
    setRenameValue,
    confirmDeleteId,
    setConfirmDeleteId,
    dragType,
    dragId,
    dropTargetId,
    handleFolderDragStart,
    handleFolderDragOver,
    handleFolderDrop,
    handleDragEnd,
    startRename,
    cancelRename,
    submitRename,
    handleDeleteFolder,
  } = useSidebar();

  const isFolderActive = () => location.pathname === `/folder/${props.folder.id}`;

  return (
    <div
      draggable={renamingId() !== props.folder.id && confirmDeleteId() !== props.folder.id}
      onDragStart={(e) => {
        e.stopPropagation();
        handleFolderDragStart(props.classId, props.folder.id, e);
      }}
      onDragOver={(e) => handleFolderDragOver(props.folder.id, e)}
      onDrop={(e) => {
        e.stopPropagation();
        handleFolderDrop(props.classId, props.folder.id, e);
      }}
      onDragEnd={handleDragEnd}
      class={`flex items-center gap-0 group/folder ${
        dragId() === props.folder.id && dragType() === 'folder'
          ? 'opacity-40'
          : dropTargetId() === props.folder.id && dragType() === 'folder'
            ? 'border-t-2 border-palette-5'
            : ''
      }`}
    >
      <span
        class="opacity-0 group-hover/folder:opacity-60 cursor-grab active:cursor-grabbing shrink-0 text-muted-foreground"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <GripVertical class="h-3 w-3" />
      </span>
      <Show
        when={renamingId() === props.folder.id && renamingType() === 'folder'}
        fallback={
          <button
            class={`flex items-center gap-1.5 flex-1 px-2 py-1 text-sm rounded-md text-left min-w-0 transition-colors ${
              isFolderActive()
                ? 'bg-accent text-foreground font-medium'
                : 'hover:bg-accent'
            }`}
            onClick={() => {
              closeMobileDrawer();
              navigate(`/folder/${props.folder.id}`);
            }}
          >
            <FolderOpen class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate">{props.folder.name}</span>
          </button>
        }
      >
        <input
          class="flex-1 mx-1 px-1.5 py-0.5 text-sm rounded border border-palette-5 bg-background outline-none min-w-0"
          value={renameValue()}
          onInput={(e) => setRenameValue(e.currentTarget.value)}
          onBlur={() => submitRename(props.folder.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitRename(props.folder.id);
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
      <Show when={renamingId() !== props.folder.id}>
        <Show
          when={confirmDeleteId() === props.folder.id}
          fallback={
            <>
              <button
                class="opacity-0 group-hover/folder:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent shrink-0 transition-opacity"
                title="Rename folder"
                onClick={(e) => startRename(e, 'folder', props.folder.id, props.folder.name, props.classId)}
              >
                <Pencil class="h-3 w-3" />
              </button>
              <button
                class="opacity-0 group-hover/folder:opacity-100 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent shrink-0 transition-opacity"
                title="Delete folder"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteId(props.folder.id);
                }}
              >
                <Trash2 class="h-3 w-3" />
              </button>
            </>
          }
        >
          <span class="text-xs text-destructive font-medium whitespace-nowrap">
            Delete?
          </span>
          <button
            class="h-6 w-6 flex items-center justify-center rounded text-destructive hover:bg-destructive/10 shrink-0"
            onClick={(e) => handleDeleteFolder(e, props.classId, props.folder.id)}
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
  );
}
