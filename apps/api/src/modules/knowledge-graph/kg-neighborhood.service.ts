import { NotFoundError, ValidationError } from '../../shared/errors';
import { createPostgresCardNeighborhoodRepository } from './kg-neighborhood.repository';
import {
  RELATION_TYPES,
  type ConfidenceBand,
  type RelationType,
} from './kg-verifier';

export const RELATION_GROUPS = [
  'hierarchy',
  'meaning',
  'form',
  'usage',
] as const;

export type RelationGroup = (typeof RELATION_GROUPS)[number];

export const RELATION_TYPES_BY_GROUP: Record<
  RelationGroup,
  readonly RelationType[]
> = {
  hierarchy: ['is_a', 'part_of'],
  meaning: ['synonym', 'antonym', 'translation_of', 'coordinate'],
  form: ['derived_from'],
  usage: ['collocation', 'confused_with'],
};

const RELATION_GROUP_BY_TYPE = new Map<RelationType, RelationGroup>(
  RELATION_GROUPS.flatMap((group) =>
    RELATION_TYPES_BY_GROUP[group].map((relationType) => [
      relationType,
      group,
    ]),
  ),
);

const DIRECTED_RELATION_TYPES = new Set<RelationType>([
  'is_a',
  'part_of',
  'derived_from',
]);

const DEFAULT_NODE_LIMIT = 24;
const MAX_NODE_LIMIT = 24;
const MAX_EDGE_LIMIT = 40;
const CURSOR_VERSION = 1;

export interface KnowledgeGraphNode {
  id: string;
  lexemeId: string;
  label: string;
  languageTag: string;
  partOfSpeech: string;
  definition: string;
  mappedCardIds: string[];
  inCurrentDeck: boolean;
  retention: number | null;
  dueAt: string | null;
}

export interface KnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  group: RelationGroup;
  directed: boolean;
  origin: 'manual' | 'ai';
  confidenceBand: ConfidenceBand | null;
  evidence: string | null;
}

export interface NeighborhoodSummary {
  deckCards: number;
  connectedCards: number;
  isolatedCards: number;
  groupCounts: Record<RelationGroup, number>;
}

export interface NeighborhoodResponse {
  focus: KnowledgeGraphNode;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  summary: NeighborhoodSummary;
  pageInfo: {
    nextCursor: string | null;
    truncated: boolean;
  };
}

export type NeighborhoodNodeRecord = Omit<KnowledgeGraphNode, 'dueAt'> & {
  normalizedLemma: string;
  dueAt: Date | string | null;
};

export type NeighborhoodFocusRecord = {
  cardId: string;
  deckId: string;
  focus: NeighborhoodNodeRecord | null;
};

export type NeighborhoodCursorPosition = {
  normalizedLemma: string;
  senseId: string;
};

export type NeighborhoodPageInput = {
  userId: string;
  deckId: string;
  focusCardId: string;
  focusSenseId: string;
  groups: RelationGroup[];
  relationTypes: RelationType[];
  nodeLimit: number;
  edgeLimit: number;
  after: NeighborhoodCursorPosition | null;
};

export type NeighborhoodPageRecord = {
  nodes: NeighborhoodNodeRecord[];
  edges: KnowledgeGraphEdge[];
  hasMore: boolean;
};

export type CardSenseMapping = {
  cardId: string;
  senseId: string;
  source: 'deterministic' | 'manual' | 'ai';
  isPrimary: boolean;
  created: boolean;
};

export type MapCardSenseResult =
  | { outcome: 'card_not_found' }
  | { outcome: 'sense_not_found' }
  | { outcome: 'mapped'; mapping: CardSenseMapping };

export interface CardNeighborhoodRepository {
  loadFocus(
    userId: string,
    cardId: string,
  ): Promise<NeighborhoodFocusRecord | null>;
  loadPage(input: NeighborhoodPageInput): Promise<NeighborhoodPageRecord>;
  loadSummary(input: {
    userId: string;
    deckId: string;
    focusSenseId: string;
  }): Promise<NeighborhoodSummary>;
  mapCardSense(
    userId: string,
    cardId: string,
    senseId: string,
  ): Promise<MapCardSenseResult>;
}

