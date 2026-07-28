import {
  type Component,
  Show,
  For,
  createEffect,
  onCleanup,
  createSignal,
  createMemo,
} from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { api } from '@/api/client';
import { currentUser } from '@/stores/auth.store';
import { resolvedTheme } from '@/stores/theme.store';
import Skeleton from '@/components/ui/skeleton';
import { Network, Maximize2, ZoomIn, ZoomOut } from 'lucide-solid';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import fcose from 'cytoscape-fcose';
import type { Core, NodeSingular } from 'cytoscape';
import {
  createGraphPresentation,
  LEGACY_RELATED_EDGE_CURVE_STYLE,
  type GraphData,
} from './graph-view-state';

// Register supported layouts once.
cytoscape.use(dagre);
cytoscape.use(fcose);

interface GraphViewProps {
  deckId: string;
}

interface GraphColors {
  muted: string;
  success: string;
  warning: string;
  destructive: string;
  foreground: string;
  background: string;
  border: string;
}

function readSemanticColor(name: string): string {
  const styles = getComputedStyle(document.documentElement);
  return (
    styles.getPropertyValue(name).trim() ||
    styles.getPropertyValue('--color-foreground').trim()
  );
}

function getGraphColors(): GraphColors {
  return {
    muted: readSemanticColor('--color-muted-foreground'),
    success: readSemanticColor('--color-success'),
    warning: readSemanticColor('--color-warning'),
    destructive: readSemanticColor('--color-destructive'),
    foreground: readSemanticColor('--color-foreground'),
    background: readSemanticColor('--color-background'),
    border: readSemanticColor('--color-border'),
  };
}

function retentionColor(r: number | null, colors: GraphColors): string {
  if (r === null) return colors.muted;
  if (r >= 0.8) return colors.success;
  if (r >= 0.6) return colors.warning;
  return colors.destructive;
}

