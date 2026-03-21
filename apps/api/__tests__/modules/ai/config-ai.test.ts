import { describe, test, expect } from 'bun:test';
import { checkAiRateLimit } from '../../../src/config/ai';

describe('checkAiRateLimit', () => {
  test('allows requests under limit', () => {
    const userId = `rate-test-${Date.now()}-${Math.random()}`;
    expect(() => checkAiRateLimit(userId)).not.toThrow();
  });

  test('throws TooManyRequestsError after 30 requests', () => {
    const userId = `rate-limit-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 30; i++) {
      checkAiRateLimit(userId);
    }
    expect(() => checkAiRateLimit(userId)).toThrow('rate limit exceeded');
  });

  test('different users have independent limits', () => {
    const user1 = `user-a-${Date.now()}-${Math.random()}`;
    const user2 = `user-b-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 30; i++) {
      checkAiRateLimit(user1);
    }
    // user2 should still be allowed
    expect(() => checkAiRateLimit(user2)).not.toThrow();
  });

  test('allows exactly 30 requests', () => {
    const userId = `exact-30-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 30; i++) {
      expect(() => checkAiRateLimit(userId)).not.toThrow();
    }
    // 31st should fail
    expect(() => checkAiRateLimit(userId)).toThrow();
  });
});
