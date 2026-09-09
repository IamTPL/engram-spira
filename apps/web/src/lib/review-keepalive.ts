import { API_URL } from '@/api/client';
import type { ReviewItem } from '@/pages/study-review-state';

/**
 * Page-exit transport for grades still queued when the page hides. A raw
 * `fetch` with `keepalive` is dispatched synchronously inside the `pagehide`
 * handler, so the browser carries it through teardown; the Eden/TanStack path
 * reaches its `fetch` only after several awaits. Same cookie auth and
 * timezone header as `api` in `@/api/client`.
 */
export function sendReviewBatchKeepalive(items: ReviewItem[]): Promise<Response> {
  return fetch(`${API_URL}/study/review-batch`, {
    method: 'POST',
    keepalive: true,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-timezone-offset': String(new Date().getTimezoneOffset()),
    },
    body: JSON.stringify({ items }),
  }).then((response) => {
    if (response.ok) return response;
    // 409 = the server already holds these requestIds; the outbox drops those
    // instead of re-queuing (see isAlreadyUsedRequestId).
    throw new Error(
      response.status === 409
        ? 'Review requestId was already used'
        : `review-batch keepalive failed: ${response.status}`,
    );
  });
}
