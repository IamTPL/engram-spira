import { describe, expect, test } from 'bun:test';

import {
  evaluateKnowledgeGraphQuality,
  parseKnowledgeGraphEvaluationDataset,
  type KnowledgeGraphEvaluationLabel,
  type KnowledgeGraphEvaluationPrediction,
} from '../../../src/modules/knowledge-graph/kg-evaluation';

function evaluationFixture(count = 300): {
  labels: KnowledgeGraphEvaluationLabel[];
  predictions: KnowledgeGraphEvaluationPrediction[];
} {
  const labels = Array.from({ length: count }, (_, index) => ({
    candidateId: `pair-${index}`,
    hasRelation: index < 100,
    relationType: index < 100 ? ('synonym' as const) : null,
    direction: index < 100 ? ('symmetric' as const) : null,
  }));
  const predictions = labels.map((label) => ({
    candidateId: label.candidateId,
    retrievedAtK: label.hasRelation,
    decision: label.hasRelation ? ('relation' as const) : ('none' as const),
    relationType: label.relationType,
    direction: label.direction,
  }));
  return { labels, predictions };
}

describe('knowledge graph quality evaluation', () => {
  test('passes a human-labelled set that meets every rollout threshold', () => {
    const fixture = evaluationFixture();
    const result = evaluateKnowledgeGraphQuality(
      fixture.labels,
      fixture.predictions,
    );

    expect(result.sampleSize).toBe(300);
    expect(result.metrics).toEqual({
      candidateRecallAt8: 1,
      suggestionPrecision: 1,
      directionAccuracy: 1,
    });
    expect(result.passed).toBe(true);
    expect(result.failedGates).toEqual([]);
  });

  test('reports each failed gate without rounding away the failure', () => {
    const fixture = evaluationFixture();
    fixture.predictions[0] = {
      candidateId: 'pair-0',
      retrievedAtK: false,
      decision: 'none',
      relationType: null,
      direction: null,
    };
    for (let index = 100; index < 112; index += 1) {
      fixture.predictions[index] = {
        candidateId: `pair-${index}`,
        retrievedAtK: true,
        decision: 'relation',
        relationType: 'synonym',
        direction: 'symmetric',
      };
    }
    for (let index = 1; index < 8; index += 1) {
      fixture.labels[index] = {
        ...fixture.labels[index]!,
        relationType: 'is_a',
        direction: 'source_to_target',
      };
      fixture.predictions[index] = {
        ...fixture.predictions[index]!,
        relationType: 'is_a',
        direction: 'target_to_source',
      };
    }

    const result = evaluateKnowledgeGraphQuality(
      fixture.labels,
      fixture.predictions,
    );

    expect(result.metrics.candidateRecallAt8).toBe(0.99);
    expect(result.metrics.suggestionPrecision).toBeLessThan(0.9);
    expect(result.metrics.directionAccuracy).toBeLessThan(0.95);
    expect(result.failedGates).toEqual([
      'suggestionPrecision',
      'directionAccuracy',
    ]);
  });

  test('counts the wrong typed relation as an incorrect suggestion', () => {
    const fixture = evaluationFixture();
    fixture.predictions[0] = {
      ...fixture.predictions[0]!,
      relationType: 'antonym',
    };

    const result = evaluateKnowledgeGraphQuality(
      fixture.labels,
      fixture.predictions,
    );

    expect(result.metrics.suggestionPrecision).toBe(0.99);
    expect(result.directionCases).toBe(99);
  });

  test('rejects relation directions that contradict the taxonomy', () => {
    const fixture = evaluationFixture();
    fixture.labels[0] = {
      ...fixture.labels[0]!,
      direction: 'source_to_target',
    };
    expect(() =>
      evaluateKnowledgeGraphQuality(fixture.labels, fixture.predictions),
    ).toThrow('direction is incompatible');

    const directedFixture = evaluationFixture();
    directedFixture.labels[0] = {
      ...directedFixture.labels[0]!,
      relationType: 'is_a',
      direction: 'symmetric',
    };
    expect(() =>
      evaluateKnowledgeGraphQuality(
        directedFixture.labels,
        directedFixture.predictions,
      ),
    ).toThrow('direction is incompatible');
  });

  test('refuses undersized or ambiguous evaluation input', () => {
    const fixture = evaluationFixture(299);
    expect(() =>
      evaluateKnowledgeGraphQuality(fixture.labels, fixture.predictions),
    ).toThrow('at least 300');

    const duplicate = evaluationFixture();
    duplicate.labels[1] = { ...duplicate.labels[0]! };
    expect(() =>
      evaluateKnowledgeGraphQuality(duplicate.labels, duplicate.predictions),
    ).toThrow('duplicate candidateId');
  });

  test('parses the evaluator file contract without trusting unknown input', () => {
    const fixture = evaluationFixture();
    expect(
      parseKnowledgeGraphEvaluationDataset({
        labels: fixture.labels,
        predictions: fixture.predictions,
      }),
    ).toEqual(fixture);
    expect(() => parseKnowledgeGraphEvaluationDataset([])).toThrow(
      'dataset must be an object',
    );
    expect(() =>
      parseKnowledgeGraphEvaluationDataset({ labels: [], predictions: null }),
    ).toThrow('labels and predictions must be arrays');
  });
});
