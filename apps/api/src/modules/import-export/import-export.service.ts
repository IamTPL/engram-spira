import { eq, and, desc, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { cards, cardFieldValues, decks, templateFields } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../shared/errors';

// ── Helpers ──────────────────────────────────────────────────

async function getDeckWithTemplate(deckId: string, userId: string) {
  const [deck] = await db
    .select({
      id: decks.id,
      cardTemplateId: decks.cardTemplateId,
      name: decks.name,
    })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);
  if (!deck) throw new NotFoundError('Deck');
  return deck;
}

async function getTemplateFields(templateId: string) {
  return db
    .select({
      id: templateFields.id,
      name: templateFields.name,
      fieldType: templateFields.fieldType,
      side: templateFields.side,
      sortOrder: templateFields.sortOrder,
    })
    .from(templateFields)
    .where(eq(templateFields.templateId, templateId))
    .orderBy(templateFields.sortOrder);
}

/**
 * Parse CSV text into rows of string arrays.
 * Handles quoted fields with commas and newlines inside quotes.
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        row.push(field.trim());
        if (row.some((f) => f.length > 0)) rows.push(row);
        row = [];
        field = '';
        if (ch === '\r') i++; // skip \n in \r\n
      } else {
        field += ch;
      }
    }
  }

  // Last field/row
  row.push(field.trim());
  if (row.some((f) => f.length > 0)) rows.push(row);

  return rows;
}

// ── Import ───────────────────────────────────────────────────

/**
 * Import cards from CSV text into a deck.
 *
 * CSV format:
 *   Header row with template field names (e.g. "Front,Back")
 *   Each subsequent row is a card.
 *
 * Returns the number of cards created and any skipped rows.
 */
export async function importCSV(
  deckId: string,
  userId: string,
  csvText: string,
) {
  const deck = await getDeckWithTemplate(deckId, userId);
  const fields = await getTemplateFields(deck.cardTemplateId);

  if (fields.length === 0) {
    throw new ValidationError('Deck template has no fields configured');
  }

  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    throw new ValidationError(
      'CSV must have a header row and at least one data row',
    );
  }

  const [headerRow, ...dataRows] = rows;

  // Map CSV column index → template field id (by name, case-insensitive)
  const fieldNameMap = new Map(fields.map((f) => [f.name.toLowerCase(), f.id]));
  const columnToFieldId: (string | null)[] = headerRow.map(
    (col) => fieldNameMap.get(col.toLowerCase()) ?? null,
  );

  // At least one column must match a template field
  const matchedCount = columnToFieldId.filter((id) => id !== null).length;
  if (matchedCount === 0) {
    const expected = fields.map((f) => f.name).join(', ');
    throw new ValidationError(
      `No CSV columns matched the template fields. Expected: ${expected}`,
    );
  }

  // Get current max sort order
  const existing = await db
    .select({ sortOrder: cards.sortOrder })
    .from(cards)
    .where(eq(cards.deckId, deckId))
    .orderBy(desc(cards.sortOrder))
    .limit(1);

  let nextOrder = existing.length > 0 ? existing[0].sortOrder + 1 : 0;

  let created = 0;
  const skippedRows: number[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const fieldValues: { templateFieldId: string; value: unknown }[] = [];

    for (let col = 0; col < columnToFieldId.length; col++) {
      const fieldId = columnToFieldId[col];
      if (fieldId && row[col] !== undefined && row[col] !== '') {
        fieldValues.push({ templateFieldId: fieldId, value: row[col] });
      }
    }

    if (fieldValues.length === 0) {
      skippedRows.push(i + 2); // +2 for 1-based + header
      continue;
    }

    const [card] = await db
      .insert(cards)
      .values({ deckId, sortOrder: nextOrder++ })
      .returning();

    await db.insert(cardFieldValues).values(
      fieldValues.map((fv) => ({
        cardId: card.id,
        templateFieldId: fv.templateFieldId,
        value: fv.value,
      })),
    );

    created++;
  }

  return { created, skipped: skippedRows.length, skippedRows };
}

// ── Export ────────────────────────────────────────────────────

/**
 * Export a deck's cards as CSV text.
 * Header row = template field names.
 */
export async function exportCSV(deckId: string, userId: string) {
  const deck = await getDeckWithTemplate(deckId, userId);
  const fields = await getTemplateFields(deck.cardTemplateId);

  const allCards = await db
    .select()
    .from(cards)
    .where(eq(cards.deckId, deckId))
    .orderBy(cards.sortOrder);

  if (allCards.length === 0) {
    // Still return header only
    const header = fields.map((f) => escapeCSVField(f.name)).join(',');
    return { csv: header + '\n', deckName: deck.name, cardCount: 0 };
  }

  // Fetch all field values for these cards
  const cardIds = allCards.map((c) => c.id);
  const fieldValuesAll = await db
    .select({
      cardId: cardFieldValues.cardId,
      templateFieldId: cardFieldValues.templateFieldId,
      value: cardFieldValues.value,
    })
    .from(cardFieldValues)
    .where(inArray(cardFieldValues.cardId, cardIds));

  // Group by card
  const byCard = new Map<string, Map<string, unknown>>();
  for (const fv of fieldValuesAll) {
    if (!byCard.has(fv.cardId)) byCard.set(fv.cardId, new Map());
    byCard.get(fv.cardId)!.set(fv.templateFieldId, fv.value);
  }

  // Build CSV
  const header = fields.map((f) => escapeCSVField(f.name)).join(',');
  const rows = allCards.map((card) => {
    const fieldMap = byCard.get(card.id) ?? new Map();
    return fields
      .map((f) => {
        const val = fieldMap.get(f.id);
        return escapeCSVField(val != null ? String(val) : '');
      })
      .join(',');
  });

  return {
    csv: [header, ...rows].join('\n') + '\n',
    deckName: deck.name,
    cardCount: allCards.length,
  };
}

/**
 * Export a deck's cards as JSON.
 */
export async function exportJSON(deckId: string, userId: string) {
  const deck = await getDeckWithTemplate(deckId, userId);
  const fields = await getTemplateFields(deck.cardTemplateId);

  const allCards = await db
    .select()
    .from(cards)
    .where(eq(cards.deckId, deckId))
    .orderBy(cards.sortOrder);

  if (allCards.length === 0) {
    return {
      json: {
        deckName: deck.name,
        fields: fields.map((f) => f.name),
        cards: [],
      },
      deckName: deck.name,
      cardCount: 0,
    };
  }

  const cardIds = allCards.map((c) => c.id);
  const fieldValuesAll = await db
    .select({
      cardId: cardFieldValues.cardId,
      templateFieldId: cardFieldValues.templateFieldId,
      value: cardFieldValues.value,
    })
    .from(cardFieldValues)
    .where(inArray(cardFieldValues.cardId, cardIds));

  const byCard = new Map<string, Map<string, unknown>>();
  for (const fv of fieldValuesAll) {
    if (!byCard.has(fv.cardId)) byCard.set(fv.cardId, new Map());
    byCard.get(fv.cardId)!.set(fv.templateFieldId, fv.value);
  }

  const jsonCards = allCards.map((card) => {
    const fieldMap = byCard.get(card.id) ?? new Map();
    const obj: Record<string, unknown> = {};
    for (const f of fields) {
      obj[f.name] = fieldMap.get(f.id) ?? null;
    }
    return obj;
  });

  return {
    json: {
      deckName: deck.name,
      fields: fields.map((f) => f.name),
      cards: jsonCards,
    },
    deckName: deck.name,
    cardCount: allCards.length,
  };
}

function escapeCSVField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
