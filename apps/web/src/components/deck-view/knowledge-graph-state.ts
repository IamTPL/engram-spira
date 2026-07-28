export type RelationType =
  | 'synonym'
  | 'antonym'
  | 'is_a'
  | 'part_of'
  | 'derived_from'
  | 'collocation'
  | 'confused_with'
  | 'translation_of'
  | 'coordinate';

export type RelationGroup = 'hierarchy' | 'meaning' | 'form' | 'usage';

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
  evidence: string | null;
  confidenceBand: 'high' | 'medium' | 'low' | null;
}

export interface NeighborhoodResponse {
  focus: KnowledgeGraphNode;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  summary: {
    deckCards: number;
    connectedCards: number;
    isolatedCards: number;
    groupCounts: Record<string, number>;
  };
  pageInfo: {
    nextCursor: string | null;
    truncated: boolean;
  };
}

export interface KnowledgeGraphExplorerState {
  rootCardId: string;
  rootSenseId: string;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  summary: NeighborhoodResponse['summary'];
  truncated: boolean;
}

export interface VisibleKnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

export interface CappedKnowledgeGraph extends VisibleKnowledgeGraph {
  truncated: boolean;
}

export interface LearnNextCandidate {
  node: KnowledgeGraphNode;
  edge: KnowledgeGraphEdge;
}

export interface VocabularyTemplateField {
  id: string;
  name: string;
  fieldType: string;
}

export interface VocabularyCardFieldValue {
  templateFieldId: string;
  value: string | unknown[];
}

export type PendingSenseMappings = Record<string, string>;

export const knowledgeGraphKeys = {
  all: ['knowledge-graph'] as const,
  capabilities() {
    return [...this.all, 'capabilities'] as const;
  },
  deck(deckId: string) {
    return [...this.all, 'deck', deckId] as const;
  },
  neighborhood(cardId: string, groups: RelationGroup[]) {
    const normalizedGroups = [...new Set(groups)].sort().join(',');
    return [
      ...this.all,
      'neighborhood',
      cardId,
      normalizedGroups,
    ] as const;
  },
  run(runId: string) {
    return [...this.all, 'run', runId] as const;
  },
  suggestions(runId: string, status: string) {
    return [...this.all, 'suggestions', runId, status] as const;
  },
};

export function isKnowledgeGraphV2Enabled(
  capabilities: { v2Enabled: boolean } | undefined,
): boolean {
  return capabilities?.v2Enabled === true;
}

export function describeKnowledgeGraphLoadError(error: unknown): {
  title: string;
  message: string;
  needsIndexing: boolean;
} {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Check your connection and try again.';
  if (message.toLocaleLowerCase('en').includes('not found')) {
    return {
      title: 'Lexical graph not built yet',
      message:
        'Build the lexical graph for this deck, then return to this word.',
      needsIndexing: true,
    };
  }
  return {
    title: 'Connections could not be loaded',
    message,
    needsIndexing: false,
  };
}

const relationGroups: Record<RelationType, RelationGroup> = {
  synonym: 'meaning',
  antonym: 'meaning',
  translation_of: 'meaning',
  coordinate: 'meaning',
  is_a: 'hierarchy',
  part_of: 'hierarchy',
  derived_from: 'form',
  collocation: 'usage',
  confused_with: 'usage',
};

const relationUsefulness: Record<RelationType, number> = {
  translation_of: 9,
  confused_with: 8,
  synonym: 7,
  antonym: 7,
  collocation: 6,
  derived_from: 5,
  is_a: 4,
  coordinate: 3,
  part_of: 2,
};

const confidenceUsefulness = {
  high: 3,
  medium: 2,
  low: 1,
} as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PART_OF_SPEECH_FIELD_NAMES = new Set([
  'type',
  'pos',
  'part of speech',
  'part-of-speech',
  'part_of_speech',
]);

export function relationGroup(type: RelationType): RelationGroup {
  return relationGroups[type];
}

