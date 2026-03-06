// Review actions
export const REVIEW_ACTIONS = {
  AGAIN: 'again',
  HARD: 'hard',
  GOOD: 'good',
  EASY: 'easy',
} as const;

// Keyboard shortcuts
export const KEYBOARD_SHORTCUTS = {
  FLIP: ' ', // Space
  AGAIN: '1',
  HARD: '2',
  GOOD: '3',
  EASY: '4',
} as const;

// Route paths
export const ROUTES = {
  LOGIN: '/login',
  REGISTER: '/register',
  DASHBOARD: '/',
  FOLDER: '/folder/:folderId',
  DECK: '/deck/:deckId',
  STUDY: '/study/:deckId',
} as const;

// Streak motivational messages keyed by minimum streak length
export const STREAK_MESSAGES: { min: number; message: string }[] = [
  { min: 365, message: "A full year! You're legendary! 🏆" },
  { min: 100, message: '100 days! Absolutely unstoppable! 🚀' },
  { min: 30, message: '30-day warrior! Keep the fire alive! 🔥' },
  { min: 14, message: 'Two weeks of consistency! Amazing! ⚡' },
  { min: 7, message: "One week streak! You're on fire! 🔥" },
  { min: 3, message: "You're building momentum! Keep going! 💪" },
  { min: 1, message: 'Great start! Come back tomorrow!' },
  { min: 0, message: 'Start your streak today! 🌱' },
];

// Activity heatmap color levels (cards reviewed → CSS class)
export const HEATMAP_LEVELS = [
  { max: 0, classes: 'bg-muted border border-border/50' },
  { max: 5, classes: 'bg-blue-200 dark:bg-blue-900/60' },
  { max: 15, classes: 'bg-blue-400 dark:bg-blue-700' },
  { max: 50, classes: 'bg-blue-600 dark:bg-blue-500' },
  { max: Infinity, classes: 'bg-blue-800 dark:bg-blue-300' },
] as const;

// Notifications polling interval (ms)
export const NOTIFICATIONS_POLL_MS = 5 * 60 * 1000; // 5 minutes
