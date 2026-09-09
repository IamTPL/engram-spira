import type { ReviewItem } from './study-review-state';

export interface ReviewOutboxOptions {
  /** Regular transport (the TanStack mutation). Must reject on failure. */
  send: (items: ReviewItem[]) => Promise<unknown>;
  /** Raw `fetch(..., { keepalive: true })` for page exit — dispatched synchronously. */
  sendKeepalive: (items: ReviewItem[]) => Promise<unknown>;
  /** A failure that must not be retried (the server already holds the grade). */
  isPermanentFailure?: (error: unknown) => boolean;
  /** Extra flush rounds `settle` may run for re-queued grades. */
  settleRetries?: number;
}

export interface ReviewOutbox {
  /** Queue a grade and send it immediately. */
  enqueue(item: ReviewItem): void;
  /** Put grades back at the front of the queue (they keep their requestId). */
  requeue(items: ReviewItem[]): void;
  /** Send everything pending through the regular transport. */
  flush(): Promise<void>;
  /**
   * Resolve only when the server holds every grade it can: waits for
   * in-flight requests and re-flushes re-queued failures up to
   * `settleRetries` more times. Anything still pending afterwards stays
   * queued (and was already reported through the transport's error path).
   */
  settle(): Promise<void>;
  /** Page is going away: hand pending grades to the keepalive transport. */
  flushKeepalive(): void;
  pendingCount(): number;
}

const DEFAULT_SETTLE_RETRIES = 2;

export function isAlreadyUsedRequestId(error: unknown): boolean {
  return error instanceof Error && /already used/i.test(error.message);
}

/**
 * One implementation of the study pages' send-every-grade-now policy. Grades
 * carry a `requestId`, so a retry can never double-apply; that is what lets
 * every failure be re-queued and retried instead of dropped.
 */
export function createReviewOutbox(options: ReviewOutboxOptions): ReviewOutbox {
  const isPermanentFailure = options.isPermanentFailure ?? isAlreadyUsedRequestId;
  const settleRetries = options.settleRetries ?? DEFAULT_SETTLE_RETRIES;
  let pending: ReviewItem[] = [];
  const inFlight = new Set<Promise<void>>();

  const track = (
    items: ReviewItem[],
    transport: (items: ReviewItem[]) => Promise<unknown>,
  ): Promise<void> => {
    const request: Promise<void> = transport(items)
      .then(() => undefined)
      .catch((error: unknown) => {
        if (isPermanentFailure(error)) return;
        pending = [...items, ...pending];
      })
      .finally(() => {
        inFlight.delete(request);
      });
    inFlight.add(request);
    return request;
  };

  const flush = (): Promise<void> => {
    if (pending.length === 0) return Promise.resolve();
    const items = pending;
    pending = [];
    return track(items, options.send);
  };

  return {
    enqueue(item) {
      pending = [...pending, item];
      void flush();
    },
    requeue(items) {
      pending = [...items, ...pending];
    },
    flush,
    async settle() {
      await Promise.all(inFlight);
      for (let round = 0; round < settleRetries && pending.length > 0; round++) {
        await flush();
        await Promise.all(inFlight);
      }
    },
    flushKeepalive() {
      if (pending.length === 0) return;
      const items = pending;
      pending = [];
      void track(items, options.sendKeepalive);
    },
    pendingCount: () => pending.length,
  };
}
