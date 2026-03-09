import { treaty } from '@elysiajs/eden';
import type { App } from '../../../api/src/index';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export const api = treaty<App>(API_URL, {
  onRequest(path, options) {
    const offset = String(new Date().getTimezoneOffset());
    if (options.headers instanceof Headers) {
      options.headers.set('x-timezone-offset', offset);
    } else if (Array.isArray(options.headers)) {
      options.headers.push(['x-timezone-offset', offset]);
    } else {
      options.headers = {
        ...options.headers,
        'x-timezone-offset': offset,
      };
    }
  },
  fetch: {
    credentials: 'include',
  },
});

export function getApiError(error: unknown): string {
  if (!error) return 'An unknown error occurred';
  if (typeof error === 'object' && 'error' in error && (error as any).error) {
    return String((error as any).error);
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && 'message' in error && (error as any).message) {
    return String((error as any).message);
  }
  return String(error);
}
