import { sql } from 'drizzle-orm';

import { db } from '../../db';
import { ValidationError } from '../../shared/errors';
import type {
  CommandActionRef,
  CommandResult,
  CommandSearchQuery,
  CommandSearchResponse,
} from './experience.types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 30;
const GROUP_LIMIT = 8;

type SearchableAction = CommandActionRef & {
  keywords?: string[];
  routePatterns?: string[];
  disabledReason?: string | null;
};

type SearchableCard = {
  id: string;
  deckId: string;
  deckName: string;
  folderId: string;
  classId: string;
  title: string;
  preview: string | null;
  updatedAt: string | null;
};

type SearchableDeck = {
  id: string;
  name: string;
  folderId: string;
  classId: string;
  updatedAt: string | null;
};

type SearchableFolder = {
  id: string;
  name: string;
  classId: string;
};

type SearchableClass = {
  id: string;
  name: string;
};

type SearchableStaticItem = {
  id: string;
  title: string;
  subtitle: string | null;
  href: string | null;
  keywords?: string[];
};

export type CommandSearchLoaders = {
  loadActions: (userId: string) => Promise<SearchableAction[]>;
  loadCards: (userId: string, q: string) => Promise<SearchableCard[]>;
  loadDecks: (userId: string, q: string) => Promise<SearchableDeck[]>;
  loadFolders: (userId: string, q: string) => Promise<SearchableFolder[]>;
  loadClasses: (userId: string, q: string) => Promise<SearchableClass[]>;
  loadDocs: (userId: string) => Promise<SearchableStaticItem[]>;
  loadSettings: (userId: string) => Promise<SearchableStaticItem[]>;
};

type RankedResult = CommandResult & {
  score: number;
  routeScore: number;
  recency: number;
};

const groupLabels: Record<CommandSearchResponse['groups'][number]['id'], string> = {
  actions: 'Actions',
  cards: 'Cards',
  decks: 'Decks',
  folders: 'Folders',
  classes: 'Classes',
  docs: 'Docs',
  settings: 'Settings',
};

export async function searchCommands(
  userId: string,
  query: CommandSearchQuery,
  loaders: CommandSearchLoaders = defaultCommandSearchLoaders,
): Promise<CommandSearchResponse> {
  const q = query.q.trim();
  if (!q) throw new ValidationError('Query is required');

  const limit = query.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ValidationError('Limit must be between 1 and 30');
  }

  const includeActions = includeScope(query.scope, 'actions');
  const includeCards = includeScope(query.scope, 'cards');
  const includeDecks = includeScope(query.scope, 'decks');
  const includeLibrary = includeScope(query.scope, 'library');
  const includeDocs = includeScope(query.scope, 'docs');
  const includeSettings = query.scope === undefined || query.scope === 'all';

  const [actions, cards, decks, folders, classes, docs, settings] =
    await Promise.all([
      loaders.loadActions(userId),
      loaders.loadCards(userId, q),
      loaders.loadDecks(userId, q),
      loaders.loadFolders(userId, q),
      loaders.loadClasses(userId, q),
      loaders.loadDocs(userId),
      loaders.loadSettings(userId),
    ]);

  const groups: Record<CommandSearchResponse['groups'][number]['id'], RankedResult[]> = {
    actions: includeActions ? rankActions(actions, q, query.currentRoute) : [],
    cards: includeCards
      ? rankCards(cards.filter((card) => matchesEntityScope(card, query)), q)
      : [],
    decks: includeDecks
      ? rankDecks(decks.filter((deck) => matchesEntityScope(deck, query)), q)
      : [],
    folders: includeLibrary ? rankFolders(folders, q) : [],
    classes: includeLibrary ? rankClasses(classes, q) : [],
    docs: includeDocs ? rankStatic(docs, q, 'doc') : [],
    settings: includeSettings ? rankStatic(settings, q, 'setting') : [],
  };

  let remaining = limit;
  return {
    groups: (Object.keys(groupLabels) as Array<keyof typeof groupLabels>).map(
      (id) => {
        const results = sortRanked(groups[id])
          .slice(0, Math.min(GROUP_LIMIT, remaining))
          .map(stripRank);
        remaining = Math.max(0, remaining - results.length);
        return { id, label: groupLabels[id], results };
      },
    ),
  };
}

