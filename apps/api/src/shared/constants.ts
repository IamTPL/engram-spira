// SRS Review Actions
export const REVIEW_ACTIONS = {
  AGAIN: 'again',
  HARD: 'hard',
  GOOD: 'good',
} as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[keyof typeof REVIEW_ACTIONS];

// SRS intervals (in minutes)
export const SRS_INTERVALS = {
  AGAIN_MINUTES: 10,
  HARD_DAYS: 1,
  GOOD_LEVEL_DAYS: {
    1: 1,
    2: 3,
    3: 7,
    4: 14,
  } as Record<number, number>,
  GOOD_DEFAULT_DAYS: 30, // Level 5+
} as const;

// SM-2 Algorithm constants
// easeFactor controls how fast intervals grow per card (adaptive per-user-per-card)
export const SM2 = {
  DEFAULT_EASE_FACTOR: 2.5, // starting multiplier for new cards
  MIN_EASE_FACTOR: 1.3, // floor — even the hardest card grows eventually
  // Per-action ease factor deltas
  AGAIN_EF_DELTA: -0.2, // penalty for forgetting
  HARD_EF_DELTA: -0.15, // penalty for difficulty
  GOOD_EF_DELTA: 0, // neutral (no change)
  // Initial intervals (repetitions 1 and 2 use fixed values like classic SM-2)
  FIRST_INTERVAL_DAYS: 1,
  SECOND_INTERVAL_DAYS: 6,
  AGAIN_RELEARN_MINUTES: 10, // show again card after 10 minutes
} as const;

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
