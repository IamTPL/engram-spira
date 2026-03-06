// ═══════════════════════════════════════════════════════════
// @engram/shared — Shared types and constants between FE & BE
// ═══════════════════════════════════════════════════════════

// ── SRS Review Actions ────────────────────────────────────
export const REVIEW_ACTIONS = {
  AGAIN: 'again',
  HARD: 'hard',
  GOOD: 'good',
  EASY: 'easy',
} as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[keyof typeof REVIEW_ACTIONS];

// ── Template Field Types ──────────────────────────────────
export const FIELD_TYPES = {
  TEXT: 'text',
  TEXTAREA: 'textarea',
  IMAGE_URL: 'image_url',
  AUDIO_URL: 'audio_url',
  JSON_ARRAY: 'json_array',
} as const;

export type FieldType = (typeof FIELD_TYPES)[keyof typeof FIELD_TYPES];

// ── Template Field Sides ──────────────────────────────────
export const FIELD_SIDES = {
  FRONT: 'front',
  BACK: 'back',
} as const;

export type FieldSide = (typeof FIELD_SIDES)[keyof typeof FIELD_SIDES];

// ── Password Constraints ──────────────────────────────────
export const PASSWORD = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 128,
} as const;

// ── System Template Names ─────────────────────────────────
export const SYSTEM_TEMPLATES = {
  VOCABULARY: 'Vocabulary',
  BASIC_QA: 'Basic Q&A',
} as const;

// ── Notification Constants ────────────────────────────────
export const NOTIFICATIONS = {
  MAX_DUE_DECKS: 50,
} as const;

// ── Study Card Link Types (Knowledge Graph) ───────────────
export const LINK_TYPES = {
  RELATED: 'related',
  PREREQUISITE: 'prerequisite',
  OPPOSITE: 'opposite',
  EXAMPLE: 'example',
} as const;

export type LinkType = (typeof LINK_TYPES)[keyof typeof LINK_TYPES];
