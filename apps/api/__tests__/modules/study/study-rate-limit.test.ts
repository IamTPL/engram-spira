import { describe, expect, test } from 'bun:test';
import { studyRateLimitKey } from '../../../src/modules/study/study-rate-limit';

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost:3001/study/review-batch', {
    method: 'POST',
    headers,
  });
}

describe('studyRateLimitKey', () => {
  test('keys an authenticated request by its session, never by the shared IP', () => {
    const key = studyRateLimitKey(
      request({ cookie: 'theme=dark; engram_session=abc123; other=1' }),
      '10.0.0.1',
      'engram_session',
    );
    expect(key.startsWith('session:')).toBe(true);
    expect(key).not.toContain('abc123');
    expect(key).not.toContain('10.0.0.1');
  });

  test('two sessions behind one IP get two keys; the same session is stable', () => {
    const a = studyRateLimitKey(request({ cookie: 'engram_session=aaa' }), '10.0.0.1', 'engram_session');
    const b = studyRateLimitKey(request({ cookie: 'engram_session=bbb' }), '10.0.0.1', 'engram_session');
    const aAgain = studyRateLimitKey(request({ cookie: 'engram_session=aaa' }), '10.0.0.2', 'engram_session');
    expect(a).not.toBe(b);
    expect(aAgain).toBe(a);
  });

  test('falls back to the forwarded IP, then the socket IP, then anonymous', () => {
    expect(
      studyRateLimitKey(
        request({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1', cookie: 'theme=dark' }),
        '10.0.0.1',
        'engram_session',
      ),
    ).toBe('ip:203.0.113.9');
    expect(
      studyRateLimitKey(request({ 'x-real-ip': '198.51.100.4' }), '10.0.0.1', 'engram_session'),
    ).toBe('ip:198.51.100.4');
    expect(studyRateLimitKey(request({}), '10.0.0.1', 'engram_session')).toBe('ip:10.0.0.1');
    expect(studyRateLimitKey(request({}), undefined, 'engram_session')).toBe('anonymous');
    expect(studyRateLimitKey(undefined, '10.0.0.1', 'engram_session')).toBe('anonymous');
  });

  test('ignores an empty session cookie', () => {
    expect(
      studyRateLimitKey(request({ cookie: 'engram_session=' }), '10.0.0.1', 'engram_session'),
    ).toBe('ip:10.0.0.1');
  });
});
