import { describe, expect, test } from 'bun:test';
import { studyRateLimitKey } from '../../../src/modules/study/study-rate-limit';

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost:3001/study/review-batch', {
    method: 'POST',
    headers,
  });
}

const COOKIE = { cookieName: 'engram_session' };

describe('studyRateLimitKey', () => {
  test('keys an authenticated request by the user id first (one bucket per account, however many sessions)', () => {
    const a = studyRateLimitKey(request({ cookie: 'engram_session=aaa' }), '10.0.0.1', {
      ...COOKIE,
      userId: 'user-1',
    });
    const b = studyRateLimitKey(request({ cookie: 'engram_session=bbb' }), '10.0.0.2', {
      ...COOKIE,
      userId: 'user-1',
    });
    expect(a).toBe('user:user-1');
    expect(b).toBe(a);
  });

  test('falls back to the hashed session cookie, never the raw token or the shared IP', () => {
    const key = studyRateLimitKey(
      request({ cookie: 'theme=dark; engram_session=abc123; other=1' }),
      '10.0.0.1',
      COOKIE,
    );
    expect(key.startsWith('session:')).toBe(true);
    expect(key).not.toContain('abc123');
    expect(key).not.toContain('10.0.0.1');
  });

  test('two sessions behind one IP get two keys; the same session is stable', () => {
    const a = studyRateLimitKey(request({ cookie: 'engram_session=aaa' }), '10.0.0.1', COOKIE);
    const b = studyRateLimitKey(request({ cookie: 'engram_session=bbb' }), '10.0.0.1', COOKIE);
    const aAgain = studyRateLimitKey(request({ cookie: 'engram_session=aaa' }), '10.0.0.2', COOKIE);
    expect(a).not.toBe(b);
    expect(aAgain).toBe(a);
  });

  test('falls back to the forwarded IP, then the socket IP, then anonymous', () => {
    expect(
      studyRateLimitKey(
        request({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1', cookie: 'theme=dark' }),
        '10.0.0.1',
        COOKIE,
      ),
    ).toBe('ip:203.0.113.9');
    expect(
      studyRateLimitKey(request({ 'x-real-ip': '198.51.100.4' }), '10.0.0.1', COOKIE),
    ).toBe('ip:198.51.100.4');
    expect(studyRateLimitKey(request({}), '10.0.0.1', COOKIE)).toBe('ip:10.0.0.1');
    expect(studyRateLimitKey(request({}), undefined, COOKIE)).toBe('anonymous');
    expect(studyRateLimitKey(undefined, '10.0.0.1', COOKIE)).toBe('anonymous');
  });

  test('ignores an empty session cookie', () => {
    expect(
      studyRateLimitKey(request({ cookie: 'engram_session=' }), '10.0.0.1', COOKIE),
    ).toBe('ip:10.0.0.1');
  });
});
