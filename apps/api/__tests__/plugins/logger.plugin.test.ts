import { describe, expect, test } from 'bun:test';
import { getRequestPath } from '../../src/plugins/logger.plugin';

describe('getRequestPath', () => {
  test('removes verification tokens from the logged request path', () => {
    const request = new Request(
      'http://localhost:3001/auth/verify-email?token=secret-token',
    );

    expect(getRequestPath(request)).toBe('/auth/verify-email');
  });

  test('removes all query values from ordinary request paths', () => {
    const request = new Request(
      'http://localhost:3001/search?q=private+notes&limit=20',
    );

    expect(getRequestPath(request)).toBe('/search');
  });
});
