import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { classes } from '../../db/schema';
import { NotFoundError, ForbiddenError } from '../../shared/errors';

export async function listByUser(userId: string) {
  return db.select().from(classes).where(eq(classes.userId, userId));
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
