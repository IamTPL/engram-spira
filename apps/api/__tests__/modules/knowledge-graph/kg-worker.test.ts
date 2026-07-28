import { describe, expect, it } from 'bun:test';

import { AppError, ValidationError } from '../../../src/shared/errors';
import {
  createKgWorker,
  processKgWorkerBatch,
  startKgWorkerIfEnabled,
  type ClaimedKgRun,
  type KgRunRepository,
  type KgWorkerDependencies,
  type KgWorkerLogger,
  type KgWorkerTimers,
} from '../../../src/modules/knowledge-graph/kg-worker';

const workerId = '00000000-0000-4000-8000-000000000001';
const baseRun: ClaimedKgRun = {
  id: '00000000-0000-4000-8000-000000000011',
  userId: '00000000-0000-4000-8000-000000000012',
  runType: 'deck_index',
  deckId: '00000000-0000-4000-8000-000000000013',
  focusSenseId: null,
  stage: 'snapshot',
  fingerprint: 'f'.repeat(64),
  representationVersion: 'v1',
  embeddingModel: 'embedding-model',
  promptVersion: 'prompt-v1',
  taxonomyVersion: 'taxonomy-v1',
  sourceLanguageTag: 'vi',
  definitionLanguageTag: 'en',
  snapshot: { version: 1 },
  progress: {},
  stats: {},
  attemptCount: 1,
  maxAttempts: 5,
  cancelRequestedAt: null,
};

function createLogger(): KgWorkerLogger {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function createRepository(
  overrides: Partial<KgRunRepository> = {},
): KgRunRepository {
  let claimed = false;
  return {
    recoverAbandoned: async () => ({ cancelled: 0, failed: 0 }),
    loadQueueTelemetry: async () => ({ depth: 0, oldestAgeMs: null }),
    claimBatch: async () => {
      if (claimed) return [];
      claimed = true;
      return [baseRun];
    },
    heartbeat: async () => ({ owned: true, cancelRequested: false }),
    advanceStage: async () => true,
    saveSnapshotAndAdvance: async () => true,
    finish: async () => true,
    retry: async () => true,
    fail: async () => true,
    cancel: async () => true,
    finalizeCancellation: async () => false,
    ...overrides,
  };
}

function createDependencies(
  overrides: Partial<KgWorkerDependencies> = {},
): KgWorkerDependencies {
  return {
    workerId,
    repository: createRepository(),
    execute: async () => ({ outcome: 'completed' }),
    logger: createLogger(),
    random: () => 0,
    batchSize: 1,
    leaseMs: 30_000,
    heartbeatIntervalMs: 10_000,
    retryBaseMs: 1_000,
    retryMaxMs: 60_000,
    ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let checks = 0;
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      checks += 1;
      if (checks > 100) {
        reject(new Error('Timed out waiting for condition'));
        return;
      }
      queueMicrotask(check);
    };
    check();
  });
}

