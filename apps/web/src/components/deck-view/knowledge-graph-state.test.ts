import { describe, expect, test } from 'bun:test';

import {
  addCardToStudyCluster,
  attachCreatedCardToExplorer,
  buildVocabularyCardFieldValues,
  buildStudyClusterHref,
  capVisibleKnowledgeGraph,
  createExplorerState,
  describeKnowledgeGraphLoadError,
  filterExplorerByGroups,
  formatRetention,
  isKnowledgeGraphV2Enabled,
  knowledgeGraphAnimationEnabled,
  knowledgeGraphCaps,
  knowledgeGraphKeys,
  limitNeighborhoodExpansion,
  mergeNeighborhood,
  parsePendingSenseMappings,
  rankLearnNextCandidates,
  registerPendingSenseMapping,
  relationGroup,
  removePendingSenseMapping,
  selectKnowledgeGraphLayout,
  serializePendingSenseMappings,
  toggleCardInStudyCluster,
  type KnowledgeGraphNode,
  type NeighborhoodResponse,
} from './knowledge-graph-state';

function node(id: string, cardId = id): KnowledgeGraphNode {
  return {
    id,
    lexemeId: `lexeme-${id}`,
    label: id,
    languageTag: 'en',
    partOfSpeech: 'noun',
    definition: `definition ${id}`,
    mappedCardIds: cardId ? [cardId] : [],
    inCurrentDeck: true,
    retention: null,
    dueAt: null,
  };
}

function neighborhood(
  focusId: string,
  neighborIds: string[],
  type: NeighborhoodResponse['edges'][number]['type'] = 'synonym',
): NeighborhoodResponse {
  return {
    focus: node(focusId),
    nodes: [node(focusId), ...neighborIds.map((id) => node(id))],
    edges: neighborIds.map((id) => ({
      id: `${focusId}-${id}`,
      source: focusId,
      target: id,
      type,
      group: relationGroup(type),
      directed: type === 'is_a',
      origin: 'ai',
      evidence: null,
      confidenceBand: 'high',
    })),
    summary: {
      deckCards: 10,
      connectedCards: 5,
      isolatedCards: 5,
      groupCounts: {},
    },
    pageInfo: { nextCursor: null, truncated: false },
  };
}