export type NeighborhoodQuery = {
  groups?: RelationGroup[];
  limit?: number;
  cursor?: string | null;
};

type NeighborhoodCursor = {
  v: number;
  cardId: string;
  focusSenseId: string;
  groups: RelationGroup[];
  after: NeighborhoodCursorPosition;
};

function canonicalGroups(
  requested: NeighborhoodQuery['groups'],
): RelationGroup[] {
  if (requested === undefined || requested.length === 0) {
    return [...RELATION_GROUPS];
  }

  const requestedSet = new Set<string>(requested);
  if (
    requestedSet.size === 0 ||
    [...requestedSet].some(
      (group) => !RELATION_GROUPS.includes(group as RelationGroup),
    )
  ) {
    throw new ValidationError('Invalid relationship group');
  }

  return RELATION_GROUPS.filter((group) => requestedSet.has(group));
}

function relationTypesForGroups(groups: RelationGroup[]): RelationType[] {
  const selected = new Set(
    groups.flatMap((group) => RELATION_TYPES_BY_GROUP[group]),
  );
  return RELATION_TYPES.filter((relationType) => selected.has(relationType));
}

function validateLimit(limit: number | undefined): number {
  const resolved = limit ?? DEFAULT_NODE_LIMIT;
  if (
    !Number.isInteger(resolved) ||
    resolved < 1 ||
    resolved > MAX_NODE_LIMIT
  ) {
    throw new ValidationError(
      `Limit must be between 1 and ${MAX_NODE_LIMIT}`,
    );
  }
  return resolved;
}

function encodeCursor(cursor: NeighborhoodCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function invalidCursor(): never {
  throw new ValidationError('Invalid neighborhood cursor');
}

function decodeCursor(
  encoded: string,
  cardId: string,
  focusSenseId: string,
  groups: RelationGroup[],
): NeighborhoodCursorPosition {
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as Partial<NeighborhoodCursor>;
    const exactKeys =
      parsed !== null && typeof parsed === 'object'
        ? Object.keys(parsed).sort()
        : [];
    if (
      exactKeys.join(',') !==
        ['after', 'cardId', 'focusSenseId', 'groups', 'v'].join(',') ||
      parsed.v !== CURSOR_VERSION ||
      parsed.cardId !== cardId ||
      parsed.focusSenseId !== focusSenseId ||
      !Array.isArray(parsed.groups) ||
      parsed.groups.join(',') !== groups.join(',') ||
      parsed.after === null ||
      typeof parsed.after !== 'object' ||
      Object.keys(parsed.after).sort().join(',') !==
        ['normalizedLemma', 'senseId'].join(',') ||
      typeof parsed.after.normalizedLemma !== 'string' ||
      typeof parsed.after.senseId !== 'string' ||
      parsed.after.normalizedLemma.length === 0 ||
      parsed.after.senseId.length === 0
    ) {
      return invalidCursor();
    }
    return {
      normalizedLemma: parsed.after.normalizedLemma,
      senseId: parsed.after.senseId,
    };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    return invalidCursor();
  }
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ValidationError('Invalid knowledge graph due date');
  }
  return date.toISOString();
}

function toNode(record: NeighborhoodNodeRecord): KnowledgeGraphNode {
  return {
    id: record.id,
    lexemeId: record.lexemeId,
    label: record.label,
    languageTag: record.languageTag,
    partOfSpeech: record.partOfSpeech,
    definition: record.definition,
    mappedCardIds: [...new Set(record.mappedCardIds)],
    inCurrentDeck: record.inCurrentDeck,
    retention: record.retention,
    dueAt: toIso(record.dueAt),
  };
}

