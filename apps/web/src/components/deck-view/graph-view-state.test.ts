import { describe, expect, test } from 'bun:test';
import {
  createGraphPresentation,
  LEGACY_RELATED_EDGE_CURVE_STYLE,
  selectGraphLayout,
  type GraphData,
} from './graph-view-state';

const graph: GraphData = {
  nodes: [
    { id: 'alpha', label: 'alpha', retention: 0.9 },
    { id: 'beta', label: 'beta', retention: 0.7 },
    { id: 'gamma', label: 'gamma', retention: null },
    { id: 'delta', label: 'delta', retention: 0.5 },
  ],
  edges: [
    { id: 'alpha-beta', source: 'alpha', target: 'beta', type: 'related' },
    { id: 'beta-gamma', source: 'beta', target: 'gamma', type: 'related' },
  ],
};

describe('graph presentation state', () => {
  test('counts total, connected, isolated cards, and relationships', () => {
    // Catches a graph summary that treats all cards as connected.
    expect(createGraphPresentation(graph, false).summary).toEqual({
      totalCards: 4,
      connectedCards: 3,
      isolatedCards: 1,
      relationships: 2,
    });
  });

  test('renders only connected cards until isolated cards are enabled and sizes to that set', () => {
    // Catches a canvas that reserves space for hidden isolated cards.
    const connectedOnly = createGraphPresentation(graph, false);
    const includingIsolated = createGraphPresentation(graph, true);
    const largeGraph: GraphData = {
      nodes: Array.from({ length: 8 }, (_, index) => ({
        id: `card-${index}`,
        label: `Card ${index}`,
        retention: null,
      })),
      edges: Array.from({ length: 6 }, (_, index) => ({
        id: `edge-${index}`,
        source: `card-${index}`,
        target: `card-${index + 1}`,
        type: 'related',
      })),
    };
    const largeConnectedOnly = createGraphPresentation(largeGraph, false);
    const largeIncludingIsolated = createGraphPresentation(largeGraph, true);

    expect(connectedOnly.renderedNodes.map((node) => node.id)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(connectedOnly.containerHeight).toBe(400);
    expect(includingIsolated.renderedNodes.map((node) => node.id)).toEqual([
      'alpha',
      'beta',
      'gamma',
      'delta',
    ]);
    expect(includingIsolated.containerHeight).toBe(400);
    expect(largeConnectedOnly.renderedNodes).toHaveLength(7);
    expect(largeConnectedOnly.containerHeight).toBe(405);
    expect(largeIncludingIsolated.renderedNodes).toHaveLength(8);
    expect(largeIncludingIsolated.containerHeight).toBe(420);
  });

  test('uses fCoSE for related and mixed legacy graphs, reserving Dagre for directed hierarchy', () => {
    // Catches the legacy rule that applies Dagre to every relationship graph.
    expect(selectGraphLayout(graph.edges)).toBe('fcose');
    expect(
      selectGraphLayout([
        { id: 'a-b', source: 'a', target: 'b', type: 'prerequisite' },
      ]),
    ).toBe('dagre');
    expect(
      selectGraphLayout([
        { id: 'a-b', source: 'a', target: 'b', type: 'prerequisite' },
        { id: 'b-c', source: 'b', target: 'c', type: 'related' },
      ]),
    ).toBe('fcose');
  });

  test('renders legacy related edges as neutral bezier connections', () => {
    expect(LEGACY_RELATED_EDGE_CURVE_STYLE).toBe('bezier');
  });
});
