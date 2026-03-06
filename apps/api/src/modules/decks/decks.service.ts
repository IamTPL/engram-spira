import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../db';
import { decks, folders, classes, cards } from '../../db/schema';
import { NotFoundError } from '../../shared/errors';

async function verifyFolderOwnership(folderId: string, userId: string) {
  const [result] = await db
    .select({ id: folders.id })
    .from(folders)
    .innerJoin(classes, eq(folders.classId, classes.id))
    .where(and(eq(folders.id, folderId), eq(classes.userId, userId)))
    .limit(1);
  if (!result) throw new NotFoundError('Folder');
  return result;
}

export async function listByFolder(folderId: string, userId: string) {
  await verifyFolderOwnership(folderId, userId);
  return db
    .select({
      id: decks.id,
      userId: decks.userId,
      folderId: decks.folderId,
      cardTemplateId: decks.cardTemplateId,
      name: decks.name,
      createdAt: decks.createdAt,
      cardCount: sql<number>`count(${cards.id})::int`,
    })
    .from(decks)
    .leftJoin(cards, eq(cards.deckId, decks.id))
    .where(eq(decks.folderId, folderId))
    .groupBy(decks.id);
}

export async function getById(id: string, userId: string) {
  // Single lookup using denormalized userId — no JOIN chain needed
  const [result] = await db
    .select()
    .from(decks)
    .where(and(eq(decks.id, id), eq(decks.userId, userId)))
    .limit(1);

  if (!result) throw new NotFoundError('Deck');
  return result;
}

export async function create(
  folderId: string,
  userId: string,
  data: { name: string; cardTemplateId: string },
) {
  await verifyFolderOwnership(folderId, userId);
  const [deck] = await db
    .insert(decks)
    // userId is now stored directly on the deck for fast ownership lookups
    .values({
      userId,
      folderId,
      name: data.name,
      cardTemplateId: data.cardTemplateId,
    })
    .returning();
  return deck;
}

export async function update(
  id: string,
  userId: string,
  data: { name?: string },
) {
  await getById(id, userId);
  const [updated] = await db
    .update(decks)
    .set(data)
    .where(eq(decks.id, id))
    .returning();
  return updated;
}

export async function remove(id: string, userId: string) {
  await getById(id, userId);
  await db.delete(decks).where(eq(decks.id, id));
}

/**
 * Move a deck to a different folder (must belong to the same user).
 */
export async function move(id: string, userId: string, folderId: string) {
  await getById(id, userId);
  await verifyFolderOwnership(folderId, userId);

  const [updated] = await db
    .update(decks)
    .set({ folderId })
    .where(eq(decks.id, id))
    .returning();

  return updated;
}
