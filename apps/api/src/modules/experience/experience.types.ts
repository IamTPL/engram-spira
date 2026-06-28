export type SectionStatus = 'ok' | 'empty' | 'error';

export type AggregateSectionMeta =
  | { status: 'ok' }
  | { status: 'empty' }
  | { status: 'error'; message: string; retryable: boolean };

export type AggregateSectionMap<TKey extends string = string> = {
  [K in TKey]: AggregateSectionMeta;
};

export type AggregateResponse<
  TData,
  TSections extends AggregateSectionMap = AggregateSectionMap,
> = {
  data: TData;
  meta: {
    generatedAt: string;
    sections: TSections;
  };
};

export type CommandCenterSectionKey =
  | 'reviewQueue'
  | 'streak'
  | 'dueDecks'
  | 'recent'
  | 'weakAreas'
  | 'forecast'
  | 'pendingSuggestions'
  | 'notifications';

export type CommandCenterSections =
  AggregateSectionMap<CommandCenterSectionKey>;

export type LibraryExplorerSectionKey = 'classes' | 'recentDecks';

export type LibraryExplorerSections =
  AggregateSectionMap<LibraryExplorerSectionKey>;

export type DeckWorkspaceSectionKey =
  | 'deck'
  | 'cards'
  | 'study'
  | 'analytics'
  | 'counters';

export type DeckWorkspaceSections = AggregateSectionMap<DeckWorkspaceSectionKey>;

export type InsightsOverviewSectionKey =
  | 'forecast'
  | 'weakAreas'
  | 'atRiskCards'
  | 'heatmap'
  | 'trends';

export type InsightsOverviewSections =
  AggregateSectionMap<InsightsOverviewSectionKey>;

export type CommandActionRef = {
  id: string;
  label: string;
  params?: Record<string, string | number | boolean | null>;
};

export type CommandResult = {
  id: string;
  type: 'action' | 'card' | 'deck' | 'folder' | 'class' | 'doc' | 'setting';
  title: string;
  subtitle: string | null;
  href: string | null;
  action: CommandActionRef | null;
  icon: string | null;
  keywords: string[];
  disabledReason: string | null;
};

export type CommandCenterResponse = {
  reviewQueue: {
    dueCount: number;
    newCount: number;
    learningCount: number;
    atRiskCount: number;
    nextAction: CommandActionRef | null;
  };
  streak: { current: number; longest: number } | null;
  dueDecks: Array<{
    id: string;
    name: string;
    folderId: string | null;
    dueCount: number;
    newCount: number;
    lastStudiedAt: string | null;
  }>;
  recent: {
    decks: Array<{ id: string; name: string; updatedAt: string | null }>;
    cards: Array<{
      id: string;
      deckId: string;
      title: string;
      updatedAt: string | null;
    }>;
  };
  weakAreas: Array<{
    id: string;
    label: string;
    cardCount: number;
    avgRetention: number | null;
    action: CommandActionRef;
  }>;
  forecast: {
    days: Array<{
      date: string;
      atRiskCount: number;
      avgRetention: number | null;
    }>;
  } | null;
  pendingSuggestions: {
    duplicates: number;
    aiSuggestions: number;
  } | null;
  notifications: Array<{
    id: string;
    title: string;
    body: string | null;
    createdAt: string;
    href: string | null;
  }>;
};

type StudyQueueBaseQuery = {
  limit?: number;
};

type StudyQueueScopeExclusions = {
  deckId?: never;
  folderId?: never;
  classId?: never;
  smartGroupId?: never;
};

export type StudyQueueQuery =
  | (StudyQueueBaseQuery &
      StudyQueueScopeExclusions & { mode: 'due' | 'interleaved' })
  | (StudyQueueBaseQuery &
      Omit<StudyQueueScopeExclusions, 'deckId'> & {
        mode: 'deck';
        deckId: string;
      })
  | (StudyQueueBaseQuery &
      Omit<StudyQueueScopeExclusions, 'folderId'> & {
        mode: 'folder';
        folderId: string;
      })
  | (StudyQueueBaseQuery &
      Omit<StudyQueueScopeExclusions, 'classId'> & {
        mode: 'class';
        classId: string;
      })
  | (StudyQueueBaseQuery &
      Omit<StudyQueueScopeExclusions, 'smartGroupId'> & {
        mode: 'smart-group';
        smartGroupId: string;
      })
  | (StudyQueueBaseQuery &
      Omit<StudyQueueScopeExclusions, 'deckId'> & {
        mode: 'at-risk';
        deckId?: string;
      });

export type StudyQueueResponse = {
  mode: StudyQueueQuery['mode'];
  title: string;
  cards: Array<{
    id: string;
    deckId: string;
    front: string;
    back: string;
    templateName: string | null;
    reason: 'due' | 'new' | 'learning' | 'at-risk' | 'manual' | 'interleaved';
    dueAt: string | null;
    retentionEstimate: number | null;
  }>;
  summary: {
    total: number;
    due: number;
    new: number;
    learning: number;
    atRisk: number;
  };
};

