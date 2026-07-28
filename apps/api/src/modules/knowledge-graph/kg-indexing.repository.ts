import type { Sql } from 'postgres';
import { pgClient } from '../../db';
import { NotFoundError } from '../../shared/errors';
import type {
  DeckIndexingPlan,
  DeckIndexingRepository,
  DeckIndexingStats,
  DeckIndexingTransaction,
  DeckVocabularySource,
} from './kg-indexing.service';

type QuerySql = Sql;

type DeckRow = {
  id: string;
  templateId: string;
};

type TemplateFieldRow = {
  id: string;
  name: string;
};

type CardRow = {
  id: string;
};

type FieldValueRow = {
  cardId: string;
  templateFieldId: string;
  value: unknown;
};

function identityKey(parts: string[]): string {
  return JSON.stringify(parts);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function selectOwnedDeck(
  sql: QuerySql,
  userId: string,
  deckId: string,
  lock: boolean,
): Promise<DeckRow> {
  const rows = lock
    ? await sql<DeckRow[]>`
        SELECT d.id, d.card_template_id AS "templateId"
        FROM decks d
        WHERE d.id = ${deckId}
          AND d.user_id = ${userId}
        FOR UPDATE OF d
      `
    : await sql<DeckRow[]>`
        SELECT d.id, d.card_template_id AS "templateId"
        FROM decks d
        WHERE d.id = ${deckId}
          AND d.user_id = ${userId}
      `;
  const deck = rows[0];
  if (!deck) throw new NotFoundError('Deck');
  return deck;
}

async function loadTemplateFields(
  sql: QuerySql,
  templateId: string,
  lock: boolean,
): Promise<TemplateFieldRow[]> {
  if (lock) {
    await sql`
      SELECT id
      FROM card_templates
      WHERE id = ${templateId}
      FOR UPDATE
    `;
    return sql<TemplateFieldRow[]>`
      SELECT id, name
      FROM template_fields
      WHERE template_id = ${templateId}
      ORDER BY id
      FOR UPDATE
    `;
  }

  return sql<TemplateFieldRow[]>`
    SELECT id, name
    FROM template_fields
    WHERE template_id = ${templateId}
    ORDER BY id
  `;
}

async function loadCards(
  sql: QuerySql,
  userId: string,
  deckId: string,
  lock: boolean,
): Promise<CardRow[]> {
  if (lock) {
    return sql<CardRow[]>`
      SELECT c.id
      FROM cards c
      JOIN decks d ON d.id = c.deck_id
      WHERE d.id = ${deckId}
        AND d.user_id = ${userId}
      ORDER BY c.id
      FOR UPDATE OF c
    `;
  }

  return sql<CardRow[]>`
    SELECT c.id
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    WHERE d.id = ${deckId}
      AND d.user_id = ${userId}
    ORDER BY c.id
  `;
}

async function loadFieldValues(
  sql: QuerySql,
  userId: string,
  deckId: string,
  lock: boolean,
): Promise<FieldValueRow[]> {
  if (lock) {
    return sql<FieldValueRow[]>`
      SELECT
        cfv.card_id AS "cardId",
        cfv.template_field_id AS "templateFieldId",
        cfv.value
      FROM card_field_values cfv
      JOIN cards c ON c.id = cfv.card_id
      JOIN decks d ON d.id = c.deck_id
      WHERE d.id = ${deckId}
        AND d.user_id = ${userId}
      ORDER BY cfv.card_id, cfv.template_field_id
      FOR UPDATE OF cfv
    `;
  }

  return sql<FieldValueRow[]>`
    SELECT
      cfv.card_id AS "cardId",
      cfv.template_field_id AS "templateFieldId",
      cfv.value
    FROM card_field_values cfv
    JOIN cards c ON c.id = cfv.card_id
    JOIN decks d ON d.id = c.deck_id
    WHERE d.id = ${deckId}
      AND d.user_id = ${userId}
    ORDER BY cfv.card_id, cfv.template_field_id
  `;
}

async function loadDeckSource(
  sql: QuerySql,
  userId: string,
  deckId: string,
  lock: boolean,
): Promise<DeckVocabularySource> {
  const deck = await selectOwnedDeck(sql, userId, deckId, lock);
  const templateFields = await loadTemplateFields(sql, deck.templateId, lock);
  const cards = await loadCards(sql, userId, deckId, lock);
  const fieldValues = await loadFieldValues(sql, userId, deckId, lock);
  const fieldValuesByCard = new Map<string, FieldValueRow[]>();
  for (const fieldValue of fieldValues) {
    const values = fieldValuesByCard.get(fieldValue.cardId) ?? [];
    values.push(fieldValue);
    fieldValuesByCard.set(fieldValue.cardId, values);
  }

  return {
    deckId: deck.id,
    templateId: deck.templateId,
    templateFields,
    cards: cards.map((card) => ({
      cardId: card.id,
      fieldValues: (fieldValuesByCard.get(card.id) ?? []).map(
        ({ templateFieldId, value }) => ({ templateFieldId, value }),
      ),
    })),
  };
}

async function assertOwnedMappings(
  sql: Sql,
  userId: string,
  deckId: string,
  cardIds: string[],
): Promise<void> {
  if (cardIds.length === 0) return;
  const ownedCards = await sql<{ id: string }[]>`
    SELECT c.id
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    WHERE d.id = ${deckId}
      AND d.user_id = ${userId}
      AND c.id = ANY(${sql.array(cardIds)}::uuid[])
    ORDER BY c.id
  `;
  if (ownedCards.length !== cardIds.length) {
    throw new NotFoundError('Deck');
  }
}

async function upsertLexemes(
  sql: Sql,
  userId: string,
  plan: DeckIndexingPlan,
): Promise<Map<string, string>> {
  if (plan.lexemes.length === 0) return new Map();
  const input = plan.lexemes
    .map((lexeme) => ({
      languageTag: lexeme.languageTag,
      lemma: lexeme.lemma,
      normalizedLemma: lexeme.normalizedLemma,
    }))
    .sort(
      (left, right) =>
        compareText(left.languageTag, right.languageTag) ||
        compareText(left.normalizedLemma, right.normalizedLemma),
    );
  const rows = await sql<
    { id: string; languageTag: string; normalizedLemma: string }[]
  >`
    INSERT INTO lexemes (
      user_id,
      language_tag,
      lemma,
      normalized_lemma
    )
    SELECT
      ${userId},
      candidate."languageTag",
      candidate.lemma,
      candidate."normalizedLemma"
    FROM jsonb_to_recordset(${sql.json(input)}) AS candidate(
      "languageTag" text,
      lemma text,
      "normalizedLemma" text
    )
    ORDER BY candidate."languageTag", candidate."normalizedLemma"
    ON CONFLICT (
      user_id,
      language_tag,
      normalized_lemma
    )
    DO UPDATE SET
      lemma = EXCLUDED.lemma,
      updated_at = CASE
        WHEN lexemes.lemma IS DISTINCT FROM EXCLUDED.lemma
          THEN now()
        ELSE lexemes.updated_at
      END
    RETURNING
      id,
      language_tag AS "languageTag",
      normalized_lemma AS "normalizedLemma"
  `;

  return new Map(
    rows.map((row) => [
      identityKey([row.languageTag, row.normalizedLemma]),
      row.id,
    ]),
  );
}

async function upsertSenses(
  sql: Sql,
  plan: DeckIndexingPlan,
  lexemeIds: Map<string, string>,
): Promise<Map<string, string>> {
  if (plan.senses.length === 0) return new Map();
  const input = plan.senses
    .map((sense) => {
      const lexemeId = lexemeIds.get(sense.lexemeKey);
      if (!lexemeId) throw new Error('Indexing lexeme upsert returned no identity');
      return {
        planKey: sense.key,
        lexemeId,
        partOfSpeech: sense.partOfSpeech,
        definitionLanguageTag: sense.definitionLanguageTag,
        definition: sense.definition,
        normalizedDefinition: sense.normalizedDefinition,
        ipa: sense.ipa,
        examples: sense.examples,
      };
    })
    .sort(
      (left, right) =>
        compareText(left.lexemeId, right.lexemeId) ||
        compareText(left.partOfSpeech, right.partOfSpeech) ||
        compareText(
          left.definitionLanguageTag,
          right.definitionLanguageTag,
        ) ||
        compareText(left.normalizedDefinition, right.normalizedDefinition),
    );
  const rows = await sql<
    {
      id: string;
      lexemeId: string;
      partOfSpeech: string;
      definitionLanguageTag: string;
      normalizedDefinition: string;
    }[]
  >`
    INSERT INTO lexical_senses (
      lexeme_id,
      part_of_speech,
      definition_language_tag,
      definition,
      normalized_definition,
      ipa,
      examples
    )
    SELECT
      candidate."lexemeId",
      candidate."partOfSpeech",
      candidate."definitionLanguageTag",
      candidate.definition,
      candidate."normalizedDefinition",
      candidate.ipa,
      candidate.examples
    FROM jsonb_to_recordset(${sql.json(input)}) AS candidate(
      "planKey" text,
      "lexemeId" uuid,
      "partOfSpeech" text,
      "definitionLanguageTag" text,
      definition text,
      "normalizedDefinition" text,
      ipa text,
      examples jsonb
    )
    ORDER BY
      candidate."lexemeId",
      candidate."partOfSpeech",
      candidate."definitionLanguageTag",
      candidate."normalizedDefinition"
    ON CONFLICT (
      lexeme_id,
      part_of_speech,
      definition_language_tag,
      normalized_definition
    )
    DO UPDATE SET
      definition = EXCLUDED.definition,
      ipa = CASE
        -- Empty deterministic metadata must not erase an enriched sense, but
        -- a present value is the current structured-card source of truth.
        WHEN EXCLUDED.ipa IS NOT NULL THEN EXCLUDED.ipa
        ELSE lexical_senses.ipa
      END,
      examples = CASE
        WHEN EXCLUDED.examples <> '[]'::jsonb THEN EXCLUDED.examples
        ELSE lexical_senses.examples
      END,
      updated_at = CASE
        WHEN lexical_senses.definition IS DISTINCT FROM EXCLUDED.definition
          OR (
            EXCLUDED.ipa IS NOT NULL
            AND lexical_senses.ipa IS DISTINCT FROM EXCLUDED.ipa
          )
          OR (
            EXCLUDED.examples <> '[]'::jsonb
            AND lexical_senses.examples IS DISTINCT FROM EXCLUDED.examples
          )
          THEN now()
        ELSE lexical_senses.updated_at
      END
    RETURNING
      id,
      lexeme_id AS "lexemeId",
      part_of_speech AS "partOfSpeech",
      definition_language_tag AS "definitionLanguageTag",
      normalized_definition AS "normalizedDefinition"
  `;

  const planKeyByDatabaseIdentity = new Map(
    input.map((sense) => [
      identityKey([
        sense.lexemeId,
        sense.partOfSpeech,
        sense.definitionLanguageTag,
        sense.normalizedDefinition,
      ]),
      sense.planKey,
    ]),
  );
  return new Map(
    rows.map((row) => {
      const databaseIdentity = identityKey([
        row.lexemeId,
        row.partOfSpeech,
        row.definitionLanguageTag,
        row.normalizedDefinition,
      ]);
      const planKey = planKeyByDatabaseIdentity.get(databaseIdentity);
      if (!planKey) throw new Error('Indexing sense upsert returned no identity');
      return [planKey, row.id];
    }),
  );
}

async function upsertMappings(
  sql: Sql,
  plan: DeckIndexingPlan,
  senseIds: Map<string, string>,
): Promise<void> {
  if (plan.mappings.length === 0) return;
  const input = plan.mappings
    .map((mapping) => {
      const senseId = senseIds.get(mapping.senseKey);
      if (!senseId) {
        throw new Error('Indexing sense upsert returned no mapping identity');
      }
      return { cardId: mapping.cardId, senseId };
    })
    .sort(
      (left, right) =>
        compareText(left.cardId, right.cardId) ||
        compareText(left.senseId, right.senseId),
    );

  await sql`
    WITH desired AS (
      SELECT candidate."cardId" AS card_id, candidate."senseId" AS sense_id
      FROM jsonb_to_recordset(${sql.json(input)}) AS candidate(
        "cardId" uuid,
        "senseId" uuid
      )
      ORDER BY candidate."cardId", candidate."senseId"
    )
    DELETE FROM card_senses existing
    USING desired
    WHERE existing.card_id = desired.card_id
      AND existing.source = 'deterministic'
      AND existing.sense_id <> desired.sense_id
  `;
  await sql`
    WITH desired AS (
      SELECT candidate."cardId" AS card_id, candidate."senseId" AS sense_id
      FROM jsonb_to_recordset(${sql.json(input)}) AS candidate(
        "cardId" uuid,
        "senseId" uuid
      )
      ORDER BY candidate."cardId", candidate."senseId"
    )
    UPDATE card_senses existing
    SET is_primary = false, updated_at = now()
    FROM desired
    WHERE existing.card_id = desired.card_id
      AND existing.is_primary = true
      AND existing.sense_id <> desired.sense_id
  `;
  await sql`
    INSERT INTO card_senses (
      card_id,
      sense_id,
      source,
      is_primary
    )
    SELECT
      candidate."cardId",
      candidate."senseId",
      'deterministic',
      true
    FROM jsonb_to_recordset(${sql.json(input)}) AS candidate(
      "cardId" uuid,
      "senseId" uuid
    )
    ORDER BY candidate."cardId", candidate."senseId"
    ON CONFLICT (card_id, sense_id)
    DO UPDATE SET
      source = 'deterministic',
      is_primary = true,
      updated_at = now()
  `;
}

async function persistPlan(
  sql: Sql,
  userId: string,
  deckId: string,
  plan: DeckIndexingPlan,
): Promise<DeckIndexingStats> {
  await assertOwnedMappings(
    sql,
    userId,
    deckId,
    plan.mappings.map((mapping) => mapping.cardId),
  );
  const lexemeIds = await upsertLexemes(sql, userId, plan);
  const senseIds = await upsertSenses(sql, plan, lexemeIds);
  await upsertMappings(sql, plan, senseIds);

  return {
    lexemes: plan.lexemes.length,
    senses: plan.senses.length,
    mappings: plan.mappings.length,
  };
}

export function createPostgresKgIndexingRepository(
  sql: Sql = pgClient,
): DeckIndexingRepository {
  return {
    loadDeckSource: (userId, deckId) =>
      sql.begin('isolation level repeatable read read only', (transaction) =>
        loadDeckSource(transaction as unknown as Sql, userId, deckId, false),
      ),
    transaction: async <T>(
      userId: string,
      operation: (transaction: DeckIndexingTransaction) => Promise<T>,
    ): Promise<T> => {
      const result = await sql.begin(
        'isolation level serializable',
        async (rawTransaction) => {
          const transaction = rawTransaction as unknown as Sql;
          const scopedTransaction: DeckIndexingTransaction = {
            loadDeckSource: (transactionUserId: string, deckId: string) => {
              if (transactionUserId !== userId) {
                throw new NotFoundError('Deck');
              }
              return loadDeckSource(
                transaction,
                transactionUserId,
                deckId,
                true,
              );
            },
            persistPlan: (
              transactionUserId: string,
              deckId: string,
              plan: DeckIndexingPlan,
            ) => {
              if (transactionUserId !== userId) {
                throw new NotFoundError('Deck');
              }
              return persistPlan(
                transaction,
                transactionUserId,
                deckId,
                plan,
              );
            },
          };
          return operation(scopedTransaction);
        },
      );
      return result as T;
    },
  };
}