export const defaultCommandSearchLoaders: CommandSearchLoaders = {
  loadActions: async () => defaultActions,
  loadCards: async (userId, q) => {
    const pattern = likePattern(q);
    return db.execute<SearchableCard>(sql`
      SELECT
        c.id,
        c.deck_id AS "deckId",
        d.name AS "deckName",
        d.folder_id AS "folderId",
        f.class_id AS "classId",
        COALESCE(
          MIN(cfv.value #>> '{}') FILTER (WHERE tf.side = 'front'),
          MIN(cfv.value #>> '{}'),
          ''
        ) AS title,
        COALESCE(MIN(cfv.value #>> '{}'), '') AS preview,
        c.created_at::text AS "updatedAt"
      FROM cards c
      JOIN decks d ON d.id = c.deck_id
      JOIN folders f ON f.id = d.folder_id
      LEFT JOIN card_field_values cfv ON cfv.card_id = c.id
      LEFT JOIN template_fields tf ON tf.id = cfv.template_field_id
      WHERE d.user_id = ${userId}
        AND (
          d.name ILIKE ${pattern}
          OR EXISTS (
            SELECT 1
            FROM card_field_values match_cfv
            WHERE match_cfv.card_id = c.id
              AND match_cfv.value #>> '{}' ILIKE ${pattern}
          )
        )
      GROUP BY c.id, c.deck_id, d.name, d.folder_id, f.class_id, c.created_at
      ORDER BY c.created_at DESC, c.id
    `);
  },
  loadDecks: async (userId, q) => {
    const pattern = likePattern(q);
    return db.execute<SearchableDeck>(sql`
      SELECT
        d.id,
        d.name,
        d.folder_id AS "folderId",
        f.class_id AS "classId",
        d.created_at::text AS "updatedAt"
      FROM decks d
      JOIN folders f ON f.id = d.folder_id
      WHERE d.user_id = ${userId}
        AND d.name ILIKE ${pattern}
      ORDER BY d.created_at DESC, d.id
    `);
  },
  loadFolders: async (userId, q) => {
    const pattern = likePattern(q);
    return db.execute<SearchableFolder>(sql`
      SELECT f.id, f.name, f.class_id AS "classId"
      FROM folders f
      JOIN classes c ON c.id = f.class_id
      WHERE c.user_id = ${userId}
        AND f.name ILIKE ${pattern}
      ORDER BY f.sort_order, f.name, f.id
    `);
  },
  loadClasses: async (userId, q) => {
    const pattern = likePattern(q);
    return db.execute<SearchableClass>(sql`
      SELECT id, name
      FROM classes
      WHERE user_id = ${userId}
        AND name ILIKE ${pattern}
      ORDER BY sort_order, name, id
    `);
  },
  loadDocs: async () => defaultDocs,
  loadSettings: async () => defaultSettings,
};

const defaultActions: SearchableAction[] = [
  {
    id: 'create-card',
    label: 'Create card',
    keywords: ['new', 'add', 'flashcard'],
    routePatterns: ['/deck/:id', '/study/:id'],
  },
  {
    id: 'create-deck',
    label: 'Create deck',
    keywords: ['new', 'library'],
  },
  {
    id: 'create-folder',
    label: 'Create folder',
    keywords: ['new', 'library', 'class', 'organize'],
  },
  {
    id: 'start-study',
    label: 'Start study',
    keywords: ['review', 'queue'],
    routePatterns: ['/deck/:id'],
  },
  {
    id: 'import-cards',
    label: 'Import cards',
    keywords: ['csv', 'json', 'paste'],
  },
];

const defaultDocs: SearchableStaticItem[] = [
  {
    id: 'docs-create-cards',
    title: 'Create cards',
    subtitle: 'Documentation',
    href: '/docs',
    keywords: ['manual', 'csv', 'json', 'ai paste'],
  },
  {
    id: 'docs-study',
    title: 'Study queue',
    subtitle: 'Documentation',
    href: '/docs',
    keywords: ['review', 'due', 'retention'],
  },
];

const defaultSettings: SearchableStaticItem[] = [
  {
    id: 'settings-profile',
    title: 'Profile settings',
    subtitle: 'Settings',
    href: '/settings',
    keywords: ['account', 'user'],
  },
  {
    id: 'settings-ai',
    title: 'AI settings',
    subtitle: 'Settings',
    href: '/settings',
    keywords: ['generation', 'paste'],
  },
];

function includeScope(
  scope: CommandSearchQuery['scope'],
  group: 'actions' | 'cards' | 'decks' | 'library' | 'docs',
) {
  if (scope === undefined || scope === 'all') return true;
  if (scope === 'library') return group === 'library' || group === 'decks';
  return scope === group;
}

function rankActions(
  actions: SearchableAction[],
  q: string,
  currentRoute: string | undefined,
): RankedResult[] {
  return actions
    .map((action) => {
      const score = bestScore(q, action.label, action.keywords);
      if (score === 0) return null;
      const routeScore = routeMatches(action.routePatterns, currentRoute) ? 1 : 0;
      return {
        id: action.id,
        type: 'action' as const,
        title: action.label,
        subtitle: null,
        href: null,
        action: {
          id: action.id,
          label: action.label,
          params: action.params,
        },
        icon: null,
        keywords: action.keywords ?? [],
        disabledReason: action.disabledReason ?? null,
        score,
        routeScore,
        recency: 0,
      };
    })
    .filter(Boolean) as RankedResult[];
}