export function selectKnowledgeGraphLayout(
  groups: RelationGroup[],
): 'dagre' | 'fcose' {
  return groups.length === 1 && groups[0] === 'hierarchy'
    ? 'dagre'
    : 'fcose';
}

export function createExplorerState(
  response: NeighborhoodResponse,
): KnowledgeGraphExplorerState {
  return {
    rootCardId: response.focus.mappedCardIds[0] ?? '',
    rootSenseId: response.focus.id,
    nodes: response.nodes,
    edges: response.edges,
    summary: response.summary,
    truncated: response.pageInfo.truncated,
  };
}

export function mergeNeighborhood(
  current: KnowledgeGraphExplorerState,
  response: NeighborhoodResponse,
  limits: { nodeCap: number; edgeCap: number },
): KnowledgeGraphExplorerState {
  const nodeById = new Map(
    current.nodes.map((item) => [item.id, item] as const),
  );
  for (const item of response.nodes) {
    if (!nodeById.has(item.id)) nodeById.set(item.id, item);
  }
  const allNodes = [...nodeById.values()];
  const nodes = allNodes.slice(0, Math.max(1, limits.nodeCap));
  const includedNodeIds = new Set(nodes.map((item) => item.id));

  const edgeById = new Map(
    current.edges.map((item) => [item.id, item] as const),
  );
  for (const item of response.edges) {
    if (!edgeById.has(item.id)) edgeById.set(item.id, item);
  }
  const eligibleEdges = [...edgeById.values()].filter(
    (item) =>
      includedNodeIds.has(item.source) && includedNodeIds.has(item.target),
  );
  const edges = eligibleEdges.slice(0, Math.max(0, limits.edgeCap));

  return {
    ...current,
    nodes,
    edges,
    truncated:
      current.truncated ||
      response.pageInfo.truncated ||
      nodes.length < allNodes.length ||
      edges.length < eligibleEdges.length,
  };
}

export function limitNeighborhoodExpansion(
  response: NeighborhoodResponse,
  existingNodeIds: ReadonlySet<string>,
  maxNewNodes = 12,
): NeighborhoodResponse {
  const allowedNodeIds = new Set<string>();
  let newNodeCount = 0;
  const newNodeCap = Math.max(0, maxNewNodes);

  for (const node of response.nodes) {
    if (
      existingNodeIds.has(node.id) ||
      node.id === response.focus.id
    ) {
      allowedNodeIds.add(node.id);
      continue;
    }
    if (newNodeCount < newNodeCap) {
      allowedNodeIds.add(node.id);
      newNodeCount += 1;
    }
  }

  const nodes = response.nodes.filter((node) =>
    allowedNodeIds.has(node.id),
  );
  if (!allowedNodeIds.has(response.focus.id)) {
    nodes.unshift(response.focus);
    allowedNodeIds.add(response.focus.id);
  }
  const edges = response.edges.filter(
    (edge) =>
      allowedNodeIds.has(edge.source) &&
      allowedNodeIds.has(edge.target),
  );

  return {
    ...response,
    nodes,
    edges,
    pageInfo: {
      ...response.pageInfo,
      truncated:
        response.pageInfo.truncated ||
        nodes.length < response.nodes.length ||
        edges.length < response.edges.length,
    },
  };
}

export function addCardToStudyCluster(
  current: string[],
  cardId: string,
  rootCardId: string,
): string[] {
  const ordered = [
    rootCardId,
    ...current.filter((item) => item !== rootCardId),
  ];
  if (!ordered.includes(cardId) && ordered.length < 12) {
    ordered.push(cardId);
  }
  return ordered.slice(0, 12);
}

export function toggleCardInStudyCluster(
  current: string[],
  cardId: string,
  rootCardId: string,
): string[] {
  const ordered = addCardToStudyCluster(current, rootCardId, rootCardId);
  if (cardId === rootCardId) return ordered;
  if (ordered.includes(cardId)) {
    return ordered.filter((item) => item !== cardId);
  }
  return addCardToStudyCluster(ordered, cardId, rootCardId);
}