describe('KG worker execution', () => {
  it('emits claimable queue depth and age once per worker batch', async () => {
    const infoContexts: Record<string, unknown>[] = [];
    const repository = createRepository({
      loadQueueTelemetry: async () => ({ depth: 7, oldestAgeMs: 1_250 }),
      claimBatch: async () => [],
    });

    const result = await processKgWorkerBatch(
      createDependencies({
        repository,
        logger: {
          info(context) {
            infoContexts.push(context);
          },
          warn() {},
          error() {},
        },
      }),
    );

    expect(result.claimed).toBe(0);
    expect(
      infoContexts.find((context) => context.transition === 'queue_observed'),
    ).toMatchObject({
      transition: 'queue_observed',
      queueDepth: 7,
      oldestQueueAgeMs: 1_250,
    });
  });

  it.each(['completed', 'partial', 'stale'] as const)(
    'persists the explicit %s executor outcome and keeps accumulated progress',
    async (outcome) => {
      const finishes: unknown[][] = [];
      const repository = createRepository({
        finish: async (...args) => {
          finishes.push(args);
          return true;
        },
      });

      const result = await processKgWorkerBatch(
        createDependencies({
          repository,
          execute: async ({ advanceStage }) => {
            expect(
              await advanceStage(
                'indexing',
                { indexed: 2 },
                { cardsSeen: 2 },
              ),
            ).toBe(true);
            return {
              outcome,
              progress: { finished: true },
              statsPatch: { suggestions: 3 },
            };
          },
        }),
      );

      expect(result[outcome]).toBe(1);
      expect(finishes).toHaveLength(1);
      expect(finishes[0]?.slice(0, 5)).toEqual([
        baseRun.id,
        workerId,
        'indexing',
        outcome,
        { finished: true },
      ]);
      expect(finishes[0]?.[5]).toEqual({ suggestions: 3 });
    },
  );

  it('logs per-stage duration and explicit transition fields', async () => {
    let nowMs = 1_000;
    const infoContexts: Record<string, unknown>[] = [];
    const logger: KgWorkerLogger = {
      info(context) {
        infoContexts.push(context);
      },
      warn() {},
      error() {},
    };

    await processKgWorkerBatch(
      createDependencies({
        logger,
        now: () => nowMs,
        execute: async ({ advanceStage }) => {
          nowMs = 1_075;
          expect(await advanceStage('indexing')).toBe(true);
          nowMs = 1_125;
          return { outcome: 'completed' };
        },
      }),
    );

    expect(
      infoContexts.find((context) => context.transition === 'stage_advanced'),
    ).toMatchObject({
      stage: 'indexing',
      previousStage: 'snapshot',
      nextStage: 'indexing',
      stageDurationMs: 75,
    });
    expect(
      infoContexts.find((context) => context.transition === 'terminal'),
    ).toMatchObject({
      stage: 'indexing',
      outcome: 'completed',
      stageDurationMs: 50,
    });
  });

  it.each([
    [{ status: 429 }, 500],
    [{ cause: { response: { status: 503 } } }, 500],
  ])(
    'retries transient provider failures with deterministic exponential jitter',
    async (thrown, expectedDelay) => {
      const retries: unknown[][] = [];
      const repository = createRepository({
        claimBatch: async () => [{ ...baseRun, attemptCount: 2 }],
        retry: async (...args) => {
          retries.push(args);
          return true;
        },
      });

      const result = await processKgWorkerBatch(
        createDependencies({
          repository,
          random: () => 0.25,
          execute: async () => {
            throw thrown;
          },
        }),
      );

      expect(result.retried).toBe(1);
      expect(retries).toHaveLength(1);
      expect(retries[0]?.[4]).toBe(expectedDelay * 3);
      expect(String((retries[0]?.[3] as { message: string }).message)).not
        .toContain('private provider body');
    },
  );

  it.each([
    new ValidationError('Invalid snapshot schema'),
    new AppError(503, 'Deterministic domain failure'),
    { code: '23514', message: 'schema constraint failed' },
    { status: 404, message: 'not found' },
  ])('fails deterministic errors without retrying', async (thrown) => {
    let retryCalls = 0;
    let failCalls = 0;
    const repository = createRepository({
      retry: async () => {
        retryCalls += 1;
        return true;
      },
      fail: async () => {
        failCalls += 1;
        return true;
      },
    });

    const result = await processKgWorkerBatch(
      createDependencies({
        repository,
        execute: async () => {
          throw thrown;
        },
      }),
    );

    expect(result.failed).toBe(1);
    expect(retryCalls).toBe(0);
    expect(failCalls).toBe(1);
  });

  it('does not retry when an AppError is wrapped inside a transient-looking cause chain', async () => {
    let retryCalls = 0;
    let failed: unknown[] = [];
    const repository = createRepository({
      retry: async () => {
        retryCalls += 1;
        return true;
      },
      fail: async (...args) => {
        failed = args;
        return true;
      },
    });
    const wrapped = new Error('provider wrapper', {
      cause: {
        status: 503,
        cause: new AppError(429, 'application throttle'),
      },
    });

    const result = await processKgWorkerBatch(
      createDependencies({
        repository,
        execute: async () => {
          throw wrapped;
        },
      }),
    );

    expect(result.failed).toBe(1);
    expect(retryCalls).toBe(0);
    expect((failed[3] as { code: string }).code).toBe('APPLICATION_ERROR');
  });

  it('finds a non-retryable AppError at any depth in a cause chain', async () => {
    let cause: unknown = new AppError(422, 'deep validation secret');
    for (let depth = 0; depth < 12; depth += 1) {
      cause = { cause };
    }
    let persisted: { code: string | null; message: string } | undefined;
    const repository = createRepository({
      fail: async (_runId, _workerId, _stage, failure) => {
        persisted = failure;
        return true;
      },
    });

    const result = await processKgWorkerBatch(
      createDependencies({
        repository,
        execute: async () => {
          throw { status: 503, cause };
        },
      }),
    );

    expect(result.failed).toBe(1);
    expect(result.retried).toBe(0);
    expect(persisted).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Knowledge graph validation failed',
    });
  });

  it('persists only allowlisted failure text and never raw provider, API key, card, or JSON content', async () => {
    let persisted: { code: string | null; message: string } | undefined;
    const repository = createRepository({
      fail: async (_runId, _workerId, _stage, failure) => {
        persisted = failure;
        return true;
      },
    });

    await processKgWorkerBatch(
      createDependencies({
        repository,
        execute: async () => {
          throw {
            code: 'CARD_SECRET_LEAK',
            message:
              'card=private-card JSON={"answer":"hidden"} apiKey=private-key',
          };
        },
      }),
    );

    expect(persisted).toEqual({
      code: 'KG_EXECUTION_ERROR',
      message: 'Knowledge graph execution failed',
    });
    expect(JSON.stringify(persisted)).not.toContain('private-card');
    expect(JSON.stringify(persisted)).not.toContain('private-key');
    expect(JSON.stringify(persisted)).not.toContain('hidden');
  });

  it('fails the fifth claimed attempt instead of scheduling a sixth', async () => {
    let retryCalls = 0;
    let failCalls = 0;
    const repository = createRepository({
      claimBatch: async () => [{ ...baseRun, attemptCount: 5, maxAttempts: 9 }],
      retry: async () => {
        retryCalls += 1;
        return true;
      },
      fail: async () => {
        failCalls += 1;
        return true;
      },
    });

    const result = await processKgWorkerBatch(
      createDependencies({
        repository,
        execute: async () => {
          throw { status: 503 };
        },
      }),
    );

    expect(result.failed).toBe(1);
    expect(retryCalls).toBe(0);
    expect(failCalls).toBe(1);
  });

  it('cancels before executor work when cancellation is already requested', async () => {
    let executorCalls = 0;
    let cancelCalls = 0;
    const repository = createRepository({
      claimBatch: async () => [
        { ...baseRun, cancelRequestedAt: new Date().toISOString() },
      ],
      cancel: async () => {
        cancelCalls += 1;
        return true;
      },
    });

    const result = await processKgWorkerBatch(
      createDependencies({
        repository,
        execute: async () => {
          executorCalls += 1;
          return { outcome: 'completed' };
        },
      }),
    );

    expect(result.cancelled).toBe(1);
    expect(executorCalls).toBe(0);
    expect(cancelCalls).toBe(1);
  });

  it('aborts executor work and cancels when a heartbeat observes cancellation', async () => {
    let heartbeatCalls = 0;
    let intervalCallback: (() => void) | undefined;
    let intervalDelay = 0;
    let cancelCalls = 0;
    const timers: KgWorkerTimers = {
      setTimeout: () => ({ unref() {} }),
      clearTimeout() {},
      setInterval(callback, delayMs) {
        intervalCallback = callback;
        intervalDelay = delayMs;
        return { unref() {} };
      },
      clearInterval() {},
    };
    const repository = createRepository({
      heartbeat: async () => {
        heartbeatCalls += 1;
        return heartbeatCalls === 1
          ? { owned: true, cancelRequested: false }
          : { owned: true, cancelRequested: true };
      },
      cancel: async () => {
        cancelCalls += 1;
        return true;
      },
    });

    const processing = processKgWorkerBatch(
      createDependencies({
        repository,
        timers,
        heartbeatIntervalMs: 29_000,
        execute: async ({ signal }) => {
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          });
          return { outcome: 'completed' };
        },
      }),
    );
    await waitFor(() => intervalCallback !== undefined);
    expect(intervalDelay).toBe(10_000);
    intervalCallback?.();

    const result = await processing;
    expect(result.cancelled).toBe(1);
    expect(cancelCalls).toBe(1);
  });

  it('does not write a terminal outcome after stage CAS ownership is lost', async () => {
    let finishCalls = 0;
    const repository = createRepository({
      advanceStage: async () => false,
      finish: async () => {
        finishCalls += 1;
        return true;
      },
    });

    const result = await processKgWorkerBatch(
      createDependencies({
        repository,
        execute: async ({ advanceStage, signal }) => {
          expect(await advanceStage('indexing')).toBe(false);
          expect(signal.aborted).toBe(true);
          return { outcome: 'completed' };
        },
      }),
    );

    expect(result.superseded).toBe(1);
    expect(finishCalls).toBe(0);
  });

  it.each(['finish', 'retry', 'fail', 'advance', 'snapshot'] as const)(
    'atomically finalizes cancellation when it wins the %s transition race',
    async (transition) => {
      let finalizeCalls = 0;
      const repository = createRepository({
        finish: async () => transition !== 'finish',
        retry: async () => transition !== 'retry',
        fail: async () => transition !== 'fail',
        advanceStage: async () => transition !== 'advance',
        saveSnapshotAndAdvance: async () => transition !== 'snapshot',
        finalizeCancellation: async () => {
          finalizeCalls += 1;
          return true;
        },
      });

      const result = await processKgWorkerBatch(
        createDependencies({
          repository,
          execute: async ({ advanceStage, saveSnapshotAndAdvance }) => {
            if (transition === 'advance') {
              expect(await advanceStage('indexing')).toBe(false);
              return { outcome: 'completed' };
            }
            if (transition === 'snapshot') {
              expect(
                await saveSnapshotAndAdvance(
                  { version: 'cancel-race' },
                  'indexing',
                ),
              ).toBe(false);
              return { outcome: 'completed' };
            }
            if (transition === 'retry') throw { status: 503 };
            if (transition === 'fail') {
              throw new ValidationError('deterministic');
            }
            return { outcome: 'completed' };
          },
        }),
      );

      expect(result.cancelled).toBe(1);
      expect(result.superseded).toBe(0);
      expect(finalizeCalls).toBe(1);
    },
  );

  it('claims and executes one oldest run at a time up to the configured batch bound', async () => {
    const older = { ...baseRun, id: 'run-older' };
    const newer = { ...baseRun, id: 'run-newer' };
    const queue = [older, newer];
    const claimSizes: number[] = [];
    const executionOrder: string[] = [];
    const repository = createRepository({
      claimBatch: async (_workerId, batchSize) => {
        claimSizes.push(batchSize);
        const next = queue.shift();
        return next ? [next] : [];
      },
    });

    const result = await processKgWorkerBatch(
      createDependencies({
        repository,
        batchSize: 2,
        execute: async ({ run }) => {
          executionOrder.push(run.id);
          return { outcome: 'completed' };
        },
      }),
    );

    expect(result.claimed).toBe(2);
    expect(claimSizes).toEqual([1, 1]);
    expect(executionOrder).toEqual(['run-older', 'run-newer']);
  });

  it('persists snapshot and stage together through the executor context', async () => {
    const calls: unknown[][] = [];
    const snapshot = { deckVersion: 'snapshot-v2', cardIds: ['card-1'] };
    const repository = createRepository({
      saveSnapshotAndAdvance: async (...args) => {
        calls.push(args);
        return true;
      },
    });

    const result = await processKgWorkerBatch(
      createDependencies({
        repository,
        execute: async ({ saveSnapshotAndAdvance }) => {
          expect(
            await saveSnapshotAndAdvance(
              snapshot,
              'indexing',
              { snapshotted: 1 },
              { cardsSeen: 1 },
            ),
          ).toBe(true);
          return { outcome: 'completed' };
        },
      }),
    );

    expect(result.completed).toBe(1);
    expect(calls).toEqual([
      [
        baseRun.id,
        workerId,
        'snapshot',
        snapshot,
        'indexing',
        { snapshotted: 1 },
        { cardsSeen: 1 },
      ],
    ]);
  });
});

