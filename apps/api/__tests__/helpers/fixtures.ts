/**
 * Factory functions for common test entities.
 * Use spread to override specific fields in tests.
 */

export function createUser(overrides: Record<string, any> = {}) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    displayName: 'Test User',
    avatarUrl: null,
    emailVerified: false,
    passwordHash: '$mock_hash$password123',
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function createSession(overrides: Record<string, any> = {}) {
  return {
    id: 'session-1',
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

export function createClass(overrides: Record<string, any> = {}) {
  return {
    id: 'class-1',
    userId: 'user-1',
    name: 'Test Class',
    description: null,
    sortOrder: 0,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function createFolder(overrides: Record<string, any> = {}) {
  return {
    id: 'folder-1',
    classId: 'class-1',
    name: 'Test Folder',
    sortOrder: 0,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function createDeck(overrides: Record<string, any> = {}) {
  return {
    id: 'deck-1',
    userId: 'user-1',
    folderId: 'folder-1',
    cardTemplateId: 'template-1',
    name: 'Test Deck',
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function createCard(overrides: Record<string, any> = {}) {
  return {
    id: 'card-1',
    deckId: 'deck-1',
    sortOrder: 0,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

export function createStudyProgress(overrides: Record<string, any> = {}) {
  return {
    cardId: 'card-1',
    userId: 'user-1',
    boxLevel: 0,
    easeFactor: 2.5,
    intervalDays: 1,
    stability: null,
    difficulty: null,
    fsrsState: null,
    lastReviewedAt: new Date('2026-01-01'),
    nextReviewAt: new Date('2026-01-02'),
    ...overrides,
  };
}

export function createTemplateField(overrides: Record<string, any> = {}) {
  return {
    id: 'field-1',
    templateId: 'template-1',
    name: 'Word',
    fieldType: 'text',
    side: 'front',
    sortOrder: 0,
    ...overrides,
  };
}

export function createCardFieldValue(overrides: Record<string, any> = {}) {
  return {
    cardId: 'card-1',
    templateFieldId: 'field-1',
    value: 'test value',
    ...overrides,
  };
}
