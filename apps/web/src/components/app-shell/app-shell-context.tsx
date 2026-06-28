import {
  type Accessor,
  createContext,
  createEffect,
  onCleanup,
  useContext,
} from 'solid-js';
import type {
  AppShellContextValue,
  CommandActionContext,
  ContextPanelDescriptor,
} from './types';

export const AppShellContext = createContext<AppShellContextValue>();

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
