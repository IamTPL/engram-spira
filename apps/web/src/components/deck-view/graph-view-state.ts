export type GraphNode = {
  id: string;
  label: string;
  retention: number | null;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type GraphLayout = 'dagre' | 'fcose';

export const LEGACY_RELATED_EDGE_CURVE_STYLE = 'bezier' as const;

const directedHierarchyTypes = new Set([
  'child',
  'hierarchy',
  'parent',
  'prerequisite',
  'prerequisite_of',
]);

export function graphContainerHeight(nodeCount: number) {
  return Math.min(800, Math.max(400, 300 + nodeCount * 15));
}

export function selectGraphLayout(edges: GraphEdge[]): GraphLayout {
  return edges.length > 0 && edges.every((edge) => directedHierarchyTypes.has(edge.type))
    ? 'dagre'
    : 'fcose';
}

export function createGraphPresentation(data: GraphData, showIsolated: boolean) {
  const nodeIds = new Set(data.nodes.map((node) => node.id));
  const renderedEdges = data.edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
  const connectedIds = new Set<string>();

  for (const edge of renderedEdges) {
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
  }

  const renderedNodes = showIsolated
    ? data.nodes
    : data.nodes.filter((node) => connectedIds.has(node.id));

  return {
    summary: {
      totalCards: data.nodes.length,
      connectedCards: connectedIds.size,
      isolatedCards: data.nodes.length - connectedIds.size,
      relationships: renderedEdges.length,
    },
    renderedNodes,
    renderedEdges,
    containerHeight: graphContainerHeight(renderedNodes.length),
    layout: selectGraphLayout(renderedEdges),
  };
}