export function buildStudyClusterHref(
  deckId: string,
  current: string[],
  rootCardId: string,
): string {
  const cardIds = addCardToStudyCluster(current, rootCardId, rootCardId);
  const encodedCardIds = cardIds.map(encodeURIComponent).join(',');
  return `/study/${encodeURIComponent(deckId)}?mode=all&cardIds=${encodedCardIds}`;
}

export function knowledgeGraphCaps(isMobile: boolean) {
  return isMobile
    ? { nodeCap: 30, edgeCap: 50 }
    : { nodeCap: 60, edgeCap: 120 };
}

export function knowledgeGraphAnimationEnabled(
  nodeCount: number,
  prefersReducedMotion: boolean,
) {
  return !prefersReducedMotion && nodeCount <= 40;
}

export function formatRetention(retention: number | null): string {
  if (retention === null) return 'Not reviewed';
  const percent = Math.round(Math.min(1, Math.max(0, retention)) * 100);
  return `${percent}% retention`;
}

export function buildVocabularyCardFieldValues(
  node: KnowledgeGraphNode,
  fields: VocabularyTemplateField[],
): VocabularyCardFieldValue[] | null {
  const normalizedNames = fields.map((field) =>
    field.name.normalize('NFKC').trim().toLocaleLowerCase('en'),
  );
  if (
    !normalizedNames.includes('word') ||
    !normalizedNames.includes('definition')
  ) {
    return null;
  }
  return fields.map((field, index) => {
    const name = normalizedNames[index];
    return {
      templateFieldId: field.id,
      value:
        name === 'word'
          ? node.label
          : name === 'definition'
            ? node.definition
            : PART_OF_SPEECH_FIELD_NAMES.has(name)
              ? node.partOfSpeech
              : field.fieldType === 'json_array'
                ? []
                : '',
    };
  });
}

export function attachCreatedCardToExplorer(
  state: KnowledgeGraphExplorerState,
  senseId: string,
  cardId: string,
): KnowledgeGraphExplorerState {
  return {
    ...state,
    nodes: state.nodes.map((node) =>
      node.id === senseId
        ? {
            ...node,
            mappedCardIds: [
              cardId,
              ...node.mappedCardIds.filter((item) => item !== cardId),
            ],
            inCurrentDeck: true,
          }
        : node,
    ),
  };
}

export function registerPendingSenseMapping(
  current: PendingSenseMappings,
  senseId: string,
  cardId: string,
): PendingSenseMappings {
  return {
    ...current,
    [senseId]: cardId,
  };
}

export function removePendingSenseMapping(
  current: PendingSenseMappings,
  senseId: string,
): PendingSenseMappings {
  const next = { ...current };
  delete next[senseId];
  return next;
}

export function parsePendingSenseMappings(
  serialized: string | null,
): PendingSenseMappings {
  if (!serialized) return {};
  try {
    const value = JSON.parse(serialized) as unknown;
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      return {};
    }
    const entries = Object.entries(value);
    if (
      entries.length > 100 ||
      entries.some(
        ([senseId, cardId]) =>
          !UUID_PATTERN.test(senseId) ||
          typeof cardId !== 'string' ||
          !UUID_PATTERN.test(cardId),
      )
    ) {
      return {};
    }
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export function serializePendingSenseMappings(
  mappings: PendingSenseMappings,
): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(mappings)
        .filter(
          ([senseId, cardId]) =>
            UUID_PATTERN.test(senseId) && UUID_PATTERN.test(cardId),
        )
        .sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
    ),
  );
}

export function filterExplorerByGroups(
  state: KnowledgeGraphExplorerState,
  groups: RelationGroup[],
): VisibleKnowledgeGraph {
  const enabledGroups = new Set(groups);
  const edges = state.edges.filter((edge) => enabledGroups.has(edge.group));
  const includedNodeIds = new Set<string>([state.rootSenseId]);
  for (const edge of edges) {
    includedNodeIds.add(edge.source);
    includedNodeIds.add(edge.target);
  }

  const rootNode = state.nodes.find((node) => node.id === state.rootSenseId);
  const nodes = [
    ...(rootNode ? [rootNode] : []),
    ...state.nodes.filter(
      (node) =>
        node.id !== state.rootSenseId && includedNodeIds.has(node.id),
    ),
  ];
  return { nodes, edges };
}

