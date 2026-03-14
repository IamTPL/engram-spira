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

function extractErrorMessage(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) {
    const inner = (value as any).value;
    if (inner !== undefined && inner !== null) {
      const msg = extractErrorMessage(inner);
      if (msg && msg !== '[object Object]') return msg;
    }
    return value.message;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const message = extractErrorMessage(item);
      if (message) return message;
    }
    return null;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const directStringPairs: Array<[unknown, unknown]> = [
      [record.status, record.value],
      [record.status, record.error],
      [record.code, record.value],
      [record.code, record.error],
    ];

    for (const [, candidate] of directStringPairs) {
      if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }

    const candidateKeys = [
      'value',
      'error',
      'message',
      'summary',
      'detail',
      'response',
      'data',
      'body',
      'cause',
    ];
    for (const key of candidateKeys) {
      if (key in record) {
        const message = extractErrorMessage(record[key]);
        if (message) return message;
      }

      const descriptor = descriptors[key];
      if (descriptor && 'value' in descriptor) {
        const message = extractErrorMessage(descriptor.value);
        if (message) return message;
      }

      if (descriptor?.get) {
        try {
          const message = extractErrorMessage(descriptor.get.call(value));
          if (message) return message;
        } catch { }
      }
    }

    for (const nested of Object.values(record)) {
      const message = extractErrorMessage(nested);
      if (message) return message;
    }

    for (const descriptor of Object.values(descriptors)) {
      if ('value' in descriptor) {
        const message = extractErrorMessage(descriptor.value);
        if (message) return message;
      }

      if (descriptor.get) {
        try {
          const message = extractErrorMessage(descriptor.get.call(value));
          if (message) return message;
        } catch { }
      }
    }
  }

  return null;
}

export function getApiError(error: unknown): string {
  if (!error) return 'An unknown error occurred';
  const message = extractErrorMessage(error);
  if (message && message !== '[object Object]') return message;
  return 'An unknown error occurred';
}
