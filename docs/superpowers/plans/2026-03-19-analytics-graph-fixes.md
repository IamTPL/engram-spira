# Analytics Graph & Logic Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Knowledge Graph UI (replace custom canvas with Cytoscape.js), fix prerequisite/duplicate logic overlap, and add graph auto-refresh after accepting relationships.

**Architecture:** Replace the custom force-directed canvas simulation in `graph-view.tsx` with Cytoscape.js (using COSE layout for stable, clustered positioning). Fix the backend `suggestedType` logic so embedding similarity alone doesn't determine prerequisite vs related. Add TanStack Query invalidation after relationship accept to auto-refresh the graph.

**Tech Stack:** Cytoscape.js, SolidJS, TanStack Solid Query, ElysiaJS

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/web/src/components/deck-view/graph-view.tsx` | **Rewrite** | Replace canvas simulation with Cytoscape.js |
| `apps/web/src/components/deck-view/ai-suggestions.tsx` | **Modify** | Add query invalidation after accept, default type selector |
| `apps/web/src/components/deck-view/duplicate-scanner.tsx` | **Modify** | Raise threshold from 0.85 to 0.95 |
| `apps/api/src/modules/knowledge-graph/kg-ai.service.ts` | **Modify** | Remove `sim > 0.85 = prerequisite` logic, default all to `related` |

---

## Chunk 1: Backend Logic Fix (Prerequisite/Duplicate Separation)

### Task 1: Fix Relationship Type Logic

**Files:**
- Modify: `apps/api/src/modules/knowledge-graph/kg-ai.service.ts:134`

The current logic `suggestedType: pair.sim > 0.85 ? 'prerequisite' : 'related'` incorrectly assigns prerequisite based on cosine similarity alone. Embedding similarity measures semantic closeness, NOT prerequisite ordering. All AI-detected relationships should default to `related` — user can change type when accepting.

- [ ] **Step 1: Change suggestedType to always return 'related'**

In `kg-ai.service.ts`, line ~134, change:
```typescript
// BEFORE (wrong — sim > 0.85 doesn't mean prerequisite)
suggestedType: pair.sim > 0.85 ? 'prerequisite' : 'related',

// AFTER — all AI suggestions default to 'related', user picks type
suggestedType: 'related',
```

- [ ] **Step 2: Verify the API response**

Run:
```bash
curl -s -c /tmp/c.txt -X POST http://localhost:3001/auth/login -H 'Content-Type: application/json' -d '{"email":"keane.chenn@gmail.com","password":"Ty030201@"}' > /dev/null && \
curl -s -b /tmp/c.txt -X POST http://localhost:3001/knowledge-graph/ai/detect -H 'Content-Type: application/json' -d '{"deckId":"5b5ca10d-5234-4e16-a259-32b6f94803f1","threshold":0.7}' | python3 -c "import json,sys; d=json.load(sys.stdin); [print(s['suggestedType']) for s in d['suggestions'][:5]]"
```
Expected: All output lines show `related` (no `prerequisite`)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/knowledge-graph/kg-ai.service.ts
git commit -m "fix(kg-ai): default all AI suggestions to 'related' type

Embedding cosine similarity measures semantic closeness, not
prerequisite ordering. Users should pick the type when accepting."
```

---

### Task 2: Raise Duplicate Detection Threshold

**Files:**
- Modify: `apps/web/src/components/deck-view/duplicate-scanner.tsx:32`

Current threshold 0.85 catches semantically similar but non-duplicate cards (e.g., "Attribute" ↔ "Signal" at 0.87). Raise to 0.95 to only flag near-identical content.

- [ ] **Step 1: Change threshold in frontend**

In `duplicate-scanner.tsx`, line ~32, change:
```typescript
// BEFORE
threshold: 0.85,

// AFTER — only flag near-identical texts
threshold: 0.95,
```

- [ ] **Step 2: Verify via curl**

```bash
curl -s -b /tmp/c.txt -X POST http://localhost:3001/ai/deck-duplicates -H 'Content-Type: application/json' -d '{"deckId":"5b5ca10d-5234-4e16-a259-32b6f94803f1","threshold":0.95}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Pairs at 0.95: {len(d[\"pairs\"])}')"
```
Expected: Fewer pairs than before (probably 0-3 instead of 15)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/deck-view/duplicate-scanner.tsx
git commit -m "fix(duplicates): raise threshold to 0.95 to avoid false positives

