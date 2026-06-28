import { describe, expect, test } from 'bun:test';
import {
  buildInitialExpansion,
  findLibrarySelectionContext,
} from './library-explorer-state';
import type { LibraryExplorerAggregate } from '@/lib/experience-api';

type LibraryClass = LibraryExplorerAggregate['data']['classes'][number];

function makeClass(id: string, folders: LibraryClass['folders']): LibraryClass {
  return {
    id,
    name: id,
    description: null,
    folderCount: folders.length,
    deckCount: folders.reduce((count, folder) => count + folder.deckCount, 0),
    cardCount: folders.reduce((count, folder) => count + folder.cardCount, 0),
    dueCount: folders.reduce((count, folder) => count + folder.dueCount, 0),
    folders,
  };
}

const classes: LibraryClass[] = [
  makeClass('class-a', [
    {
      id: 'folder-a',
      name: 'Folder A',
      deckCount: 1,
      cardCount: 3,
      dueCount: 1,
      decks: [
        {
          id: 'deck-a',
          name: 'Deck A',
          cardCount: 3,
          dueCount: 1,
          updatedAt: null,
        },
      ],
    },
  ]),
  makeClass('class-b', [
    {
      id: 'folder-b',
      name: 'Folder B',
      deckCount: 1,
      cardCount: 2,
      dueCount: 0,
      decks: [
        {
          id: 'deck-b',
          name: 'Deck B',
          cardCount: 2,
          dueCount: 0,
          updatedAt: null,
        },
      ],
    },
  ]),
];

describe('library explorer state helpers', () => {
  test('expands the route-selected deck before recent or first class fallback', () => {
    expect(
      buildInitialExpansion(classes, ['deck-a'], { deckId: 'deck-b' }),
    ).toEqual({
      classIds: ['class-b'],
      folderIds: ['folder-b'],
    });
  });

  test('expands recent decks when there is no route selection', () => {
    expect(buildInitialExpansion(classes, ['deck-b'], {})).toEqual({
      classIds: ['class-b'],
      folderIds: ['folder-b'],
    });
  });

  test('falls back to the first class when there is no route or recent match', () => {
    expect(buildInitialExpansion(classes, [], {})).toEqual({
      classIds: ['class-a'],
      folderIds: [],
    });
  });

  test('finds action context for selected class, folder, and deck ids', () => {
    expect(findLibrarySelectionContext(classes, { classId: 'class-b' })).toEqual(
      { selectedClassId: 'class-b' },
    );
    expect(
      findLibrarySelectionContext(classes, { folderId: 'folder-b' }),
    ).toEqual({ selectedClassId: 'class-b', selectedFolderId: 'folder-b' });
    expect(findLibrarySelectionContext(classes, { deckId: 'deck-b' })).toEqual({
      selectedClassId: 'class-b',
      selectedFolderId: 'folder-b',
      selectedDeckId: 'deck-b',
    });
  });
});
