import { eq, and, asc } from 'drizzle-orm';
import { db } from '../../db';
import { classes } from '../../db/schema';
import { NotFoundError } from '../../shared/errors';

export async function listByUser(userId: string) {
  return db
    .select()
    .from(classes)
    .where(eq(classes.userId, userId))
    .orderBy(asc(classes.sortOrder));
}

export async function getById(id: string, userId: string) {
  const [cls] = await db
    .select()
    .from(classes)
    .where(and(eq(classes.id, id), eq(classes.userId, userId)))
    .limit(1);

  if (!cls) throw new NotFoundError('Class');
  return cls;
}

export async function create(
  userId: string,
  data: { name: string; description?: string },
) {
  const [cls] = await db
    .insert(classes)
    .values({ userId, name: data.name, description: data.description ?? null })
    .returning();
  return cls;
}

export async function update(
  id: string,
  userId: string,
  data: { name?: string; description?: string },
) {
  const cls = await getById(id, userId);
  const [updated] = await db
    .update(classes)
    .set(data)
    .where(eq(classes.id, cls.id))
    .returning();
  return updated;
}

export async function remove(id: string, userId: string) {
  const cls = await getById(id, userId);
  await db.delete(classes).where(eq(classes.id, cls.id));
}

export async function reorder(userId: string, classIds: string[]) {
  // Verify all classes belong to user
  const userClasses = await db
    .select({ id: classes.id, sortOrder: classes.sortOrder })
    .from(classes)
    .where(eq(classes.userId, userId))
    .orderBy(asc(classes.sortOrder));

  const userClassIds = new Set(userClasses.map((c) => c.id));
  for (const id of classIds) {
    if (!userClassIds.has(id)) {
      throw new NotFoundError('Class');
    }
  }

  const indexMap = new Map(classIds.map((id, i) => [id, i]));
  let nextOrder = classIds.length;

  await db.transaction(async (tx) => {
    const updates = userClasses.map((c) => {
      let newOrder = indexMap.get(c.id);
      if (newOrder === undefined) {
        newOrder = nextOrder++;
      }
      return tx.update(classes).set({ sortOrder: newOrder }).where(eq(classes.id, c.id));
    });
    
    await Promise.all(updates);
  });

  return { reordered: classIds.length };
}
