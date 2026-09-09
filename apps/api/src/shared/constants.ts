// SRS Review Actions
export const REVIEW_ACTIONS = {
  AGAIN: 'again',
  HARD: 'hard',
  GOOD: 'good',
  EASY: 'easy',
} as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[keyof typeof REVIEW_ACTIONS];

// Template Field Types
export const FIELD_TYPES = {
  TEXT: 'text',
  TEXTAREA: 'textarea',
  IMAGE_URL: 'image_url',
  AUDIO_URL: 'audio_url',
  JSON_ARRAY: 'json_array',
} as const;

export type FieldType = (typeof FIELD_TYPES)[keyof typeof FIELD_TYPES];

// Template Field Sides
export const FIELD_SIDES = {
  FRONT: 'front',
  BACK: 'back',
} as const;

export type FieldSide = (typeof FIELD_SIDES)[keyof typeof FIELD_SIDES];

// Session
export const SESSION = {
  TOKEN_BYTES: 32,
  MAX_AGE_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
  REFRESH_THRESHOLD_MS: 15 * 24 * 60 * 60 * 1000, // 15 days
} as const;

// Default system template names
export const SYSTEM_TEMPLATES = {
  VOCABULARY: 'Vocabulary',
  BASIC_QA: 'Basic Q&A',
} as const;

// Password constraints
export const PASSWORD = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 128,
} as const;

// Streak constants
export const STREAK = {
  /** Max days back to scan for activity heatmap */
  ACTIVITY_MAX_DAYS: 365,
  /** Default days returned by the activity endpoint */
  ACTIVITY_DEFAULT_DAYS: 90,
} as const;

// Notification constants
export const NOTIFICATIONS = {
  /** Max decks to return in a single due-decks notification call */
  MAX_DUE_DECKS: 50,
} as const;
