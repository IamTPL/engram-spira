import { createMemo } from 'solid-js';
import { createQuery } from '@tanstack/solid-query';
import { api } from '@/api/client';
import { currentUser } from '@/stores/auth.store';
import { experienceQueryKeys, getLibraryExplorer } from '@/lib/experience-api';

export interface DeckItem {
  id: string;
  name: string;
  folderId: string;
  cardTemplateId: string;
  cardCount: number;
}

export interface TemplateItem {
  id: string;
  name: string;
  isSystem: boolean;
}

export interface FolderData {
  id: string;
  name: string;
  classId: string;
}

/**
 * Queries backing the folder page.
 *
 * The library-explorer query reuses the exact key AppShell's LibraryExplorer
 * already subscribes to, so it reads that cache instead of issuing a request.
 * Its two derived values — the parent class name and the folder due count —
 * are optional by design: when the cache has not landed the header simply
 * omits them rather than flashing a skeleton.
 */
export function useFolderData(folderId: () => string) {
  const folderQuery = createQuery(() => ({
    queryKey: ['folder', folderId()],
    queryFn: async () => {
      const { data } = await (api.folders as any)[folderId()].get();
      return data as FolderData | null;
    },
    enabled: !!folderId(),
  }));

  const decksQuery = createQuery(() => ({
    queryKey: ['decks', folderId()],
    queryFn: async () => {
      const { data } = await api.decks['by-folder']({
        folderId: folderId(),
      }).get();
      return (data ?? []) as DeckItem[];
    },
    enabled: !!folderId(),
  }));

  const templatesQuery = createQuery(() => ({
    queryKey: ['card-templates'],
    queryFn: async () => {
      const { data } = await api['card-templates'].get();
      return (data ?? []) as TemplateItem[];
    },
  }));

  const libraryQuery = createQuery(() => ({
    queryKey: experienceQueryKeys.libraryExplorer(),
    queryFn: getLibraryExplorer,
    enabled: !!currentUser()?.id,
    staleTime: 60_000,
  }));

  const folder = () => folderQuery.data ?? null;
  const decks = () => decksQuery.data ?? [];
  const templates = () => templatesQuery.data ?? [];
  const classes = () => libraryQuery.data?.data.classes ?? [];

  const parentClass = createMemo(
    () =>
      classes().find((cls) =>
        cls.folders.some((entry) => entry.id === folderId()),
      ) ?? null,
  );

  const libraryFolder = createMemo(
    () =>
      parentClass()?.folders.find((entry) => entry.id === folderId()) ?? null,
  );

  const deckCount = () => decks().length;
  const cardCount = createMemo(() =>
    decks().reduce((total, deck) => total + deck.cardCount, 0),
  );
  const dueCount = () => libraryFolder()?.dueCount ?? null;

  return {
    folderQuery,
    decksQuery,
    folder,
    decks,
    templates,
    classes,
    parentClass,
    deckCount,
    cardCount,
    dueCount,
  };
}
