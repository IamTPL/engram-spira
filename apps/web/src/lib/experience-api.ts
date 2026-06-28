import { api as defaultClient, getApiError } from '@/api/client';
import type {
  AggregateResponse,
  CommandCenterResponse,
  CommandCenterSections,
  CommandSearchQuery,
  CommandSearchResponse,
  CreateCommitRequest,
  CreateCommitResponse,
  CreatePreviewRequest,
  CreatePreviewResponse,
  DeckWorkspaceQuery,
  DeckWorkspaceResponse,
  DeckWorkspaceSections,
  InsightsOverviewResponse,
  InsightsOverviewSections,
  LibraryExplorerResponse,
  LibraryExplorerSections,
  StudyQueueQuery,
  StudyQueueResponse,
} from '../../../api/src/modules/experience/experience.types';

export type CommandCenterAggregate = AggregateResponse<
  CommandCenterResponse,
  CommandCenterSections
>;
export type LibraryExplorerAggregate = AggregateResponse<
  LibraryExplorerResponse,
  LibraryExplorerSections
>;
export type DeckWorkspaceAggregate = AggregateResponse<
  DeckWorkspaceResponse,
  DeckWorkspaceSections
>;
export type InsightsOverviewAggregate = AggregateResponse<
  InsightsOverviewResponse,
  InsightsOverviewSections
>;

type EdenResponse<T> = {
  data?: T | null;
  error?: unknown;
};

export type ExperienceApiClient = any;

export const experienceQueryKeys = {
  commandCenter: () => ['command-center'] as const,
  libraryExplorer: () => ['library-explorer'] as const,
  commandSearch: (query?: CommandSearchQuery) =>
    ['command-search', query ?? null] as const,
  studyQueue: (query: StudyQueueQuery) => ['study-queue', query] as const,
  deckWorkspace: (deckId: string, query?: DeckWorkspaceQuery) =>
    ['deck-workspace', deckId, query ?? null] as const,
  insightsOverview: () => ['insights-overview'] as const,
};

function unwrap<T>(response: EdenResponse<T>): T {
  if (response.error) throw new Error(getApiError(response.error));
  if (response.data === null || response.data === undefined) {
    throw new Error('Empty response');
  }
  return response.data;
}

export function createExperienceApi(
  client: ExperienceApiClient = defaultClient as ExperienceApiClient,
) {
  return {
    async getCommandCenter() {
      return unwrap<CommandCenterAggregate>(
        await client.dashboard['command-center'].get(),
      );
    },

    async getLibraryExplorer() {
      return unwrap<LibraryExplorerAggregate>(
        await client.library.explorer.get(),
      );
    },

    async getStudyQueue(query: StudyQueueQuery) {
      return unwrap<StudyQueueResponse>(
        await client.study.queue.get({ query }),
      );
    },

    async searchCommands(query: CommandSearchQuery) {
      return unwrap<CommandSearchResponse>(
        await client.command.search.get({ query }),
      );
    },

    async getDeckWorkspace(deckId: string, query: DeckWorkspaceQuery = {}) {
      return unwrap<DeckWorkspaceAggregate>(
        await client.decks[deckId].workspace.get({ query }),
      );
    },

    async createPreview(request: CreatePreviewRequest) {
      return unwrap<CreatePreviewResponse>(
        await client.create.preview.post(request),
      );
    },

    async createCommit(request: CreateCommitRequest) {
      return unwrap<CreateCommitResponse>(
        await client.create.commit.post(request),
      );
    },

    async getInsightsOverview() {
      return unwrap<InsightsOverviewAggregate>(
        await client.insights.overview.get(),
      );
    },
  };
}

export const experienceApi = createExperienceApi();

export const getCommandCenter = experienceApi.getCommandCenter;
export const getLibraryExplorer = experienceApi.getLibraryExplorer;
export const getStudyQueue = experienceApi.getStudyQueue;
export const searchCommands = experienceApi.searchCommands;
export const getDeckWorkspace = experienceApi.getDeckWorkspace;
export const createPreview = experienceApi.createPreview;
export const createCommit = experienceApi.createCommit;
export const getInsightsOverview = experienceApi.getInsightsOverview;
