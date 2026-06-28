import {
  type Accessor,
  type Component,
  type JSX,
  Show,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  useContext,
} from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import { PanelLeft, PanelRight } from 'lucide-solid';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { SidebarClassList } from '@/components/layout/sidebar/sidebar-class-list';
import { SidebarFooter } from '@/components/layout/sidebar/sidebar-footer';
import { SidebarProvider } from '@/components/layout/sidebar/sidebar-context';
import { commandActionRunner } from '@/lib/command-actions';
import { experienceQueryKeys } from '@/lib/experience-api';
import { queryClient } from '@/lib/query-client';
import { currentUser } from '@/stores/auth.store';
import { openSearch } from '@/stores/search.store';
import { toast } from '@/stores/toast.store';
import { cn } from '@/lib/utils';
import type {
  AppShellContextValue,
  CommandActionContext,
  CommandActionRef,
  CommandActionResult,
  ContextPanelDescriptor,
  QueryInvalidationKey,
} from './types';
import {
  clampPanelWidth,
  readStoredBoolean,
  readStoredPanelWidth,
  shellPanelBounds,
  shellStorageKeys,
  writeStoredValue,
  type ShellPanel,
} from './app-shell-state';
import { CommandBar } from './command-bar';
import { ContextPanel } from './context-panel';
import { MobileBottomNav } from './mobile-bottom-nav';
import { TaskRail } from './task-rail';

type AppShellProps = {
  children: JSX.Element;
};

type ConfirmationResult = Extract<CommandActionResult, { status: 'confirm' }>;

const AppShellContext = createContext<AppShellContextValue>();

function browserStorage() {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function isDesktopPanelViewport() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(min-width: 1280px)').matches
  );
}

function actionKey(action: CommandActionRef) {
  return `${action.id}:${JSON.stringify(action.params ?? {})}`;
}

function resolveAvailableRoute(href: string) {
  const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const url = new URL(href, base);

  if (url.pathname === '/study') {
    const deckId = url.searchParams.get('deckId');
    return deckId ? `/study/${deckId}` : '/study/interleaved';
  }

  if (url.pathname === '/library') {
    const deckId = url.searchParams.get('deckId');
    const folderId = url.searchParams.get('folderId');
    if (deckId) return `/deck/${deckId}`;
    if (folderId) return `/folder/${folderId}`;
    return '/';
  }

  if (url.pathname === '/create') {
    const targetDeckId = url.searchParams.get('targetDeckId');
    return targetDeckId ? `/deck/${targetDeckId}` : '/';
  }

  if (url.pathname === '/insights') return '/';

  return `${url.pathname}${url.search}${url.hash}`;
}

function invalidateExperienceQueries(
  keys: QueryInvalidationKey[] | undefined,
  context: CommandActionContext,
) {
  if (!keys) return;

  for (const key of keys) {
    if (key === 'command-center') {
      queryClient.invalidateQueries({
        queryKey: experienceQueryKeys.commandCenter(),
      });
    } else if (key === 'library-explorer') {
      queryClient.invalidateQueries({
        queryKey: experienceQueryKeys.libraryExplorer(),
      });
    } else if (key === 'study-queue') {
      queryClient.invalidateQueries({ queryKey: ['study-queue'] });
    } else if (key === 'deck-workspace') {
      if (context.selectedDeckId) {
        queryClient.invalidateQueries({
          queryKey: experienceQueryKeys.deckWorkspace(
            context.selectedDeckId,
          ) as unknown as readonly unknown[],
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ['deck-workspace'] });
      }
    } else if (key === 'insights-overview') {
      queryClient.invalidateQueries({
        queryKey: experienceQueryKeys.insightsOverview(),
      });
    } else if (key === 'command-search') {
      queryClient.invalidateQueries({ queryKey: ['command-search'] });
    }
  }
}

