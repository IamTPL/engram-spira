import { describe, test, expect } from 'bun:test';
import {
  REVIEW_ACTIONS,
  FIELD_TYPES,
  FIELD_SIDES,
  SESSION,
  PASSWORD,
  SYSTEM_TEMPLATES,
  STREAK,
  NOTIFICATIONS,
} from '../../src/shared/constants';

describe('REVIEW_ACTIONS', () => {
  test('has all 4 actions', () => {
    expect(REVIEW_ACTIONS.AGAIN).toBe('again');
    expect(REVIEW_ACTIONS.HARD).toBe('hard');
    expect(REVIEW_ACTIONS.GOOD).toBe('good');
    expect(REVIEW_ACTIONS.EASY).toBe('easy');
  });

  test('has exactly 4 keys', () => {
    expect(Object.keys(REVIEW_ACTIONS)).toHaveLength(4);
  });
});

describe('SESSION constants', () => {
  test('token is 32 bytes', () => {
    expect(SESSION.TOKEN_BYTES).toBe(32);
  });

  test('max age is 30 days in ms', () => {
    expect(SESSION.MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test('refresh threshold is 15 days in ms', () => {
    expect(SESSION.REFRESH_THRESHOLD_MS).toBe(15 * 24 * 60 * 60 * 1000);
  });
});

describe('PASSWORD constraints', () => {
  test('min length is 8', () => {
    expect(PASSWORD.MIN_LENGTH).toBe(8);
  });

  test('max length is 128', () => {
    expect(PASSWORD.MAX_LENGTH).toBe(128);
  });
});

describe('FIELD_TYPES', () => {
  test('has expected values', () => {
    expect(FIELD_TYPES.TEXT).toBe('text');
    expect(FIELD_TYPES.TEXTAREA).toBe('textarea');
    expect(FIELD_TYPES.IMAGE_URL).toBe('image_url');
    expect(FIELD_TYPES.AUDIO_URL).toBe('audio_url');
    expect(FIELD_TYPES.JSON_ARRAY).toBe('json_array');
  });
});

describe('FIELD_SIDES', () => {
  test('has front and back', () => {
    expect(FIELD_SIDES.FRONT).toBe('front');
    expect(FIELD_SIDES.BACK).toBe('back');
  });
});

describe('SYSTEM_TEMPLATES', () => {
  test('has vocabulary and basic QA', () => {
    expect(SYSTEM_TEMPLATES.VOCABULARY).toBe('Vocabulary');
    expect(SYSTEM_TEMPLATES.BASIC_QA).toBe('Basic Q&A');
  });
});

describe('STREAK constants', () => {
  test('activity max days is 365', () => {
    expect(STREAK.ACTIVITY_MAX_DAYS).toBe(365);
  });

  test('activity default days is 90', () => {
    expect(STREAK.ACTIVITY_DEFAULT_DAYS).toBe(90);
  });
});

describe('NOTIFICATIONS', () => {
  test('max due decks is 50', () => {
    expect(NOTIFICATIONS.MAX_DUE_DECKS).toBe(50);
  });
});
