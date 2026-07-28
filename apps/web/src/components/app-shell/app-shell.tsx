import {
  type Component,
  type JSX,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { useLocation } from '@solidjs/router';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { currentUser } from '@/stores/auth.store';
import { cn } from '@/lib/utils';
import { AppShellContext } from './app-shell-context';
import type {
  AppShellContextValue,
  CommandActionContext,
  ContextPanelDescriptor,
} from './types';
import {
  clampPanelWidth,
  getAppShellViewportClass,
  readStoredPanelWidth,
  shellPanelBounds,
  shellStorageKeys,
  writeStoredValue,
} from './app-shell-state';
import { CommandSearch } from './command-search';
import { LibraryExplorer } from './library-explorer';
import { MobileBottomNav } from './mobile-bottom-nav';
import { TaskRail } from './task-rail';

type AppShellProps = {
  children: JSX.Element;
};

function browserStorage() {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function isDesktopPanelViewport() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(min-width: 1280px)').matches
  );
}

export const AppShell: Component<AppShellProps> = (props) => {
  const location = useLocation();
  const storage = browserStorage();

  const [explorerWidth, setExplorerWidth] = createSignal(
    readStoredPanelWidth(storage, 'explorer'),
  );
  const [explorerSheetOpen, setExplorerSheetOpen] = createSignal(false);
  const [contextPanel, setContextPanel] =
    createSignal<ContextPanelDescriptor | null>(null);
  const [registeredActionContext, setRegisteredActionContext] = createSignal<
    Partial<CommandActionContext>
  >({});
  let stopExplorerResize: (() => void) | undefined;

  createEffect(() =>
    writeStoredValue(storage, shellStorageKeys.explorerWidth, explorerWidth()),
  );

  createEffect(
    on(
      () => location.pathname,
      () => {
        setContextPanel(null);
        setRegisteredActionContext({});
        setExplorerSheetOpen(false);
      },
      { defer: true },
    ),
  );

  const actionContext = createMemo<CommandActionContext>(() => ({
    ...registeredActionContext(),
    route: location.pathname,
    currentUserId: currentUser()?.id ?? '',
  }));

  const setActionContext = (patch: Partial<CommandActionContext>) => {
    setRegisteredActionContext((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(patch) as Array<
        [keyof CommandActionContext, CommandActionContext[keyof CommandActionContext]]
      >) {
        if (value === undefined) {
          delete next[key];
        } else {
          next[key] = value as never;
        }
      }
      return next;
    });
  };

  const clearActionContext = (keys?: Array<keyof CommandActionContext>) => {
    if (!keys) {
      setRegisteredActionContext({});
      return;
    }

    setRegisteredActionContext((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  };

  const closeResponsiveSurfaces = () => {
    if (!isDesktopPanelViewport()) {
      setExplorerSheetOpen(false);
    }
  };

  const openExplorerPanel = () => {
    if (!isDesktopPanelViewport()) {
      setExplorerSheetOpen(true);
    }
  };

  const openContextPanel = () => {};
  const closeContextPanel = () => setContextPanel(null);

  const beginExplorerResize = (event: PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = explorerWidth();
    stopExplorerResize?.();

    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      setExplorerWidth(clampPanelWidth('explorer', startWidth + delta));
    };

    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (stopExplorerResize === stop) stopExplorerResize = undefined;
    };

    stopExplorerResize = stop;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
  };

  onCleanup(() => stopExplorerResize?.());

  const resizeExplorerByKeyboard = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    const delta = event.shiftKey ? 40 : 16;
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    setExplorerWidth(
      clampPanelWidth('explorer', explorerWidth() + delta * direction),
    );
  };

  const shellContext: AppShellContextValue = {
    setContextPanel,
    contextPanel,
    openContextPanel,
    closeContextPanel,
    actionContext,
    setActionContext,
    clearActionContext,
  };

  return (
    <AppShellContext.Provider value={shellContext}>
      <div class={getAppShellViewportClass()}>
        <TaskRail onOpenExplorer={openExplorerPanel} />

        <aside
          class="relative hidden h-full min-h-0 shrink-0 border-r bg-background xl:flex"
          style={{ width: `${explorerWidth()}px` }}
        >
          <LibraryExplorer
            onCollapse={() => {}}
            onNavigate={closeResponsiveSurfaces}
          />
          <ResizeHandle
            value={explorerWidth()}
            onPointerDown={beginExplorerResize}
            onKeyDown={resizeExplorerByKeyboard}
          />
        </aside>

        <div class="flex min-w-0 flex-1 flex-col">
          <main
            id="main-content"
            tabindex="-1"
            class="min-h-0 flex-1 overflow-hidden focus:outline-none"
          >
            {props.children}
          </main>

          <MobileBottomNav onOpenExplorer={openExplorerPanel} />
        </div>
      </div>

      <CommandSearch />

      <Sheet open={explorerSheetOpen()} onOpenChange={setExplorerSheetOpen}>
        <Show when={explorerSheetOpen()}>
          <SheetContent side="left" class="w-[min(92vw,360px)] p-0">
            <SheetHeader class="sr-only">
              <SheetTitle>Navigation and library</SheetTitle>
            </SheetHeader>
            <LibraryExplorer
              onCollapse={() => setExplorerSheetOpen(false)}
              onNavigate={closeResponsiveSurfaces}
            />
          </SheetContent>
        </Show>
      </Sheet>
    </AppShellContext.Provider>
  );
};

const ResizeHandle: Component<{
  value: number;
  onPointerDown: (event: PointerEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}> = (props) => {
  const bounds = () => shellPanelBounds.explorer;

  return (
    <div
      role="separator"
      aria-label="Resize navigation panel"
      aria-orientation="vertical"
      aria-valuemin={bounds().min}
      aria-valuemax={bounds().max}
      aria-valuenow={props.value}
      tabindex="0"
      class={cn(
        'absolute top-0 z-10 h-full w-2 cursor-col-resize border-transparent outline-none transition-colors hover:border-ring focus-visible:border-ring',
        'right-[-4px] border-r',
      )}
      onPointerDown={props.onPointerDown}
      onKeyDown={props.onKeyDown}
    />
  );
};

export {
  useAppShell,
  useRegisterActionContext,
  useRegisterContextPanel,
} from './app-shell-context';
