import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { aggregateResponse, resolveSection } from './aggregate.helpers';
import type {
  AggregateResponse,
  LibraryExplorerResponse,
  LibraryExplorerSections,
} from './experience.types';

export type LibraryExplorerLoaders = {
  loadClasses: (userId: string) => Promise<LibraryExplorerResponse['classes']>;
  loadRecentDeckIds: (userId: string) => Promise<string[]>;
};

type LibraryRow = {
  classId: string;
  className: string;
  classDescription: string | null;
  folderId: string | null;
  folderName: string | null;
  deckId: string | null;
  deckName: string | null;
  deckUpdatedAt: Date | string | null;
  cardCount: number;
  dueCount: number;
};

export async function getLibraryExplorer(
  userId: string,
  loaders: LibraryExplorerLoaders = defaultLibraryExplorerLoaders,
): Promise<AggregateResponse<LibraryExplorerResponse, LibraryExplorerSections>> {
  const classes = await resolveSection({
    required: true,
    load: () => loaders.loadClasses(userId),
    empty: (data) => data.length === 0,
  });
  const recentDecks = await resolveSection({
    load: () => loaders.loadRecentDeckIds(userId),
    fallback: [],
    empty: (data) => data.length === 0,
  });

  return aggregateResponse(
    {
      classes: classes.data,
      recentDeckIds: recentDecks.data,
    },
    {
      classes: classes.meta,
      recentDecks: recentDecks.meta,
    } satisfies LibraryExplorerSections,
  );
}

export const defaultLibraryExplorerLoaders: LibraryExplorerLoaders = {
  loadClasses,
  loadRecentDeckIds,
};

async function loadClasses(userId: string) {
  const rows = await db.execute<LibraryRow>(sql`
    SELECT
      cl.id AS "classId",
      cl.name AS "className",
      cl.description AS "classDescription",
      f.id AS "folderId",
      f.name AS "folderName",
      d.id AS "deckId",
      d.name AS "deckName",
      d.created_at AS "deckUpdatedAt",
      COUNT(c.id)::int AS "cardCount",
      COUNT(c.id) FILTER (WHERE sp.id IS NULL OR sp.next_review_at <= NOW())::int AS "dueCount"
    FROM classes cl
    LEFT JOIN folders f ON f.class_id = cl.id
    LEFT JOIN decks d ON d.folder_id = f.id AND d.user_id = ${userId}
    LEFT JOIN cards c ON c.deck_id = d.id
    LEFT JOIN study_progress sp ON sp.card_id = c.id AND sp.user_id = ${userId}
    WHERE cl.user_id = ${userId}
    GROUP BY cl.id, cl.name, cl.description, f.id, f.name, d.id, d.name, d.created_at
    ORDER BY cl.sort_order ASC, f.sort_order ASC, d.created_at DESC
  `);

  const classes = new Map<string, LibraryExplorerResponse['classes'][number]>();
  const foldersByClass = new Map<
    string,
    Map<string, LibraryExplorerResponse['classes'][number]['folders'][number]>
  >();

  for (const row of rows) {
    let cls = classes.get(row.classId);
    if (!cls) {
      cls = {
        id: row.classId,
        name: row.className,
        description: row.classDescription,
        folderCount: 0,
        deckCount: 0,
        cardCount: 0,
        dueCount: 0,
        folders: [],
      };
      classes.set(row.classId, cls);
      foldersByClass.set(row.classId, new Map());
    }

    if (!row.folderId) continue;

    const folderMap = foldersByClass.get(row.classId)!;
    let folder = folderMap.get(row.folderId);
    if (!folder) {
      folder = {
        id: row.folderId,
        name: row.folderName ?? '',
        deckCount: 0,
        cardCount: 0,
        dueCount: 0,
        decks: [],
      };
      folderMap.set(row.folderId, folder);
      cls.folders.push(folder);
      cls.folderCount++;
    }

    if (!row.deckId) continue;

    folder.decks.push({
      id: row.deckId,
      name: row.deckName ?? '',
      cardCount: row.cardCount,
      dueCount: row.dueCount,
      updatedAt: toIso(row.deckUpdatedAt),
    });
    folder.deckCount++;
    folder.cardCount += row.cardCount;
    folder.dueCount += row.dueCount;
    cls.deckCount++;
    cls.cardCount += row.cardCount;
    cls.dueCount += row.dueCount;
  }

  return Array.from(classes.values());
}

async function loadRecentDeckIds(userId: string) {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT id
    FROM decks
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 8
  `);

  return rows.map((row) => row.id);
}

function toIso(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
