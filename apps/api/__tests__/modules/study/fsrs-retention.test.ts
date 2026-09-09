import { describe, expect, test } from 'bun:test';
import {
  forgetting_curve,
  type FSRSParameters,
} from 'ts-fsrs';
import { ValidationError } from '../../../src/shared/errors';
import {
  calculateCanonicalFsrsRetrievability,
  type CanonicalFsrsCardState,
  type CanonicalFsrsRead,
  type CanonicalFsrsParameterRevision,
} from '../../../src/modules/study/fsrs-retention';
import {
  canonicalJson,
  sha256Canonical,
} from '../../../src/modules/study/fsrs-canonical';
import {
  FSRS_ALGORITHM_VERSION,
  FSRS_LIBRARY_VERSION,
  FSRS_POLICY_VERSION,
  normalizeFsrsParameters,
} from '../../../src/modules/study/fsrs.engine';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const CARD_ID = '20000000-0000-4000-8000-000000000001';
const STATE_ID = '30000000-0000-4000-8000-000000000001';
const REVISION_ID = '40000000-0000-4000-8000-000000000001';
const LAST_REVIEWED_AT = new Date('2026-01-01T12:00:00.000Z');

function revision(
  overrides: Partial<CanonicalFsrsParameterRevision> = {},
): CanonicalFsrsParameterRevision {
  const parameters =
    overrides.parameters ??
    (JSON.parse(
      canonicalJson(normalizeFsrsParameters()),
    ) as Record<string, unknown>);
  return {
    id: REVISION_ID,
    userId: USER_ID,
    revision: 1,
    engineVersion: FSRS_LIBRARY_VERSION,
    algorithmVersion: FSRS_ALGORITHM_VERSION,
    policyVersion: FSRS_POLICY_VERSION,
    parameters,
    paramsHash: sha256Canonical(parameters),
    source: 'manual',
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
    activatedAt: new Date('2025-12-01T00:00:00.000Z'),
    retiredAt: null,
    ...overrides,
  };
}

function state(
  overrides: Partial<CanonicalFsrsCardState> = {},
): CanonicalFsrsCardState {
  return {
    id: STATE_ID,
    userId: USER_ID,
    cardId: CARD_ID,
    nextReviewAt: new Date('2026-01-11T12:00:00.000Z'),
    lastReviewedAt: new Date(LAST_REVIEWED_AT),
    stability: 10.123456789,
    difficulty: 5.5,
    state: 'review',
    elapsedDays: 10,
    scheduledDays: 10,
    learningSteps: 0,
    reps: 3,
    lapses: 1,
    parameterRevisionId: REVISION_ID,
    stateVersion: 3,
    learningCycle: 1,
    updatedAt: new Date('2026-01-01T12:00:00.000Z'),
    ...overrides,
  };
}

function read(
  stateOverrides: Partial<CanonicalFsrsCardState> = {},
  revisionOverrides: Partial<CanonicalFsrsParameterRevision> = {},
): CanonicalFsrsRead {
  return {
    state: state(stateOverrides),
    revision: revision(revisionOverrides),
  };
}

function directTsFsrs(
  input: CanonicalFsrsRead,
  asOf: Date,
): number {
  const persisted = input.state;
  const parameters =
    input.revision.parameters as unknown as FSRSParameters;
  const elapsedDays =
    (asOf.getTime() - persisted.lastReviewedAt.getTime()) /
    86_400_000;
  return forgetting_curve(
    parameters.w,
    elapsedDays,
    Number(persisted.stability.toFixed(8)),
  );
}