const GraphView: Component<GraphViewProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let cy: Core | null = null;
  const [showIsolated, setShowIsolated] = createSignal(false);
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
      return data as GraphData | null;
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

  const hasNoNodes = () => {
    const d = graphQuery.data;
    return d && d.nodes.length === 0;
  };

  const graphPresentation = createMemo(() =>
    createGraphPresentation(
      graphQuery.data ?? { nodes: [], edges: [] },
      showIsolated(),
    ),
  );

  const nodeLabels = createMemo(
    () =>
      new Map(
        (graphQuery.data?.nodes ?? []).map((node) => [node.id, node.label]),
      ),
  );

  const retentionLabel = (retention: number | null) =>
    retention === null
      ? 'Not reviewed'
      : `${Math.round(retention * 100)}% retention`;

  // Initialize Cytoscape when data arrives
  createEffect(() => {
    resolvedTheme();
    const data = graphQuery.data;
    const presentation = graphPresentation();
    if (!data || !containerRef || presentation.renderedEdges.length === 0) {
      if (cy) { cy.destroy(); cy = null; }
      return;
    }

    const colors = getGraphColors();
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const fontFamily = getComputedStyle(document.body).fontFamily;

    // Build cytoscape elements
    const elements = [
      ...presentation.renderedNodes.map((n) => ({
        data: {
          id: n.id,
          label: n.label.length > 20 ? n.label.slice(0, 18) + '…' : n.label,
          fullLabel: n.label,
          retention: n.retention,
          color: retentionColor(n.retention, colors),
        },
      })),
      ...presentation.renderedEdges.map((e) => ({
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
            'font-family': fontFamily,
            color: colors.foreground,
            'text-valign': 'bottom',
            'text-margin-y': 6,
            width: 16,
            height: 16,
            'border-width': 1.5,
            'border-color': colors.background,
            'text-max-width': '100px',
            'text-wrap': 'ellipsis',
            'text-outline-color': colors.background,
            'text-outline-width': 2,
            'overlay-padding': 4,
          },
        },
        {
          selector: 'node:active, node:selected',
          style: {
            'border-width': 2.5,
            'border-color': colors.foreground,
            width: 22,
            height: 22,
            'font-weight': 'bold',
            color: colors.foreground,
            'z-index': 10,
          },
        },
        {
          selector: '.dimmed',
          style: {
            opacity: 0.15,
          },
        },
        {
          selector: 'edge[type = "related"]',
          style: {
            'line-color': colors.border,
            'line-opacity': 0.7,
            width: 1.5,
            'line-style': 'dashed',
            'curve-style': LEGACY_RELATED_EDGE_CURVE_STYLE,
          },
        },
      ],
      layout: presentation.layout === 'dagre'
        ? {
            name: 'dagre',
            rankDir: 'TB',
            nodeSep: 80,
            rankSep: 100,
            edgeSep: 30,
            ranker: 'network-simplex',
            animate: !reduceMotion,
            animationDuration: reduceMotion ? 0 : 450,
            fit: true,
            padding: 40,
          } as any
        : {
            name: 'fcose',
            quality: 'default',
            randomize: true,
            nodeRepulsion: 4500,
            idealEdgeLength: 120,
            nodeSeparation: 80,
            animate: !reduceMotion,
            animationDuration: reduceMotion ? 0 : 450,
            fit: true,
            padding: 40,
          } as any,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      minZoom: 0.15,
      maxZoom: 4,
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

  // ── Zoom controls ─────────────────────────────────────────────
  const handleFit = () => cy?.fit(undefined, 50);
  const handleZoomIn = () => { if (cy) cy.zoom(cy.zoom() * 1.3); };
  const handleZoomOut = () => { if (cy) cy.zoom(cy.zoom() / 1.3); };

  const zoomBtnClass =
    'flex h-8 w-8 items-center justify-center rounded-md border bg-card text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-foreground';

  return (
    <Show
      when={!graphQuery.isLoading}
      fallback={<Skeleton shape="card" height="300px" />}
    >
      <Show
        when={!graphQuery.isError}
        fallback={
          <section class="rounded-lg border bg-card p-5">
            <h3 class="text-sm font-semibold text-foreground">
              Knowledge graph unavailable
            </h3>
            <p class="mt-1 text-sm text-muted-foreground">
              Relationship data could not be loaded right now.
            </p>
          </section>
        }
      >
        <Show when={hasNoNodes()}>
          <section class="rounded-lg border bg-card p-6 text-center">
            <Network class="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
            <p class="text-sm font-medium text-foreground">
              No graph data yet
            </p>
            <p class="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Add cards to this deck before detecting relationships.
            </p>
          </section>
        </Show>

        <Show when={hasNodesButNoEdges()}>
          <section class="rounded-lg border bg-card p-6 text-center">
            <Network class="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
            <p class="text-sm font-medium text-foreground">
              No relationships yet
            </p>
            <p class="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Use AI relationship detection below to discover connections
              between cards.
            </p>
          </section>
        </Show>

        <Show when={hasGraph()}>
          <section
            class="relative overflow-hidden rounded-lg border bg-card"
            aria-labelledby="knowledge-graph-title"
          >
            <div class="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div class="flex min-w-0 items-center gap-2">
                <Network class="h-4 w-4 shrink-0 text-muted-foreground" />
                <div class="min-w-0">
                  <h3
                    id="knowledge-graph-title"
                    class="text-sm font-semibold text-foreground"
                  >
                    Knowledge graph
                  </h3>
                  <p class="text-xs text-muted-foreground">
                    {graphPresentation().summary.totalCards} total cards ·{' '}
                    {graphPresentation().summary.connectedCards} connected ·{' '}
                    {graphPresentation().summary.isolatedCards} isolated ·{' '}
                    {graphPresentation().summary.relationships} relationships
                  </p>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-3">
                <p class="text-xs text-muted-foreground">
                  Select a node to isolate its connections
                </p>
                <Show when={graphPresentation().summary.isolatedCards > 0}>
                  <button
                    type="button"
                    class="rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent active:translate-y-px"
                    onClick={() => setShowIsolated((value) => !value)}
                    aria-pressed={showIsolated()}
                  >
                    {showIsolated()
                      ? 'Hide isolated cards'
                      : `Show ${graphPresentation().summary.isolatedCards} isolated ${graphPresentation().summary.isolatedCards === 1 ? 'card' : 'cards'}`}
                  </button>
                </Show>
              </div>
            </div>

            <Show when={hoveredNode()}>
              <div
                role="tooltip"
                class="pointer-events-none absolute z-20 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
                style={{
                  left: `${Math.min(
                    hoveredNode()!.x + 10,
                    (containerRef?.clientWidth ?? 400) - 160,
                  )}px`,
                  top: `${hoveredNode()!.y - 40}px`,
                }}
              >
                <p class="font-semibold">{hoveredNode()!.label}</p>
                <p class="mt-0.5 text-muted-foreground">
                  Retention:{' '}
                  {hoveredNode()!.retention !== null
                    ? `${Math.round(hoveredNode()!.retention! * 100)}%`
                    : 'Not reviewed'}
                </p>
              </div>
            </Show>

            <div
              class="absolute bottom-3 right-3 z-10 flex flex-col gap-1"
              role="toolbar"
              aria-label="Graph zoom controls"
            >
              <button
                type="button"
                onClick={handleFit}
                title="Fit graph"
                aria-label="Fit graph"
                class={zoomBtnClass}
              >
                <Maximize2 class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                title="Zoom in"
                aria-label="Zoom in"
                class={zoomBtnClass}
              >
                <ZoomIn class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleZoomOut}
                title="Zoom out"
                aria-label="Zoom out"
                class={zoomBtnClass}
              >
                <ZoomOut class="h-3.5 w-3.5" />
              </button>
            </div>
            <div
              ref={containerRef}
              class="w-full cursor-grab active:cursor-grabbing"
              style={{ height: `${graphPresentation().containerHeight}px` }}
              role="img"
              aria-label="Interactive knowledge graph of related cards"
              aria-describedby="knowledge-graph-canvas-description"
            />

            <p id="knowledge-graph-canvas-description" class="sr-only">
              This graph renders {graphPresentation().renderedNodes.length}{' '}
              of {graphPresentation().summary.totalCards} cards and{' '}
              {graphPresentation().summary.relationships} relationships. Use
              the accessible graph data section after the canvas to inspect
              every item without using pointer controls.
            </p>

            <details class="border-t bg-card">
              <summary class="cursor-pointer px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                View accessible graph data
              </summary>
              <div class="grid max-h-80 gap-5 overflow-y-auto border-t bg-surface p-4 md:grid-cols-2">
                <section aria-labelledby="graph-node-list-title">
                  <h4
                    id="graph-node-list-title"
                    class="text-xs font-semibold text-foreground"
                  >
                    Cards and retention
                  </h4>
                  <ul class="mt-2 space-y-2">
                    <For each={graphQuery.data?.nodes ?? []}>
                      {(node) => (
                        <li class="rounded-md border bg-card px-3 py-2 text-xs">
                          <span class="font-medium text-foreground">
                            {node.label}
                          </span>
                          <span class="ml-2 text-muted-foreground">
                            {retentionLabel(node.retention)}
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>

                <section aria-labelledby="graph-relationship-list-title">
                  <h4
                    id="graph-relationship-list-title"
                    class="text-xs font-semibold text-foreground"
                  >
                    Relationships
                  </h4>
                  <ul class="mt-2 space-y-2">
                    <For each={graphQuery.data?.edges ?? []}>
                      {(edge) => (
                        <li class="rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
                          <span class="font-medium text-foreground">
                            {nodeLabels().get(edge.source) ?? edge.source}
                          </span>
                          <span> connects to </span>
                          <span class="font-medium text-foreground">
                            {nodeLabels().get(edge.target) ?? edge.target}
                          </span>
                          <span class="ml-1">({edge.type})</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              </div>
            </details>
          </section>
        </Show>
      </Show>
    </Show>
  );
};

export default GraphView;
