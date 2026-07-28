import {
  type Component,
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { useNavigate } from '@solidjs/router';
import cytoscape, {
  type Core,
  type EdgeSingular,
  type NodeSingular,
} from 'cytoscape';
import dagre from 'cytoscape-dagre';
import fcose from 'cytoscape-fcose';
import {
  ArrowRight,
  BookOpen,
  Check,
  Compass,
  ExternalLink,
  GitCompareArrows,
  List,
  Maximize2,
  Network,
  Plus,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-solid';

import { api, getApiError } from '@/api/client';
import { createAnimationFrameScheduler } from '@/lib/create-animation-frame-scheduler';
import { queryClient } from '@/lib/query-client';
import { resolvedTheme } from '@/stores/theme.store';
import { toast } from '@/stores/toast.store';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import Skeleton from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  buildStudyClusterHref,
  buildVocabularyCardFieldValues,
  capVisibleKnowledgeGraph,
  createExplorerState,
  attachCreatedCardToExplorer,
  describeKnowledgeGraphLoadError,
  filterExplorerByGroups,
  formatRetention,
  knowledgeGraphAnimationEnabled,
  knowledgeGraphCaps,
  knowledgeGraphKeys,
  limitNeighborhoodExpansion,
  mergeNeighborhood,
  parsePendingSenseMappings,
  rankLearnNextCandidates,
  registerPendingSenseMapping,
  removePendingSenseMapping,
  serializePendingSenseMappings,
  selectKnowledgeGraphLayout,
  toggleCardInStudyCluster,
  type KnowledgeGraphEdge,
  type KnowledgeGraphExplorerState,
  type KnowledgeGraphNode,
  type NeighborhoodResponse,
  type PendingSenseMappings,
  type RelationGroup,
  type RelationType,
  type VocabularyTemplateField,
} from './knowledge-graph-state';

cytoscape.use(dagre);
cytoscape.use(fcose);

const ALL_RELATION_GROUPS: RelationGroup[] = [
  'meaning',
  'hierarchy',
  'form',
  'usage',
];

const GROUP_LABELS: Record<RelationGroup, string> = {
  meaning: 'Meaning',
  hierarchy: 'Hierarchy',
  form: 'Word form',
  usage: 'Usage',
};

const RELATION_LABELS: Record<RelationType, string> = {
  synonym: 'synonym of',
  antonym: 'antonym of',
  is_a: 'is a',
  part_of: 'part of',
  derived_from: 'derived from',
  collocation: 'used with',
  confused_with: 'confused with',
  translation_of: 'translation of',
  coordinate: 'related category',
};

interface FocusedKnowledgeGraphProps {
  deckId: string;
  rootCardId: string;
  templateFields: VocabularyTemplateField[];
  onViewCard?: (cardId: string) => void;
  onCardsChanged?: () => void | Promise<void>;
  onRunCreated?: (runId: string) => void;
}

interface GraphColors {
  background: string;
  border: string;
  destructive: string;
  foreground: string;
  info: string;
  muted: string;
  primary: string;
  success: string;
  warning: string;
}

interface NodeDetailProps {
  node: KnowledgeGraphNode;
  root: KnowledgeGraphNode;
  relationship: KnowledgeGraphEdge | null;
  cardId: string | null;
  pendingMappingCardId: string | null;
  comparing: boolean;
  expanded: boolean;
  expanding: boolean;
  addingToDeck: boolean;
  discovering: boolean;
  canExpand: boolean;
  canAddToDeck: boolean;
  cluster: string[];
  rootCardId: string;
  onCompare: () => void;
  onExpand: () => void;
  onAddToDeck: () => void;
  onRetryMapping: () => void;
  onDiscover: () => void;
  onToggleStudy: () => void;
  onViewCard?: (cardId: string) => void;
}

function readSemanticColor(name: string): string {
  const styles = getComputedStyle(document.documentElement);
  return (
    styles.getPropertyValue(name).trim() ||
    styles.getPropertyValue('--color-foreground').trim()
  );
}

function graphColors(): GraphColors {
  return {
    background: readSemanticColor('--color-background'),
    border: readSemanticColor('--color-border'),
    destructive: readSemanticColor('--color-destructive'),
    foreground: readSemanticColor('--color-foreground'),
    info: readSemanticColor('--color-info'),
    muted: readSemanticColor('--color-muted-foreground'),
    primary: readSemanticColor('--color-primary'),
    success: readSemanticColor('--color-success'),
    warning: readSemanticColor('--color-warning'),
  };
}

function retentionColor(
  retention: number | null,
  colors: GraphColors,
): string {
  if (retention === null) return colors.muted;
  if (retention >= 0.8) return colors.success;
  if (retention >= 0.6) return colors.warning;
  return colors.destructive;
}

function dueText(dueAt: string | null): string {
  if (!dueAt) return 'No review scheduled';
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return 'Review date unavailable';
  return `Due ${date.toLocaleDateString()}`;
}

function pendingMappingStorageKey(deckId: string): string {
  return `kg-v2-pending-sense-mappings:${deckId}`;
}

function storedPendingSenseMappings(deckId: string): PendingSenseMappings {
  if (typeof sessionStorage === 'undefined') return {};
  return parsePendingSenseMappings(
    sessionStorage.getItem(pendingMappingStorageKey(deckId)),
  );
}

function storePendingSenseMappings(
  deckId: string,
  mappings: PendingSenseMappings,
): void {
  if (typeof sessionStorage === 'undefined') return;
  const key = pendingMappingStorageKey(deckId);
  if (Object.keys(mappings).length === 0) {
    sessionStorage.removeItem(key);
    return;
  }
  sessionStorage.setItem(key, serializePendingSenseMappings(mappings));
}

function NodeSummary(props: {
  node: KnowledgeGraphNode;
  label: string;
}) {
  return (
    <section class="rounded-lg border bg-surface p-3">
      <p class="text-xs font-medium text-muted-foreground">{props.label}</p>
      <p class="mt-1 text-base font-semibold text-foreground">
        {props.node.label}
      </p>
      <p class="mt-0.5 text-xs text-muted-foreground">
        {props.node.partOfSpeech} in {props.node.languageTag}
      </p>
      <p class="mt-2 text-sm leading-relaxed text-foreground">
        {props.node.definition}
      </p>
      <p class="mt-2 text-xs text-muted-foreground">
        {formatRetention(props.node.retention)}, {dueText(props.node.dueAt)}
      </p>
    </section>
  );
}

const NodeDetail: Component<NodeDetailProps> = (props) => {
  const isRoot = () => props.node.id === props.root.id;
  const existingCardId = () =>
    props.cardId ?? props.pendingMappingCardId;
  const isInCluster = () =>
    props.cardId !== null && props.cluster.includes(props.cardId);
  const canToggleStudy = () =>
    props.cardId !== null && props.node.inCurrentDeck;
  const clusterIsFull = () =>
    props.cluster.length >= 12 && !isInCluster();

  return (
    <div class="space-y-4">
      <div>
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 class="text-lg font-semibold text-foreground">
              {props.node.label}
            </h4>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {props.node.partOfSpeech} in {props.node.languageTag}
            </p>
          </div>
          <span class="rounded-md border bg-surface px-2 py-1 text-xs font-medium text-muted-foreground">
            {formatRetention(props.node.retention)}
          </span>
        </div>
        <p class="mt-3 text-sm leading-relaxed text-foreground">
          {props.node.definition}
        </p>
        <p class="mt-2 text-xs text-muted-foreground">
          {dueText(props.node.dueAt)}
        </p>
      </div>

      <Show when={props.relationship}>
        {(relationship) => (
          <div class="rounded-lg border bg-surface px-3 py-2.5">
            <p class="text-xs font-semibold text-foreground">
              {GROUP_LABELS[relationship().group]} connection
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              {RELATION_LABELS[relationship().type]}
              <Show when={relationship().origin === 'ai'}>
                {' '}suggested by AI and accepted
              </Show>
              <Show when={relationship().confidenceBand}>
                {(confidenceBand) => (
                  <> · {confidenceBand()} verifier confidence</>
                )}
              </Show>
            </p>
            <Show when={relationship().evidence}>
              <p class="mt-2 text-xs leading-relaxed text-foreground">
                Evidence: {relationship().evidence}
              </p>
            </Show>
          </div>
        )}
      </Show>

      <Show when={props.comparing && !isRoot()}>
        <div class="grid gap-3 sm:grid-cols-2">
          <NodeSummary node={props.root} label="Root word" />
          <NodeSummary node={props.node} label="Selected word" />
        </div>
      </Show>

      <div class="grid gap-2 sm:grid-cols-2">
        <Button
          variant="outline"
          class="min-h-11"
          disabled={isRoot()}
          onClick={props.onCompare}
        >
          <GitCompareArrows class="h-4 w-4" />
          {props.comparing ? 'Hide comparison' : 'Compare with root'}
        </Button>
        <Button
          variant="outline"
          class="min-h-11"
          disabled={
            isRoot() ||
            props.cardId === null ||
            props.expanded ||
            !props.canExpand
          }
          loading={props.expanding}
          onClick={props.onExpand}
          title={
            props.canExpand
              ? undefined
              : 'Enable at least one relationship filter to expand'
          }
        >
          <Plus class="h-4 w-4" />
          {props.expanded ? 'One hop expanded' : 'Expand one hop'}
        </Button>
        <Show when={existingCardId() !== null && props.onViewCard}>
          <Button
            variant="outline"
            class="min-h-11"
            data-kg-node-action="view-card"
            data-kg-sense-id={props.node.id}
            onClick={() => props.onViewCard?.(existingCardId()!)}
          >
            <ExternalLink class="h-4 w-4" />
            View existing card
          </Button>
        </Show>
        <Show
          when={
            props.cardId === null &&
            props.pendingMappingCardId === null
          }
        >
          <Button
            variant="outline"
            class="min-h-11"
            loading={props.addingToDeck}
            disabled={isRoot() || !props.canAddToDeck || props.addingToDeck}
            data-kg-node-action="add-card"
            data-kg-sense-id={props.node.id}
            onClick={props.onAddToDeck}
            title={
              props.canAddToDeck
                ? undefined
                : 'This action requires a vocabulary template with word and definition fields'
            }
          >
            <Plus class="h-4 w-4" />
            Add to this deck
          </Button>
        </Show>
        <Show
          when={
            props.cardId === null &&
            props.pendingMappingCardId !== null
          }
        >
          <Button
            variant="outline"
            class="min-h-11 border-warning/40 text-warning"
            loading={props.addingToDeck}
            disabled={props.addingToDeck}
            data-kg-node-action="retry-mapping"
            data-kg-sense-id={props.node.id}
            onClick={props.onRetryMapping}
            title="The card exists in this deck, but its lexical sense still needs to be linked"
          >
            <Network class="h-4 w-4" />
            Retry lexical link
          </Button>
        </Show>
        <Button
          variant="outline"
          class="min-h-11"
          disabled={!canToggleStudy() || isRoot() || clusterIsFull()}
          onClick={props.onToggleStudy}
          title={
            clusterIsFull()
              ? 'Study clusters can contain up to 12 cards'
              : undefined
          }
        >
          <Show
            when={isInCluster()}
            fallback={<BookOpen class="h-4 w-4" />}
          >
            <Check class="h-4 w-4" />
          </Show>
          {isRoot()
            ? 'Root stays in cluster'
            : isInCluster()
              ? 'Remove from cluster'
              : 'Add to study cluster'}
        </Button>
        <Button
          variant="outline"
          class="min-h-11 sm:col-span-2"
          loading={props.discovering}
          disabled={props.discovering}
          onClick={props.onDiscover}
        >
          <Compass class="h-4 w-4" />
          Discover related words
        </Button>
      </div>
    </div>
  );
};

const FocusedKnowledgeGraph: Component<FocusedKnowledgeGraphProps> = (props) => {
  let graphContainer: HTMLDivElement | undefined;
  let cy: Core | null = null;
  let hydratedResponse: NeighborhoodResponse | undefined;
  const navigate = useNavigate();
  const scheduleAnimationFrame = createAnimationFrameScheduler();

  const [explorer, setExplorer] =
    createSignal<KnowledgeGraphExplorerState | null>(null);
  const [enabledGroups, setEnabledGroups] = createSignal<RelationGroup[]>([
    ...ALL_RELATION_GROUPS,
  ]);
  const [selectedSenseId, setSelectedSenseId] = createSignal('');
  const [expandedSenseIds, setExpandedSenseIds] = createSignal<string[]>([]);
  const [expandingSenseId, setExpandingSenseId] = createSignal<string | null>(
    null,
  );
  const [addingSenseId, setAddingSenseId] = createSignal<string | null>(null);
  const [pendingMappingsDeckId, setPendingMappingsDeckId] = createSignal(
    props.deckId,
  );
  const [pendingSenseMappings, setPendingSenseMappings] =
    createSignal<PendingSenseMappings>(
      storedPendingSenseMappings(props.deckId),
    );
  const [discoveringSenseId, setDiscoveringSenseId] = createSignal<
    string | null
  >(null);
  const [studyCluster, setStudyCluster] = createSignal<string[]>([
    props.rootCardId,
  ]);
  const [comparing, setComparing] = createSignal(false);
  const [mobileView, setMobileView] = createSignal<'list' | 'graph'>('list');
  const [detailOpen, setDetailOpen] = createSignal(false);
  const [liveMessage, setLiveMessage] = createSignal('');
  const [cyRevision, setCyRevision] = createSignal(0);
  const [isMobile, setIsMobile] = createSignal(
    typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 767px)').matches,
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = createSignal(
    typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const fetchNeighborhood = async (
    cardId: string,
    groups: RelationGroup[],
    limit: number,
  ): Promise<NeighborhoodResponse> => {
    const { data, error } = await api['knowledge-graph']
      .cards({ id: cardId })
      .neighborhood.get({
      query: {
        groups: groups.join(','),
        limit,
      },
    });
    if (error || !data) {
      throw new Error(
        error ? getApiError(error) : 'Neighborhood data is unavailable',
      );
    }
    return data as NeighborhoodResponse;
  };

  const rootQuery = createQuery(() => ({
    queryKey: knowledgeGraphKeys.neighborhood(
      props.rootCardId,
      ALL_RELATION_GROUPS,
    ),
    queryFn: () =>
      fetchNeighborhood(props.rootCardId, ALL_RELATION_GROUPS, 24),
    enabled: Boolean(props.rootCardId),
    staleTime: 2 * 60_000,
  }));

  createEffect(
    on(
      () => props.rootCardId,
      (rootCardId) => {
        hydratedResponse = undefined;
        batch(() => {
          setExplorer(null);
          setSelectedSenseId('');
          setExpandedSenseIds([]);
          setAddingSenseId(null);
          setDiscoveringSenseId(null);
          setStudyCluster([rootCardId]);
          setComparing(false);
          setDetailOpen(false);
          setEnabledGroups([...ALL_RELATION_GROUPS]);
          setMobileView('list');
        });
      },
    ),
  );

  createEffect(() => {
    const deckId = props.deckId;
    if (pendingMappingsDeckId() === deckId) return;
    setPendingMappingsDeckId(deckId);
    setPendingSenseMappings(storedPendingSenseMappings(deckId));
  });

  createEffect(() => {
    const response = rootQuery.data;
    const rootCardId = props.rootCardId;
    if (!response || !response.focus.mappedCardIds.includes(rootCardId)) {
      return;
    }
    if (response === hydratedResponse) return;
    hydratedResponse = response;
    const next = createExplorerState(response);
    batch(() => {
      setExplorer({ ...next, rootCardId });
      setSelectedSenseId(response.focus.id);
      setStudyCluster([rootCardId]);
      setLiveMessage(
        `Loaded ${response.nodes.length} words and ${response.edges.length} relationships`,
      );
    });
  });

  onMount(() => {
    const mobileMedia = window.matchMedia('(max-width: 767px)');
    const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMobile = () => setIsMobile(mobileMedia.matches);
    const syncMotion = () => setPrefersReducedMotion(motionMedia.matches);
    syncMobile();
    syncMotion();
    mobileMedia.addEventListener('change', syncMobile);
    motionMedia.addEventListener('change', syncMotion);
    onCleanup(() => {
      mobileMedia.removeEventListener('change', syncMobile);
      motionMedia.removeEventListener('change', syncMotion);
    });
  });

  const rootNode = createMemo(() => {
    const state = explorer();
    return state?.nodes.find((node) => node.id === state.rootSenseId) ?? null;
  });

  const rootLoadError = createMemo(() =>
    describeKnowledgeGraphLoadError(rootQuery.error),
  );

  const selectedNode = createMemo(() => {
    const state = explorer();
    return (
      state?.nodes.find((node) => node.id === selectedSenseId()) ??
      rootNode()
    );
  });

  const selectedRelationship = createMemo(() => {
    const state = explorer();
    const node = selectedNode();
    if (!state || !node || node.id === state.rootSenseId) return null;
    return (
      state.edges.find(
        (edge) =>
          (edge.source === state.rootSenseId && edge.target === node.id) ||
          (edge.target === state.rootSenseId && edge.source === node.id),
      ) ?? null
    );
  });

  const selectedCardId = createMemo(() => {
    const state = explorer();
    const node = selectedNode();
    if (!state || !node || !node.inCurrentDeck) return null;
    if (node.id === state.rootSenseId) return props.rootCardId;
    return node.mappedCardIds[0] ?? null;
  });

  const selectedPendingMappingCardId = createMemo(() => {
    const node = selectedNode();
    return node ? pendingSenseMappings()[node.id] ?? null : null;
  });

  const visibleGraph = createMemo(() => {
    const state = explorer();
    if (!state) return { nodes: [], edges: [], truncated: false };
    const filtered = filterExplorerByGroups(state, enabledGroups());
    const capped = capVisibleKnowledgeGraph(
      filtered,
      state.rootSenseId,
      knowledgeGraphCaps(isMobile()),
    );
    return {
      ...capped,
      truncated: state.truncated || capped.truncated,
    };
  });

  const nodeById = createMemo(
    () =>
      new Map(
        visibleGraph().nodes.map((node) => [node.id, node] as const),
      ),
  );

  const graphLayout = createMemo(() =>
    selectKnowledgeGraphLayout(enabledGroups()),
  );

  const learnNextCandidate = createMemo(
    () =>
      rankLearnNextCandidates(
        visibleGraph(),
        explorer()?.rootSenseId ?? '',
      )[0] ?? null,
  );

  const canvasEnabled = () => !isMobile() || mobileView() === 'graph';

  const selectNode = (senseId: string) => {
    if (!explorer()?.nodes.some((node) => node.id === senseId)) return;
    batch(() => {
      setSelectedSenseId(senseId);
      setComparing(false);
      if (isMobile()) setDetailOpen(true);
    });
  };

  const toggleGroup = (group: RelationGroup) => {
    setEnabledGroups((current) =>
      current.includes(group)
        ? current.filter((item) => item !== group)
        : ALL_RELATION_GROUPS.filter(
            (item) => item === group || current.includes(item),
          ),
    );
  };

  const edgesForGroup = (group: RelationGroup) =>
    visibleGraph().edges.filter((edge) => edge.group === group);

  const expandSelected = async () => {
    const state = explorer();
    const node = selectedNode();
    const cardId = selectedCardId();
    const groups = enabledGroups();
    if (
      !state ||
      !node ||
      !cardId ||
      node.id === state.rootSenseId ||
      groups.length === 0 ||
      expandingSenseId() !== null
    ) {
      return;
    }

    setExpandingSenseId(node.id);
    try {
      const response = await queryClient.fetchQuery({
        queryKey: knowledgeGraphKeys.neighborhood(cardId, groups),
        queryFn: () => fetchNeighborhood(cardId, groups, 24),
        staleTime: 2 * 60_000,
      });
      const currentState = explorer();
      if (
        !currentState ||
        currentState.rootSenseId !== state.rootSenseId
      ) {
        return;
      }
      const storageLimits = knowledgeGraphCaps(false);
      const displayLimits = knowledgeGraphCaps(isMobile());
      const limitedResponse = limitNeighborhoodExpansion(
        response,
        new Set(currentState.nodes.map((item) => item.id)),
        12,
      );
      let mergedNodeCount = currentState.nodes.length;
      setExplorer((current) => {
        if (!current || current.rootSenseId !== state.rootSenseId) {
          return current;
        }
        const next = mergeNeighborhood(
          current,
          limitedResponse,
          storageLimits,
        );
        mergedNodeCount = next.nodes.length;
        return next;
      });
      setExpandedSenseIds((current) =>
        current.includes(node.id) ? current : [...current, node.id],
      );
      setLiveMessage(
        `Expanded ${node.label}. Showing ${Math.min(
          displayLimits.nodeCap,
          mergedNodeCount,
        )} words`,
      );
    } catch (error) {
      setLiveMessage(
        error instanceof Error
          ? `Could not expand ${node.label}: ${error.message}`
          : `Could not expand ${node.label}`,
      );
    } finally {
      setExpandingSenseId(null);
    }
  };

  const toggleSelectedStudyCard = () => {
    const cardId = selectedCardId();
    if (!cardId) return;
    setStudyCluster((current) =>
      toggleCardInStudyCluster(current, cardId, props.rootCardId),
    );
  };

  const updatePendingSenseMappings = (
    update: (current: PendingSenseMappings) => PendingSenseMappings,
  ) => {
    setPendingSenseMappings((current) => {
      const next = update(current);
      storePendingSenseMappings(pendingMappingsDeckId(), next);
      return next;
    });
  };

  const addSelectedToDeck = async () => {
    const state = explorer();
    const node = selectedNode();
    if (!state || !node || selectedCardId() || addingSenseId() !== null) {
      return;
    }
    const fieldValues = buildVocabularyCardFieldValues(
      node,
      props.templateFields,
    );
    if (!fieldValues) return;

    setAddingSenseId(node.id);
    let createdCardId: string | null = null;
    try {
      const { data, error } = await api.cards['by-deck']({
        deckId: props.deckId,
      }).post({ fieldValues });
      if (error || !data || typeof data.id !== 'string') {
        throw new Error(error ? getApiError(error) : 'Card could not be created');
      }
      createdCardId = data.id;
      updatePendingSenseMappings((current) =>
        registerPendingSenseMapping(current, node.id, createdCardId!),
      );
      await mapCardToSense(node, createdCardId);
    } catch (error) {
      toast.error(
        createdCardId
          ? 'The card was created. Retry its lexical link without creating another card.'
          : error instanceof Error
            ? error.message
            : 'Could not add this vocabulary card',
      );
      if (createdCardId) await Promise.resolve(props.onCardsChanged?.());
      focusNodeAction(node.id, 'retry-mapping');
    } finally {
      setAddingSenseId(null);
    }
  };

  const focusNodeAction = (
    senseId: string,
    action: 'retry-mapping' | 'view-card',
  ) => {
    scheduleAnimationFrame(() => {
      const candidates = document.querySelectorAll<HTMLElement>(
        `[data-kg-sense-id="${senseId}"][data-kg-node-action="${action}"]`,
      );
      const visible = [...candidates].find(
        (element) => element.getClientRects().length > 0,
      );
      (visible ?? candidates[0])?.focus({ preventScroll: true });
    });
  };

  const mapCardToSense = async (
    node: KnowledgeGraphNode,
    cardId: string,
  ) => {
    const mapping = await api['knowledge-graph']
      .cards({ id: cardId })
      .senses({ senseId: node.id })
      .post();
    if (mapping.error) throw new Error(getApiError(mapping.error));

    setExplorer((current) =>
      current
        ? attachCreatedCardToExplorer(current, node.id, cardId)
        : current,
    );
    updatePendingSenseMappings((current) =>
      removePendingSenseMapping(current, node.id),
    );
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: knowledgeGraphKeys.all }),
      Promise.resolve(props.onCardsChanged?.()),
    ]);
    setLiveMessage(`${node.label} was added and linked to this deck`);
    toast.success(`${node.label} added to this deck`);
    focusNodeAction(node.id, 'view-card');
  };

  const retrySelectedMapping = async () => {
    const node = selectedNode();
    const cardId = selectedPendingMappingCardId();
    if (!node || !cardId || addingSenseId() !== null) return;

    setAddingSenseId(node.id);
    try {
      await mapCardToSense(node, cardId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'The lexical sense could not be linked yet',
      );
      focusNodeAction(node.id, 'retry-mapping');
    } finally {
      setAddingSenseId(null);
    }
  };

  const discoverSelected = async () => {
    const node = selectedNode();
    if (!node || discoveringSenseId() !== null) return;
    setDiscoveringSenseId(node.id);
    try {
      const { data, error } = await api['knowledge-graph']
        .senses({ senseId: node.id })['expansion-runs']
        .post();
      if (error || !data || typeof data.runId !== 'string') {
        throw new Error(
          error ? getApiError(error) : 'Discovery run could not be started',
        );
      }
      props.onRunCreated?.(data.runId);
      setLiveMessage(`Discovering related vocabulary for ${node.label}`);
      toast.info(
        data.reused
          ? `Reusing related-word discovery for ${node.label}`
          : `Related-word discovery queued for ${node.label}`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not discover related vocabulary',
      );
    } finally {
      setDiscoveringSenseId(null);
    }
  };

  const startStudyCluster = () => {
    navigate(
      buildStudyClusterHref(
        props.deckId,
        studyCluster(),
        props.rootCardId,
      ),
    );
  };

  const selectLearnNext = () => {
    const candidate = learnNextCandidate();
    if (!candidate) return;
    selectNode(candidate.node.id);
    setLiveMessage(
      `${candidate.node.label} is ranked next through its ${RELATION_LABELS[candidate.edge.type]} connection`,
    );
  };

  createEffect(() => {
    resolvedTheme();
    const graph = visibleGraph();
    const layoutName = graphLayout();
    const shouldRender = canvasEnabled();
    const reduceMotion = prefersReducedMotion();
    const rootSenseId = explorer()?.rootSenseId;
    const container = graphContainer;

    if (!shouldRender || !rootSenseId || !container || graph.nodes.length === 0) {
      if (cy) {
        cy.destroy();
        cy = null;
      }
      return;
    }

    const colors = graphColors();
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const animate = knowledgeGraphAnimationEnabled(
      graph.nodes.length,
      reduceMotion,
    );
    const elements = [
      ...graph.nodes.map((node) => ({
        data: {
          id: node.id,
          label:
            node.label.length > 24
              ? `${node.label.slice(0, 22)}…`
              : node.label,
          fullLabel: node.label,
          color: retentionColor(node.retention, colors),
        },
        classes: node.id === rootSenseId ? 'root' : '',
      })),
      ...graph.edges.map((edge) => ({
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.type,
          directed: edge.directed,
        },
      })),
    ];

    if (cy) {
      cy.destroy();
      cy = null;
    }

    const instance = cytoscape({
      container,
      elements,
      layout: { name: 'preset' },
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'border-color': colors.background,
            'border-width': 2,
            color: colors.foreground,
            'font-family': fontFamily,
            'font-size': '11px',
            height: 20,
            label: 'data(label)',
            'overlay-padding': 7,
            'text-background-color': colors.background,
            'text-background-opacity': 0.88,
            'text-background-padding': '2px',
            'text-margin-y': 8,
            'text-max-width': '116px',
            'text-outline-color': colors.background,
            'text-outline-width': 2,
            'text-valign': 'bottom',
            'text-wrap': 'ellipsis',
            width: 20,
          },
        },
        {
          selector: 'node.root',
          style: {
            'background-color': colors.primary,
            'border-color': colors.info,
            'border-width': 3,
            'font-weight': 700,
            height: 31,
            width: 31,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-color': colors.info,
            'border-width': 4,
            height: 28,
            width: 28,
          },
        },
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            'line-color': colors.border,
            'line-opacity': 0.82,
            width: 1.5,
          },
        },
        {
          selector: 'edge[?directed]',
          style: {
            'arrow-scale': 0.8,
            'target-arrow-color': colors.border,
            'target-arrow-shape': 'triangle',
          },
        },
        {
          selector: '.dimmed',
          style: {
            opacity: 0.12,
          },
        },
      ] as any,
      minZoom: 0.18,
      maxZoom: 3.5,
      boxSelectionEnabled: false,
      userPanningEnabled: true,
      userZoomingEnabled: true,
    });
    cy = instance;

    instance.on('tap', 'node', (event) => {
      selectNode((event.target as NodeSingular).id());
    });
    instance.on('tap', 'edge', (event) => {
      const edge = event.target as EdgeSingular;
      const rootId = explorer()?.rootSenseId;
      const targetId =
        edge.target().id() === rootId
          ? edge.source().id()
          : edge.target().id();
      selectNode(targetId);
    });
    instance.on('tap', (event) => {
      if (event.target === instance) {
        selectNode(rootSenseId);
      }
    });

    const root = instance.getElementById(rootSenseId);
    if (layoutName === 'fcose') {
      root.position({
        x: Math.max(1, container.clientWidth / 2),
        y: Math.max(1, container.clientHeight / 2),
      });
      root.lock();
      instance.one('layoutstop', () => root.unlock());
    }
    instance
      .layout(
        layoutName === 'dagre'
          ? ({
              name: 'dagre',
              rankDir: 'TB',
              nodeSep: 66,
              rankSep: 88,
              edgeSep: 24,
              ranker: 'network-simplex',
              animate,
              animationDuration: animate ? 380 : 0,
              fit: true,
              padding: 38,
            } as any)
          : ({
              name: 'fcose',
              quality: 'default',
              randomize: true,
              nodeRepulsion: 5200,
              idealEdgeLength: 112,
              nodeSeparation: 72,
              animate,
              animationDuration: animate ? 380 : 0,
              fit: true,
              padding: 38,
            } as any),
      )
      .run();
    setCyRevision((value) => value + 1);

    onCleanup(() => {
      if (cy === instance) cy = null;
      instance.destroy();
    });
  });

  createEffect(() => {
    cyRevision();
    const instance = cy;
    const selectedId = selectedSenseId();
    if (!instance || !selectedId) return;
    const node = instance.getElementById(selectedId);
    if (node.empty()) return;
    instance.elements().removeClass('dimmed');
    instance.nodes().unselect();
    node.select();
    const edges = node.connectedEdges();
    const connected = edges.connectedNodes().add(node);
    instance
      .elements()
      .not(connected)
      .not(edges)
      .addClass('dimmed');
  });

  onCleanup(() => {
    if (cy) {
      cy.destroy();
      cy = null;
    }
  });

  const fitGraph = () => cy?.fit(undefined, 42);
  const zoomIn = () => {
    if (cy) cy.zoom(cy.zoom() * 1.25);
  };
  const zoomOut = () => {
    if (cy) cy.zoom(cy.zoom() / 1.25);
  };

  const renderNodeDetail = () => (
    <Show when={selectedNode() && rootNode()}>
      <NodeDetail
        node={selectedNode()!}
        root={rootNode()!}
        relationship={selectedRelationship()}
        cardId={selectedCardId()}
        pendingMappingCardId={selectedPendingMappingCardId()}
        comparing={comparing()}
        expanded={expandedSenseIds().includes(selectedSenseId())}
        expanding={expandingSenseId() === selectedSenseId()}
        addingToDeck={addingSenseId() === selectedSenseId()}
        discovering={discoveringSenseId() === selectedSenseId()}
        canExpand={enabledGroups().length > 0}
        canAddToDeck={
          buildVocabularyCardFieldValues(
            selectedNode()!,
            props.templateFields,
          ) !== null
        }
        cluster={studyCluster()}
        rootCardId={props.rootCardId}
        onCompare={() => setComparing((value) => !value)}
        onExpand={() => void expandSelected()}
        onAddToDeck={() => void addSelectedToDeck()}
        onRetryMapping={() => void retrySelectedMapping()}
        onDiscover={() => void discoverSelected()}
        onToggleStudy={toggleSelectedStudyCard}
        onViewCard={props.onViewCard}
      />
    </Show>
  );

  return (
    <section
      class="overflow-hidden rounded-xl border bg-card"
      aria-labelledby="focused-knowledge-graph-title"
    >
      <Show
        when={!rootQuery.isLoading}
        fallback={
          <div class="space-y-4 p-4 sm:p-5">
            <Skeleton class="h-16" />
            <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
              <Skeleton class="h-[28rem]" />
              <Skeleton class="h-[28rem]" />
            </div>
          </div>
        }
      >
        <Show
          when={!rootQuery.isError}
          fallback={
            <div class="space-y-3 p-4 sm:p-5">
              <Alert
                variant="destructive"
                title={rootLoadError().title}
              >
                {rootLoadError().message}
              </Alert>
              <div class="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  class="min-h-11"
                  onClick={() => void rootQuery.refetch()}
                >
                  Try again
                </Button>
                <Show when={rootLoadError().needsIndexing}>
                  <Button
                    class="min-h-11"
                    onClick={() =>
                      document
                        .getElementById('knowledge-graph-review-section')
                        ?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        })
                    }
                  >
                    Build lexical graph
                  </Button>
                </Show>
              </div>
            </div>
          }
        >
          <Show
            when={explorer() && rootNode()}
            fallback={
              <div class="p-5">
                <Alert title="No lexical sense available">
                  Index this deck before exploring vocabulary connections.
                </Alert>
              </div>
            }
          >
            <header class="border-b bg-surface px-4 py-4 sm:px-5">
              <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div class="flex min-w-0 items-start gap-3">
                  <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-card text-foreground">
                    <Network class="h-5 w-5" />
                  </div>
                  <div class="min-w-0">
                    <h3
                      id="focused-knowledge-graph-title"
                      class="text-base font-semibold text-foreground"
                    >
                      Explore {rootNode()!.label}
                    </h3>
                    <p class="mt-1 text-sm text-muted-foreground">
                      {visibleGraph().nodes.length} words,{' '}
                      {visibleGraph().edges.length} relationships.{' '}
                      {explorer()!.summary.connectedCards} connected cards and{' '}
                      {explorer()!.summary.isolatedCards} isolated cards in this
                      deck.
                    </p>
                    <Show when={visibleGraph().truncated}>
                      <p class="mt-1 text-xs text-warning">
                        View is capped for this screen size.
                      </p>
                    </Show>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-xs font-medium text-muted-foreground">
                    Study cluster {studyCluster().length}/12
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    class="min-h-11 max-w-full sm:min-h-8"
                    disabled={learnNextCandidate() === null}
                    onClick={selectLearnNext}
                    title={
                      learnNextCandidate()
                        ? `Select ${learnNextCandidate()!.node.label}, ranked by relationship usefulness and learning need`
                        : 'No direct relationship is available in the active filters'
                    }
                  >
                    <ArrowRight class="h-4 w-4" />
                    <span class="truncate">
                      Learn next
                      <Show when={learnNextCandidate()}>
                        {(candidate) => <> · {candidate().node.label}</>}
                      </Show>
                    </span>
                  </Button>
                  <Button
                    size="sm"
                    class="min-h-11 sm:min-h-8"
                    onClick={startStudyCluster}
                  >
                    <BookOpen class="h-4 w-4" />
                    Study cluster
                  </Button>
                </div>
              </div>

              <div
                class="mt-4 flex flex-wrap gap-2"
                role="group"
                aria-label="Relationship filters"
              >
                <For each={ALL_RELATION_GROUPS}>
                  {(group) => (
                    <button
                      type="button"
                      class="min-h-11 rounded-md border px-3 text-xs font-medium transition-[background-color,color,border-color,transform] active:translate-y-px sm:min-h-8"
                      classList={{
                        'border-primary bg-primary text-primary-foreground':
                          enabledGroups().includes(group),
                        'bg-card text-muted-foreground hover:bg-accent hover:text-foreground':
                          !enabledGroups().includes(group),
                      }}
                      aria-pressed={enabledGroups().includes(group)}
                      onClick={() => toggleGroup(group)}
                    >
                      {GROUP_LABELS[group]}
                    </button>
                  )}
                </For>
              </div>

              <div
                class="mt-3 grid grid-cols-2 gap-2 md:hidden"
                role="group"
                aria-label="Explorer view"
              >
                <Button
                  variant={mobileView() === 'list' ? 'default' : 'outline'}
                  class="min-h-11"
                  aria-pressed={mobileView() === 'list'}
                  onClick={() => setMobileView('list')}
                >
                  <List class="h-4 w-4" />
                  Relationship list
                </Button>
                <Button
                  variant={mobileView() === 'graph' ? 'default' : 'outline'}
                  class="min-h-11"
                  aria-pressed={mobileView() === 'graph'}
                  onClick={() => setMobileView('graph')}
                >
                  <Network class="h-4 w-4" />
                  Graph
                </Button>
              </div>
            </header>

            <div class="grid min-h-[31rem] md:grid-cols-[minmax(0,1fr)_21rem]">
              <div
                class="relative min-h-[24rem] border-b md:block md:border-b-0 md:border-r"
                classList={{
                  hidden: isMobile() && mobileView() !== 'graph',
                  block: !isMobile() || mobileView() === 'graph',
                }}
              >
                <div
                  ref={graphContainer}
                  class="h-[28rem] w-full cursor-grab bg-card active:cursor-grabbing md:h-full md:min-h-[31rem]"
                  role="img"
                  aria-label={`Interactive vocabulary graph centered on ${rootNode()!.label}`}
                  aria-describedby="focused-graph-description"
                />
                <p id="focused-graph-description" class="sr-only">
                  Select a node to inspect it. The grouped relationship list
                  provides the same data without pointer controls.
                </p>
                <div
                  class="absolute bottom-3 right-3 flex flex-col gap-1"
                  role="toolbar"
                  aria-label="Graph zoom controls"
                >
                  <Button
                    variant="outline"
                    size="icon"
                    class="h-11 w-11 bg-card sm:h-9 sm:w-9"
                    onClick={fitGraph}
                    aria-label="Fit graph"
                    title="Fit graph"
                  >
                    <Maximize2 class="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    class="h-11 w-11 bg-card sm:h-9 sm:w-9"
                    onClick={zoomIn}
                    aria-label="Zoom in"
                    title="Zoom in"
                  >
                    <ZoomIn class="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    class="h-11 w-11 bg-card sm:h-9 sm:w-9"
                    onClick={zoomOut}
                    aria-label="Zoom out"
                    title="Zoom out"
                  >
                    <ZoomOut class="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <aside
                class="max-h-[34rem] overflow-y-auto bg-surface p-3 md:block md:max-h-none md:p-4"
                classList={{
                  hidden: isMobile() && mobileView() !== 'list',
                  block: !isMobile() || mobileView() === 'list',
                }}
                aria-label="Grouped vocabulary relationships"
              >
                <Show
                  when={visibleGraph().edges.length > 0}
                  fallback={
                    <div class="flex min-h-64 flex-col items-center justify-center px-4 text-center">
                      <Search class="h-6 w-6 text-muted-foreground" />
                      <p class="mt-3 text-sm font-medium text-foreground">
                        No relationships in these filters
                      </p>
                      <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Turn on another relationship group or index more cards.
                      </p>
                    </div>
                  }
                >
                  <div class="space-y-5">
                    <For each={enabledGroups()}>
                      {(group) => (
                        <Show when={edgesForGroup(group).length > 0}>
                          <section
                            aria-labelledby={`focused-group-${group}`}
                          >
                            <div class="flex items-center justify-between">
                              <h4
                                id={`focused-group-${group}`}
                                class="text-xs font-semibold text-foreground"
                              >
                                {GROUP_LABELS[group]}
                              </h4>
                              <span class="text-xs tabular-nums text-muted-foreground">
                                {edgesForGroup(group).length}
                              </span>
                            </div>
                            <ul class="mt-2 space-y-2">
                              <For each={edgesForGroup(group)}>
                                {(edge) => (
                                  <li class="rounded-lg border bg-card p-2">
                                    <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
                                      <button
                                        type="button"
                                        class="min-h-11 truncate rounded-md px-2 text-left text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
                                        onClick={() =>
                                          selectNode(edge.source)
                                        }
                                      >
                                        <span class="block truncate">
                                          {nodeById().get(edge.source)?.label ??
                                            edge.source}
                                        </span>
                                        <Show
                                          when={nodeById().get(edge.source)}
                                        >
                                          {(node) => (
                                            <span class="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">
                                              {formatRetention(
                                                node().retention,
                                              )}
                                            </span>
                                          )}
                                        </Show>
                                      </button>
                                      <span class="max-w-24 text-center text-[11px] leading-tight text-muted-foreground">
                                        {RELATION_LABELS[edge.type]}
                                      </span>
                                      <button
                                        type="button"
                                        class="min-h-11 truncate rounded-md px-2 text-right text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
                                        onClick={() =>
                                          selectNode(edge.target)
                                        }
                                      >
                                        <span class="block truncate">
                                          {nodeById().get(edge.target)?.label ??
                                            edge.target}
                                        </span>
                                        <Show
                                          when={nodeById().get(edge.target)}
                                        >
                                          {(node) => (
                                            <span class="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">
                                              {formatRetention(
                                                node().retention,
                                              )}
                                            </span>
                                          )}
                                        </Show>
                                      </button>
                                    </div>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </section>
                        </Show>
                      )}
                    </For>
                  </div>
                </Show>
              </aside>
            </div>

            <div class="hidden border-t bg-card p-5 md:block">
              {renderNodeDetail()}
            </div>

            <Sheet
              open={isMobile() && detailOpen()}
              onOpenChange={setDetailOpen}
            >
              <SheetContent side="bottom" class="max-h-[85dvh]">
                <SheetHeader class="pr-10 text-left">
                  <SheetTitle>Vocabulary details</SheetTitle>
                  <SheetDescription>
                    Compare, expand, or add this card to a focused study
                    cluster.
                  </SheetDescription>
                </SheetHeader>
                {renderNodeDetail()}
              </SheetContent>
            </Sheet>

            <p class="sr-only" aria-live="polite" aria-atomic="true">
              {liveMessage()}
            </p>
          </Show>
        </Show>
      </Show>
    </section>
  );
};

export default FocusedKnowledgeGraph;
export type { FocusedKnowledgeGraphProps };
