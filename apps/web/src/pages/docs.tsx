import {
  type Component,
  createSignal,
  onMount,
  onCleanup,
  Show,
  For,
  Switch,
  Match,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { createQuery } from '@tanstack/solid-query';
import { marked } from 'marked';
import PageShell from '@/components/layout/page-shell';
import {
  ArrowLeft,
  FileText,
  LayoutTemplate,
  Database,
  Loader2,
  AlertCircle,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Move,
} from 'lucide-solid';

// ── Types ──────────────────────────────────────────────────────────────────

type TopTab = 'srs' | 'c4' | 'erd';

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
  { id: 'erd', label: 'ERD', icon: Database },
];

const ERD_URL = '/docs/erd/erd.svg';

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
  return sanitizeHtml(marked.parse(md) as string);
}

async function fetchSvg(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('SVG not exported yet');
  const text = await res.text();
  // Detect placeholder (our placeholder SVGs contain this marker)
  if (text.includes('Export from Structurizr Lite')) {
    throw new Error('placeholder');
  }
  return sanitizeSvg(text);
}

function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  doc
    .querySelectorAll('script, iframe, object, embed, link, meta')
    .forEach((el) => {
      el.remove();
    });

  const all = doc.body.querySelectorAll('*');
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === 'href' || name === 'src') &&
        value.startsWith('javascript:')
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }

  return doc.body.innerHTML;
}

function sanitizeSvg(svgText: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');

  doc.querySelectorAll('script').forEach((el) => el.remove());

  const all = doc.querySelectorAll('*');
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === 'href' || name === 'xlink:href') &&
        value.startsWith('javascript:')
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }

  const svg = doc.querySelector('svg');
  return svg ? svg.outerHTML : '';
}

// ── Sub-components ─────────────────────────────────────────────────────────

const PlaceholderCard: Component<{ diagramLabel: string }> = (props) => (
  <div class="flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 px-6 py-14 text-center">
    <div class="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border bg-card">
      <LayoutTemplate class="h-4 w-4 text-foreground" />
    </div>
    <h3 class="text-base font-semibold text-foreground">
      {props.diagramLabel} is not exported yet
    </h3>
    <p class="mb-6 mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
      Run the export command to generate SVG diagrams automatically.
    </p>
    <ol class="max-w-md space-y-2 text-left text-sm text-muted-foreground">
      <li class="flex gap-2">
        <span class="mt-0.5 h-fit shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          1
        </span>
        <span>
          Run{' '}
          <code class="rounded bg-muted px-1 font-mono text-xs">
            bun run docs:export
          </code>{' '}
          to export all diagrams
        </span>
      </li>
      <li class="flex gap-2">
        <span class="mt-0.5 h-fit shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
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

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoom(ZOOM_STEP);
    }
    if (e.key === '-') {
      e.preventDefault();
      zoom(-ZOOM_STEP);
    }
    if (e.key === '0') {
      e.preventDefault();
      resetView();
    }
  };

  return (
    <div class="flex flex-col gap-3">
      {/* Toolbar */}
      <div
        class="flex flex-wrap items-center justify-end gap-1"
        aria-label="Diagram controls"
      >
        <span class="mr-2 text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {Math.round(scale() * 100)}%
        </span>
        <button
          type="button"
          onClick={() => zoom(-ZOOM_STEP)}
          title="Zoom out"
          aria-label="Zoom out"
          class="flex h-8 w-8 items-center justify-center rounded-lg border border-border transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ZoomOut class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => zoom(ZOOM_STEP)}
          title="Zoom in"
          aria-label="Zoom in"
          class="flex h-8 w-8 items-center justify-center rounded-lg border border-border transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ZoomIn class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={resetView}
          title="Fit to screen"
          aria-label="Fit diagram to screen"
          class="flex h-8 w-8 items-center justify-center rounded-lg border border-border transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Maximize2 class="h-3.5 w-3.5" />
        </button>
        <div class="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen() ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={isFullscreen() ? 'Exit fullscreen' : 'Open fullscreen'}
          class="flex h-8 w-8 items-center justify-center rounded-lg border border-border transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Show
            when={isFullscreen()}
            fallback={<Move class="h-3.5 w-3.5" />}
          >
            <Minimize2 class="h-3.5 w-3.5" />
          </Show>
        </button>
      </div>

      {/* Canvas */}
      <div
        ref={(el) => (containerRef = el)}
        class="relative w-full select-none overflow-hidden rounded-xl border border-border bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          height: isFullscreen() ? '100dvh' : 'min(64dvh, 600px)',
          cursor: 'grab',
        }}
        tabindex={0}
        aria-label="Interactive diagram. Use the toolbar or keyboard controls to zoom and fit the view."
        onWheel={onWheel}
        onKeyDown={onKeyDown}
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
        <p class="pointer-events-none absolute bottom-2 right-3 select-none rounded bg-background/85 px-2 py-1 text-[10px] text-muted-foreground">
          Scroll to zoom · Drag to pan · 0 to reset
        </p>
      </div>
    </div>
  );
};