describe('KG worker controller', () => {
  it('coalesces requests, never overlaps batches, unrefs timers, and stop drains', async () => {
    const firstBatch = deferred();
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    let unrefCalls = 0;
    let clearCalls = 0;
    const timers: KgWorkerTimers = {
      setTimeout() {
        return {
          unref() {
            unrefCalls += 1;
          },
        };
      },
      clearTimeout() {
        clearCalls += 1;
      },
      setInterval() {
        return { unref() {} };
      },
      clearInterval() {},
    };
    const worker = createKgWorker({
      processBatch: async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (calls === 1) await firstBatch.promise;
        active -= 1;
        return {
          claimed: 0,
          completed: 0,
          partial: 0,
          stale: 0,
          retried: 0,
          failed: 0,
          cancelled: 0,
          superseded: 0,
        };
      },
      pollIntervalMs: 1_000,
      timers,
    });

    worker.request();
    await waitFor(() => calls === 1);
    worker.request();
    worker.request();
    const stopping = worker.stop();
    expect(worker.isRunning()).toBe(true);
    firstBatch.resolve();
    await stopping;

    expect(calls).toBe(1);
    expect(maxActive).toBe(1);
    expect(unrefCalls).toBe(0);
    expect(clearCalls).toBe(0);

    const pollingWorker = createKgWorker({
      processBatch: async () => ({
        claimed: 0,
        completed: 0,
        partial: 0,
        stale: 0,
        retried: 0,
        failed: 0,
        cancelled: 0,
        superseded: 0,
      }),
      pollIntervalMs: 1_000,
      timers,
    });
    pollingWorker.request();
    await waitFor(() => !pollingWorker.isRunning());
    expect(unrefCalls).toBe(1);
    await pollingWorker.stop();
    expect(clearCalls).toBe(1);
  });
});

describe('KG worker runtime guard', () => {
  it('starts only when enabled outside tests', () => {
    let starts = 0;
    const controller = {
      request() {},
      stop: async () => {},
      isRunning: () => false,
    };
    const start = () => {
      starts += 1;
      return controller;
    };

    expect(
      startKgWorkerIfEnabled({ enabled: false, isTest: false, start }),
    ).toBeNull();
    expect(
      startKgWorkerIfEnabled({ enabled: true, isTest: true, start }),
    ).toBeNull();
    expect(
      startKgWorkerIfEnabled({ enabled: true, isTest: false, start }),
    ).toBe(controller);
    expect(starts).toBe(1);
  });
});
