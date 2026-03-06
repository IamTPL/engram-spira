import { eq, and, asc } from 'drizzle-orm';
import { db } from '../../db';
import { folders, classes } from '../../db/schema';
import { NotFoundError } from '../../shared/errors';

async function verifyClassOwnership(classId: string, userId: string) {
  const [cls] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.userId, userId)))
    .limit(1);
  if (!cls) throw new NotFoundError('Class');
  return cls;
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

export async function reorder(
  classId: string,
  userId: string,
  folderIds: string[],
) {
  await verifyClassOwnership(classId, userId);

  const classFolders = await db
    .select({ id: folders.id })
    .from(folders)
    .where(eq(folders.classId, classId));

  const classFolderIds = new Set(classFolders.map((f) => f.id));
  for (const id of folderIds) {
    if (!classFolderIds.has(id)) {
      throw new NotFoundError('Folder');
    }
  }

  const updates = folderIds.map((id, index) =>
    db.update(folders).set({ sortOrder: index }).where(eq(folders.id, id)),
  );

  await Promise.all(updates);

  return { reordered: folderIds.length };
}