Previous 0.85 threshold flagged semantically similar but non-duplicate
cards (e.g., 'Attribute' and 'Signal' at 87%)."
```

---

## Chunk 2: Graph Refresh After Accept

### Task 3: Add Query Invalidation After Accepting Relationships

**Files:**
- Modify: `apps/web/src/components/deck-view/ai-suggestions.tsx:1,53-65`

After `handleAccept` creates a link, the Knowledge Graph query must be invalidated so TanStack Query refetches the graph data.

- [ ] **Step 1: Import queryClient**

At top of `ai-suggestions.tsx`, add:
```typescript
import { queryClient } from '@/lib/query-client';
```

- [ ] **Step 2: Invalidate graph query after successful accept**

In `handleAccept`, after `setSuggestions(...)` at line ~64, add:
```typescript
// Refresh the Knowledge Graph so new edges appear immediately
queryClient.invalidateQueries({ queryKey: ['deck-graph'] });
```

- [ ] **Step 3: Test — accept a relationship and verify graph refreshes**

On the browser: 
1. Open deck → Analytics → AI Detect Relationships
2. Accept one suggestion  
3. Expected: Knowledge Graph component re-renders with the new edge (no manual page reload needed)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/deck-view/ai-suggestions.tsx
git commit -m "fix(graph): refresh knowledge graph after accepting relationship

Invalidate deck-graph query after creating a link so the graph
re-renders with the new edge immediately."
```

---

## Chunk 3: Replace Canvas Graph With Cytoscape.js

### Task 4: Install Cytoscape.js

**Files:**
- Modify: `apps/web/package.json` (via npm)

- [ ] **Step 1: Install cytoscape**

```bash
cd apps/web && npm install cytoscape && cd ../..
```

- [ ] **Step 2: Install types**

```bash
cd apps/web && npm install -D @types/cytoscape && cd ../..
```

- [ ] **Step 3: Verify install**

```bash
grep cytoscape apps/web/package.json
```
Expected: `"cytoscape": "^3.x.x"` in dependencies

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json
git commit -m "chore: add cytoscape.js for knowledge graph visualization"
```

---

### Task 5: Rewrite graph-view.tsx with Cytoscape.js

**Files:**
- Rewrite: `apps/web/src/components/deck-view/graph-view.tsx`

Replace the entire custom canvas force simulation with Cytoscape.js. Key improvements:
- **COSE layout**: Stable, deterministic node placement with cluster formation
- **No animation chaos**: Layout computes once, no continuous force simulation
- **Proper interaction**: Pan/zoom, click node highlights edges, hover tooltip
- **Clean styling**: Node color = retention, edge style = relationship type

- [ ] **Step 1: Rewrite graph-view.tsx**

Replace the ENTIRE file content with the Cytoscape.js implementation:

```tsx
import {
  type Component,
  Show,
  createEffect,
  onCleanup,
  onMount,
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
      // Destroy previous instance if data became empty
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
            'line-color': '#64748b40',
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
      // Interaction settings
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
      {/* Empty state */}
      <Show when={hasNodesButNoEdges()}>
        <div class="rounded-xl border bg-card p-6 text-center">
          <Network class="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p class="text-sm font-medium">No relationships yet</p>
          <p class="text-xs text-muted-foreground mt-1">
            Use &ldquo;AI Detect Relationships&rdquo; below to discover connections between your cards.
          </p>
        </div>
      </Show>
      {/* Full graph */}
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
```

- [ ] **Step 2: Test on browser**

Open `http://localhost:3002/deck/5b5ca10d-5234-4e16-a259-32b6f94803f1`, toggle Analytics on:
- Knowledge Graph should render with Cytoscape.js COSE layout
- Nodes should be stable (no jumping on hover)
- Pan/zoom should work (drag to pan, scroll to zoom)
- Click a node → highlights connected edges
- Hover node → tooltip shows label and retention

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/deck-view/graph-view.tsx
git commit -m "feat(graph): replace custom canvas with Cytoscape.js

- COSE layout for stable, clustered node positioning
- Pan/zoom, click-to-highlight, hover tooltips
- Prerequisite edges show as solid purple with arrows
- Related edges show as dashed gray
- No more animation chaos on mouse movement"
```

---

## Verification Checklist

After all tasks complete, verify:

- [ ] Knowledge Graph renders with stable COSE layout (no jumping nodes)
- [ ] Pan/zoom works in the graph
- [ ] Hover tooltip shows card label + retention
- [ ] Click node highlights connected edges
- [ ] AI Detect Relationships returns all types as `related`
- [ ] Accept a relationship → graph auto-refreshes with new edge
- [ ] Check Duplicates at threshold 0.95 shows fewer/zero false positives
- [ ] "Attribute ↔ Signal" no longer appears as duplicate
