import { ValidationError } from '../../shared/errors';
import {
  RELATION_TYPES,
  type RelationDirection,
  type RelationType,
} from './kg-verifier';

export interface KnowledgeGraphEvaluationLabel {
  candidateId: string;
  hasRelation: boolean;
  relationType: RelationType | null;
  direction: RelationDirection | null;
}

export interface KnowledgeGraphEvaluationPrediction {
  candidateId: string;
  retrievedAtK: boolean;
  decision: 'relation' | 'none' | 'abstain';
  relationType: RelationType | null;
  direction: RelationDirection | null;
}

export interface KnowledgeGraphEvaluationDataset {
  labels: KnowledgeGraphEvaluationLabel[];
  predictions: KnowledgeGraphEvaluationPrediction[];
}

export interface KnowledgeGraphQualityThresholds {
  minimumLabels: number;
  candidateRecallAt8: number;
  suggestionPrecision: number;
  directionAccuracy: number;
}

export type KnowledgeGraphQualityMetric =
  | 'candidateRecallAt8'
  | 'suggestionPrecision'
  | 'directionAccuracy';

export interface KnowledgeGraphQualityResult {
  sampleSize: number;
  positivePairs: number;
  predictedRelations: number;
  directionCases: number;
  metrics: Record<KnowledgeGraphQualityMetric, number>;
  thresholds: Omit<KnowledgeGraphQualityThresholds, 'minimumLabels'>;
  passed: boolean;
  failedGates: KnowledgeGraphQualityMetric[];
}

export const DEFAULT_KG_QUALITY_THRESHOLDS: KnowledgeGraphQualityThresholds = {
  minimumLabels: 300,
  candidateRecallAt8: 0.95,
  suggestionPrecision: 0.9,
  directionAccuracy: 0.95,
};

const RELATION_TYPE_SET = new Set<string>(RELATION_TYPES);
const DIRECTION_SET = new Set<string>([
  'source_to_target',
  'target_to_source',
  'symmetric',
]);
const SYMMETRIC_RELATION_TYPE_SET = new Set<RelationType>([
  'synonym',
  'antonym',
  'collocation',
  'confused_with',
  'translation_of',
  'coordinate',
]);

function assertCandidateId(candidateId: unknown): asserts candidateId is string {
  if (typeof candidateId !== 'string' || candidateId.trim().length === 0) {
    throw new ValidationError(
      'Knowledge graph evaluation candidateId is required',
    );
  }
}

function assertRelationMetadata(
  decision: 'relation' | 'none' | 'abstain',
  relationType: RelationType | null,
  direction: RelationDirection | null,
): void {
  if (decision === 'relation') {
    if (
      relationType === null ||
      !RELATION_TYPE_SET.has(relationType) ||
      direction === null ||
      !DIRECTION_SET.has(direction)
    ) {
      throw new ValidationError(
        'Relation evaluation records require a valid type and direction',
      );
    }
    const expectsSymmetric = SYMMETRIC_RELATION_TYPE_SET.has(relationType);
    if (
      (expectsSymmetric && direction !== 'symmetric') ||
      (!expectsSymmetric && direction === 'symmetric')
    ) {
      throw new ValidationError(
        'Relation evaluation direction is incompatible with its type',
      );
    }
    return;
  }
  if (relationType !== null || direction !== null) {
    throw new ValidationError(
      'Non-relation evaluation records cannot include relation metadata',
    );
  }
}

function assertLabel(label: KnowledgeGraphEvaluationLabel): void {
  if (!label || typeof label !== 'object') {
    throw new ValidationError(
      'Knowledge graph evaluation label must be an object',
    );
  }
  assertCandidateId(label.candidateId);
  if (typeof label.hasRelation !== 'boolean') {
    throw new ValidationError(
      'Knowledge graph evaluation hasRelation must be boolean',
    );
  }
  assertRelationMetadata(
    label.hasRelation ? 'relation' : 'none',
    label.relationType,
    label.direction,
  );
}

function assertPrediction(
  prediction: KnowledgeGraphEvaluationPrediction,
): void {
  if (!prediction || typeof prediction !== 'object') {
    throw new ValidationError(
      'Knowledge graph evaluation prediction must be an object',
    );
  }
  assertCandidateId(prediction.candidateId);
  if (typeof prediction.retrievedAtK !== 'boolean') {
    throw new ValidationError(
      'Knowledge graph evaluation retrievedAtK must be boolean',
    );
  }
  if (
    prediction.decision !== 'relation' &&
    prediction.decision !== 'none' &&
    prediction.decision !== 'abstain'
  ) {
    throw new ValidationError(
      'Knowledge graph evaluation decision is invalid',
    );
  }
  assertRelationMetadata(
    prediction.decision,
    prediction.relationType,
    prediction.direction,
  );
}

