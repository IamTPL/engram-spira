import { describe, expect, test } from 'bun:test';
import { forgetting_curve } from 'ts-fsrs';
import { fsrsForgettingCurveConstants } from '../../../src/modules/study/fsrs-revision';
import { normalizeFsrsParameters } from '../../../src/modules/study/fsrs.engine';

describe('fsrsForgettingCurveConstants', () => {
  test('matches ts-fsrs decay/factor for the default parameters', () => {
    const parameters = normalizeFsrsParameters();
    const { decay, factor } = fsrsForgettingCurveConstants(parameters);
    expect(decay).toBe(-parameters.w[20]!);
    // ts-fsrs: factor = round8(exp(ln 0.9 / decay) - 1); R(t=S) must be exactly 0.9
    expect(factor).toBe(Number((Math.exp(Math.log(0.9) / decay) - 1).toFixed(8)));
    expect(forgetting_curve(parameters.w, 10, 10)).toBe(
      Number(Math.pow(1 + factor * 10 / 10, decay).toFixed(8)),
    );
  });

  test('rejects parameters whose w[20] is not a positive decay', () => {
    expect(() =>
      fsrsForgettingCurveConstants({ w: [...normalizeFsrsParameters().w.slice(0, 20), 0] }),
    ).toThrow();
  });
});
