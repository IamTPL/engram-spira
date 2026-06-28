import { describe, expect, test } from 'bun:test';

import { searchCommands } from '../../../src/modules/experience/command-search.service';
import { ValidationError } from '../../../src/shared/errors';

function baseLoaders(overrides: Record<string, unknown> = {}) {
  return {
    loadCards: async () => [
      {
        id: 'card-older',
        deckId: 'deck-1',
        deckName: 'Biology',
        folderId: 'folder-1',
        classId: 'class-1',
        title: 'Cell deck',
        preview: 'older card',
        updatedAt: '2026-06-01T10:00:00.000Z',
      },
      {
        id: 'card-newer',
        deckId: 'deck-1',
        deckName: 'Biology',
        folderId: 'folder-1',
        classId: 'class-1',
        title: 'Cell deck',
        preview: 'newer card',
        updatedAt: '2026-06-28T10:00:00.000Z',
      },
    ],
    loadDecks: async () => [
      {
        id: 'deck-exact',
        name: 'Biology',
        folderId: 'folder-1',
        classId: 'class-1',
        updatedAt: '2026-06-01T10:00:00.000Z',
      },
      {
        id: 'deck-fuzzy',
        name: 'Biology notes',
        folderId: 'folder-1',
        classId: 'class-1',
        updatedAt: '2026-06-28T10:00:00.000Z',
      },
      {
        id: 'deck-other-folder',
        name: 'Biology lab',
        folderId: 'folder-2',
        classId: 'class-1',
        updatedAt: '2026-06-28T10:00:00.000Z',
      },
    ],
    loadFolders: async () => [
      { id: 'folder-1', name: 'Biology Folder', classId: 'class-1' },
      { id: 'folder-2', name: 'Other Folder', classId: 'class-1' },
    ],
    loadClasses: async () => [{ id: 'class-1', name: 'Biology Class' }],
    loadActions: async () => [
      {
        id: 'create-card',
        label: 'Create card',
        keywords: ['new', 'card'],
        routePatterns: ['/decks/:id/workspace'],
      },
      {
        id: 'global-create-card',
        label: 'Create card',
        keywords: ['new', 'card'],
      },
      {
        id: 'disabled-import',
        label: 'Import deck',
        keywords: ['import', 'deck'],
        disabledReason: 'Choose a deck first',
      },
    ],
    loadDocs: async () => [
      {
        id: 'doc-biology',
        title: 'Biology help',
        subtitle: 'Documentation',
        href: '/docs/biology',
        keywords: ['biology'],
      },
    ],
    loadSettings: async () => [
      {
        id: 'setting-biology',
        title: 'Biology setting',
        subtitle: 'Settings',
        href: '/settings/biology',
        keywords: ['biology'],
      },
    ],
    ...overrides,
  } as any;
}

