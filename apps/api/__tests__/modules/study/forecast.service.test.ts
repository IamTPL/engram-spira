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
  });
});