const C4DiagramView: Component<{ diagram: C4Diagram }> = (props) => {
  const svgQuery = createQuery(() => ({
    queryKey: ['c4-svg', props.diagram.url],
    queryFn: () => fetchSvg(props.diagram.url),
    retry: false,
  }));

  return (
    <Switch>
      <Match when={svgQuery.isLoading}>
        <div
          class="flex items-center justify-center gap-2 py-24 text-muted-foreground"
          aria-live="polite"
        >
          <Loader2 class="h-5 w-5 animate-spin" />
          <span class="text-sm">Loading diagram...</span>
        </div>
      </Match>
      <Match when={svgQuery.isError}>
        <PlaceholderCard diagramLabel={props.diagram.label} />
      </Match>
      <Match when={svgQuery.data}>
        <SvgViewer svgContent={svgQuery.data!} />
      </Match>
    </Switch>
  );
};

// ── Main Page ──────────────────────────────────────────────────────────────

const DocsPage: Component = () => {
  const navigate = useNavigate();
  const [topTab, setTopTab] = createSignal<TopTab>('srs');
  const [c4Tab, setC4Tab] = createSignal(C4_DIAGRAMS[0].id);

  // Fetch SRS markdown only while its tab is active.
  const htmlQuery = createQuery(() => ({
    queryKey: ['srs-markdown'],
    queryFn: fetchMarkdown,
    enabled: topTab() === 'srs',
    retry: false,
  }));
  const html = () => htmlQuery.data ?? '';

  const activeDiagram = () => C4_DIAGRAMS.find((d) => d.id === c4Tab())!;

  return (
    <PageShell maxWidth="max-w-6xl">
      <div class="animate-fade-in space-y-7">
        {/* ── Page header ── */}
        <header class="flex items-start gap-4 border-b pb-7">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Back to dashboard"
            class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft class="h-4 w-4" />
          </button>
          <div class="min-w-0">
            <p class="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Technical reference
            </p>
            <h1 class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Project documentation
            </h1>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Explore the study model, system architecture, and current database
              schema behind Engram Spira.
            </p>
          </div>
        </header>

        {/* ── Top tab bar ── */}
        <div
          class="grid gap-2 rounded-xl border bg-muted/35 p-1.5 sm:grid-cols-3"
          role="tablist"
          aria-label="Documentation sections"
        >
          <For each={TOP_TABS}>
            {(tab) => {
              const Icon = tab.icon;
              return (
                <button
                  type="button"
                  id={`docs-tab-${tab.id}`}
                  role="tab"
                  aria-selected={topTab() === tab.id}
                  aria-controls={`docs-panel-${tab.id}`}
                  onClick={() => setTopTab(tab.id)}
                  class={`flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    topTab() === tab.id
                      ? 'bg-foreground text-background shadow-xs'
                      : 'text-muted-foreground hover:bg-card hover:text-foreground'
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
          <section
            id="docs-panel-srs"
            role="tabpanel"
            aria-labelledby="docs-tab-srs"
          >
            <Switch>
              <Match when={htmlQuery.isLoading}>
                <div
                  class="flex items-center justify-center gap-2 rounded-xl border bg-card py-24 text-muted-foreground"
                  aria-live="polite"
                >
                  <Loader2 class="h-5 w-5 animate-spin" />
                  <span class="text-sm">Loading SRS document...</span>
                </div>
              </Match>
              <Match when={htmlQuery.isError}>
                <div
                  class="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
                  role="alert"
                >
                  <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    Failed to load SRS document. Run{' '}
                    <code class="rounded bg-destructive/10 px-1 font-mono text-xs">
                      bun run docs:sync
                    </code>{' '}
                    to sync doc files.
                  </p>
                </div>
              </Match>
              <Match when={html()}>
                {/* Prose container with scoped markdown styles. */}
                <article
                  class="
                    rounded-xl border bg-card p-5 shadow-xs sm:p-8
                    prose prose-sm max-w-none
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
                    prose-a:text-foreground prose-a:decoration-muted-foreground prose-a:underline-offset-4
                    prose-hr:border-border
                  "
                  innerHTML={html()}
                />
              </Match>
            </Switch>
          </section>
        </Show>

        {/* ── C4 Architecture Tab ── */}
        <Show when={topTab() === 'c4'}>
          <section
            id="docs-panel-c4"
            class="space-y-4"
            role="tabpanel"
            aria-labelledby="docs-tab-c4"
          >
            {/* Diagram sub-tab pills */}
            <div
              class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
              role="tablist"
              aria-label="C4 diagram level"
            >
              <For each={C4_DIAGRAMS}>
                {(d) => (
                  <button
                    type="button"
                    id={`c4-subtab-${d.id}`}
                    role="tab"
                    aria-selected={c4Tab() === d.id}
                    aria-controls="c4-diagram-panel"
                    onClick={() => setC4Tab(d.id)}
                    class={`flex flex-col items-start rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      c4Tab() === d.id
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                    }`}
                  >
                    <span
                      class={`text-xs font-medium ${
                        c4Tab() === d.id
                          ? 'text-background/70'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {d.level}
                    </span>
                    <span class="text-sm font-semibold">{d.label}</span>
                  </button>
                )}
              </For>
            </div>

            {/* Active diagram */}
            <div
              id="c4-diagram-panel"
              class="rounded-xl border bg-card p-3 shadow-xs sm:p-4"
              role="tabpanel"
              aria-labelledby={`c4-subtab-${activeDiagram().id}`}
            >
              <div class="mb-3 flex flex-col gap-2 border-b px-1 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p class="text-xs font-medium text-muted-foreground">
                    {activeDiagram().level}
                  </p>
                  <h2 class="mt-1 text-lg font-semibold tracking-tight">
                    {activeDiagram().label}
                  </h2>
                </div>
                <span class="w-fit rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                  C4 Model
                </span>
              </div>
              <C4DiagramView diagram={activeDiagram()} />
            </div>
          </section>
        </Show>

        {/* ── ERD Tab ── */}
        <Show when={topTab() === 'erd'}>
          <section
            id="docs-panel-erd"
            role="tabpanel"
            aria-labelledby="docs-tab-erd"
          >
            <div class="rounded-xl border bg-card p-3 shadow-xs sm:p-4">
              <div class="mb-3 flex flex-col gap-2 border-b px-1 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p class="text-xs font-medium text-muted-foreground">
                    Database Schema
                  </p>
                  <h2 class="mt-1 text-lg font-semibold tracking-tight">
                    Entity Relationship Diagram
                  </h2>
                </div>
                <span class="w-fit rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                  18 Tables
                </span>
              </div>
              {(() => {
                const erdQuery = createQuery(() => ({
                  queryKey: ['erd-svg'],
                  queryFn: () => fetchSvg(ERD_URL),
                  retry: false,
                }));
                return (
                  <Switch>
                    <Match when={erdQuery.isLoading}>
                      <div
                        class="flex items-center justify-center gap-2 py-24 text-muted-foreground"
                        aria-live="polite"
                      >
                        <Loader2 class="h-5 w-5 animate-spin" />
                        <span class="text-sm">Loading ERD...</span>
                      </div>
                    </Match>
                    <Match when={erdQuery.isError}>
                      <PlaceholderCard diagramLabel="ERD" />
                    </Match>
                    <Match when={erdQuery.data}>
                      <SvgViewer svgContent={erdQuery.data!} />
                    </Match>
                  </Switch>
                );
              })()}
            </div>
          </section>
        </Show>
      </div>
    </PageShell>
  );
};

export default DocsPage;
