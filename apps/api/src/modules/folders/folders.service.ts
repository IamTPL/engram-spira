import { eq, and, asc, sql } from 'drizzle-orm';
import { db } from '../../db';
import { folders, classes } from '../../db/schema';
import { NotFoundError } from '../../shared/errors';
import {
  buildSortOrderAssignments,
  REORDER_UPDATE_BATCH_SIZE,
} from '../../shared/reorder';

async function verifyClassOwnership(classId: string, userId: string) {
  const [cls] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.userId, userId)))
    .limit(1);
  if (!cls) throw new NotFoundError('Class');
  return cls;
}

export async function listByUser(userId: string) {
  return db
    .select({
      id: folders.id,
      name: folders.name,
      classId: folders.classId,
      sortOrder: folders.sortOrder,
    })
    .from(folders)
    .innerJoin(classes, eq(folders.classId, classes.id))
    .where(eq(classes.userId, userId))
    .orderBy(asc(folders.sortOrder));
}

export async function listByClass(classId: string, userId: string) {
  await verifyClassOwnership(classId, userId);
  return db
    .select()
    .from(folders)
    .where(eq(folders.classId, classId))
    .orderBy(asc(folders.sortOrder));
}

export async function getById(id: string, userId: string) {
  const [folder] = await db
    .select()
    .from(folders)
    .innerJoin(classes, eq(folders.classId, classes.id))
    .where(and(eq(folders.id, id), eq(classes.userId, userId)))
    .limit(1);

  if (!folder) throw new NotFoundError('Folder');
  return folder.folders;
}

export async function create(
  classId: string,
  userId: string,
  data: { name: string },
) {
  await verifyClassOwnership(classId, userId);
  const [folder] = await db
    .insert(folders)
    .values({ classId, name: data.name })
    .returning();
  return folder;
}

export async function update(
  id: string,
  userId: string,
  data: { name?: string },
) {
  await getById(id, userId);
  const [updated] = await db
    .update(folders)
    .set(data)
    .where(eq(folders.id, id))
    .returning();
  return updated;
}

export async function remove(id: string, userId: string) {
  await getById(id, userId);
  await db.delete(folders).where(eq(folders.id, id));
}

/**
 * Move a folder to a different class (must belong to the same user).
 */
export async function move(id: string, userId: string, classId: string) {
  await getById(id, userId);
  await verifyClassOwnership(classId, userId);

  const [updated] = await db
    .update(folders)
    .set({ classId })
    .where(eq(folders.id, id))
    .returning();

  return updated;
}

export async function reorder(
  classId: string,
  userId: string,
  folderIds: string[],
) {
  await verifyClassOwnership(classId, userId);

  const classFolders = await db
    .select({ id: folders.id, sortOrder: folders.sortOrder })
    .from(folders)
    .where(eq(folders.classId, classId))
    .orderBy(asc(folders.sortOrder));

  const classFolderIds = new Set(classFolders.map((f) => f.id));
  for (const id of folderIds) {
    if (!classFolderIds.has(id)) {
      throw new NotFoundError('Folder');
    }
  }

  const assignments = buildSortOrderAssignments(classFolders, folderIds);

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
        UPDATE folders AS target
        SET sort_order = updates.sort_order
        FROM (VALUES ${values}) AS updates(id, sort_order)
        WHERE target.id = updates.id
      `);
    }
  });

  return { reordered: folderIds.length };
}
