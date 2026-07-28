import { describe, expect, test } from 'bun:test';

import { buildStudyDeckQuery, isStudyCluster } from './study-mode-state';

const rootCardId = '22222222-2222-4222-8222-222222222222';
const relatedCardId = '11111111-1111-4111-8111-111111111111';

describe('study mode request state', () => {
  test('forwards the root-first cardIds URL value and studies the whole cluster', () => {
    const cardIds = `${rootCardId},${relatedCardId}`;

    expect(buildStudyDeckQuery('due', cardIds)).toEqual({
      mode: 'all',
      cardIds,
    });
  });

  test('keeps existing due and all-deck request behavior without a cluster', () => {
    expect(buildStudyDeckQuery('due')).toEqual({});
    expect(buildStudyDeckQuery('all')).toEqual({ mode: 'all' });
    expect(isStudyCluster(undefined)).toBe(false);
    expect(isStudyCluster('   ')).toBe(false);
    expect(isStudyCluster('card-a,card-b')).toBe(true);
  });
});