function assertUniqueIds(
  records: Array<{ candidateId: string }>,
  kind: 'label' | 'prediction',
): void {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.candidateId)) {
      throw new ValidationError(
        `Knowledge graph evaluation ${kind} has duplicate candidateId`,
      );
    }
    ids.add(record.candidateId);
  }
}

function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function parseKnowledgeGraphEvaluationDataset(
  value: unknown,
): KnowledgeGraphEvaluationDataset {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(
      'Knowledge graph evaluation dataset must be an object',
    );
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.labels) || !Array.isArray(record.predictions)) {
    throw new ValidationError(
      'Knowledge graph evaluation labels and predictions must be arrays',
    );
  }
  return {
    labels: record.labels as KnowledgeGraphEvaluationLabel[],
    predictions: record.predictions as KnowledgeGraphEvaluationPrediction[],
  };
}

export function evaluateKnowledgeGraphQuality(
  labels: KnowledgeGraphEvaluationLabel[],
  predictions: KnowledgeGraphEvaluationPrediction[],
  thresholds: KnowledgeGraphQualityThresholds =
    DEFAULT_KG_QUALITY_THRESHOLDS,
): KnowledgeGraphQualityResult {
  if (labels.length < thresholds.minimumLabels) {
    throw new ValidationError(
      `Knowledge graph evaluation requires at least ${thresholds.minimumLabels} human-labelled pairs`,
    );
  }
  for (const label of labels) assertLabel(label);
  for (const prediction of predictions) assertPrediction(prediction);
  assertUniqueIds(labels, 'label');
  assertUniqueIds(predictions, 'prediction');

  const labelById = new Map(
    labels.map((label) => [label.candidateId, label] as const),
  );
  for (const prediction of predictions) {
    if (!labelById.has(prediction.candidateId)) {
      throw new ValidationError(
        'Knowledge graph evaluation prediction references an unknown candidateId',
      );
    }
  }
  const predictionById = new Map(
    predictions.map(
      (prediction) => [prediction.candidateId, prediction] as const,
    ),
  );

  const positiveLabels = labels.filter((label) => label.hasRelation);
  if (positiveLabels.length === 0) {
    throw new ValidationError(
      'Knowledge graph evaluation requires positive relationship labels',
    );
  }

  const retrievedPositiveCount = positiveLabels.filter(
    (label) => predictionById.get(label.candidateId)?.retrievedAtK === true,
  ).length;
  const relationPredictions = predictions.filter(
    (prediction) => prediction.decision === 'relation',
  );
  const correctRelationPredictions = relationPredictions.filter(
    (prediction) => {
      const label = labelById.get(prediction.candidateId);
      return (
        label?.hasRelation === true &&
        prediction.relationType === label.relationType
      );
    },
  );
  const directionCases = correctRelationPredictions.filter(
    (prediction) =>
      labelById.get(prediction.candidateId)?.direction !== null,
  );
  const correctDirections = directionCases.filter(
    (prediction) =>
      prediction.direction ===
      labelById.get(prediction.candidateId)?.direction,
  ).length;

  const metrics = {
    candidateRecallAt8: safeRate(
      retrievedPositiveCount,
      positiveLabels.length,
    ),
    suggestionPrecision: safeRate(
      correctRelationPredictions.length,
      relationPredictions.length,
    ),
    directionAccuracy: safeRate(correctDirections, directionCases.length),
  };
  const publicThresholds = {
    candidateRecallAt8: thresholds.candidateRecallAt8,
    suggestionPrecision: thresholds.suggestionPrecision,
    directionAccuracy: thresholds.directionAccuracy,
  };
  const failedGates = (
    Object.keys(publicThresholds) as KnowledgeGraphQualityMetric[]
  ).filter((metric) => metrics[metric] < publicThresholds[metric]);

  return {
    sampleSize: labels.length,
    positivePairs: positiveLabels.length,
    predictedRelations: relationPredictions.length,
    directionCases: directionCases.length,
    metrics,
    thresholds: publicThresholds,
    passed: failedGates.length === 0,
    failedGates,
  };
}
