import { describe, expect, mock, test } from 'bun:test';
import {
  createCoalescingEnqueuer,
  createConcurrencyLimiter,
} from '../../src/shared/concurrency';

function createDeferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = () => resolvePromise();
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createControlledWork() {
  const attempts: ReturnType<typeof createDeferred>[] = [];
  const work = mock(async () => {
    const attempt = createDeferred();
    attempts.push(attempt);
    await attempt.promise;
  });
  const waitForAttempts = async (count: number) => {
    for (let turn = 0; turn < 100; turn++) {
      if (attempts.length >= count) return;
      await Bun.sleep(0);
    }
    throw new Error(`Timed out waiting for ${count} work attempts`);
  };
  return { attempts, waitForAttempts, work };
}

describe('createConcurrencyLimiter', () => {
  test('caps concurrent work and preserves FIFO start order', async () => {
    const limit = createConcurrencyLimiter(3);
    const started: number[] = [];
    let active = 0;
    let peak = 0;

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        limit(async () => {
          started.push(index);
          active++;
          peak = Math.max(peak, active);
          await Bun.sleep(1);
          active--;
          return index;
        }),
      ),
    );

    expect(peak).toBe(3);
    expect(started).toEqual(results);
    expect(results).toEqual(Array.from({ length: 12 }, (_, index) => index));
  });

  test('releases a slot when work rejects', async () => {
    const limit = createConcurrencyLimiter(1);

    await expect(
      limit(async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(await limit(async () => 'recovered')).toBe('recovered');
  });

  test('rejects invalid concurrency limits', () => {
    expect(() => createConcurrencyLimiter(0)).toThrow(RangeError);
    expect(() => createConcurrencyLimiter(1.5)).toThrow(RangeError);
  });
});

describe('createCoalescingEnqueuer', () => {
  test('coalesces a burst into the current run and one rerun', async () => {
    const { attempts, waitForAttempts, work } = createControlledWork();
    const onError = mock(() => {});
    const enqueue = createCoalescingEnqueuer(work, onError);

    enqueue('card-1');
    await waitForAttempts(1);
    for (let index = 0; index < 100; index++) enqueue('card-1');

    expect(work).toHaveBeenCalledTimes(1);
    attempts[0].resolve();
    await waitForAttempts(2);
    expect(work).toHaveBeenCalledTimes(2);

    attempts[1].resolve();
    await Bun.sleep(0);
    expect(work).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  test('runs a requested rerun after the current run fails', async () => {
    const { attempts, waitForAttempts, work } = createControlledWork();
    const onError = mock(() => {});
    const enqueue = createCoalescingEnqueuer(work, onError);
    const failure = new Error('embedding failed');

    enqueue('card-1');
    await waitForAttempts(1);
    enqueue('card-1');
    attempts[0].reject(failure);

    await waitForAttempts(2);
    expect(work).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('card-1', failure);

    attempts[1].resolve();
    await Bun.sleep(0);
  });

  test('cleans up completed state so a later request starts fresh work', async () => {
    const { attempts, waitForAttempts, work } = createControlledWork();
    const enqueue = createCoalescingEnqueuer(work, () => {});

    enqueue('card-1');
    await waitForAttempts(1);
    attempts[0].resolve();
    await Bun.sleep(0);

    enqueue('card-1');
    await waitForAttempts(2);
    expect(work).toHaveBeenCalledTimes(2);

    attempts[1].resolve();
    await Bun.sleep(0);
  });
});
