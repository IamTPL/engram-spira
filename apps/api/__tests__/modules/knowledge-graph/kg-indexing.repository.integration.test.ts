import { afterAll, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { createPostgresKgIndexingRepository } from '../../../src/modules/knowledge-graph/kg-indexing.repository';
import {
  publishDeckIndex,
  snapshotDeckForIndexing,
} from '../../../src/modules/knowledge-graph/kg-indexing.service';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../src/db/migrations');
const createdDatabases = new Set<string>();

async function canUseDisposablePostgres() {
  const admin = postgres(ADMIN_URL, {
    max: 1,
    connect_timeout: 2,
    idle_timeout: 1,
  });
  try {
    await admin`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await admin.end();
  }
}

const integrationTest = (await canUseDisposablePostgres()) ? test : test.skip;

function assertDisposableDatabaseName(databaseName: string) {
  if (!/^engram_kg_index_test_[a-f0-9]+$/.test(databaseName)) {
    throw new Error(`Refusing unsafe disposable database name: ${databaseName}`);
  }
}

async function createDisposableDatabase() {
  const databaseName =
    `engram_kg_index_test_${crypto.randomUUID().replaceAll('-', '')}`;
  assertDisposableDatabaseName(databaseName);
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    createdDatabases.add(databaseName);
  } finally {
    await admin.end();
  }

  const databaseUrl = new URL(ADMIN_URL);
  databaseUrl.pathname = `/${databaseName}`;
  return {
    databaseName,
    sql: postgres(databaseUrl.toString(), {
      max: 2,
      onnotice: () => {},
    }),
  };
}

async function dropDisposableDatabase(databaseName: string) {
  assertDisposableDatabaseName(databaseName);
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    createdDatabases.delete(databaseName);
  } finally {
    await admin.end();
  }
}

afterAll(async () => {
  for (const databaseName of [...createdDatabases]) {
    await dropDisposableDatabase(databaseName);
  }
});

async function applyMigrations(sql: Sql) {
  const migrationFiles = (await readdir(MIGRATIONS_DIR))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();

  for (const migrationFile of migrationFiles) {
    const source = await Bun.file(resolve(MIGRATIONS_DIR, migrationFile)).text();
    const statements = source
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    await sql.begin(async (transaction) => {
      for (const statement of statements) {
        await transaction.unsafe(statement);
      }
    });
  }
}

type CardValues = {
  word: unknown;
  definition: unknown;
  ipa?: unknown;
  examples?: unknown;
};

async function seedVocabularyDeck(
  sql: Sql,
  cards: CardValues[],
  existingUserId?: string,
) {
  const user = existingUserId
    ? { id: existingUserId }
    : (await sql<{ id: string }[]>`
        INSERT INTO users (email, password_hash)
        VALUES (${`${crypto.randomUUID()}@example.com`}, 'hash')
        RETURNING id
      `)[0];
  const fixtureSuffix = crypto.randomUUID();
  const [template] = await sql<{ id: string }[]>`
    INSERT INTO card_templates (user_id, name)
    VALUES (${user.id}, ${`Vocabulary ${fixtureSuffix}`})
    RETURNING id
  `;
  const fields = await sql<{ id: string; name: string }[]>`
    INSERT INTO template_fields (
      template_id,
      name,
      field_type,
      side,
      sort_order
    )
    VALUES
      (${template.id}, 'word', 'text', 'front', 0),
      (${template.id}, 'definition', 'textarea', 'back', 1),
      (${template.id}, 'ipa', 'text', 'front', 2),
      (${template.id}, 'examples', 'json_array', 'back', 3)
    RETURNING id, name
  `;
  const fieldIds = Object.fromEntries(fields.map((field) => [field.name, field.id]));
  const [languageClass] = await sql<{ id: string }[]>`
    INSERT INTO classes (user_id, name)
    VALUES (${user.id}, ${`Languages ${fixtureSuffix}`})
    RETURNING id
  `;
  const [folder] = await sql<{ id: string }[]>`
    INSERT INTO folders (class_id, name)
    VALUES (${languageClass.id}, ${`Vietnamese ${fixtureSuffix}`})
    RETURNING id
  `;
  const [deck] = await sql<{ id: string }[]>`
    INSERT INTO decks (user_id, folder_id, card_template_id, name)
    VALUES (
      ${user.id},
      ${folder.id},
      ${template.id},
      ${`Vocabulary ${fixtureSuffix}`}
    )
    RETURNING id
  `;
  const cardIds: string[] = [];
  for (const [sortOrder, values] of cards.entries()) {
    const [card] = await sql<{ id: string }[]>`
      INSERT INTO cards (deck_id, sort_order)
      VALUES (${deck.id}, ${sortOrder})
      RETURNING id
    `;
    cardIds.push(card.id);
    const entries = Object.entries(values) as Array<
      [keyof CardValues, unknown]
    >;
    for (const [name, value] of entries) {
      await sql`
        INSERT INTO card_field_values (card_id, template_field_id, value)
        VALUES (${card.id}, ${fieldIds[name]}, ${sql.json(value as never)})
      `;
    }
  }

  return {
    userId: user.id,
    deckId: deck.id,
    cardIds,
    fieldIds,
  };
}

integrationTest(
  'publishes atomically, idempotently, and rejects a stale owned-deck snapshot',
  async () => {
    const { databaseName, sql } = await createDisposableDatabase();
    try {
      await applyMigrations(sql);
      const fixture = await seedVocabularyDeck(sql, [
        {
          word: 'má',
          definition: 'mother',
          examples: [],
        },
        {
          word: 'má',
          definition: 'cheek',
        },
        {
          word: 'má',
          definition: 'mother',
          ipa: '/maː/',
          examples: ['She is my mother.'],
        },
      ]);
      const repository = createPostgresKgIndexingRepository(sql);
      const indexingInput = {
        userId: fixture.userId,
        deckId: fixture.deckId,
        sourceLanguageTag: 'vi',
        definitionLanguageTag: 'en',
      };

      await expect(
        snapshotDeckForIndexing(
          { ...indexingInput, userId: crypto.randomUUID() },
          repository,
        ),
      ).rejects.toThrow('Deck not found');

      const staleSnapshot = await snapshotDeckForIndexing(
        indexingInput,
        repository,
      );
      await sql`
        UPDATE card_field_values
        SET value = ${sql.json('maternal parent')}
        WHERE card_id = ${fixture.cardIds[0]}
          AND template_field_id = ${fixture.fieldIds.definition}
      `;
      expect(
        await publishDeckIndex(
          { ...indexingInput, snapshot: staleSnapshot.snapshot },
          repository,
        ),
      ).toEqual({ outcome: 'stale' });
      expect(Array.from(
        await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM lexemes
          WHERE user_id = ${fixture.userId}
        `,
      )).toEqual([{ count: 0 }]);

      await sql`
        UPDATE card_field_values
        SET value = ${sql.json('mother')}
        WHERE card_id = ${fixture.cardIds[0]}
          AND template_field_id = ${fixture.fieldIds.definition}
      `;
      const currentSnapshot = await snapshotDeckForIndexing(
        indexingInput,
        repository,
      );
      const firstResult = await publishDeckIndex(
        { ...indexingInput, snapshot: currentSnapshot.snapshot },
        repository,
      );
      expect(firstResult).toEqual({
        outcome: 'published',
        stats: { lexemes: 1, senses: 2, mappings: 3 },
        nextStage: 'embeddings',
        progress: { indexedCards: 3 },
        statsPatch: {
          indexedLexemes: 1,
          indexedSenses: 2,
          indexedMappings: 3,
        },
      });

      const firstRows = await sql<
        {
          lexemeId: string;
          senseId: string;
          mappingId: string;
          cardId: string;
          normalizedDefinition: string;
          ipa: string | null;
          examples: string[];
        }[]
      >`
        SELECT
          l.id AS "lexemeId",
          ls.id AS "senseId",
          cs.id AS "mappingId",
          cs.card_id AS "cardId",
          ls.normalized_definition AS "normalizedDefinition",
          ls.ipa,
          ls.examples
        FROM lexemes l
        JOIN lexical_senses ls ON ls.lexeme_id = l.id
        JOIN card_senses cs ON cs.sense_id = ls.id
        WHERE l.user_id = ${fixture.userId}
        ORDER BY cs.card_id
      `;
      expect(new Set(firstRows.map((row) => row.lexemeId)).size).toBe(1);
      expect(new Set(firstRows.map((row) => row.senseId)).size).toBe(2);
      expect(firstRows.filter((row) => row.normalizedDefinition === 'mother'))
        .toHaveLength(2);
      expect(
        firstRows.find((row) => row.normalizedDefinition === 'mother'),
      ).toMatchObject({
        ipa: '/maː/',
        examples: ['She is my mother.'],
      });

      expect(
        await publishDeckIndex(
          { ...indexingInput, snapshot: currentSnapshot.snapshot },
          repository,
        ),
      ).toMatchObject({ outcome: 'published' });
      const secondRows = await sql<
        { lexemeId: string; senseId: string; mappingId: string; cardId: string }[]
      >`
        SELECT
          l.id AS "lexemeId",
          ls.id AS "senseId",
          cs.id AS "mappingId",
          cs.card_id AS "cardId"
        FROM lexemes l
        JOIN lexical_senses ls ON ls.lexeme_id = l.id
        JOIN card_senses cs ON cs.sense_id = ls.id
        WHERE l.user_id = ${fixture.userId}
        ORDER BY cs.card_id
      `;
      expect(Array.from(secondRows)).toEqual(
        firstRows.map(({ lexemeId, senseId, mappingId, cardId }) => ({
          lexemeId,
          senseId,
          mappingId,
          cardId,
        })),
      );

      const motherSenseId = firstRows.find(
        (row) => row.normalizedDefinition === 'mother',
      )!.senseId;
      const cheekSenseId = firstRows.find(
        (row) => row.normalizedDefinition === 'cheek',
      )!.senseId;
      await sql`
        INSERT INTO card_senses (card_id, sense_id, source, is_primary)
        VALUES (${fixture.cardIds[0]}, ${cheekSenseId}, 'manual', false)
      `;
      await sql`
        UPDATE lexical_senses
        SET
          definition = 'Existing richer definition',
          ipa = '/existing/',
          examples = ${sql.json(['Existing example'])}
        WHERE id = ${motherSenseId}
      `;
      expect(
        await publishDeckIndex(
          { ...indexingInput, snapshot: currentSnapshot.snapshot },
          repository,
        ),
      ).toMatchObject({ outcome: 'published' });
      expect(Array.from(
        await sql`
          SELECT definition, ipa, examples
          FROM lexical_senses
          WHERE id = ${motherSenseId}
        `,
      )).toEqual([
        {
          definition: 'mother',
          ipa: '/maː/',
          examples: ['She is my mother.'],
        },
      ]);

      await sql`
        UPDATE card_field_values
        SET value = ${sql.json('MÁ')}
        WHERE card_id IN (
          ${fixture.cardIds[0]},
          ${fixture.cardIds[1]},
          ${fixture.cardIds[2]}
        )
          AND template_field_id = ${fixture.fieldIds.word}
      `;
      await sql`
        UPDATE card_field_values
        SET value = ${sql.json(' Mother ')}
        WHERE card_id IN (${fixture.cardIds[0]}, ${fixture.cardIds[2]})
          AND template_field_id = ${fixture.fieldIds.definition}
      `;
      await sql`
        UPDATE card_field_values
        SET value = ${sql.json('/ma-new/')}
        WHERE card_id = ${fixture.cardIds[2]}
          AND template_field_id = ${fixture.fieldIds.ipa}
      `;
      await sql`
        UPDATE card_field_values
        SET value = ${sql.json(['Updated deterministic example'])}
        WHERE card_id = ${fixture.cardIds[2]}
          AND template_field_id = ${fixture.fieldIds.examples}
      `;
      const displayRefreshSnapshot = await snapshotDeckForIndexing(
        indexingInput,
        repository,
      );
      expect(
        await publishDeckIndex(
          {
            ...indexingInput,
            snapshot: displayRefreshSnapshot.snapshot,
          },
          repository,
        ),
      ).toMatchObject({ outcome: 'published' });
      expect(Array.from(
        await sql`
          SELECT l.lemma, ls.definition, ls.ipa, ls.examples
          FROM lexemes l
          JOIN lexical_senses ls ON ls.lexeme_id = l.id
          WHERE l.user_id = ${fixture.userId}
            AND ls.normalized_definition = 'mother'
        `,
      )).toEqual([
        {
          lemma: 'MÁ',
          definition: 'Mother',
          ipa: '/ma-new/',
          examples: ['Updated deterministic example'],
        },
      ]);

      await sql`
        UPDATE card_field_values
        SET value = ${sql.json('maternal parent')}
        WHERE card_id = ${fixture.cardIds[0]}
          AND template_field_id = ${fixture.fieldIds.definition}
      `;
      const changedSnapshot = await snapshotDeckForIndexing(
        indexingInput,
        repository,
      );
      await publishDeckIndex(
        { ...indexingInput, snapshot: changedSnapshot.snapshot },
        repository,
      );
      const changedMappings = await sql<
        {
          normalizedDefinition: string;
          source: string;
          isPrimary: boolean;
        }[]
      >`
        SELECT
          ls.normalized_definition AS "normalizedDefinition",
          cs.source,
          cs.is_primary AS "isPrimary"
        FROM card_senses cs
        JOIN lexical_senses ls ON ls.id = cs.sense_id
        WHERE cs.card_id = ${fixture.cardIds[0]}
        ORDER BY ls.normalized_definition
      `;
      expect(Array.from(changedMappings)).toEqual([
        {
          normalizedDefinition: 'cheek',
          source: 'manual',
          isPrimary: false,
        },
        {
          normalizedDefinition: 'maternal parent',
          source: 'deterministic',
          isPrimary: true,
        },
      ]);

      const rollbackFixture = await seedVocabularyDeck(sql, [
        { word: 'cha', definition: 'father' },
      ]);
      const rollbackInput = {
        userId: rollbackFixture.userId,
        deckId: rollbackFixture.deckId,
        sourceLanguageTag: 'vi',
        definitionLanguageTag: 'en',
      };
      const rollbackSnapshot = await snapshotDeckForIndexing(
        rollbackInput,
        repository,
      );
      await sql.unsafe(`
        CREATE FUNCTION reject_deterministic_mapping() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'injected mapping failure';
        END;
        $$;
        CREATE TRIGGER reject_deterministic_mapping
        BEFORE INSERT ON card_senses
        FOR EACH ROW
        WHEN (NEW.source = 'deterministic')
        EXECUTE FUNCTION reject_deterministic_mapping();
      `);
      await expect(
        publishDeckIndex(
          { ...rollbackInput, snapshot: rollbackSnapshot.snapshot },
          repository,
        ),
      ).rejects.toThrow('injected mapping failure');
      expect(Array.from(
        await sql<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM lexemes
          WHERE user_id = ${rollbackFixture.userId}
        `,
      )).toEqual([{ count: 0 }]);
    } finally {
      await sql.end();
      await dropDisposableDatabase(databaseName);
    }
  },
  30_000,
);

integrationTest(
  'retries concurrent unchanged decks that share a lexical identity',
  async () => {
    const { databaseName, sql } = await createDisposableDatabase();
    try {
      await applyMigrations(sql);
      const first = await seedVocabularyDeck(sql, [
        { word: 'bank', definition: 'ngân hàng' },
      ]);
      const second = await seedVocabularyDeck(
        sql,
        [{ word: 'bank', definition: 'ngân hàng' }],
        first.userId,
      );
      const repository = createPostgresKgIndexingRepository(sql);
      const firstInput = {
        userId: first.userId,
        deckId: first.deckId,
        sourceLanguageTag: 'en',
        definitionLanguageTag: 'vi',
      };
      const secondInput = {
        ...firstInput,
        deckId: second.deckId,
      };
      const [firstSnapshot, secondSnapshot] = await Promise.all([
        snapshotDeckForIndexing(firstInput, repository),
        snapshotDeckForIndexing(secondInput, repository),
      ]);

      const results = await Promise.all([
        publishDeckIndex(
          { ...firstInput, snapshot: firstSnapshot.snapshot },
          repository,
        ),
        publishDeckIndex(
          { ...secondInput, snapshot: secondSnapshot.snapshot },
          repository,
        ),
      ]);

      expect(results).toEqual([
        expect.objectContaining({ outcome: 'published' }),
        expect.objectContaining({ outcome: 'published' }),
      ]);
      expect(Array.from(
        await sql<{ lexemes: number; senses: number; mappings: number }[]>`
          SELECT
            (SELECT count(*)::int FROM lexemes) AS lexemes,
            (SELECT count(*)::int FROM lexical_senses) AS senses,
            (SELECT count(*)::int FROM card_senses) AS mappings
        `,
      )).toEqual([{ lexemes: 1, senses: 1, mappings: 2 }]);
    } finally {
      await sql.end();
      await dropDisposableDatabase(databaseName);
    }
  },
  30_000,
);
