import Elysia from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import { ValidationError } from '../../shared/errors';
import { getCommandCenter } from './command-center.service';
import { searchCommands } from './command-search.service';
import {
  commitCreatePreview,
  createPreview,
} from './create-preview.service';
import { getDeckWorkspace } from './deck-workspace.service';
import { getInsightsOverview } from './insights-overview.service';
import { getLibraryExplorer } from './library-explorer.service';
import { getStudyQueue } from './study-queue.service';
import type {
  CommandSearchQuery,
  CreateCommitRequest,
  CreatePreviewRequest,
  DeckWorkspaceQuery,
  StudyQueueQuery,
} from './experience.types';

export type ExperienceRouteServices = {
  getCommandCenter: typeof getCommandCenter;
  getStudyQueue: typeof getStudyQueue;
  getLibraryExplorer: typeof getLibraryExplorer;
  getDeckWorkspace: typeof getDeckWorkspace;
  getInsightsOverview: typeof getInsightsOverview;
  searchCommands: typeof searchCommands;
  createPreview: typeof createPreview;
  commitCreatePreview: typeof commitCreatePreview;
};

const defaultExperienceRouteServices: ExperienceRouteServices = {
  getCommandCenter,
  getStudyQueue,
  getLibraryExplorer,
  getDeckWorkspace,
  getInsightsOverview,
  searchCommands,
  createPreview,
  commitCreatePreview,
};

export function createExperienceRoutes(
  services: ExperienceRouteServices = defaultExperienceRouteServices,
  authPlugin: any = requireAuth,
) {
  return new Elysia({ name: 'experience-routes' })
    .use(authPlugin)
    .get('/dashboard/command-center', ({ currentUser }: any) =>
      services.getCommandCenter(currentUser.id),
    )
    .get('/study/queue', ({ currentUser, query }: any) =>
      services.getStudyQueue(currentUser.id, parseStudyQueueQuery(query)),
    )
    .get('/library/explorer', ({ currentUser }: any) =>
      services.getLibraryExplorer(currentUser.id),
    )
    .get('/decks/:id/workspace', ({ currentUser, params, query }: any) =>
      services.getDeckWorkspace(
        currentUser.id,
        params.id,
        parseDeckWorkspaceQuery(query),
      ),
    )
    .get('/insights/overview', ({ currentUser }: any) =>
      services.getInsightsOverview(currentUser.id),
    )
    .get('/command/search', ({ currentUser, query }: any) =>
      services.searchCommands(currentUser.id, parseCommandSearchQuery(query)),
    )
    .post('/create/preview', ({ currentUser, body }: any) =>
      services.createPreview(currentUser.id, body as CreatePreviewRequest),
    )
    .post('/create/commit', ({ currentUser, body }: any) =>
      services.commitCreatePreview(currentUser.id, body as CreateCommitRequest),
    );
}

export const experienceRoutes = createExperienceRoutes();

function parseStudyQueueQuery(query: Record<string, unknown>): StudyQueueQuery {
  const mode = String(query.mode ?? 'due') as StudyQueueQuery['mode'];
  const limit = parseOptionalNumber(query.limit, 'limit');
  const base = limit === undefined ? { mode } : { mode, limit };

  switch (mode) {
    case 'deck':
      return { ...base, deckId: stringOrUndefined(query.deckId) } as StudyQueueQuery;
    case 'folder':
      return {
        ...base,
        folderId: stringOrUndefined(query.folderId),
      } as StudyQueueQuery;
    case 'class':
      return {
        ...base,
        classId: stringOrUndefined(query.classId),
      } as StudyQueueQuery;
    case 'smart-group':
      return {
        ...base,
        smartGroupId: stringOrUndefined(query.smartGroupId),
      } as StudyQueueQuery;
    case 'at-risk':
      return { ...base, deckId: stringOrUndefined(query.deckId) } as StudyQueueQuery;
    case 'interleaved':
    case 'due':
    default:
      return base as StudyQueueQuery;
  }
}

function parseDeckWorkspaceQuery(
  query: Record<string, unknown>,
): DeckWorkspaceQuery {
  const parsed: DeckWorkspaceQuery = {};
  const cardPage = parseOptionalNumber(query.cardPage, 'cardPage');
  const cardPageSize = parseOptionalNumber(query.cardPageSize, 'cardPageSize');
  const cardSearch = stringOrUndefined(query.cardSearch);
  const sort = stringOrUndefined(query.sort);

  if (cardPage !== undefined) parsed.cardPage = cardPage;
  if (cardPageSize !== undefined) parsed.cardPageSize = cardPageSize;
  if (cardSearch !== undefined) parsed.cardSearch = cardSearch;
  if (
    sort === 'createdAt' ||
    sort === 'updatedAt' ||
    sort === 'dueAt' ||
    sort === 'template'
  ) {
    parsed.sort = sort;
  }

  return parsed;
}

function parseCommandSearchQuery(
  query: Record<string, unknown>,
): CommandSearchQuery {
  const q = String(query.q ?? '').trim();
  if (!q) throw new ValidationError('Query is required');

  const limit = parseOptionalNumber(query.limit, 'limit');
  if (limit !== undefined && (limit < 1 || limit > 30)) {
    throw new ValidationError('Limit must be between 1 and 30');
  }

  const parsed: CommandSearchQuery = { q };
  const scope = stringOrUndefined(query.scope);
  if (
    scope === 'all' ||
    scope === 'cards' ||
    scope === 'decks' ||
    scope === 'library' ||
    scope === 'actions' ||
    scope === 'docs'
  ) {
    parsed.scope = scope;
  }
  const currentRoute = stringOrUndefined(query.currentRoute);
  const classId = stringOrUndefined(query.classId);
  const folderId = stringOrUndefined(query.folderId);
  const deckId = stringOrUndefined(query.deckId);

  if (currentRoute !== undefined) parsed.currentRoute = currentRoute;
  if (classId !== undefined) parsed.classId = classId;
  if (folderId !== undefined) parsed.folderId = folderId;
  if (deckId !== undefined) parsed.deckId = deckId;
  if (limit !== undefined) parsed.limit = limit;

  return parsed;
}

function parseOptionalNumber(value: unknown, name: string) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new ValidationError(`${name} must be an integer`);
  }
  return parsed;
}

function stringOrUndefined(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  return text.length > 0 ? text : undefined;
}
