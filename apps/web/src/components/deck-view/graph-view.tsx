import {
  type Component,
  Show,
  createEffect,
  onCleanup,
  createSignal,
} from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { api } from '@/api/client';
import { currentUser } from '@/stores/auth.store';
import Skeleton from '@/components/ui/skeleton';
import { Network } from 'lucide-solid';
import cytoscape from 'cytoscape';
import type { Core, NodeSingular } from 'cytoscape';

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

interface GraphViewProps {
  deckId: string;
}

function retentionColor(r: number | null): string {
  if (r === null) return '#94a3b8';
  if (r >= 0.8) return '#22c55e';
  if (r >= 0.6) return '#f59e0b';
  return '#ef4444';
}

const GraphView: Component<GraphViewProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let cy: Core | null = null;
  const [hoveredNode, setHoveredNode] = createSignal<{
    label: string;
    retention: number | null;
    x: number;
    y: number;
  } | null>(null);

  const graphQuery = createQuery(() => ({
    queryKey: ['deck-graph', props.deckId, currentUser()?.id],
    queryFn: async () => {
      const { data } = await (api['knowledge-graph'] as any).decks[
        props.deckId
      ].graph.get();
      return data as {
        nodes: { id: string; label: string; retention: number | null }[];
        edges: GraphEdge[];
      } | null;
    },
    enabled: !!props.deckId && !!currentUser()?.id,
    staleTime: 2 * 60_000,
  }));

  const hasGraph = () => {
    const d = graphQuery.data;
    return d && d.nodes.length > 0 && d.edges.length > 0;
  };

  const hasNodesButNoEdges = () => {
    const d = graphQuery.data;
    return d && d.nodes.length > 0 && d.edges.length === 0;
  };

  // Initialize Cytoscape when data arrives
  createEffect(() => {
    const data = graphQuery.data;
    if (!data || !containerRef || data.edges.length === 0) {
      if (cy) { cy.destroy(); cy = null; }
      return;
    }

    // Only include connected nodes
    const connectedIds = new Set<string>();
    for (const e of data.edges) {
      connectedIds.add(e.source);
      connectedIds.add(e.target);
    }
    const connectedNodes = data.nodes.filter((n) => connectedIds.has(n.id));

    // Build cytoscape elements
    const elements = [
      ...connectedNodes.map((n) => ({
        data: {
          id: n.id,
          label: n.label.length > 20 ? n.label.slice(0, 18) + '…' : n.label,
          fullLabel: n.label,
          retention: n.retention,
          color: retentionColor(n.retention),
        },
      })),
      ...data.edges.map((e) => ({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type,
        },
      })),
    ];

    // Destroy previous instance
    if (cy) { cy.destroy(); cy = null; }

    cy = cytoscape({
      container: containerRef,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            'font-size': '11px',
            'font-family': 'system-ui, sans-serif',
            color: '#94a3b8',
            'text-valign': 'bottom',
            'text-margin-y': 6,
            width: 14,
            height: 14,
            'border-width': 1,
            'border-color': 'rgba(255,255,255,0.3)',
            'text-max-width': '80px',
            'text-wrap': 'ellipsis',
          },
        },
        {
          selector: 'node:active, node:selected',
          style: {
            'border-width': 2,
            'border-color': '#fff',
            width: 20,
            height: 20,
            'font-weight': 'bold',
            color: '#e2e8f0',
          },
        },
        {
          selector: '.dimmed',
          style: {
            opacity: 0.2,
          },
        },
        {
          selector: 'edge[type = "prerequisite"]',
          style: {
            'line-color': '#8b5cf6',
            width: 2,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#8b5cf6',
            'arrow-scale': 0.8,
          },
        },
        {
          selector: 'edge[type = "related"]',
          style: {
            'line-color': 'rgba(100,116,139,0.4)',
            width: 1,
            'line-style': 'dashed',
            'curve-style': 'bezier',
          },
        },
      ],
      layout: {
        name: 'cose',
        animate: false,
        nodeRepulsion: () => 4500,
        idealEdgeLength: () => 120,
        gravity: 0.25,
        padding: 30,
        randomize: false,
      } as any,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      minZoom: 0.3,
      maxZoom: 3,
    });

    // Hover tooltip
    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target as NodeSingular;
      const pos = node.renderedPosition();
      setHoveredNode({
        label: node.data('fullLabel'),
        retention: node.data('retention'),
        x: pos.x,
        y: pos.y,
      });
    });

    cy.on('mouseout', 'node', () => {
      setHoveredNode(null);
    });

    // Click node → highlight connected edges
    cy.on('tap', 'node', (evt) => {
      const node = evt.target as NodeSingular;
      cy!.elements().removeClass('highlighted dimmed');
      const connected = node.connectedEdges().connectedNodes().add(node);
      connected.addClass('highlighted');
      cy!.elements().not(connected).not(node.connectedEdges()).addClass('dimmed');
    });

    // Click background → reset
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        cy!.elements().removeClass('highlighted dimmed');
      }
    });
  });

  onCleanup(() => {
    if (cy) { cy.destroy(); cy = null; }
  });

  return (
    <Show
      when={!graphQuery.isLoading}
      fallback={<Skeleton shape="card" height="300px" />}
    >
      {/* Empty state: nodes exist but no relationships */}
      <Show when={hasNodesButNoEdges()}>
        <div class="rounded-xl border bg-card p-6 text-center">
          <Network class="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p class="text-sm font-medium">No relationships yet</p>
          <p class="text-xs text-muted-foreground mt-1">
            Use &ldquo;AI Detect Relationships&rdquo; below to discover connections between your cards.
          </p>
        </div>
      </Show>
      {/* Full graph with Cytoscape.js */}
      <Show when={hasGraph()}>
        <div class="rounded-xl border bg-card overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b">
            <div class="flex items-center gap-2">
              <Network class="h-4 w-4 text-muted-foreground" />
              <h3 class="text-sm font-semibold">Knowledge Graph</h3>
            </div>
            <div class="flex items-center gap-3 text-[10px] text-muted-foreground">
              <div class="flex items-center gap-1">
                <div class="h-2 w-4 rounded-sm bg-[#8b5cf6]" />
                <span>Prerequisite</span>
              </div>
              <div class="flex items-center gap-1">
                <div class="h-0.5 w-4 border-t border-dashed border-muted-foreground" />
                <span>Related</span>
              </div>
            </div>
          </div>
          {/* Tooltip */}
          <Show when={hoveredNode()}>
            <div
              class="absolute z-10 bg-card border rounded-lg px-3 py-2 shadow-lg text-xs pointer-events-none"
              style={{
                left: `${hoveredNode()!.x + 10}px`,
                top: `${hoveredNode()!.y - 40}px`,
              }}
            >
              <p class="font-semibold">{hoveredNode()!.label}</p>
              <p class="text-muted-foreground mt-0.5">
                Retention:{' '}
                {hoveredNode()!.retention !== null
                  ? `${Math.round(hoveredNode()!.retention! * 100)}%`
                  : 'N/A'}
              </p>
            </div>
          </Show>
          <div
            ref={containerRef}
            class="w-full cursor-grab active:cursor-grabbing"
            style={{ height: '360px' }}
          />
        </div>
      </Show>
    </Show>
  );
};

export default GraphView;