function rankCards(cards: SearchableCard[], q: string): RankedResult[] {
  return cards
    .map((card) => {
      const score = bestScore(q, card.title, [card.deckName, card.preview ?? '']);
      if (score === 0) return null;
      return {
        id: card.id,
        type: 'card' as const,
        title: card.title,
        subtitle: card.deckName,
        href: `/deck/${card.deckId}?cardId=${card.id}`,
        action: null,
        icon: null,
        keywords: [card.deckName],
        disabledReason: null,
        score,
        routeScore: 0,
        recency: toTime(card.updatedAt),
      };
    })
    .filter(Boolean) as RankedResult[];
}

function rankDecks(decks: SearchableDeck[], q: string): RankedResult[] {
  return decks
    .map((deck) => {
      const score = bestScore(q, deck.name);
      if (score === 0) return null;
      return {
        id: deck.id,
        type: 'deck' as const,
        title: deck.name,
        subtitle: null,
        href: `/deck/${deck.id}`,
        action: null,
        icon: null,
        keywords: [],
        disabledReason: null,
        score,
        routeScore: 0,
        recency: toTime(deck.updatedAt),
      };
    })
    .filter(Boolean) as RankedResult[];
}

function rankFolders(folders: SearchableFolder[], q: string): RankedResult[] {
  return folders
    .map((folder) => {
      const score = bestScore(q, folder.name);
      if (score === 0) return null;
      return {
        id: folder.id,
        type: 'folder' as const,
        title: folder.name,
        subtitle: null,
        href: `/folder/${folder.id}`,
        action: null,
        icon: null,
        keywords: [],
        disabledReason: null,
        score,
        routeScore: 0,
        recency: 0,
      };
    })
    .filter(Boolean) as RankedResult[];
}

function rankClasses(classes: SearchableClass[], q: string): RankedResult[] {
  return classes
    .map((klass) => {
      const score = bestScore(q, klass.name);
      if (score === 0) return null;
      return {
        id: klass.id,
        type: 'class' as const,
        title: klass.name,
        subtitle: null,
        href: null,
        action: null,
        icon: null,
        keywords: [],
        disabledReason: null,
        score,
        routeScore: 0,
        recency: 0,
      };
    })
    .filter(Boolean) as RankedResult[];
}

function rankStatic(
  items: SearchableStaticItem[],
  q: string,
  type: 'doc' | 'setting',
): RankedResult[] {
  return items
    .map((item) => {
      const score = bestScore(q, item.title, item.keywords);
      if (score === 0) return null;
      return {
        id: item.id,
        type,
        title: item.title,
        subtitle: item.subtitle,
        href: item.href,
        action: null,
        icon: null,
        keywords: item.keywords ?? [],
        disabledReason: null,
        score,
        routeScore: 0,
        recency: 0,
      };
    })
    .filter(Boolean) as RankedResult[];
}

function bestScore(q: string, title: string, keywords: string[] = []) {
  return Math.max(matchScore(q, title), ...keywords.map((k) => matchScore(q, k)));
}

function matchScore(q: string, value: string | null | undefined) {
  const query = normalize(q);
  const target = normalize(value ?? '');
  if (!query || !target) return 0;
  if (target === query) return 1000;
  if (target.startsWith(query)) return 850;
  if (target.includes(query)) return 700;
  return isSubsequence(query, target) ? 500 - (target.length - query.length) : 0;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isSubsequence(query: string, target: string) {
  let index = 0;
  for (const char of target) {
    if (char === query[index]) index += 1;
    if (index === query.length) return true;
  }
  return false;
}

function routeMatches(patterns: string[] | undefined, currentRoute: string | undefined) {
  if (!patterns || !currentRoute) return false;
  return patterns.some((pattern) => {
    const regex = new RegExp(
      `^${pattern.replace(/:[^/]+/g, '[^/]+').replace(/\//g, '\\/')}$`,
    );
    return regex.test(currentRoute);
  });
}

function matchesEntityScope(
  entity: { deckId?: string; folderId?: string; classId?: string; id?: string },
  query: CommandSearchQuery,
) {
  if (query.deckId) return entity.deckId === query.deckId || entity.id === query.deckId;
  if (query.folderId) return entity.folderId === query.folderId;
  if (query.classId) return entity.classId === query.classId;
  return true;
}

function sortRanked(results: RankedResult[]) {
  return [...results].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.routeScore !== a.routeScore) return b.routeScore - a.routeScore;
    if (b.recency !== a.recency) return b.recency - a.recency;
    const titleOrder = a.title.localeCompare(b.title);
    if (titleOrder !== 0) return titleOrder;
    return a.id.localeCompare(b.id);
  });
}

function stripRank(result: RankedResult): CommandResult {
  const { score: _score, routeScore: _routeScore, recency: _recency, ...rest } =
    result;
  return rest;
}

function toTime(value: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function likePattern(value: string) {
  return `%${value.replace(/[%_]/g, '\\$&')}%`;
}
