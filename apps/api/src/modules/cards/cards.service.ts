import { eq, and, inArray, desc, sql, count } from 'drizzle-orm';
import { db } from '../../db';
import { cards, cardFieldValues, decks, templateFields } from '../../db/schema';
import { NotFoundError } from '../../shared/errors';

// Ownership check: decks.userId is denormalized — no JOIN chain needed
async function verifyDeckOwnership(deckId: string, userId: string) {
  const [result] = await db
    .select({ id: decks.id, cardTemplateId: decks.cardTemplateId })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);
  if (!result) throw new NotFoundError('Deck');
  return result;
}

export async function listByDeck(
  deckId: string,
  userId: string,
  pagination: { page: number; limit: number } = { page: 1, limit: 50 },
) {
  await verifyDeckOwnership(deckId, userId);

  const { page, limit } = pagination;
  const offset = (page - 1) * limit;

  // Parallel: paginated card list + total count
  const [[totalRow], cardList] = await Promise.all([
    db.select({ count: count() }).from(cards).where(eq(cards.deckId, deckId)),
    db
      .select()
      .from(cards)
      .where(eq(cards.deckId, deckId))
      .orderBy(cards.sortOrder)
      .limit(limit)
      .offset(offset),
  ]);

  const total = totalRow?.count ?? 0;

  if (cardList.length === 0) {
    return { items: [], total, page, limit, hasMore: false };
  }

  const cardIds = cardList.map((c) => c.id);

  // Fetch all field values for this page of cards in a single query
  const fieldValues = await db
    .select({
      cardId: cardFieldValues.cardId,
      templateFieldId: cardFieldValues.templateFieldId,
      fieldName: templateFields.name,
      fieldType: templateFields.fieldType,
      side: templateFields.side,
      sortOrder: templateFields.sortOrder,
      value: cardFieldValues.value,
    })
    .from(cardFieldValues)
    .innerJoin(
      templateFields,
      eq(cardFieldValues.templateFieldId, templateFields.id),
    )
    .where(
      cardIds.length === 1
        ? eq(cardFieldValues.cardId, cardIds[0])
        : inArray(cardFieldValues.cardId, cardIds),
    );

  const fieldsByCard = new Map<string, typeof fieldValues>();
  for (const fv of fieldValues) {
    const existing = fieldsByCard.get(fv.cardId) ?? [];
    existing.push(fv);
    fieldsByCard.set(fv.cardId, existing);
  }

  const items = cardList.map((card) => ({
    ...card,
    fields: (fieldsByCard.get(card.id) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    ),
  }));

  return {
    items,
    total,
    page,
    limit,
    hasMore: offset + cardList.length < total,
  };
}

export async function create(
  deckId: string,
  userId: string,
  data: { fieldValues: { templateFieldId: string; value: unknown }[] },
) {
  const deck = await verifyDeckOwnership(deckId, userId);

  // Get max sort order
  const existing = await db
    .select({ sortOrder: cards.sortOrder })
    .from(cards)
    .where(eq(cards.deckId, deckId))
    .orderBy(desc(cards.sortOrder))
    .limit(1);

  const nextOrder = existing.length > 0 ? existing[0].sortOrder + 1 : 0;

  const [card] = await db
    .insert(cards)
    .values({ deckId, sortOrder: nextOrder })
    .returning();

  if (data.fieldValues.length > 0) {
    await db.insert(cardFieldValues).values(
      data.fieldValues.map((fv) => ({
        cardId: card.id,
        templateFieldId: fv.templateFieldId,
        value: fv.value,
      })),
    );
  }

  return card;
}

export async function update(
  cardId: string,
  userId: string,
  data: { fieldValues: { templateFieldId: string; value: unknown }[] },
) {
  // Verify ownership through card -> deck (denormalized userId)
  const [cardResult] = await db
    .select({ cardId: cards.id, deckId: cards.deckId })
    .from(cards)
    .innerJoin(decks, and(eq(cards.deckId, decks.id), eq(decks.userId, userId)))
    .where(eq(cards.id, cardId))
    .limit(1);

  if (!cardResult) throw new NotFoundError('Card');

  // Batch upsert field values in a single query
  if (data.fieldValues.length > 0) {
    await db
      .insert(cardFieldValues)
      .values(
        data.fieldValues.map((fv) => ({
          cardId,
          templateFieldId: fv.templateFieldId,
          value: fv.value,
        })),
      )
      .onConflictDoUpdate({
        target: [cardFieldValues.cardId, cardFieldValues.templateFieldId],
        set: { value: sql`excluded.value` },
      });
  }

  return { id: cardId, updated: true };
}

export async function remove(cardId: string, userId: string) {
  const [cardResult] = await db
    .select({ cardId: cards.id })
    .from(cards)
    .innerJoin(decks, and(eq(cards.deckId, decks.id), eq(decks.userId, userId)))
    .where(eq(cards.id, cardId))
    .limit(1);

  if (!cardResult) throw new NotFoundError('Card');
  await db.delete(cards).where(eq(cards.id, cardId));
}
