import type { Accessor, JSX } from 'solid-js';

export type CommandActionRef = {
  id: string;
  label: string;
  params?: Record<string, string | number | boolean | null>;
};

export type CommandActionContext = {
  route: string;
  currentUserId: string;
  selectedDeckId?: string;
  selectedCardId?: string;
  selectedFolderId?: string;
  selectedClassId?: string;
};

export type QueryInvalidationKey =
  | 'command-center'
  | 'library-explorer'
  | 'study-queue'
  | 'deck-workspace'
  | 'insights-overview'
  | 'command-search';

export type CommandActionResult =
  | {
      status: 'success';
      message?: string;
      navigateTo?: string;
      invalidate?: QueryInvalidationKey[];
    }
  | {
      status: 'error';
      message: string;
      fieldErrors?: Record<string, string>;
    }
  | {
      status: 'confirm';
      title: string;
      description: string;
      confirmLabel: string;
      destructive?: boolean;
      onConfirmAction: CommandActionRef;
    };

export type CommandActionDefinition<
  TParams extends Record<string, unknown> = Record<string, unknown>,
> = {
  id: string;
  label: string;
  keywords: string[];
  requiredParams: Array<keyof TParams>;
  validateParams: (
    params: Record<string, unknown>,
    context: CommandActionContext,
  ) => TParams | CommandActionResult;
  run: (
    params: TParams,
    context: CommandActionContext,
  ) => Promise<CommandActionResult> | CommandActionResult;
};

export type ContextPanelDescriptor = {
  id: string;
  title: string;
  content: () => JSX.Element;
  actions?: CommandActionRef[];
  empty?: boolean;
};

export type AppShellContextValue = {
  setContextPanel: (descriptor: ContextPanelDescriptor | null) => void;
  contextPanel: Accessor<ContextPanelDescriptor | null>;
  openContextPanel: () => void;
  closeContextPanel: () => void;
  actionContext: Accessor<CommandActionContext>;
  setActionContext: (patch: Partial<CommandActionContext>) => void;
  clearActionContext: (keys?: Array<keyof CommandActionContext>) => void;
};