export function capVisibleKnowledgeGraph(
  graph: VisibleKnowledgeGraph,
  rootSenseId: string,
  limits: { nodeCap: number; edgeCap: number },
): CappedKnowledgeGraph {
  const rootNode = graph.nodes.find((node) => node.id === rootSenseId);
  const orderedNodes = [
    ...(rootNode ? [rootNode] : []),
    ...graph.nodes.filter((node) => node.id !== rootSenseId),
  ];
  const nodes = orderedNodes.slice(0, Math.max(1, limits.nodeCap));
  const includedNodeIds = new Set(nodes.map((node) => node.id));
  const eligibleEdges = graph.edges.filter(
    (edge) =>
      includedNodeIds.has(edge.source) &&
      includedNodeIds.has(edge.target),
  );
  const edges = eligibleEdges.slice(0, Math.max(0, limits.edgeCap));
  return {
    nodes,
    edges,
    truncated:
      nodes.length < orderedNodes.length ||
      edges.length < eligibleEdges.length,
  };
}

function isDue(node: KnowledgeGraphNode, nowMs: number): boolean {
  if (node.dueAt === null) return false;
  const dueMs = new Date(node.dueAt).getTime();
  return Number.isFinite(dueMs) && dueMs <= nowMs;
}

function compareLearnNextCandidate(
  left: LearnNextCandidate,
  right: LearnNextCandidate,
  nowMs: number,
): number {
  const usefulness =
    relationUsefulness[right.edge.type] -
    relationUsefulness[left.edge.type];
  if (usefulness !== 0) return usefulness;

  const leftConfidence = left.edge.confidenceBand
    ? confidenceUsefulness[left.edge.confidenceBand]
    : 0;
  const rightConfidence = right.edge.confidenceBand
    ? confidenceUsefulness[right.edge.confidenceBand]
    : 0;
  if (leftConfidence !== rightConfidence) {
    return rightConfidence - leftConfidence;
  }

  if (left.node.inCurrentDeck !== right.node.inCurrentDeck) {
    return left.node.inCurrentDeck ? 1 : -1;
  }

  const leftDue = isDue(left.node, nowMs);
  const rightDue = isDue(right.node, nowMs);
  if (leftDue !== rightDue) return leftDue ? -1 : 1;

  const leftRetention = left.node.retention ?? -1;
  const rightRetention = right.node.retention ?? -1;
  if (leftRetention !== rightRetention) {
    return leftRetention - rightRetention;
  }

  if (left.node.id < right.node.id) return -1;
  if (left.node.id > right.node.id) return 1;
  return left.edge.id < right.edge.id
    ? -1
    : left.edge.id > right.edge.id
      ? 1
      : 0;
}

export function rankLearnNextCandidates(
  graph: VisibleKnowledgeGraph,
  rootSenseId: string,
  nowMs = Date.now(),
): LearnNextCandidate[] {
  const nodeById = new Map(
    graph.nodes.map((node) => [node.id, node] as const),
  );
  const bestByNodeId = new Map<string, LearnNextCandidate>();

  for (const edge of graph.edges) {
    const candidateId =
      edge.source === rootSenseId
        ? edge.target
        : edge.target === rootSenseId
          ? edge.source
          : null;
    if (candidateId === null || candidateId === rootSenseId) continue;
    const candidateNode = nodeById.get(candidateId);
    if (!candidateNode) continue;
    const candidate = { node: candidateNode, edge };
    const current = bestByNodeId.get(candidateId);
    if (
      !current ||
      compareLearnNextCandidate(candidate, current, nowMs) < 0
    ) {
      bestByNodeId.set(candidateId, candidate);
    }
  }

  return [...bestByNodeId.values()].sort((left, right) =>
    compareLearnNextCandidate(left, right, nowMs),
  );
}
