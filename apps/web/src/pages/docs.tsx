import {
  type Component,
  createSignal,
  createResource,
  onMount,
  onCleanup,
  Show,
  For,
  Switch,
  Match,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { marked } from 'marked';
import Header from '@/components/layout/header';
import MobileNav from '@/components/layout/mobile-nav';
import {
  ArrowLeft,
  FileText,
  LayoutTemplate,
  Loader2,
  AlertCircle,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Move,
} from 'lucide-solid';

// ── Types ──────────────────────────────────────────────────────────────────

type TopTab = 'srs' | 'c4';

interface C4Diagram {
  id: string;
  label: string;
  level: string;
  url: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const TOP_TABS: { id: TopTab; label: string; icon: any }[] = [
  { id: 'srs', label: 'SRS Document', icon: FileText },
  { id: 'c4', label: 'C4 Architecture', icon: LayoutTemplate },
];

const C4_DIAGRAMS: C4Diagram[] = [
  {
    id: 'context',
    label: 'System Context',
    level: 'Level 1',
    url: '/docs/c4/01_context.svg',
  },
  {
    id: 'container',
    label: 'Containers',
    level: 'Level 2',
    url: '/docs/c4/02_container.svg',
  },
  {
    id: 'component-api',
    label: 'API Server',
    level: 'Level 3',
    url: '/docs/c4/03_component_api.svg',
  },
  {
    id: 'component-spa',
    label: 'Web SPA',
    level: 'Level 3',
    url: '/docs/c4/04_component_spa.svg',
  },
];

// ── Fetch helpers ──────────────────────────────────────────────────────────

async function fetchMarkdown(): Promise<string> {
  const res = await fetch('/docs/srs/srs.md');
  if (!res.ok) throw new Error('Failed to load SRS document');
  const md = await res.text();
  return marked.parse(md) as string;
}

async function fetchSvg(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('SVG not exported yet');
  const text = await res.text();
  // Detect placeholder (our placeholder SVGs contain this marker)
  if (text.includes('Export from Structurizr Lite')) {
    throw new Error('placeholder');
  }
  return text;
}

// ── Sub-components ─────────────────────────────────────────────────────────

const PlaceholderCard: Component<{ diagramLabel: string }> = (props) => (
  <div class="flex flex-col items-center justify-center py-20 px-8 text-center border-2 border-dashed border-border rounded-xl bg-muted/20">
    <div class="h-16 w-16 rounded-2xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center mb-4">
      <LayoutTemplate class="h-8 w-8 text-blue-500" />
    </div>
    <h3 class="text-base font-semibold text-foreground mb-1">
      {props.diagramLabel} — Not exported yet
    </h3>
    <p class="text-sm text-muted-foreground max-w-sm mb-6">
      Run the export command to generate SVG diagrams automatically.
    </p>
    <ol class="text-left text-sm text-muted-foreground space-y-2 max-w-md">
      <li class="flex gap-2">
        <span class="shrink-0 font-mono text-xs bg-muted px-1.5 py-0.5 rounded h-fit mt-0.5">
          1
        </span>
        <span>
          Run{' '}
          <code class="bg-muted px-1 rounded text-xs font-mono">
            bun run docs:export
          </code>{' '}
          to export all diagrams
        </span>
      </li>
      <li class="flex gap-2">
        <span class="shrink-0 font-mono text-xs bg-muted px-1.5 py-0.5 rounded h-fit mt-0.5">
          2
        </span>
        <span>Refresh this page</span>
      </li>
    </ol>
  </div>
);

// ── SVG Zoom+Pan Viewer ────────────────────────────────────────────────────

const SvgViewer: Component<{ svgContent: string }> = (props) => {
  let containerRef!: HTMLDivElement;

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 5;
  const ZOOM_STEP = 0.15;

  // Parse natural SVG dimensions from the raw SVG string
  const getNaturalSize = () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(props.svgContent, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return { w: 1200, h: 800 };
    const vb = svg.getAttribute('viewBox')?.split(' ').map(Number);
    const w = vb ? vb[2] : parseFloat(svg.getAttribute('width') || '1200');
    const h = vb ? vb[3] : parseFloat(svg.getAttribute('height') || '800');
    return { w: w || 1200, h: h || 800 };
  };

  const size = getNaturalSize();

  const initScale = () => {
    const cw = containerRef?.clientWidth ?? 900;
    return Math.min(1, (cw - 32) / size.w);
  };

  const [scale, setScale] = createSignal(0.8);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  let isDragging = false;
  let lastMouse = { x: 0, y: 0 };

  onMount(() => {
    setScale(initScale());
  });

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const zoom = (delta: number, originX?: number, originY?: number) => {
    const prevScale = scale();
    const nextScale = clampScale(prevScale + delta);
    if (nextScale === prevScale) return;

    // Zoom toward mouse cursor if origin provided
    if (originX !== undefined && originY !== undefined) {
      const rect = containerRef.getBoundingClientRect();
      const mouseX = originX - rect.left;
      const mouseY = originY - rect.top;
      const ratio = nextScale / prevScale;
      setPan((p) => ({
        x: mouseX - ratio * (mouseX - p.x),
        y: mouseY - ratio * (mouseY - p.y),
      }));
    }
    setScale(nextScale);
  };

  const resetView = () => {
    setScale(initScale());
    setPan({ x: 0, y: 0 });
  };

  // Fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef
        .requestFullscreen()
        .then(() => {
          setIsFullscreen(true);
          // In fullscreen the container is 100vw×100vh, re-fit
          const fs = initScale();
          setScale(fs);
          setPan({ x: 0, y: 0 });
        })
        .catch(() => {});
    } else {
      document.exitFullscreen();
    }
  };

  onMount(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    onCleanup(() => document.removeEventListener('fullscreenchange', handler));
  });

  // Mouse wheel zoom
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    zoom(delta, e.clientX, e.clientY);
  };

  // Drag to pan
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    isDragging = true;
    lastMouse = { x: e.clientX, y: e.clientY };
    containerRef.setPointerCapture(e.pointerId);
    containerRef.style.cursor = 'grabbing';
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    lastMouse = { x: e.clientX, y: e.clientY };
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  };
  const onPointerUp = () => {
    isDragging = false;
    containerRef.style.cursor = 'grab';
  };

  return (
    <div class="flex flex-col gap-2">
      {/* Toolbar */}
      <div class="flex items-center gap-1 justify-end">
        <span class="text-xs text-muted-foreground mr-2">
          {Math.round(scale() * 100)}%
        </span>
        <button
          onClick={() => zoom(-ZOOM_STEP)}
          title="Zoom out"
          class="h-7 w-7 flex items-center justify-center rounded border border-border hover:bg-accent transition-colors"
        >
          <ZoomOut class="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => zoom(ZOOM_STEP)}
          title="Zoom in"
          class="h-7 w-7 flex items-center justify-center rounded border border-border hover:bg-accent transition-colors"
        >
          <ZoomIn class="h-3.5 w-3.5" />
        </button>
        <button
          onClick={resetView}
          title="Fit to screen"
          class="h-7 w-7 flex items-center justify-center rounded border border-border hover:bg-accent transition-colors"
        >
          <Maximize2 class="h-3.5 w-3.5" />
        </button>
        <div class="w-px h-4 bg-border mx-1" />
        <button
          onClick={toggleFullscreen}
          title={isFullscreen() ? 'Exit fullscreen' : 'Fullscreen'}
          class="h-7 w-7 flex items-center justify-center rounded border border-border hover:bg-accent transition-colors"
        >
          {isFullscreen() ? (
            <Minimize2 class="h-3.5 w-3.5" />
          ) : (
            <Move class="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Canvas */}
      <div
        ref={(el) => (containerRef = el)}
        class="relative w-full rounded-xl border border-border bg-white dark:bg-muted/20 overflow-hidden select-none"
        style={{ height: isFullscreen() ? '100vh' : '600px', cursor: 'grab' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div
          style={{
            position: 'absolute',
            top: '0',
            left: '0',
            width: `${size.w}px`,
            height: `${size.h}px`,
            transform: `translate(${pan().x}px, ${pan().y}px) scale(${scale()})`,
            'transform-origin': '0 0',
            'will-change': 'transform',
          }}
          innerHTML={props.svgContent}
        />
        <p class="absolute bottom-2 right-3 text-[10px] text-muted-foreground/60 pointer-events-none select-none">
          Scroll to zoom · Drag to pan
        </p>
      </div>
    </div>
  );
};

const C4DiagramView: Component<{ diagram: C4Diagram }> = (props) => {
  const [svg] = createResource(() => props.diagram.url, fetchSvg);

  return (
    <Switch>
      <Match when={svg.loading}>
        <div class="flex items-center justify-center py-24 text-muted-foreground gap-2">
          <Loader2 class="h-5 w-5 animate-spin" />
          <span class="text-sm">Loading diagram…</span>
        </div>
      </Match>
      <Match when={svg.error}>
        <PlaceholderCard diagramLabel={props.diagram.label} />
      </Match>
      <Match when={svg()}>
        <SvgViewer svgContent={svg()!} />
      </Match>
    </Switch>
  );
};

// ── Main Page ──────────────────────────────────────────────────────────────

const DocsPage: Component = () => {
  const navigate = useNavigate();
  const [topTab, setTopTab] = createSignal<TopTab>('srs');
  const [c4Tab, setC4Tab] = createSignal(C4_DIAGRAMS[0].id);

  // SRS markdown — only fetched when SRS tab is active
  const [html] = createResource(
    () => topTab() === 'srs',
    (active) => (active ? fetchMarkdown() : Promise.resolve('')),
  );

  const activeDiagram = () => C4_DIAGRAMS.find((d) => d.id === c4Tab())!;

  return (
    <div class="h-screen flex flex-col">
      <Header />
      <MobileNav />
      <main class="flex-1 overflow-y-auto pb-mobile-nav">
        <div class="p-6 max-w-6xl mx-auto space-y-6">
          {/* ── Page header ── */}
          <div class="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              class="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <ArrowLeft class="h-4 w-4" />
            </button>
            <div>
              <h1 class="text-xl font-bold">Project Documentation</h1>
              <p class="text-sm text-muted-foreground">
                Live reference docs — Engram Spira
              </p>
            </div>
          </div>

          {/* ── Top tab bar ── */}
          <div class="flex gap-1 border-b">
            <For each={TOP_TABS}>
              {(tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    id={`docs-tab-${tab.id}`}
                    onClick={() => setTopTab(tab.id)}
                    class={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                      topTab() === tab.id
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                    }`}
                  >
                    <Icon class="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              }}
            </For>
          </div>

          {/* ── SRS Tab ── */}
          <Show when={topTab() === 'srs'}>
            <Switch>
              <Match when={html.loading}>
                <div class="flex items-center justify-center py-24 text-muted-foreground gap-2">
                  <Loader2 class="h-5 w-5 animate-spin" />
                  <span class="text-sm">Loading SRS document…</span>
                </div>
              </Match>
              <Match when={html.error}>
                <div class="flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive text-sm">
                  <AlertCircle class="h-4 w-4 shrink-0" />
                  Failed to load SRS document. Run{' '}
                  <code class="bg-destructive/10 px-1 rounded font-mono text-xs">
                    bun run docs:sync
                  </code>{' '}
                  to sync doc files.
                </div>
              </Match>
              <Match when={html()}>
                {/* Prose container — scoped markdown styles */}
                <article
                  class="
                    prose prose-sm dark:prose-invert max-w-none
                    prose-headings:font-semibold
                    prose-h1:text-2xl prose-h1:border-b prose-h1:pb-3
                    prose-h2:text-lg prose-h2:mt-8
                    prose-h3:text-base
                    prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                    prose-pre:bg-muted prose-pre:border prose-pre:rounded-xl
                    prose-table:border-collapse
                    prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-2 prose-th:bg-muted/50 prose-th:text-sm
                    prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2 prose-td:text-sm
                    prose-strong:text-foreground
                    prose-a:text-primary
                    prose-hr:border-border
                  "
                  innerHTML={html()}
                />
              </Match>
            </Switch>
          </Show>

          {/* ── C4 Architecture Tab ── */}
          <Show when={topTab() === 'c4'}>
            <div class="space-y-4">
              {/* Diagram sub-tab pills */}
              <div class="flex flex-wrap gap-2">
                <For each={C4_DIAGRAMS}>
                  {(d) => (
                    <button
                      id={`c4-subtab-${d.id}`}
                      onClick={() => setC4Tab(d.id)}
                      class={`flex flex-col items-start px-4 py-2 rounded-xl border text-left transition-all ${
                        c4Tab() === d.id
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/30'
                      }`}
                    >
                      <span class="text-xs font-medium">{d.level}</span>
                      <span class="text-sm font-semibold">{d.label}</span>
                    </button>
                  )}
                </For>
              </div>

              {/* Active diagram */}
              <div class="rounded-xl border bg-card p-2">
                <div class="px-3 py-2 mb-2 flex items-center justify-between">
                  <div>
                    <p class="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                      {activeDiagram().level}
                    </p>
                    <h2 class="text-sm font-semibold">
                      {activeDiagram().label}
                    </h2>
                  </div>
                  <span class="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                    C4 Model
                  </span>
                </div>
                <C4DiagramView diagram={activeDiagram()} />
              </div>
            </div>
          </Show>
        </div>
      </main>
    </div>
  );
};

export default DocsPage;