function compareNode(
  left: NeighborhoodNodeRecord,
  right: NeighborhoodNodeRecord,
): number {
  const lemmaOrder =
    left.normalizedLemma < right.normalizedLemma
      ? -1
      : left.normalizedLemma > right.normalizedLemma
        ? 1
        : 0;
  return lemmaOrder || left.id.localeCompare(right.id);
}

function compareEdge(
  left: KnowledgeGraphEdge,
  right: KnowledgeGraphEdge,
): number {
  return left.id.localeCompare(right.id);
}

function normalizeSummary(summary: NeighborhoodSummary): NeighborhoodSummary {
  const deckCards = Math.max(0, Math.floor(summary.deckCards));
  const connectedCards = Math.min(
    deckCards,
    Math.max(0, Math.floor(summary.connectedCards)),
  );
  return {
    deckCards,
    connectedCards,
    isolatedCards: deckCards - connectedCards,
    groupCounts: {
      hierarchy: Math.max(0, Math.floor(summary.groupCounts.hierarchy)),
      meaning: Math.max(0, Math.floor(summary.groupCounts.meaning)),
      form: Math.max(0, Math.floor(summary.groupCounts.form)),
      usage: Math.max(0, Math.floor(summary.groupCounts.usage)),
    },
  };
}

export function relationGroupForType(
  relationType: RelationType,
): RelationGroup {
  const group = RELATION_GROUP_BY_TYPE.get(relationType);
  if (!group) throw new ValidationError('Invalid relationship type');
  return group;
}

export function isDirectedRelation(relationType: RelationType): boolean {
  return DIRECTED_RELATION_TYPES.has(relationType);
}

export async function getCardNeighborhood(
  userId: string,
  cardId: string,
  query: NeighborhoodQuery = {},
  repository: CardNeighborhoodRepository =
    createPostgresCardNeighborhoodRepository(),
): Promise<NeighborhoodResponse> {
  const groups = canonicalGroups(query.groups);
  const nodeLimit = validateLimit(query.limit);
  const focusRecord = await repository.loadFocus(userId, cardId);
  if (!focusRecord) throw new NotFoundError('Card');
  if (!focusRecord.focus) throw new NotFoundError('Knowledge graph');

  const after = query.cursor
    ? decodeCursor(
        query.cursor,
        cardId,
        focusRecord.focus.id,
        groups,
      )
    : null;
  const [page, summary] = await Promise.all([
    repository.loadPage({
      userId,
      deckId: focusRecord.deckId,
      focusCardId: cardId,
      focusSenseId: focusRecord.focus.id,
      groups,
      relationTypes: relationTypesForGroups(groups),
      nodeLimit,
      edgeLimit: MAX_EDGE_LIMIT,
      after,
    }),
    repository.loadSummary({
      userId,
      deckId: focusRecord.deckId,
      focusSenseId: focusRecord.focus.id,
    }),
  ]);

  const orderedNodes = [...page.nodes].sort(compareNode);
  const lastNode = orderedNodes.at(-1);
  const nextCursor =
    page.hasMore && lastNode
      ? encodeCursor({
          v: CURSOR_VERSION,
          cardId,
          focusSenseId: focusRecord.focus.id,
          groups,
          after: {
            normalizedLemma: lastNode.normalizedLemma,
            senseId: lastNode.id,
          },
        })
      : null;

  return {
    focus: toNode(focusRecord.focus),
    nodes: orderedNodes.map(toNode),
    edges: [...page.edges].sort(compareEdge),
    summary: normalizeSummary(summary),
    pageInfo: {
      nextCursor,
      truncated: nextCursor !== null,
    },
  };
}

export async function mapCardToSense(
  userId: string,
  cardId: string,
  senseId: string,
  repository: CardNeighborhoodRepository =
    createPostgresCardNeighborhoodRepository(),
): Promise<CardSenseMapping> {
  const result = await repository.mapCardSense(userId, cardId, senseId);
  if (result.outcome === 'card_not_found') {
    throw new NotFoundError('Card');
  }
  if (result.outcome === 'sense_not_found') {
    throw new NotFoundError('Sense');
  }
  return result.mapping;
}
