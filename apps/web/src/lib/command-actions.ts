import { api as defaultClient, getApiError } from '@/api/client';
import type {
  CommandActionContext,
  CommandActionDefinition,
  CommandActionRef,
  CommandActionResult,
  QueryInvalidationKey,
} from '@/components/app-shell/types';

type ActionParams = Record<string, unknown>;
type ActionRuntime = {
  client: any;
};
type ActionImplementation<
  TParams extends ActionParams = ActionParams,
> = Omit<CommandActionDefinition<TParams>, 'run'> & {
  run: (
    params: TParams,
    context: CommandActionContext,
    runtime: ActionRuntime,
  ) => Promise<CommandActionResult> | CommandActionResult;
};

type StudyMode =
  | 'due'
  | 'deck'
  | 'folder'
  | 'class'
  | 'smart-group'
  | 'interleaved'
  | 'at-risk';

const commandActionOrder = [
  'navigate.home',
  'navigate.study',
  'navigate.library',
  'navigate.create',
  'navigate.insights',
  'study.startQueue',
  'deck.create',
  'deck.delete.confirm',
  'deck.delete',
  'card.createManual',
  'create.openAiPaste',
  'create.importCsv',
  'insight.studyAtRisk',
  'settings.open',
] as const;

export const commandActionIds = [...commandActionOrder];

function success(
  result: Omit<Extract<CommandActionResult, { status: 'success' }>, 'status'>,
): CommandActionResult {
  return { status: 'success', ...result };
}

function validationError(
  key: string,
  message = `${key} is required`,
): CommandActionResult {
  return {
    status: 'error',
    message,
    fieldErrors: { [key]: 'Required' },
  };
}

function actionError(error: unknown): CommandActionResult {
  return { status: 'error', message: getApiError(error) };
}