export type CommandSearchQuery = {
  q: string;
  scope?: 'all' | 'cards' | 'decks' | 'library' | 'actions' | 'docs';
  currentRoute?: string;
  limit?: number;
};

export type CommandSearchResponse = {
  groups: Array<{
    id: 'actions' | 'cards' | 'decks' | 'folders' | 'classes' | 'docs' | 'settings';
    label: string;
    results: CommandResult[];
  }>;
};

export type LibraryExplorerResponse = {
  classes: Array<{
    id: string;
    name: string;
    description: string | null;
    folderCount: number;
    deckCount: number;
    cardCount: number;
    dueCount: number;
    folders: Array<{
      id: string;
      name: string;
      deckCount: number;
      cardCount: number;
      dueCount: number;
      decks: Array<{
        id: string;
        name: string;
        cardCount: number;
        dueCount: number;
        updatedAt: string | null;
      }>;
    }>;
  }>;
  recentDeckIds: string[];
};

export type DeckWorkspaceQuery = {
  cardPage?: number;
  cardPageSize?: number;
  cardSearch?: string;
  sort?: 'createdAt' | 'updatedAt' | 'dueAt' | 'template';
};

export type DeckWorkspaceResponse = {
  deck: {
    id: string;
    name: string;
    folderId: string;
    cardTemplateId: string;
    cardCount: number;
  };
  cards: {
    items: Array<{
      id: string;
      title: string;
      preview: string;
      updatedAt: string | null;
    }>;
    page: number;
    pageSize: number;
    total: number;
  };
  study: {
    dueCount: number;
    newCount: number;
    learningCount: number;
    lastStudiedAt: string | null;
  } | null;
  analytics: {
    avgRetention: number | null;
    atRiskCount: number;
  } | null;
  counters: {
    graphLinks: number;
    duplicates: number;
    aiSuggestions: number;
  } | null;
};

export type ManualCreatePayload = {
  fields: Record<string, string>;
};

export type AiPasteCreatePayload = {
  text: string;
  mode: 'vocabulary' | 'qa';
  requestedCount?: number;
};

export type CsvCreatePayload = {
  filename: string;
  content: string;
  delimiter?: ',' | ';' | '\t';
  hasHeader: boolean;
  fieldMapping: Record<string, string>;
};

export type JsonCreatePayload = {
  filename: string;
  content: string;
  fieldMapping?: Record<string, string>;
};

export type CreatePreviewRequest =
  | {
      source: 'manual';
      targetDeckId: string;
      templateId: string;
      payload: ManualCreatePayload;
    }
  | {
      source: 'ai-paste';
      targetDeckId: string;
      templateId: string;
      payload: AiPasteCreatePayload;
    }
  | {
      source: 'csv';
      targetDeckId: string;
      templateId: string;
      payload: CsvCreatePayload;
    }
  | {
      source: 'json';
      targetDeckId: string;
      templateId: string;
      payload: JsonCreatePayload;
    };

export type CreatePreviewRecord = {
  previewId: string;
  userId: string;
  targetDeckId: string;
  templateId: string;
  source: CreatePreviewRequest['source'];
  requestFingerprint: string;
  cards: Array<{
    clientId: string;
    fields: Record<string, string>;
    validationErrors: string[];
    duplicateCandidates: Array<{
      cardId: string;
      similarity: number;
      title: string;
    }>;
    defaultResolution: 'create' | 'skip' | 'merge';
  }>;
  expiresAt: string;
};

export type CreatePreviewResponse = {
  previewId: string;
  expiresAt: string;
  cards: Array<{
    clientId: string;
    fields: Record<string, string>;
    validationErrors: string[];
    duplicateCandidates: Array<{
      cardId: string;
      similarity: number;
      title: string;
    }>;
    resolution: 'create' | 'skip' | 'merge';
  }>;
  summary: {
    total: number;
    valid: number;
    invalid: number;
    possibleDuplicates: number;
  };
};

export type CreateCommitCard =
  | {
      clientId: string;
      resolution: 'create';
      fields?: Record<string, string>;
      mergeTargetCardId?: never;
    }
  | {
      clientId: string;
      resolution: 'skip';
      fields?: never;
      mergeTargetCardId?: never;
    }
  | {
      clientId: string;
      resolution: 'merge';
      mergeTargetCardId: string;
      fields?: Record<string, string>;
    };

export type CreateCommitRequest = {
  previewId: string;
  idempotencyKey: string;
  cards: CreateCommitCard[];
};

export type CreateCommitResponse = {
  createdCardIds: string[];
  skippedClientIds: string[];
  mergedCardIds: string[];
};

export type InsightsOverviewResponse = {
  forecast: CommandCenterResponse['forecast'];
  weakAreas: CommandCenterResponse['weakAreas'];
  atRiskCards: Array<{
    id: string;
    deckId: string;
    title: string;
    retentionEstimate: number | null;
  }>;
  heatmap: Array<{ date: string; count: number }> | null;
  trends: {
    reviewedThisWeek: number;
    retentionDelta: number | null;
  } | null;
};
