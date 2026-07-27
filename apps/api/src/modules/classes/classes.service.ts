import { eq, and, asc, sql } from 'drizzle-orm';
import { db } from '../../db';
import { classes } from '../../db/schema';
import { NotFoundError } from '../../shared/errors';
import {
  buildSortOrderAssignments,
  REORDER_UPDATE_BATCH_SIZE,
} from '../../shared/reorder';

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

  const assignments = buildSortOrderAssignments(userClasses, classIds);

  await db.transaction(async (tx) => {
    for (
      let offset = 0;
      offset < assignments.length;
      offset += REORDER_UPDATE_BATCH_SIZE
    ) {
      const chunk = assignments.slice(
        offset,
        offset + REORDER_UPDATE_BATCH_SIZE,
      );
      const values = sql.join(
        chunk.map(
          (assignment) =>
            sql`(${assignment.id}::uuid, ${assignment.sortOrder}::integer)`,
        ),
        sql.raw(', '),
      );
      await tx.execute(sql`
        UPDATE classes AS target
        SET sort_order = updates.sort_order
        FROM (VALUES ${values}) AS updates(id, sort_order)
        WHERE target.id = updates.id
      `);
    }
  });

  return { reordered: classIds.length };
}
