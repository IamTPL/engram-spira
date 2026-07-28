import type { ConfidenceBand } from './kg-verifier';

const CONFIDENCE_SCORE_BY_BAND: Record<ConfidenceBand, number> = {
  high: 0.9,
  medium: 0.6,
  low: 0.3,
};

export function confidenceScoreForBand(band: ConfidenceBand): number {
  return CONFIDENCE_SCORE_BY_BAND[band];
}

export function confidenceBandForScore(
  origin: 'manual' | 'ai',
  score: number | string,
): ConfidenceBand | null {
  if (origin === 'manual') return null;
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 1) {
    throw new Error('Invalid knowledge graph relation confidence');
  }
  if (numericScore >= 0.8) return 'high';
  if (numericScore >= 0.5) return 'medium';
  return 'low';
}