describe('command search service', () => {
  test('exact title ranking before fuzzy matches', async () => {
    const response = await searchCommands(
      'user-1',
      { q: 'Biology', limit: 10 },
      baseLoaders(),
    );

    expect(response.groups.find((g) => g.id === 'decks')?.results[0].id).toBe(
      'deck-exact',
    );
  });

  test('recently opened decks/cards rank before older equally-matching decks/cards', async () => {
    const response = await searchCommands(
      'user-1',
      { q: 'Cell deck', limit: 10 },
      baseLoaders({
        loadDecks: async () => [
          {
            id: 'deck-older',
            name: 'Cell deck',
            folderId: 'folder-1',
            classId: 'class-1',
            updatedAt: '2026-06-01T10:00:00.000Z',
          },
          {
            id: 'deck-newer',
            name: 'Cell deck',
            folderId: 'folder-1',
            classId: 'class-1',
            updatedAt: '2026-06-28T10:00:00.000Z',
          },
        ],
      }),
    );

    expect(response.groups.find((g) => g.id === 'decks')?.results[0].id).toBe(
      'deck-newer',
    );
    expect(response.groups.find((g) => g.id === 'cards')?.results[0].id).toBe(
      'card-newer',
    );
  });

  test('entity matches rank before docs/settings results for non-action queries', async () => {
    const response = await searchCommands(
      'user-1',
      { q: 'Biology', limit: 10 },
      baseLoaders(),
    );

    const nonEmptyGroups = response.groups
      .filter((group) => group.results.length > 0)
      .map((group) => group.id);

    expect(nonEmptyGroups.indexOf('decks')).toBeLessThan(
      nonEmptyGroups.indexOf('docs'),
    );
    expect(nonEmptyGroups.indexOf('classes')).toBeLessThan(
      nonEmptyGroups.indexOf('settings'),
    );
  });

  test('route-aware actions before global actions', async () => {
    const response = await searchCommands(
      'user-1',
      {
        q: 'Create card',
        currentRoute: '/decks/deck-1/workspace',
        limit: 10,
      },
      baseLoaders(),
    );

    expect(response.groups.find((g) => g.id === 'actions')?.results[0].id).toBe(
      'create-card',
    );
  });

  test('scope filtering limits deck/card results to requested class/folder/deck scope', async () => {
    const folderScoped = await searchCommands(
      'user-1',
      { q: 'Biology', folderId: 'folder-1', limit: 10 },
      baseLoaders(),
    );
    const deckScoped = await searchCommands(
      'user-1',
      { q: 'Cell deck', deckId: 'deck-1', limit: 10 },
      baseLoaders(),
    );

    expect(
      folderScoped.groups.find((g) => g.id === 'decks')?.results.map((r) => r.id),
    ).not.toContain('deck-other-folder');
    expect(
      deckScoped.groups.find((g) => g.id === 'cards')?.results.map((r) => r.id),
    ).toEqual(['card-newer', 'card-older']);
  });

  test('default limit applied when omitted', async () => {
    const response = await searchCommands(
      'user-1',
      { q: 'item' },
      baseLoaders({
        loadCards: async () =>
          Array.from({ length: 40 }, (_, index) => ({
            id: `card-${index}`,
            deckId: 'deck-1',
            deckName: 'Deck',
            folderId: 'folder-1',
            classId: 'class-1',
            title: `item ${index}`,
            preview: null,
            updatedAt: null,
          })),
        loadDecks: async () =>
          Array.from({ length: 40 }, (_, index) => ({
            id: `deck-${index}`,
            name: `item ${index}`,
            folderId: 'folder-1',
            classId: 'class-1',
            updatedAt: null,
          })),
        loadFolders: async () =>
          Array.from({ length: 40 }, (_, index) => ({
            id: `folder-${index}`,
            name: `item ${index}`,
            classId: 'class-1',
          })),
      }),
    );

    const total = response.groups.reduce(
      (sum, group) => sum + group.results.length,
      0,
    );

    expect(total).toBe(20);
  });

  test('disabled action includes disabled reason', async () => {
    const response = await searchCommands(
      'user-1',
      { q: 'Import deck', limit: 10 },
      baseLoaders(),
    );

    expect(response.groups.find((g) => g.id === 'actions')?.results[0]).toMatchObject(
      {
        id: 'disabled-import',
        disabledReason: 'Choose a deck first',
      },
    );
  });

  test('query limit max 30 total and 8 per group', async () => {
    const response = await searchCommands(
      'user-1',
      { q: 'item', limit: 30 },
      baseLoaders({
        loadCards: async () =>
          Array.from({ length: 20 }, (_, index) => ({
            id: `card-${index}`,
            deckId: 'deck-1',
            deckName: 'Deck',
            folderId: 'folder-1',
            classId: 'class-1',
            title: `item card ${index}`,
            preview: null,
            updatedAt: null,
          })),
        loadDecks: async () =>
          Array.from({ length: 20 }, (_, index) => ({
            id: `deck-${index}`,
            name: `item deck ${index}`,
            folderId: 'folder-1',
            classId: 'class-1',
            updatedAt: null,
          })),
        loadFolders: async () =>
          Array.from({ length: 20 }, (_, index) => ({
            id: `folder-${index}`,
            name: `item folder ${index}`,
            classId: 'class-1',
          })),
        loadClasses: async () =>
          Array.from({ length: 20 }, (_, index) => ({
            id: `class-${index}`,
            name: `item class ${index}`,
          })),
      }),
    );

    expect(response.groups.every((group) => group.results.length <= 8)).toBe(
      true,
    );
    expect(
      response.groups.reduce((sum, group) => sum + group.results.length, 0),
    ).toBe(30);
  });

  test('validates required query and limit range', async () => {
    await expect(
      searchCommands('user-1', { q: '', limit: 10 }, baseLoaders()),
    ).rejects.toThrow(new ValidationError('Query is required'));

    await expect(
      searchCommands('user-1', { q: 'deck', limit: 31 }, baseLoaders()),
    ).rejects.toThrow(new ValidationError('Limit must be between 1 and 30'));
  });
});