export const AppShell: Component<AppShellProps> = (props) => {
  const location = useLocation();
  const navigate = useNavigate();
  const storage = browserStorage();

  const [explorerWidth, setExplorerWidth] = createSignal(
    readStoredPanelWidth(storage, 'explorer'),
  );
  const [contextWidth, setContextWidth] = createSignal(
    readStoredPanelWidth(storage, 'context'),
  );
  const [explorerCollapsed, setExplorerCollapsed] = createSignal(
    readStoredBoolean(storage, shellStorageKeys.explorerCollapsed, false),
  );
  const [contextCollapsed, setContextCollapsed] = createSignal(
    readStoredBoolean(storage, shellStorageKeys.contextCollapsed, false),
  );
  const [explorerSheetOpen, setExplorerSheetOpen] = createSignal(false);
  const [contextSheetOpen, setContextSheetOpen] = createSignal(false);
  const [contextPanel, setContextPanel] =
    createSignal<ContextPanelDescriptor | null>(null);
  const [registeredActionContext, setRegisteredActionContext] = createSignal<
    Partial<CommandActionContext>
  >({});
  const [pendingActionKey, setPendingActionKey] = createSignal<string | null>(
    null,
  );
  const [confirmation, setConfirmation] =
    createSignal<ConfirmationResult | null>(null);

  createEffect(() =>
    writeStoredValue(storage, shellStorageKeys.explorerWidth, explorerWidth()),
  );
  createEffect(() =>
    writeStoredValue(storage, shellStorageKeys.contextWidth, contextWidth()),
  );
  createEffect(() =>
    writeStoredValue(
      storage,
      shellStorageKeys.explorerCollapsed,
      explorerCollapsed(),
    ),
  );
  createEffect(() =>
    writeStoredValue(
      storage,
      shellStorageKeys.contextCollapsed,
      contextCollapsed(),
    ),
  );

  createEffect(
    on(
      () => location.pathname,
      () => {
        setContextPanel(null);
        setRegisteredActionContext({});
        setExplorerSheetOpen(false);
        setContextSheetOpen(false);
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
      setContextSheetOpen(false);
    }
  };

  const navigateWithinShell = (href: string) => {
    navigate(resolveAvailableRoute(href));
    closeResponsiveSurfaces();
  };

  const handleActionResult = async (
    result: CommandActionResult,
    context: CommandActionContext,
  ) => {
    if (result.status === 'confirm') {
      setConfirmation(result);
      return;
    }

    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }

    invalidateExperienceQueries(result.invalidate, context);
    if (result.message) toast.success(result.message);
    if (result.navigateTo) navigateWithinShell(result.navigateTo);
  };

  const runShellAction = async (action: CommandActionRef) => {
    const key = actionKey(action);
    if (pendingActionKey() === key) return;

    const context = actionContext();
    setPendingActionKey(key);
    try {
      const result = await commandActionRunner.run(action, context);
      await handleActionResult(result, context);
    } finally {
      setPendingActionKey(null);
    }
  };

  const openExplorerPanel = () => {
    if (isDesktopPanelViewport()) {
      setExplorerCollapsed(false);
    } else {
      setExplorerSheetOpen(true);
    }
  };

  const openContextPanel = () => {
    if (isDesktopPanelViewport()) {
      setContextCollapsed(false);
    } else {
      setContextSheetOpen(true);
    }
  };

  const closeContextPanel = () => {
    if (isDesktopPanelViewport()) {
      setContextCollapsed(true);
    } else {
      setContextSheetOpen(false);
    }
  };

  const beginResize = (panel: ShellPanel, event: PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel === 'explorer' ? explorerWidth() : contextWidth();
    const setWidth = panel === 'explorer' ? setExplorerWidth : setContextWidth;

    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth =
        panel === 'explorer' ? startWidth + delta : startWidth - delta;
      setWidth(clampPanelWidth(panel, nextWidth));
    };

    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
  };

  const resizeByKeyboard = (panel: ShellPanel, event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    const delta = event.shiftKey ? 40 : 16;
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const width = panel === 'explorer' ? explorerWidth() : contextWidth();
    const setWidth = panel === 'explorer' ? setExplorerWidth : setContextWidth;
    setWidth(clampPanelWidth(panel, width + delta * direction));
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
    <SidebarProvider>
      <AppShellContext.Provider value={shellContext}>
        <div class="flex h-dvh min-h-0 w-full overflow-hidden bg-background text-foreground">
          <TaskRail
            onOpenExplorer={openExplorerPanel}
            onOpenContext={openContextPanel}
          />

          <Show when={!explorerCollapsed()}>
            <aside
              class="relative hidden h-full min-h-0 shrink-0 border-r bg-background xl:flex"
              style={{ width: `${explorerWidth()}px` }}
            >
              <LibraryExplorerPanel
                onCollapse={() => setExplorerCollapsed(true)}
              />
              <ResizeHandle
                panel="explorer"
                value={explorerWidth()}
                onPointerDown={beginResize}
                onKeyDown={resizeByKeyboard}
              />
            </aside>
          </Show>

          <div class="flex min-w-0 flex-1 flex-col">
            <CommandBar
              explorerCollapsed={explorerCollapsed()}
              contextCollapsed={contextCollapsed()}
              onOpenExplorer={openExplorerPanel}
              onToggleExplorer={() =>
                setExplorerCollapsed((collapsed) => !collapsed)
              }
              onOpenContext={openContextPanel}
              onToggleContext={() =>
                setContextCollapsed((collapsed) => !collapsed)
              }
            />

            <main
              id="main-content"
              tabindex="-1"
              class="min-h-0 flex-1 overflow-hidden bg-muted/20 focus:outline-none"
            >
              {props.children}
            </main>

            <MobileBottomNav
              onOpenExplorer={openExplorerPanel}
              onOpenContext={openContextPanel}
            />
          </div>

          <Show when={!contextCollapsed()}>
            <aside
              class="relative hidden h-full min-h-0 shrink-0 border-l bg-background xl:flex"
              style={{ width: `${contextWidth()}px` }}
            >
              <ResizeHandle
                panel="context"
                value={contextWidth()}
                onPointerDown={beginResize}
                onKeyDown={resizeByKeyboard}
              />
              <ContextPanel
                descriptor={contextPanel}
                pendingActionKey={pendingActionKey}
                onRunAction={runShellAction}
                onNavigate={navigateWithinShell}
                onOpenSearch={openSearch}
              />
            </aside>
          </Show>
        </div>

        <Sheet open={explorerSheetOpen()} onOpenChange={setExplorerSheetOpen}>
          <SheetContent side="left" class="w-[min(90vw,360px)] p-0">
            <SheetHeader class="sr-only">
              <SheetTitle>Library</SheetTitle>
            </SheetHeader>
            <LibraryExplorerPanel onCollapse={() => setExplorerSheetOpen(false)} />
          </SheetContent>
        </Sheet>

        <Sheet open={contextSheetOpen()} onOpenChange={setContextSheetOpen}>
          <SheetContent side="right" class="w-[min(92vw,380px)] p-0">
            <SheetHeader class="sr-only">
              <SheetTitle>Context</SheetTitle>
            </SheetHeader>
            <ContextPanel
              descriptor={contextPanel}
              pendingActionKey={pendingActionKey}
              onRunAction={runShellAction}
              onNavigate={navigateWithinShell}
              onOpenSearch={openSearch}
            />
          </SheetContent>
        </Sheet>

        <AlertDialog
          open={!!confirmation()}
          onOpenChange={(open) => {
            if (!open) setConfirmation(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmation()?.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmation()?.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setConfirmation(null)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant={confirmation()?.destructive ? 'destructive' : 'default'}
                onClick={() => {
                  const action = confirmation()?.onConfirmAction;
                  setConfirmation(null);
                  if (action) void runShellAction(action);
                }}
              >
                {confirmation()?.confirmLabel ?? 'Confirm'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AppShellContext.Provider>
    </SidebarProvider>
  );
};

const LibraryExplorerPanel: Component<{ onCollapse: () => void }> = (props) => {
  const navigate = useNavigate();

  return (
    <div class="flex h-full min-h-0 w-full flex-col">
      <div class="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
          onClick={() => navigate('/')}
        >
          <img src="/logo-engram.webp" alt="" class="h-7 w-auto" />
          <span class="truncate text-sm font-semibold">Engram Spira</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          aria-label="Collapse library"
          onClick={props.onCollapse}
        >
          <PanelLeft class="h-4 w-4" />
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <SidebarClassList />
      </div>

      <SidebarFooter compact={false} />
    </div>
  );
};

const ResizeHandle: Component<{
  panel: ShellPanel;
  value: number;
  onPointerDown: (panel: ShellPanel, event: PointerEvent) => void;
  onKeyDown: (panel: ShellPanel, event: KeyboardEvent) => void;
}> = (props) => {
  const bounds = () => shellPanelBounds[props.panel];
  const sideClass = () =>
    props.panel === 'explorer'
      ? 'right-[-4px] border-r'
      : 'left-[-4px] border-l';

  return (
    <div
      role="separator"
      aria-label={`Resize ${props.panel} panel`}
      aria-orientation="vertical"
      aria-valuemin={bounds().min}
      aria-valuemax={bounds().max}
      aria-valuenow={props.value}
      tabindex="0"
      class={cn(
        'absolute top-0 z-10 h-full w-2 cursor-col-resize border-transparent outline-none transition-colors hover:border-ring focus-visible:border-ring',
        sideClass(),
      )}
      onPointerDown={(event) => props.onPointerDown(props.panel, event)}
      onKeyDown={(event) => props.onKeyDown(props.panel, event)}
    />
  );
};

export function useAppShell() {
  const context = useContext(AppShellContext);
  if (!context) throw new Error('useAppShell must be used within AppShell');
  return context;
}

export function useRegisterContextPanel(
  descriptorAccessor: Accessor<ContextPanelDescriptor | null>,
) {
  const shell = useAppShell();

  createEffect(() => {
    const descriptor = descriptorAccessor();
    shell.setContextPanel(descriptor);

    onCleanup(() => {
      if (!descriptor || shell.contextPanel()?.id === descriptor.id) {
        shell.setContextPanel(null);
      }
    });
  });
}

export function useRegisterActionContext(
  contextAccessor: Accessor<Partial<CommandActionContext>>,
  keys: Array<keyof CommandActionContext>,
) {
  const shell = useAppShell();

  createEffect(() => {
    shell.setActionContext(contextAccessor());
    onCleanup(() => shell.clearActionContext(keys));
  });
}
