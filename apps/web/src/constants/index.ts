// Review actions
export const REVIEW_ACTIONS = {
  AGAIN: 'again',
  HARD: 'hard',
  GOOD: 'good',
} as const;

// Keyboard shortcuts
export const KEYBOARD_SHORTCUTS = {
  FLIP: ' ', // Space
  AGAIN: '1',
  HARD: '2',
  GOOD: '3',
} as const;

// Route paths
export const ROUTES = {
  LOGIN: '/login',
  REGISTER: '/register',
  DASHBOARD: '/',
  STUDY: '/study/:deckId',
} as const;
