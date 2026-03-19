import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { cardTemplates, templateFields, decks } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../shared/errors';

// ── In-process cache for system templates ─────────────────────────────────────
// System templates are seeded once and never mutated at runtime.
// Caching them avoids repeated DB round-trips on every "create deck" open.
type CachedTemplate = typeof cardTemplates.$inferSelect;
let _systemTemplatesCache: CachedTemplate[] | null = null;

async function getSystemTemplates(): Promise<CachedTemplate[]> {
  if (_systemTemplatesCache) return _systemTemplatesCache;
  _systemTemplatesCache = await db
    .select()
    .from(cardTemplates)
    .where(eq(cardTemplates.isSystem, true));
  return _systemTemplatesCache;
}

/** Call this if a system template is ever added/removed at runtime. */
export function invalidateSystemTemplatesCache() {
  _systemTemplatesCache = null;
}
// ─────────────────────────────────────────────────────────────────────────────

export async function listAvailable(userId: string) {
  // Fetch system templates from cache + user templates from DB in parallel
  const [systemTemplates, userTemplates] = await Promise.all([
    getSystemTemplates(),
    db.select().from(cardTemplates).where(eq(cardTemplates.userId, userId)),
  ]);
  return [...systemTemplates, ...userTemplates];
}

export async function getWithFields(id: string) {
  const [templateRows, fields] = await Promise.all([
    db.select().from(cardTemplates).where(eq(cardTemplates.id, id)).limit(1),
    db
      .select()
      .from(templateFields)
      .where(eq(templateFields.templateId, id))
      .orderBy(templateFields.side, templateFields.sortOrder),
  ]);

  const template = templateRows[0];
  if (!template) throw new NotFoundError('Card template');

  return { ...template, fields };
}

export async function create(
  userId: string,
  data: {
    name: string;
    description?: string;
    fields: {
      name: string;
      fieldType: string;
      side: string;
      sortOrder: number;
      isRequired?: boolean;
      config?: unknown;
    }[];
  },
) {
  const [template] = await db
    .insert(cardTemplates)
    .values({
      userId,
      name: data.name,
      description: data.description ?? null,
      isSystem: false,
    })
    .returning();

  if (data.fields.length > 0) {
    await db.insert(templateFields).values(
      data.fields.map((f) => ({
        templateId: template.id,
        name: f.name,
        fieldType: f.fieldType,
        side: f.side,
        sortOrder: f.sortOrder,
        isRequired: f.isRequired ?? false,
        config: f.config ?? null,
      })),
    );
  }

  return getWithFields(template.id);
}

export async function update(
  userId: string,
  templateId: string,
  data: {
    name?: string;
    description?: string;
    fields?: {
      name: string;
      fieldType: string;
      side: string;
      sortOrder: number;
      isRequired?: boolean;
      config?: unknown;
    }[];
  },
) {
  // Verify ownership — only user templates can be updated
  const [template] = await db
    .select()
    .from(cardTemplates)
    .where(eq(cardTemplates.id, templateId))
    .limit(1);

  if (!template) throw new NotFoundError('Card template');
  if (template.isSystem) {
    throw new ValidationError('Cannot modify system templates');
  }
  if (template.userId !== userId) {
    throw new NotFoundError('Card template');
  }

  // Update template metadata
  if (data.name || data.description !== undefined) {
    await db
      .update(cardTemplates)
      .set({
        ...(data.name ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
      })
      .where(eq(cardTemplates.id, templateId));
  }

  // Replace fields if provided
  if (data.fields) {
    await db
      .delete(templateFields)
      .where(eq(templateFields.templateId, templateId));

    if (data.fields.length > 0) {
      await db.insert(templateFields).values(
        data.fields.map((f) => ({
          templateId,
          name: f.name,
          fieldType: f.fieldType,
          side: f.side,
          sortOrder: f.sortOrder,
          isRequired: f.isRequired ?? false,
          config: f.config ?? null,
        })),
      );
    }
  }

  return getWithFields(templateId);
}

export async function remove(userId: string, templateId: string) {
  const [template] = await db
    .select()
    .from(cardTemplates)
    .where(eq(cardTemplates.id, templateId))
    .limit(1);

  if (!template) throw new NotFoundError('Card template');
  if (template.isSystem) {
    throw new ValidationError('Cannot delete system templates');
  }
  if (template.userId !== userId) {
    throw new NotFoundError('Card template');
  }

  // Check if template is in use by any decks
  const [inUse] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(eq(decks.cardTemplateId, templateId))
    .limit(1);

  if (inUse) {
    throw new ValidationError(
      'Cannot delete template that is in use by decks. Reassign decks first.',
    );
  }

  await db.delete(cardTemplates).where(eq(cardTemplates.id, templateId));
  return { deleted: true };
}
