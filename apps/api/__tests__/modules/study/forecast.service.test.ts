import { describe, test, expect, beforeEach } from 'bun:test';
import { resetMocks, setMockReturn } from '../../helpers/db-mock';

import * as forecastService from '../../../src/modules/study/forecast.service';

describe('forecast.service', () => {
  beforeEach(() => resetMocks());

  describe('getForecast', () => {
    test('returns forecast with empty progress', async () => {
      setMockReturn([]); // fetchUserProgress returns empty
      const result = await forecastService.getForecast('user-1', 7);
      expect(result).toHaveProperty('forecast');
      expect(result.forecast).toHaveLength(7);
    });

    test('clamps days to max 90', async () => {
      setMockReturn([]);
      const result = await forecastService.getForecast('user-1', 200);
      expect(result.forecast).toHaveLength(90);
    });

    test('clamps days to min 1', async () => {
      setMockReturn([]);
      const result = await forecastService.getForecast('user-1', 0);
      expect(result.forecast).toHaveLength(1);
    });

    test('each forecast day has required properties', async () => {
      setMockReturn([]);
      const result = await forecastService.getForecast('user-1', 3);
      for (const day of result.forecast) {
        expect(day).toHaveProperty('date');
        expect(day).toHaveProperty('atRiskCount');
        expect(day).toHaveProperty('avgRetention');
      }
    });

    test('avgRetention is 1 when no reviewed cards', async () => {
      setMockReturn([]);
      const result = await forecastService.getForecast('user-1', 1);
      expect(result.forecast[0].avgRetention).toBe(1);
    });

    test('atRiskCount is 0 when no reviewed cards', async () => {
      setMockReturn([]);
      const result = await forecastService.getForecast('user-1', 1);
      expect(result.forecast[0].atRiskCount).toBe(0);
    });

    test('date format is YYYY-MM-DD', async () => {
      setMockReturn([]);
      const result = await forecastService.getForecast('user-1', 1);
      expect(result.forecast[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('fills days the query did not return and keeps returned values', async () => {
      setMockReturn([{ offset: 1, atRiskCount: 2, avgRetention: 0.8125 }]);
      const result = await forecastService.getForecast('user-1', 3);
      expect(result.forecast.map((d) => [d.atRiskCount, d.avgRetention])).toEqual([
        [0, 1],
        [2, 0.813],
        [0, 1],
      ]);
    });
  });

  describe('getRetentionHeatmap', () => {
    test('returns an empty list when the query matches no owned card', async () => {
      setMockReturn([]);
      const result = await forecastService.getRetentionHeatmap(
        'user-1',
        'deck-1',
      );
      expect(result).toEqual({ cards: [] });
    });

    test('rounds retention and normalises postgres timestamp text', async () => {
      setMockReturn([
        {
          cardId: 'card-1',
          retention: 0.8129999,
          lastReviewed: '2026-09-08 07:02:44.07+00',
          nextReview: '2026-10-16 07:02:44.07+00',
          stability: 38.41487726,
        },
      ]);
      const result = await forecastService.getRetentionHeatmap(
        'user-1',
        'deck-1',
      );
      expect(result.cards).toEqual([
        {
          cardId: 'card-1',
          retention: 0.813,
          lastReviewed: '2026-09-08T07:02:44.070Z',
          nextReview: '2026-10-16T07:02:44.070Z',
          stability: 38.41487726,
        },
      ]);
    });
  });

  describe('getAtRiskCards', () => {
    test('returns total 0 with no rows', async () => {
      setMockReturn([]);
      const result = await forecastService.getAtRiskCards('user-1');
      expect(result).toEqual({ atRisk: [], total: 0 });
    });

    test('takes total from the window count and keeps aggregated fields', async () => {
      setMockReturn([
        {
          cardId: 'card-1',
          deckId: 'deck-1',
          deckName: 'intro',
          retention: 0.9477149,
          total: 12,
          fields: [{ fieldName: 'word', side: 'front', value: 'Capability' }],
        },
      ]);
      const result = await forecastService.getAtRiskCards('user-1', 0.95, 5);
      expect(result.total).toBe(12);
      expect(result.atRisk).toEqual([
        {
          cardId: 'card-1',
          deckId: 'deck-1',
          deckName: 'intro',
          retention: 0.948,
          fields: [{ fieldName: 'word', side: 'front', value: 'Capability' }],
        },
      ]);
    });
  });
});
