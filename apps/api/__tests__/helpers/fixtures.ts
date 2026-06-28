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

export function createExperienceFixtureRows() {
  const now = new Date('2026-06-28T10:00:00.000Z');
  const past = new Date('2026-06-27T10:00:00.000Z');
  const future = new Date('2026-06-29T10:00:00.000Z');

  return {
    now,
    users: {
      primary: createUser({ id: 'user-1' }),
      other: createUser({ id: 'user-2', email: 'other@example.com' }),
    },
    classes: {
      primary: createClass({ id: 'class-1', userId: 'user-1' }),
      other: createClass({ id: 'class-2', userId: 'user-2' }),
    },
    folders: {
      primary: createFolder({ id: 'folder-1', classId: 'class-1' }),
      other: createFolder({ id: 'folder-2', classId: 'class-2' }),
    },
    decks: {
      primary: createDeck({ id: 'deck-1', userId: 'user-1' }),
      secondary: createDeck({
        id: 'deck-2',
        userId: 'user-1',
        folderId: 'folder-1',
        name: 'Second Deck',
      }),
      other: createDeck({
        id: 'deck-3',
        userId: 'user-2',
        folderId: 'folder-2',
      }),
    },
    templateFields: {
      front: createTemplateField({
        id: 'field-front',
        name: 'Front',
        side: 'front',
        sortOrder: 0,
      }),
      back: createTemplateField({
        id: 'field-back',
        name: 'Back',
        side: 'back',
        sortOrder: 1,
      }),
    },
    queueRows: [
      {
        id: 'card-learning',
        deckId: 'deck-1',
        front: 'Learning front',
        back: 'Learning back',
        templateName: 'Basic',
        dueAt: future,
        retentionEstimate: 0.92,
        boxLevel: 0,
        lastReviewedAt: past,
        sortOrder: 3,
      },
      {
        id: 'card-due',
        deckId: 'deck-1',
        front: 'Due front',
        back: 'Due back',
        templateName: 'Basic',
        dueAt: past,
        retentionEstimate: 0.81,
        boxLevel: 3,
        lastReviewedAt: past,
        sortOrder: 2,
      },
      {
        id: 'card-new',
        deckId: 'deck-2',
        front: 'New front',
        back: 'New back',
        templateName: 'Basic',
        dueAt: null,
        retentionEstimate: null,
        boxLevel: null,
        lastReviewedAt: null,
        sortOrder: 1,
      },
      {
        id: 'card-risk',
        deckId: 'deck-2',
        front: 'Risk front',
        back: 'Risk back',
        templateName: 'Basic',
        dueAt: future,
        retentionEstimate: 0.42,
        boxLevel: 2,
        lastReviewedAt: past,
        sortOrder: 4,
      },
    ],
  };
}