describe('focused knowledge graph state', () => {
  test('builds one canonical query-key hierarchy', () => {
    expect(knowledgeGraphKeys.deck('deck-1')).toEqual([
      'knowledge-graph',
      'deck',
      'deck-1',
    ]);
    expect(knowledgeGraphKeys.capabilities()).toEqual([
      'knowledge-graph',
      'capabilities',
    ]);
    expect(
      knowledgeGraphKeys.neighborhood('card-1', ['usage', 'meaning']),
    ).toEqual([
      'knowledge-graph',
      'neighborhood',
      'card-1',
      'meaning,usage',
    ]);
    expect(knowledgeGraphKeys.run('run-1')).toEqual([
      'knowledge-graph',
      'run',
      'run-1',
    ]);
    expect(knowledgeGraphKeys.suggestions('run-1', 'pending')).toEqual([
      'knowledge-graph',
      'suggestions',
      'run-1',
      'pending',
    ]);
  });

  test('maps relation taxonomy to learning groups and chooses layout', () => {
    expect(relationGroup('translation_of')).toBe('meaning');
    expect(relationGroup('is_a')).toBe('hierarchy');
    expect(relationGroup('derived_from')).toBe('form');
    expect(relationGroup('collocation')).toBe('usage');
    expect(selectKnowledgeGraphLayout(['hierarchy'])).toBe('dagre');
    expect(selectKnowledgeGraphLayout(['hierarchy', 'meaning'])).toBe('fcose');
    expect(selectKnowledgeGraphLayout([])).toBe('fcose');
  });

  test('keeps v2 controls hidden until the backend explicitly enables them', () => {
    expect(isKnowledgeGraphV2Enabled(undefined)).toBe(false);
    expect(isKnowledgeGraphV2Enabled({ v2Enabled: false })).toBe(false);
    expect(isKnowledgeGraphV2Enabled({ v2Enabled: true })).toBe(true);
  });

  test('turns a missing neighborhood into an actionable indexing message', () => {
    expect(
      describeKnowledgeGraphLoadError(
        new Error('Knowledge graph not found'),
      ),
    ).toEqual({
      title: 'Lexical graph not built yet',
      message:
        'Build the lexical graph for this deck, then return to this word.',
      needsIndexing: true,
    });
    expect(
      describeKnowledgeGraphLoadError(new Error('Network unavailable')),
    ).toEqual({
      title: 'Connections could not be loaded',
      message: 'Network unavailable',
      needsIndexing: false,
    });
  });

  test('merges one-hop expansions without duplicates and enforces desktop caps', () => {
    const root = neighborhood('root', ['a', 'b']);
    const state = createExplorerState(root);
    const expanded = mergeNeighborhood(
      state,
      neighborhood('a', ['b', 'c', 'd']),
      { nodeCap: 4, edgeCap: 3 },
    );

    expect(expanded.rootCardId).toBe('root');
    expect(expanded.nodes.map((item) => item.id)).toEqual([
      'root',
      'a',
      'b',
      'c',
    ]);
    expect(expanded.edges.map((item) => item.id)).toEqual([
      'root-a',
      'root-b',
      'a-b',
    ]);
    expect(expanded.truncated).toBe(true);
  });

  test('limits each expansion to 12 new nodes without shrinking the cached neighborhood', () => {
    const response = neighborhood('a', ['b', 'c', 'd', 'e']);
    const limited = limitNeighborhoodExpansion(
      response,
      new Set(['root', 'a', 'b']),
      2,
    );

    expect(limited.nodes.map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(limited.edges.map((edge) => edge.id)).toEqual([
      'a-b',
      'a-c',
      'a-d',
    ]);
    expect(limited.pageInfo.truncated).toBe(true);
    expect(response.nodes.map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  test('keeps the root selected and limits a same-deck study cluster to 12 cards', () => {
    let selection = addCardToStudyCluster([], 'root-card', 'root-card');
    for (let index = 0; index < 20; index += 1) {
      selection = addCardToStudyCluster(
        selection,
        `card-${index}`,
        'root-card',
      );
    }

    expect(selection[0]).toBe('root-card');
    expect(selection).toHaveLength(12);
    expect(
      addCardToStudyCluster(selection, 'root-card', 'root-card'),
    ).toEqual(selection);
  });

  test('builds deterministic word/definition values only for vocabulary templates', () => {
    const vocabularyNode = {
      ...node('sense-1', ''),
      label: 'bank',
      definition: 'ngân hàng',
      inCurrentDeck: false,
    };
    const fields = [
      { id: 'word-field', name: 'Word', fieldType: 'text' },
      { id: 'type-field', name: 'type', fieldType: 'text' },
      { id: 'definition-field', name: ' definition ', fieldType: 'text' },
      { id: 'examples-field', name: 'Examples', fieldType: 'json_array' },
    ];

    expect(buildVocabularyCardFieldValues(vocabularyNode, fields)).toEqual([
      { templateFieldId: 'word-field', value: 'bank' },
      { templateFieldId: 'type-field', value: 'noun' },
      { templateFieldId: 'definition-field', value: 'ngân hàng' },
      { templateFieldId: 'examples-field', value: [] },
    ]);
    expect(
      buildVocabularyCardFieldValues(vocabularyNode, fields.slice(0, 1)),
    ).toBeNull();

    for (const alias of [
      'pos',
      'part of speech',
      'part-of-speech',
      'part_of_speech',
    ]) {
      const values = buildVocabularyCardFieldValues(vocabularyNode, [
        { id: 'word-field', name: 'word', fieldType: 'text' },
        { id: 'pos-field', name: alias, fieldType: 'text' },
        {
          id: 'definition-field',
          name: 'definition',
          fieldType: 'text',
        },
      ]);
      expect(values?.[1]).toEqual({
        templateFieldId: 'pos-field',
        value: 'noun',
      });
    }
  });

  test('attaches a newly created same-deck card without mutating explorer state', () => {
    const state = createExplorerState(neighborhood('root', ['sense-1']));
    state.nodes[1] = {
      ...state.nodes[1]!,
      mappedCardIds: ['card-in-another-deck'],
      inCurrentDeck: false,
    };

    const next = attachCreatedCardToExplorer(
      state,
      'sense-1',
      'new-deck-card',
    );

    expect(next).not.toBe(state);
    expect(next.nodes[1]).toMatchObject({
      mappedCardIds: ['new-deck-card', 'card-in-another-deck'],
      inCurrentDeck: true,
    });
    expect(state.nodes[1]).toMatchObject({
      mappedCardIds: ['card-in-another-deck'],
      inCurrentDeck: false,
    });
  });

  test('retains an unmapped created card for an idempotent mapping retry', () => {
    const current = { 'sense-a': 'card-a' };
    const pending = registerPendingSenseMapping(
      current,
      'sense-b',
      'card-b',
    );
    const completed = removePendingSenseMapping(pending, 'sense-b');

    expect(current).toEqual({ 'sense-a': 'card-a' });
    expect(pending).toEqual({
      'sense-a': 'card-a',
      'sense-b': 'card-b',
    });
    expect(completed).toEqual({ 'sense-a': 'card-a' });
  });

  test('strictly serializes pending mapping recovery state for a deck session', () => {
    const mappings = {
      '00000000-0000-4000-8000-000000000002':
        '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000001':
        '00000000-0000-4000-8000-000000000101',
    };

    const serialized = serializePendingSenseMappings(mappings);
    expect(serialized).toBe(
      '{"00000000-0000-4000-8000-000000000001":"00000000-0000-4000-8000-000000000101","00000000-0000-4000-8000-000000000002":"00000000-0000-4000-8000-000000000102"}',
    );
    expect(parsePendingSenseMappings(serialized)).toEqual(mappings);
    expect(parsePendingSenseMappings('{"sense":"not-a-card-id"}')).toEqual({});
    expect(parsePendingSenseMappings('[]')).toEqual({});
    expect(parsePendingSenseMappings('{')).toEqual({});
    expect(parsePendingSenseMappings(null)).toEqual({});
  });

  test('filters edges by learning group and keeps only visible nodes plus the root', () => {
    const response = neighborhood('root', ['synonym'], 'synonym');
    response.nodes.push(node('parent'), node('unused'));
    response.edges.push({
      id: 'root-parent',
      source: 'root',
      target: 'parent',
      type: 'is_a',
      group: 'hierarchy',
      directed: true,
      origin: 'manual',
      evidence: null,
      confidenceBand: null,
    });
    const visible = filterExplorerByGroups(
      createExplorerState(response),
      ['hierarchy'],
    );

    expect(visible.edges.map((edge) => edge.id)).toEqual(['root-parent']);
    expect(visible.nodes.map((item) => item.id)).toEqual(['root', 'parent']);
  });

  test('uses responsive graph caps and disables animation for large or reduced-motion graphs', () => {
    expect(knowledgeGraphCaps(false)).toEqual({ nodeCap: 60, edgeCap: 120 });
    expect(knowledgeGraphCaps(true)).toEqual({ nodeCap: 30, edgeCap: 50 });
    expect(knowledgeGraphAnimationEnabled(40, false)).toBe(true);
    expect(knowledgeGraphAnimationEnabled(41, false)).toBe(false);
    expect(knowledgeGraphAnimationEnabled(10, true)).toBe(false);
  });

  test('re-applies viewport caps after a desktop graph moves to mobile', () => {
    const response = neighborhood('root', ['a', 'b', 'c']);
    const visible = filterExplorerByGroups(
      createExplorerState(response),
      ['meaning'],
    );
    const capped = capVisibleKnowledgeGraph(
      visible,
      'root',
      { nodeCap: 2, edgeCap: 1 },
    );

    expect(capped.nodes.map((item) => item.id)).toEqual(['root', 'a']);
    expect(capped.edges.map((edge) => edge.id)).toEqual(['root-a']);
    expect(capped.truncated).toBe(true);
  });

  test('keeps root in a toggleable cluster and builds the study URL in root-first order', () => {
    let selection = toggleCardInStudyCluster(
      ['related-card'],
      'second-card',
      'root-card',
    );
    selection = toggleCardInStudyCluster(
      selection,
      'related-card',
      'root-card',
    );
    selection = toggleCardInStudyCluster(
      selection,
      'root-card',
      'root-card',
    );

    expect(selection).toEqual(['root-card', 'second-card']);
    expect(
      buildStudyClusterHref('deck-1', selection, 'root-card'),
    ).toBe(
      '/study/deck-1?mode=all&cardIds=root-card,second-card',
    );
  });

  test('always exposes retention as text', () => {
    expect(formatRetention(null)).toBe('Not reviewed');
    expect(formatRetention(0.834)).toBe('83% retention');
  });

  test('ranks learn-next candidates by usefulness, verifier band, card gap, learning need, then id', () => {
    const nodes = [
      node('root'),
      {
        ...node('translation-low', ''),
        inCurrentDeck: false,
      },
      {
        ...node('synonym-high', ''),
        inCurrentDeck: false,
      },
      {
        ...node('synonym-new', ''),
        inCurrentDeck: false,
      },
      {
        ...node('synonym-due', 'due-card'),
        retention: 0.9,
        dueAt: '2026-07-26T00:00:00.000Z',
      },
      {
        ...node('synonym-low-retention', 'weak-card'),
        retention: 0.3,
        dueAt: '2026-07-29T00:00:00.000Z',
      },
    ];
    const edge = (
      target: string,
      type: NeighborhoodResponse['edges'][number]['type'],
      confidenceBand: 'high' | 'medium' | 'low' | null,
    ) => ({
      id: `edge-${target}`,
      source: 'root',
      target,
      type,
      group: relationGroup(type),
      directed: false,
      origin: 'ai' as const,
      evidence: null,
      confidenceBand,
    });
    const ranked = rankLearnNextCandidates(
      {
        nodes,
        edges: [
          edge('synonym-low-retention', 'synonym', 'high'),
          edge('synonym-due', 'synonym', 'high'),
          edge('synonym-new', 'synonym', 'high'),
          edge('synonym-high', 'synonym', 'medium'),
          edge('translation-low', 'translation_of', 'low'),
        ],
      },
      'root',
      Date.parse('2026-07-27T00:00:00.000Z'),
    );

    expect(
      ranked.map((candidate: { node: KnowledgeGraphNode }) => candidate.node.id),
    ).toEqual([
      'translation-low',
      'synonym-new',
      'synonym-due',
      'synonym-low-retention',
      'synonym-high',
    ]);
  });
});
