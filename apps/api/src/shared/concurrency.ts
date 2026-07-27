export type ConcurrencyLimiter = <T>(work: () => Promise<T>) => Promise<T>;
export type CoalescingEnqueuer<Key> = (key: Key) => void;

export function createConcurrencyLimiter(
  maxConcurrency: number,
): ConcurrencyLimiter {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError('maxConcurrency must be a positive integer');
  }

  type Waiter = {
    resolve: () => void;
    next: Waiter | null;
  };
  let waiterHead: Waiter | null = null;
  let waiterTail: Waiter | null = null;
  let active = 0;

  const acquire = async () => {
    if (active < maxConcurrency) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => {
      const waiter: Waiter = { resolve, next: null };
      if (waiterTail) {
        waiterTail.next = waiter;
      } else {
        waiterHead = waiter;
      }
      waiterTail = waiter;
    });
  };

  const release = () => {
    const next = waiterHead;
    if (next) {
      waiterHead = next.next;
      if (!waiterHead) waiterTail = null;
      next.resolve();
    } else {
      active--;
    }
  };

  return async <T>(work: () => Promise<T>) => {
    await acquire();
    try {
      return await work();
    } finally {
      release();
    }
  };
}

/**
 * Coalesce repeated work for the same key into the active run plus at most one
 * pending rerun. A request arriving during the rerun schedules one latest rerun.
 */
export function createCoalescingEnqueuer<Key>(
  work: (key: Key) => Promise<unknown>,
  onError: (key: Key, error: unknown) => void,
): CoalescingEnqueuer<Key> {
  const pending = new Map<Key, { rerunRequested: boolean }>();

  return (key) => {
    const state = pending.get(key);
    if (state) {
      state.rerunRequested = true;
      return;
    }

    const nextState = { rerunRequested: false };
    pending.set(key, nextState);
    void (async () => {
      try {
        do {
          nextState.rerunRequested = false;
          try {
            await work(key);
          } catch (error) {
            onError(key, error);
          }
        } while (nextState.rerunRequested);
      } finally {
        if (pending.get(key) === nextState) {
          pending.delete(key);
        }
      }
    })();
  };
}