describe('canonical FSRS retrievability', () => {
  test('matches pinned ts-fsrs FSRS-6 golden values at one and ten elapsed days', () => {
    const input = read();

    expect(
      calculateCanonicalFsrsRetrievability(
        input,
        new Date('2026-01-02T12:00:00.000Z'),
      ),
    ).toBe(0.985848);
    expect(
      calculateCanonicalFsrsRetrievability(
        input,
        new Date('2026-01-11T12:00:00.000Z'),
      ),
    ).toBe(0.90084075);
  });

  test('changes smoothly at a fractional elapsed day with direct forgetting-curve parity', () => {
    const input = read();
    const sameInstant = new Date('2026-01-01T12:00:00.000Z');
    const halfDay = new Date('2026-01-02T00:00:00.000Z');
    const fullDay = new Date('2026-01-02T12:00:00.000Z');
    const parameters =
      input.revision.parameters as unknown as FSRSParameters;
    const expectedHalfDay = forgetting_curve(
      parameters.w,
      0.5,
      Number(input.state.stability.toFixed(8)),
    );

    const atZero = calculateCanonicalFsrsRetrievability(
      input,
      sameInstant,
    );
    const atHalf = calculateCanonicalFsrsRetrievability(input, halfDay);
    const atOne = calculateCanonicalFsrsRetrievability(input, fullDay);

    expect(atHalf).toBe(expectedHalfDay);
    expect(atHalf).not.toBe(atZero);
    expect(atHalf).not.toBe(atOne);
    expect(atZero).toBeGreaterThan(atHalf!);
    expect(atHalf).toBeGreaterThan(atOne!);
  });

  test('returns the same fractional-day value before and after due-time changes', () => {
    const asOf = new Date('2026-01-02T00:00:00.000Z');
    const alreadyDue = read({
      nextReviewAt: new Date('2026-01-01T13:00:00.000Z'),
    });
    const scheduledLater = read({
      nextReviewAt: new Date('2026-02-01T12:00:00.000Z'),
    });

    expect(
      calculateCanonicalFsrsRetrievability(alreadyDue, asOf),
    ).toBe(directTsFsrs(alreadyDue, asOf));
    expect(
      calculateCanonicalFsrsRetrievability(scheduledLater, asOf),
    ).toBe(directTsFsrs(scheduledLater, asOf));
    expect(
      calculateCanonicalFsrsRetrievability(alreadyDue, asOf),
    ).toBe(
      calculateCanonicalFsrsRetrievability(scheduledLater, asOf),
    );
  });

  test('has direct library parity for every persisted state and due-time relationship', () => {
    const cases: Array<{
      name: string;
      input: CanonicalFsrsRead;
      asOf: Date;
    }> = [
      {
        name: 'Learning overdue',
        input: read({
          state: 'learning',
          nextReviewAt: new Date('2026-01-01T12:15:00.000Z'),
          learningSteps: 1,
        }),
        asOf: new Date('2026-01-03T12:00:00.000Z'),
      },
      {
        name: 'Review scheduled in the future',
        input: read({
          state: 'review',
          nextReviewAt: new Date('2026-02-01T12:00:00.000Z'),
        }),
        asOf: new Date('2026-01-11T12:00:00.000Z'),
      },
      {
        name: 'Relearning due at asOf',
        input: read({
          state: 'relearning',
          nextReviewAt: new Date('2026-01-04T12:00:00.000Z'),
          learningSteps: 0,
        }),
        asOf: new Date('2026-01-04T12:00:00.000Z'),
      },
      {
        name: 'same review instant',
        input: read(),
        asOf: new Date(LAST_REVIEWED_AT),
      },
    ];

    for (const current of cases) {
      expect(
        calculateCanonicalFsrsRetrievability(current.input, current.asOf),
        current.name,
      ).toBe(directTsFsrs(current.input, current.asOf));
    }
  });

  test('uses the state referenced custom revision rather than another active parameter set', () => {
    const parameters = normalizeFsrsParameters();
    const customWeights = [...parameters.w];
    customWeights[20] = 0.3;
    const customParameters = JSON.parse(
      canonicalJson(
        normalizeFsrsParameters({
          request_retention: 0.83,
          w: customWeights,
        }),
      ),
    ) as Record<string, unknown>;
    const input = read({}, {
      parameters: customParameters,
      paramsHash: sha256Canonical(customParameters),
      retiredAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const asOf = new Date('2026-01-11T12:00:00.000Z');

    expect(
      calculateCanonicalFsrsRetrievability(input, asOf),
    ).toBe(directTsFsrs(input, asOf));
    expect(
      calculateCanonicalFsrsRetrievability(input, asOf),
    ).not.toBe(0.90084075);
  });

  test('represents New as null and requires a valid explicit asOf', () => {
    expect(
      calculateCanonicalFsrsRetrievability(
        null,
        new Date('2026-01-11T12:00:00.000Z'),
      ),
    ).toBeNull();
    expect(() =>
      calculateCanonicalFsrsRetrievability(null, new Date(Number.NaN)),
    ).toThrow(ValidationError);
  });

  test('rejects asOf before lastReviewedAt instead of silently clamping', () => {
    expect(() =>
      calculateCanonicalFsrsRetrievability(
        read(),
        new Date('2026-01-01T11:59:59.999Z'),
      ),
    ).toThrow('before');
  });

  test('fails closed on invalid persisted state metrics, counters, dates, and enums', () => {
    const invalidStates: Array<[string, CanonicalFsrsCardState]> = [
      ['stability', state({ stability: 0 })],
      ['stability', state({ stability: Number.POSITIVE_INFINITY })],
      ['difficulty', state({ difficulty: 0.999 })],
      ['difficulty', state({ difficulty: 10.001 })],
      ['elapsedDays', state({ elapsedDays: -1 })],
      ['scheduledDays', state({ scheduledDays: 1.5 })],
      ['learningSteps', state({ learningSteps: -1 })],
      ['reps', state({ reps: 0, stateVersion: 0 })],
      ['lapses', state({ lapses: 4 })],
      ['stateVersion', state({ stateVersion: 4 })],
      ['learningCycle', state({ learningCycle: 0 })],
      ['lastReviewedAt', state({ lastReviewedAt: new Date(Number.NaN) })],
      ['nextReviewAt', state({ nextReviewAt: new Date(Number.NaN) })],
      ['updatedAt', state({ updatedAt: new Date(Number.NaN) })],
      [
        'state',
        state({
          state: 'new' as CanonicalFsrsCardState['state'],
        }),
      ],
    ];

    for (const [name, persisted] of invalidStates) {
      expect(
        () =>
          calculateCanonicalFsrsRetrievability(
            { state: persisted, revision: revision() },
            new Date('2026-01-11T12:00:00.000Z'),
          ),
        name,
      ).toThrow(ValidationError);
    }
  });

  test('fails closed on revision ownership, provenance, canonical JSON, and hash mismatches', () => {
    const canonical = revision().parameters;
    const invalidReads: Array<[string, CanonicalFsrsRead]> = [
      [
        'revision id',
        read({ parameterRevisionId: crypto.randomUUID() }),
      ],
      [
        'revision owner',
        read({}, { userId: crypto.randomUUID() }),
      ],
      [
        'engine provenance',
        read({}, { engineVersion: 'ts-fsrs@next' }),
      ],
      [
        'algorithm provenance',
        read({}, { algorithmVersion: 'FSRS-5' }),
      ],
      [
        'policy provenance',
        read({}, { policyVersion: 'another-policy' }),
      ],
      [
        'canonical parameters',
        read({}, {
          parameters: {},
          paramsHash: sha256Canonical(canonical),
        }),
      ],
      [
        'parameter hash',
        read({}, { paramsHash: 'f'.repeat(64) }),
      ],
      [
        'revision number',
        read({}, { revision: 0 }),
      ],
      [
        'revision source',
        read({}, {
          source: 'temporary' as CanonicalFsrsParameterRevision['source'],
        }),
      ],
      [
        'revision timestamps',
        read({}, {
          retiredAt: new Date('2025-11-30T23:59:59.999Z'),
        }),
      ],
    ];

    for (const [name, input] of invalidReads) {
      expect(
        () =>
          calculateCanonicalFsrsRetrievability(
            input,
            new Date('2026-01-11T12:00:00.000Z'),
          ),
        name,
      ).toThrow(ValidationError);
    }
  });

  test('does not mutate state, revision parameters, or Date objects', () => {
    const input = read();
    const before = {
      state: {
        ...input.state,
        nextReviewAt: input.state.nextReviewAt.getTime(),
        lastReviewedAt: input.state.lastReviewedAt.getTime(),
        updatedAt: input.state.updatedAt.getTime(),
      },
      revision: {
        ...input.revision,
        createdAt: input.revision.createdAt.getTime(),
        activatedAt: input.revision.activatedAt.getTime(),
        retiredAt: input.revision.retiredAt?.getTime() ?? null,
        parameters: canonicalJson(input.revision.parameters),
      },
    };

    calculateCanonicalFsrsRetrievability(
      input,
      new Date('2026-01-11T12:00:00.000Z'),
    );

    expect({
      state: {
        ...input.state,
        nextReviewAt: input.state.nextReviewAt.getTime(),
        lastReviewedAt: input.state.lastReviewedAt.getTime(),
        updatedAt: input.state.updatedAt.getTime(),
      },
      revision: {
        ...input.revision,
        createdAt: input.revision.createdAt.getTime(),
        activatedAt: input.revision.activatedAt.getTime(),
        retiredAt: input.revision.retiredAt?.getTime() ?? null,
        parameters: canonicalJson(input.revision.parameters),
      },
    }).toEqual(before);
  });
});
