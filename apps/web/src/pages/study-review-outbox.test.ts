import { describe, expect, test } from 'bun:test';
import { createReviewOutbox } from './study-review-outbox';
import type { ReviewItem } from './study-review-state';

const item = (n: number): ReviewItem => ({
  requestId: `00000000-0000-4000-8000-00000000000${n}`,
  cardId: `10000000-0000-4000-8000-00000000000${n}`,
  rating: 'good',
  reviewedAt: '2026-09-09T10:00:00.000Z',
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createReviewOutbox', () => {
  test('sends each enqueued grade immediately, one request per grade', async () => {
    const sent: ReviewItem[][] = [];
    const outbox = createReviewOutbox({
      send: async (items) => {
        sent.push(items);
      },
      sendKeepalive: async () => {},
    });
    outbox.enqueue(item(1));
    outbox.enqueue(item(2));
    await outbox.settle();
    expect(sent).toEqual([[item(1)], [item(2)]]);
    expect(outbox.pendingCount()).toBe(0);
  });

  test('settle waits for in-flight requests and re-sends re-queued failures instead of resolving early', async () => {
    const first = deferred();
    let calls = 0;
    const sent: ReviewItem[][] = [];
    const outbox = createReviewOutbox({
      send: async (items) => {
        calls += 1;
        sent.push(items);
        if (calls === 1) return first.promise;
      },
      sendKeepalive: async () => {},
    });
    outbox.enqueue(item(1));
    let settled = false;
    const settling = outbox.settle().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    first.reject(new Error('503'));
    await settling;
    // Retried once with the same requestId (idempotent server-side).
    expect(sent).toEqual([[item(1)], [item(1)]]);
    expect(outbox.pendingCount()).toBe(0);
  });

  test('settle gives up after the retry budget and leaves the grades pending', async () => {
    let calls = 0;
    const outbox = createReviewOutbox({
      send: async () => {
        calls += 1;
        throw new Error('503');
      },
      sendKeepalive: async () => {},
      settleRetries: 2,
    });
    outbox.enqueue(item(1));
    await outbox.settle();
    expect(calls).toBe(3);
    expect(outbox.pendingCount()).toBe(1);
  });

  test('drops grades the server already holds instead of retrying them forever', async () => {
    let calls = 0;
    const outbox = createReviewOutbox({
      send: async () => {
        calls += 1;
        throw new Error('Review requestId was already used with a different payload');
      },
      sendKeepalive: async () => {},
    });
    outbox.enqueue(item(1));
    await outbox.settle();
    expect(calls).toBe(1);
    expect(outbox.pendingCount()).toBe(0);
  });

  test('flushKeepalive hands pending grades to the keepalive transport synchronously and re-queues on failure', async () => {
    const keepalive = deferred();
    const sentKeepalive: ReviewItem[][] = [];
    const outbox = createReviewOutbox({
      send: () => new Promise(() => {}), // never resolves: simulates a hung request
      sendKeepalive: (items) => {
        sentKeepalive.push(items);
        return keepalive.promise;
      },
    });
    // A failed grade sitting in the queue when the page hides.
    outbox.requeue([item(1)]);
    outbox.flushKeepalive();
    expect(sentKeepalive).toEqual([[item(1)]]);
    expect(outbox.pendingCount()).toBe(0);
    keepalive.reject(new Error('network'));
    await Promise.resolve();
    await Promise.resolve();
    expect(outbox.pendingCount()).toBe(1);
  });

  test('flushKeepalive with nothing pending sends nothing', () => {
    let calls = 0;
    const outbox = createReviewOutbox({
      send: async () => {},
      sendKeepalive: async () => {
        calls += 1;
      },
    });
    outbox.flushKeepalive();
    expect(calls).toBe(0);
  });
});