function asString(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function optionalString(value: unknown) {
  return asString(value);
}

function requireString(params: ActionParams, key: string) {
  return asString(params[key]) ?? validationError(key);
}

function isActionResult(value: unknown): value is CommandActionResult {
  return (
    !!value &&
    typeof value === 'object' &&
    'status' in value &&
    typeof (value as { status?: unknown }).status === 'string'
  );
}

function withQuery(path: string, params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const stringValue = optionalString(value);
    if (stringValue) search.set(key, stringValue);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function validateStudyMode(value: unknown): StudyMode | CommandActionResult {
  const mode = (optionalString(value) ?? 'due') as StudyMode;
  if (
    mode === 'due' ||
    mode === 'deck' ||
    mode === 'folder' ||
    mode === 'class' ||
    mode === 'smart-group' ||
    mode === 'interleaved' ||
    mode === 'at-risk'
  ) {
    return mode;
  }
  return { status: 'error', message: 'Invalid study mode' };
}

function validateStudyParams(
  params: ActionParams,
  context: CommandActionContext,
): ActionParams | CommandActionResult {
  const mode = validateStudyMode(params.mode);
  if (isActionResult(mode)) return mode;

  const deckId = optionalString(params.deckId) ?? context.selectedDeckId;
  const folderId = optionalString(params.folderId) ?? context.selectedFolderId;
  const classId = optionalString(params.classId) ?? context.selectedClassId;
  const smartGroupId = optionalString(params.smartGroupId);

  if (mode === 'deck' && !deckId) return validationError('deckId');
  if (mode === 'folder' && !folderId) return validationError('folderId');
  if (mode === 'class' && !classId) return validationError('classId');
  if (mode === 'smart-group' && !smartGroupId) {
    return validationError('smartGroupId');
  }

  return { mode, deckId, folderId, classId, smartGroupId };
}

function studyRoute(params: ActionParams) {
  return withQuery('/study', {
    mode: params.mode,
    deckId: params.deckId,
    folderId: params.folderId,
    classId: params.classId,
    smartGroupId: params.smartGroupId,
  });
}

function createRoute(params: ActionParams) {
  return withQuery('/create', {
    source: params.source,
    targetDeckId: params.targetDeckId,
    templateId: params.templateId,
  });
}

function libraryRoute(params: ActionParams) {
  return withQuery('/library', {
    classId: params.classId,
    folderId: params.folderId,
    deckId: params.deckId,
    view: params.view,
  });
}

function settingsRoute(params: ActionParams) {
  return withQuery('/settings', { section: params.section });
}

async function unwrapActionResponse<T>(response: {
  data?: T | null;
  error?: unknown;
}) {
  if (response.error) throw new Error(getApiError(response.error));
  return response.data;
}

const invalidates = {
  studyQueue: ['study-queue', 'command-center'] satisfies QueryInvalidationKey[],
  deckMutation: [
    'library-explorer',
    'command-center',
  ] satisfies QueryInvalidationKey[],
};

const definitions: Record<string, ActionImplementation<any>> = {
  'navigate.home': {
    id: 'navigate.home',
    label: 'Home',
    keywords: ['home', 'dashboard', 'command center'],
    requiredParams: [],
    validateParams: () => ({}),
    run: () => success({ navigateTo: '/' }),
  },

  'navigate.study': {
    id: 'navigate.study',
    label: 'Study',
    keywords: ['study', 'review', 'queue'],
    requiredParams: [],
    validateParams: validateStudyParams,
    run: (params) => success({ navigateTo: studyRoute(params) }),
  },

  'navigate.library': {
    id: 'navigate.library',
    label: 'Library',
    keywords: ['library', 'classes', 'folders', 'decks'],
    requiredParams: [],
    validateParams: (params, context) => ({
      classId: optionalString(params.classId) ?? context.selectedClassId,
      folderId: optionalString(params.folderId) ?? context.selectedFolderId,
      deckId: optionalString(params.deckId) ?? context.selectedDeckId,
      view: optionalString(params.view),
    }),
    run: (params) => success({ navigateTo: libraryRoute(params) }),
  },

  'navigate.create': {
    id: 'navigate.create',
    label: 'Create',
    keywords: ['create', 'add', 'import', 'generate'],
    requiredParams: [],
    validateParams: (params, context) => ({
      source: optionalString(params.source),
      targetDeckId:
        optionalString(params.targetDeckId) ?? context.selectedDeckId,
    }),
    run: (params) => success({ navigateTo: createRoute(params) }),
  },

  'navigate.insights': {
    id: 'navigate.insights',
    label: 'Insights',
    keywords: ['insights', 'analytics', 'forecast'],
    requiredParams: [],
    validateParams: () => ({}),
    run: () => success({ navigateTo: '/insights' }),
  },

  'study.startQueue': {
    id: 'study.startQueue',
    label: 'Start study queue',
    keywords: ['study', 'start', 'queue'],
    requiredParams: ['mode'],
    validateParams: validateStudyParams,
    run: (params) =>
      success({
        navigateTo: studyRoute(params),
        invalidate: invalidates.studyQueue,
      }),
  },

  'deck.create': {
    id: 'deck.create',
    label: 'Create deck',
    keywords: ['deck', 'create', 'new'],
    requiredParams: ['folderId', 'name', 'templateId'],
    validateParams: (params) => {
      const folderId = requireString(params, 'folderId');
      if (isActionResult(folderId)) return folderId;
      const name = requireString(params, 'name');
      if (isActionResult(name)) return name;
      const templateId = requireString(params, 'templateId');
      if (isActionResult(templateId)) return templateId;
      return { folderId, name, templateId };
    },
    run: async (params, _context, runtime) => {
      const deck = await unwrapActionResponse<{ id?: string }>(
        await runtime.client.decks['by-folder']({
          folderId: params.folderId,
        }).post({
          name: params.name,
          cardTemplateId: params.templateId,
        }),
      );
      return success({
        message: 'Deck created',
        navigateTo: deck?.id ? `/deck/${deck.id}` : undefined,
        invalidate: invalidates.deckMutation,
      });
    },
  },

  'deck.delete.confirm': {
    id: 'deck.delete.confirm',
    label: 'Delete deck',
    keywords: ['delete', 'remove', 'deck'],
    requiredParams: ['deckId'],
    validateParams: (params, context) => {
      const deckId = optionalString(params.deckId) ?? context.selectedDeckId;
      if (!deckId) return validationError('deckId');
      return { deckId };
    },
    run: (params) => ({
      status: 'confirm',
      title: 'Delete deck?',
      description: 'This removes the deck and its cards.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirmAction: {
        id: 'deck.delete',
        label: 'Delete deck',
        params: { deckId: params.deckId },
      },
    }),
  },

  'deck.delete': {
    id: 'deck.delete',
    label: 'Delete deck',
    keywords: ['delete', 'remove', 'deck'],
    requiredParams: ['deckId'],
    validateParams: (params, context) => {
      const deckId = optionalString(params.deckId) ?? context.selectedDeckId;
      if (!deckId) return validationError('deckId');
      return { deckId };
    },
    run: async (params, _context, runtime) => {
      await unwrapActionResponse(
        await runtime.client.decks[params.deckId].delete(),
      );
      return success({
        message: 'Deck deleted',
        navigateTo: '/',
        invalidate: invalidates.deckMutation,
      });
    },
  },

  'card.createManual': {
    id: 'card.createManual',
    label: 'Create card',
    keywords: ['card', 'manual', 'create'],
    requiredParams: ['deckId', 'templateId'],
    validateParams: (params, context) => {
      const deckId = optionalString(params.deckId) ?? context.selectedDeckId;
      if (!deckId) return validationError('deckId');
      const templateId = requireString(params, 'templateId');
      if (isActionResult(templateId)) return templateId;
      return { deckId, templateId, source: 'manual' };
    },
    run: (params) =>
      success({
        navigateTo: createRoute({
          source: 'manual',
          targetDeckId: params.deckId,
          templateId: params.templateId,
        }),
      }),
  },

  'create.openAiPaste': {
    id: 'create.openAiPaste',
    label: 'Generate cards',
    keywords: ['ai', 'paste', 'generate'],
    requiredParams: [],
    validateParams: (params, context) => ({
      source: 'ai-paste',
      targetDeckId:
        optionalString(params.targetDeckId) ?? context.selectedDeckId,
    }),
    run: (params) => success({ navigateTo: createRoute(params) }),
  },

  'create.importCsv': {
    id: 'create.importCsv',
    label: 'Import CSV',
    keywords: ['csv', 'import'],
    requiredParams: [],
    validateParams: (params, context) => ({
      source: 'csv',
      targetDeckId:
        optionalString(params.targetDeckId) ?? context.selectedDeckId,
    }),
    run: (params) => success({ navigateTo: createRoute(params) }),
  },

  'insight.studyAtRisk': {
    id: 'insight.studyAtRisk',
    label: 'Study at-risk cards',
    keywords: ['risk', 'weak', 'forgetting'],
    requiredParams: [],
    validateParams: (params, context) => ({
      mode: optionalString(params.groupId) ? 'smart-group' : 'at-risk',
      deckId: optionalString(params.deckId) ?? context.selectedDeckId,
      smartGroupId: optionalString(params.groupId),
    }),
    run: (params) =>
      success({
        navigateTo: studyRoute(params),
        invalidate: invalidates.studyQueue,
      }),
  },

  'settings.open': {
    id: 'settings.open',
    label: 'Settings',
    keywords: ['settings', 'preferences'],
    requiredParams: [],
    validateParams: (params) => ({ section: optionalString(params.section) }),
    run: (params) => success({ navigateTo: settingsRoute(params) }),
  },
};

export const commandActionDefinitions = commandActionOrder.map(
  (id) => definitions[id],
);

export function getCommandActionDefinition(id: string) {
  return definitions[id] ?? null;
}

export function createCommandActionRunner(options: { client?: any } = {}) {
  const runtime: ActionRuntime = {
    client: options.client ?? defaultClient,
  };

  return {
    async run(
      action: CommandActionRef,
      context: CommandActionContext,
    ): Promise<CommandActionResult> {
      const definition = definitions[action.id];
      if (!definition) {
        return { status: 'error', message: `Unknown action: ${action.id}` };
      }

      const params = definition.validateParams(
        action.params ?? {},
        context,
      );
      if (isActionResult(params)) return params;

      try {
        return await definition.run(params, context, runtime);
      } catch (error) {
        return actionError(error);
      }
    },
  };
}

export const commandActionRunner = createCommandActionRunner();
