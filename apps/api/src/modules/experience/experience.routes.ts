import Elysia from 'elysia';
import { requireAuth } from '../auth/auth.middleware';
import { getCommandCenter } from './command-center.service';
import { getDeckWorkspace } from './deck-workspace.service';
import { getInsightsOverview } from './insights-overview.service';
import { getLibraryExplorer } from './library-explorer.service';
import { getStudyQueue } from './study-queue.service';
import type { DeckWorkspaceQuery, StudyQueueQuery } from './experience.types';

export type ExperienceRouteServices = {
  getCommandCenter: typeof getCommandCenter;
  getStudyQueue: typeof getStudyQueue;
  getLibraryExplorer: typeof getLibraryExplorer;
  getDeckWorkspace: typeof getDeckWorkspace;
  getInsightsOverview: typeof getInsightsOverview;
};

const defaultExperienceRouteServices: ExperienceRouteServices = {
  getCommandCenter,
  getStudyQueue,
  getLibraryExplorer,
  getDeckWorkspace,
  getInsightsOverview,
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
    );
}

export const experienceRoutes = createExperienceRoutes();

function parseStudyQueueQuery(query: Record<string, unknown>): StudyQueueQuery {
  const mode = String(query.mode ?? 'due') as StudyQueueQuery['mode'];
  const limit = parseOptionalNumber(query.limit);
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
  const cardPage = parseOptionalNumber(query.cardPage);
  const cardPageSize = parseOptionalNumber(query.cardPageSize);
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

function parseOptionalNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringOrUndefined(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  return text.length > 0 ? text : undefined;
}
