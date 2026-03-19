import {
  type Component,
  Show,
  createSignal,
  createEffect,
  onCleanup,
  onMount,
} from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { api } from '@/api/client';
import { currentUser } from '@/stores/auth.store';
import Skeleton from '@/components/ui/skeleton';
import { Network } from 'lucide-solid';

interface GraphNode {
  id: string;
  label: string;
  retention: number | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

interface GraphViewProps {
  deckId: string;
}

// ── Minimal force simulation (no d3 dependency) ──────────────────────────────

const REPULSION = 800;
const ATTRACTION = 0.005;
const DAMPING = 0.85;
const CENTER_GRAVITY = 0.01;
const LINK_DISTANCE = 120;

function tick(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
) {
  const cx = width / 2;
  const cy = height / 2;

  // Repulsion between all node pairs
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = REPULSION / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      nodes[i].vx += fx;
      nodes[i].vy += fy;
      nodes[j].vx -= fx;
      nodes[j].vy -= fy;
    }
  }

  // Attraction along edges
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);
    if (!src || !tgt) continue;
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const force = (dist - LINK_DISTANCE) * ATTRACTION;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    src.vx += fx;
    src.vy += fy;
    tgt.vx -= fx;
    tgt.vy -= fy;
  }

  // Center gravity + integrate
  for (const node of nodes) {
    node.vx += (cx - node.x) * CENTER_GRAVITY;
    node.vy += (cy - node.y) * CENTER_GRAVITY;
    node.vx *= DAMPING;
    node.vy *= DAMPING;
    node.x += node.vx;
    node.y += node.vy;
    // Clamp to bounds
    node.x = Math.max(30, Math.min(width - 30, node.x));
    node.y = Math.max(30, Math.min(height - 30, node.y));
  }
}

function retentionColor(r: number | null): string {
  if (r === null) return '#94a3b8';
  if (r >= 0.8) return '#22c55e';
  if (r >= 0.6) return '#f59e0b';
  return '#ef4444';
}

// ── Component ────────────────────────────────────────────────────────────────

const GraphView: Component<GraphViewProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let animFrame: number | null = null;
  let simNodes: GraphNode[] = [];
  let simEdges: GraphEdge[] = [];
  const [hoveredNode, setHoveredNode] = createSignal<GraphNode | null>(null);

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
    return d && d.nodes.length > 0;
  };

  // Initialize simulation when data arrives
  createEffect(() => {
    const data = graphQuery.data;
    if (!data || !canvasRef) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvasRef.width / dpr;
    const h = canvasRef.height / dpr;

    // Initialize node positions in a circle
    simNodes = data.nodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / data.nodes.length;
      const radius = Math.min(w, h) * 0.3;
      return {
        ...n,
        x: w / 2 + Math.cos(angle) * radius,
        y: h / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });
    simEdges = data.edges;

    startSimulation();
  });

  const startSimulation = () => {
    if (animFrame) cancelAnimationFrame(animFrame);
    let iterations = 0;
    const maxIterations = 300;

    const loop = () => {
      if (!canvasRef || iterations >= maxIterations) return;
      const dpr = window.devicePixelRatio || 1;
      tick(simNodes, simEdges, canvasRef.width / dpr, canvasRef.height / dpr);
      draw();
      iterations++;
      animFrame = requestAnimationFrame(loop);
    };
    loop();
  };

  const draw = () => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvasRef.width / dpr;
    const h = canvasRef.height / dpr;

    ctx.clearRect(0, 0, canvasRef.width, canvasRef.height);

    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

    // Draw edges
    for (const edge of simEdges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) continue;

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = edge.type === 'prerequisite' ? '#8b5cf6' : '#64748b40';
      ctx.lineWidth = edge.type === 'prerequisite' ? 2 : 1;
      if (edge.type === 'related') ctx.setLineDash([4, 4]);
      else ctx.setLineDash([]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw nodes
    const hovered = hoveredNode();
    for (const node of simNodes) {
      const isHovered = hovered?.id === node.id;
      const radius = isHovered ? 10 : 7;

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = retentionColor(node.retention);
      ctx.fill();
      ctx.strokeStyle = isHovered ? '#fff' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.stroke();

      // Label
      ctx.font = `${isHovered ? 'bold ' : ''}11px system-ui, sans-serif`;
      ctx.fillStyle = isHovered ? '#e2e8f0' : '#94a3b8';
      ctx.textAlign = 'center';
      ctx.fillText(
        node.label.length > 20 ? node.label.slice(0, 18) + '…' : node.label,
        node.x,
        node.y + radius + 14,
      );
    }
  };

  // Handle mouse hover for tooltips
  const handleMouseMove = (e: MouseEvent) => {
    if (!canvasRef) return;
    const rect = canvasRef.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let found: GraphNode | null = null;
    for (const node of simNodes) {
      const dx = node.x - mx;
      const dy = node.y - my;
      if (dx * dx + dy * dy < 200) {
        found = node;
        break;
      }
    }
    setHoveredNode(found);
    draw(); // Redraw with hover state
  };

  // Resize canvas (HiDPI-aware)
  onMount(() => {
    const resize = () => {
      if (!canvasRef?.parentElement) return;
      const parent = canvasRef.parentElement;
      const dpr = window.devicePixelRatio || 1;
      canvasRef.width = parent.clientWidth * dpr;
      canvasRef.height = parent.clientHeight * dpr;
      canvasRef.style.width = `${parent.clientWidth}px`;
      canvasRef.style.height = `${parent.clientHeight}px`;
      const ctx = canvasRef.getContext('2d');
      ctx?.scale(dpr, dpr);
      draw();
    };
    resize();
    window.addEventListener('resize', resize);
    onCleanup(() => window.removeEventListener('resize', resize));
  });

  onCleanup(() => {
    if (animFrame) cancelAnimationFrame(animFrame);
  });

  return (
    <Show
      when={!graphQuery.isLoading}
      fallback={<Skeleton shape="card" height="300px" />}
    >
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
            <div class="absolute z-10 bg-card border rounded-lg px-3 py-2 shadow-lg text-xs pointer-events-none m-4">
              <p class="font-semibold">{hoveredNode()!.label}</p>
              <p class="text-muted-foreground mt-0.5">
                Retention:{' '}
                {hoveredNode()!.retention !== null
                  ? `${Math.round(hoveredNode()!.retention! * 100)}%`
                  : 'N/A'}
              </p>
            </div>
          </Show>
          <div class="relative" style={{ height: '320px' }}>
            <canvas
              ref={canvasRef}
              class="w-full h-full cursor-crosshair"
              onMouseMove={handleMouseMove}
              onMouseLeave={() => {
                setHoveredNode(null);
                draw();
              }}
            />
          </div>
        </div>
      </Show>
    </Show>
  );
};

export default GraphView;
