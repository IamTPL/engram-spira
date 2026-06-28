import type { CommandActionContext } from './types';
import type { LibraryExplorerAggregate } from '@/lib/experience-api';

export type LibraryClass = LibraryExplorerAggregate['data']['classes'][number];

type RouteSelection = {
  classId?: string;
  folderId?: string;
  deckId?: string;
};

export function findLibrarySelectionContext(
  classes: LibraryClass[],
  selection: RouteSelection,
): Partial<CommandActionContext> {
  for (const cls of classes) {
    if (selection.classId === cls.id) {
      return { selectedClassId: cls.id };
    }

    for (const folder of cls.folders) {
      if (selection.folderId === folder.id) {
        return {
          selectedClassId: cls.id,
          selectedFolderId: folder.id,
        };
      }

      for (const deck of folder.decks) {
        if (selection.deckId === deck.id) {
          return {
            selectedClassId: cls.id,
            selectedFolderId: folder.id,
            selectedDeckId: deck.id,
          };
        }
      }
    }
  }

  return {};
}

export function buildInitialExpansion(
  classes: LibraryClass[],
  recentDeckIds: string[],
  routeSelection: RouteSelection,
) {
  const classIds = new Set<string>();
  const folderIds = new Set<string>();
  const recentDeckSet = new Set(recentDeckIds);

  const addMatch = (selection: RouteSelection) => {
    for (const cls of classes) {
      if (selection.classId === cls.id) {
        classIds.add(cls.id);
        return true;
      }

      for (const folder of cls.folders) {
        if (selection.folderId === folder.id) {
          classIds.add(cls.id);
          folderIds.add(folder.id);
          return true;
        }

        for (const deck of folder.decks) {
          if (selection.deckId === deck.id) {
            classIds.add(cls.id);
            folderIds.add(folder.id);
            return true;
          }
        }
      }
    }
    return false;
  };

  if (addMatch(routeSelection)) {
    return { classIds: [...classIds], folderIds: [...folderIds] };
  }

  for (const cls of classes) {
    for (const folder of cls.folders) {
      if (folder.decks.some((deck) => recentDeckSet.has(deck.id))) {
        classIds.add(cls.id);
        folderIds.add(folder.id);
      }
    }
  }

  if (classIds.size === 0 && classes[0]) {
    classIds.add(classes[0].id);
  }

  return { classIds: [...classIds], folderIds: [...folderIds] };
}
