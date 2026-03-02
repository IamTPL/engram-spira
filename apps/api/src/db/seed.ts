import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { hash } from '@node-rs/argon2';
import { eq, and, isNull } from 'drizzle-orm';
import * as schema from './schema';
import {
  FIELD_TYPES,
  FIELD_SIDES,
  SYSTEM_TEMPLATES,
} from '../shared/constants';

const DATABASE_URL = process.env.DATABASE_URL!;

async function seed() {
  const client = postgres(DATABASE_URL);
  const db = drizzle(client, { schema });

  // ── 0. Clean up duplicate system templates ──────────────────────────
  console.log('Cleaning up duplicate system templates...');
  const allSystem = await db
    .select()
    .from(schema.cardTemplates)
    .where(eq(schema.cardTemplates.isSystem, true));

  // Group by name, keep only the oldest (first created) per name
  const grouped = new Map<string, (typeof allSystem)[number][]>();
  for (const t of allSystem) {
    const list = grouped.get(t.name) ?? [];
    list.push(t);
    grouped.set(t.name, list);
  }

  for (const [name, dupes] of grouped) {
    if (dupes.length <= 1) continue;
    // Sort by createdAt ascending, keep the first one
    dupes.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const toDelete = dupes.slice(1);

    // Re-point any decks referencing duplicates to the original
    const keepId = dupes[0].id;
    for (const dup of toDelete) {
      await db
        .update(schema.decks)
        .set({ cardTemplateId: keepId })
        .where(eq(schema.decks.cardTemplateId, dup.id));
      await db
        .delete(schema.cardTemplates)
        .where(eq(schema.cardTemplates.id, dup.id));
    }
    console.log(
      `  [CLEANUP] "${name}": removed ${toDelete.length} duplicate(s), kept id=${keepId}`,
    );
  }

  // ── 1. Seed test user ───────────────────────────────────────────────
  console.log('Seeding test user...');
  const passwordHash = await hash('password123');
  await db
    .insert(schema.users)
    .values({
      email: 'test@example.com',
      passwordHash,
    })
    .onConflictDoNothing();
  console.log('  [OK] Test user: test@example.com / password123');

  // ── 2. Seed system templates (idempotent) ───────────────────────────
  console.log('Seeding default templates...');

  // Helper: only create template + fields if it doesn't exist yet
  async function ensureSystemTemplate(
    name: string,
    description: string,
    fields: {
      name: string;
      fieldType: string;
      side: string;
      sortOrder: number;
      isRequired: boolean;
      config: Record<string, unknown>;
    }[],
  ) {
    const [existing] = await db
      .select()
      .from(schema.cardTemplates)
      .where(
        and(
          eq(schema.cardTemplates.name, name),
          eq(schema.cardTemplates.isSystem, true),
        ),
      )
      .limit(1);

    if (existing) {
      console.log(`  [SKIP] "${name}" already exists (id=${existing.id})`);
      return existing;
    }

    const [template] = await db
      .insert(schema.cardTemplates)
      .values({ name, description, isSystem: true, userId: null })
      .returning();

    await db
      .insert(schema.templateFields)
      .values(fields.map((f) => ({ ...f, templateId: template.id })));

    console.log(
      `  [OK] Created "${name}" template with ${fields.length} fields`,
    );
    return template;
  }

  // 2a. Vocabulary Template
  await ensureSystemTemplate(
    SYSTEM_TEMPLATES.VOCABULARY,
    'Learn vocabulary with word, type, IPA pronunciation, definition and examples',
    [
      {
        name: 'word',
        fieldType: FIELD_TYPES.TEXT,
        side: FIELD_SIDES.FRONT,
        sortOrder: 1,
        isRequired: true,
        config: { placeholder: 'Enter the word' },
      },
      {
        name: 'type',
        fieldType: FIELD_TYPES.TEXT,
        side: FIELD_SIDES.FRONT,
        sortOrder: 2,
        isRequired: false,
        config: { placeholder: 'noun, verb, adj...' },
      },
      {
        name: 'ipa',
        fieldType: FIELD_TYPES.TEXT,
        side: FIELD_SIDES.FRONT,
        sortOrder: 3,
        isRequired: false,
        config: { placeholder: '/wɜːrd/' },
      },
      {
        name: 'definition',
        fieldType: FIELD_TYPES.TEXTAREA,
        side: FIELD_SIDES.BACK,
        sortOrder: 1,
        isRequired: true,
        config: { placeholder: 'Enter the definition' },
      },
      {
        name: 'examples',
        fieldType: FIELD_TYPES.JSON_ARRAY,
        side: FIELD_SIDES.BACK,
        sortOrder: 2,
        isRequired: false,
        config: { maxItems: 5, placeholder: 'Enter an example sentence' },
      },
    ],
  );

  // 2b. Basic Q&A Template
  await ensureSystemTemplate(
    SYSTEM_TEMPLATES.BASIC_QA,
    'Simple question and answer flashcard',
    [
      {
        name: 'question',
        fieldType: FIELD_TYPES.TEXTAREA,
        side: FIELD_SIDES.FRONT,
        sortOrder: 1,
        isRequired: true,
        config: { placeholder: 'Enter the question' },
      },
      {
        name: 'answer',
        fieldType: FIELD_TYPES.TEXTAREA,
        side: FIELD_SIDES.BACK,
        sortOrder: 1,
        isRequired: true,
        config: { placeholder: 'Enter the answer' },
      },
    ],
  );

  console.log('Seeding complete!');
  await client.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
