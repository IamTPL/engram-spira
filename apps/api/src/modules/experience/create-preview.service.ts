import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db';
import { cardFieldValues, cards, decks, templateFields } from '../../db/schema';
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
} from '../../shared/errors';
import { create as createCard } from '../cards/cards.service';
import { getWithFields } from '../card-templates/card-templates.service';
import type {
  CreateCommitRequest,
  CreateCommitResponse,
  CreatePreviewRecord,
  CreatePreviewRequest,
  CreatePreviewResponse,
} from './experience.types';

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const MAX_AI_TEXT_CHARS = 10_000;
const MAX_AI_REQUESTED_COUNT = 30;
const MAX_IMPORT_BYTES = 1_000_000;
const MAX_IMPORT_ROWS = 500;

type TemplateFieldInfo = {
  id: string;
  name: string;
  sortOrder: number;
  isRequired: boolean;
};

type DeckInfo = {
  id: string;
  cardTemplateId: string;
};

type ExistingCardInfo = {
  id: string;
  deckId: string;
  title: string;
  fields: Record<string, string>;
};

type AiPastePayload = Extract<
  CreatePreviewRequest,
  { source: 'ai-paste' }
>['payload'];
type CsvPayload = Extract<CreatePreviewRequest, { source: 'csv' }>['payload'];
type JsonPayload = Extract<CreatePreviewRequest, { source: 'json' }>['payload'];

type InternalPreviewRecord = CreatePreviewRecord & {
  commitRecords: Map<
    string,
    { fingerprint: string; result: CreateCommitResponse | null; succeeded: boolean }
  >;
  consumedByKey: string | null;
};

export type PreviewStore = {
  get: (previewId: string) => InternalPreviewRecord | undefined;
  set: (record: InternalPreviewRecord) => void;
  clear: () => void;
};

export type CreatePreviewServices = {
  store: PreviewStore;
  now: () => Date;
  previewTtlMs: number;
  loadDeck: (userId: string, deckId: string) => Promise<DeckInfo>;
  loadTemplate: (
    templateId: string,
  ) => Promise<{ id: string; fields: TemplateFieldInfo[] }>;
  listCardsInDeck: (
    userId: string,
    deckId: string,
  ) => Promise<ExistingCardInfo[]>;
  createCard: (
    userId: string,
    deckId: string,
    fields: Record<string, string>,
  ) => Promise<{ id: string }>;
  loadMergeCard: (userId: string, cardId: string) => Promise<ExistingCardInfo>;
  fillMissingCardFields: (
    userId: string,
    cardId: string,
    fields: Record<string, string>,
  ) => Promise<{ id: string }>;
};

export function createInMemoryPreviewStore(): PreviewStore {
  const records = new Map<string, InternalPreviewRecord>();
  return {
    get: (previewId) => records.get(previewId),
    set: (record) => records.set(record.previewId, record),
    clear: () => records.clear(),
  };
}

const defaultPreviewStore = createInMemoryPreviewStore();

export const defaultCreatePreviewServices: CreatePreviewServices = {
  store: defaultPreviewStore,
  now: () => new Date(),
  previewTtlMs: PREVIEW_TTL_MS,
  loadDeck: async (userId, deckId) => {
    const [deck] = await db
      .select({ id: decks.id, cardTemplateId: decks.cardTemplateId })
      .from(decks)
      .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
      .limit(1);
    if (!deck) throw new NotFoundError('Deck');
    return deck;
  },
  loadTemplate: async (templateId) => {
    const template = await getWithFields(templateId);
    return {
      id: template.id,
      fields: template.fields.map((field) => ({
        id: field.id,
        name: field.name,
        sortOrder: field.sortOrder,
        isRequired: field.isRequired,
      })),
    };
  },
  listCardsInDeck: async (userId, deckId) => {
    await defaultCreatePreviewServices.loadDeck(userId, deckId);
    return loadCardsWithNamedFields(deckId);
  },
  createCard: async (userId, deckId, fields) => {
    const template = await loadDeckTemplateFields(userId, deckId);
    return createCard(deckId, userId, {
      fieldValues: toFieldValues(fields, template),
    });
  },
  loadMergeCard: async (userId, cardId) => {
    const [row] = await db
      .select({ deckId: cards.deckId })
      .from(cards)
      .innerJoin(decks, and(eq(cards.deckId, decks.id), eq(decks.userId, userId)))
      .where(eq(cards.id, cardId))
      .limit(1);
    if (!row) throw new NotFoundError('Merge target');
    const [card] = await loadCardsWithNamedFields(row.deckId, [cardId]);
    if (!card) throw new NotFoundError('Merge target');
    return card;
  },
  fillMissingCardFields: async (userId, cardId, fields) => {
    if (Object.keys(fields).length === 0) return { id: cardId };
    const mergeCard = await defaultCreatePreviewServices.loadMergeCard(
      userId,
      cardId,
    );
    const template = await loadDeckTemplateFields(userId, mergeCard.deckId);
    const values = toFieldValues(fields, template).map((fieldValue) => ({
      cardId,
      ...fieldValue,
    }));
    if (values.length > 0) {
      await db.insert(cardFieldValues).values(values).onConflictDoNothing();
    }
    return { id: cardId };
  },
};

export async function createPreview(
  userId: string,
  request: CreatePreviewRequest,
  services: CreatePreviewServices = defaultCreatePreviewServices,
): Promise<CreatePreviewResponse> {
  validatePreviewRequestShape(request);
  const deck = await services.loadDeck(userId, request.targetDeckId);
  if (deck.cardTemplateId !== request.templateId) {
    throw new ValidationError('Template not valid for target deck');
  }
  const template = await services.loadTemplate(request.templateId);
  const rows = parsePayloadRows(request);
  const existingCards = await services.listCardsInDeck(userId, request.targetDeckId);
  const cardsForPreview = rows.map((row, index) => {
    const fields = normalizeFields(row, template.fields);
    const validationErrors = requiredFieldErrors(fields, template.fields);
    if (request.source === 'manual' && validationErrors.length > 0) {
      throw new ValidationError(validationErrors.join(', '));
    }
    const duplicateCandidates = findDuplicateCandidates(fields, existingCards);
    return {
      clientId: `preview-card-${index + 1}`,
      fields,
      validationErrors,
      duplicateCandidates,
      defaultResolution:
        duplicateCandidates.length > 0 ? ('merge' as const) : ('create' as const),
    };
  });

  const expiresAt = new Date(
    services.now().getTime() + services.previewTtlMs,
  ).toISOString();
  const previewId = crypto.randomUUID();
  const record: InternalPreviewRecord = {
    previewId,
    userId,
    targetDeckId: request.targetDeckId,
    templateId: request.templateId,
    source: request.source,
    requestFingerprint: fingerprint(request),
    cards: cardsForPreview,
    expiresAt,
    commitRecords: new Map(),
    consumedByKey: null,
  };
  services.store.set(record);

  return {
    previewId,
    expiresAt,
    cards: cardsForPreview.map((card) => ({
      clientId: card.clientId,
      fields: card.fields,
      validationErrors: card.validationErrors,
      duplicateCandidates: card.duplicateCandidates,
      resolution: card.defaultResolution,
    })),
    summary: {
      total: cardsForPreview.length,
      valid: cardsForPreview.filter((card) => card.validationErrors.length === 0)
        .length,
      invalid: cardsForPreview.filter((card) => card.validationErrors.length > 0)
        .length,
      possibleDuplicates: cardsForPreview.filter(
        (card) => card.duplicateCandidates.length > 0,
      ).length,
    },
  };
}

export async function commitCreatePreview(
  userId: string,
  request: CreateCommitRequest,
  services: CreatePreviewServices = defaultCreatePreviewServices,
): Promise<CreateCommitResponse> {
  validateCommitRequestShape(request);
  const record = services.store.get(request.previewId);
  if (!record || record.userId !== userId) {
    throw new ConflictError('Preview expired');
  }

  const commitFingerprint = fingerprint(request);
  const existingIdempotency = record.commitRecords.get(request.idempotencyKey);
  if (existingIdempotency) {
    if (existingIdempotency.fingerprint !== commitFingerprint) {
      throw new ConflictError('Idempotency key conflict');
    }
    if (existingIdempotency.succeeded && existingIdempotency.result) {
      return existingIdempotency.result;
    }
  }

  if (record.consumedByKey && record.consumedByKey !== request.idempotencyKey) {
    throw new ConflictError('Preview already committed');
  }

  if (new Date(record.expiresAt).getTime() <= services.now().getTime()) {
    throw new ConflictError('Preview expired');
  }

  const result: CreateCommitResponse = {
    createdCardIds: [],
    skippedClientIds: [],
    mergedCardIds: [],
  };

  for (const requestedCard of request.cards) {
    const previewCard = record.cards.find(
      (card) => card.clientId === requestedCard.clientId,
    );
    if (!previewCard) throw new ConflictError('Unknown preview record');

    if (requestedCard.resolution === 'skip') {
      result.skippedClientIds.push(requestedCard.clientId);
      continue;
    }

    if (previewCard.validationErrors.length > 0) {
      throw new ValidationError(previewCard.validationErrors.join(', '));
    }

    if (requestedCard.resolution === 'create') {
      const created = await services.createCard(
        userId,
        record.targetDeckId,
        previewCard.fields,
      );
      result.createdCardIds.push(created.id);
      continue;
    }

    if (!requestedCard.mergeTargetCardId) {
      throw new ValidationError('Merge target is required');
    }
    const mergeTarget = await loadMergeTarget(
      services,
      userId,
      requestedCard.mergeTargetCardId,
      record.targetDeckId,
    );
    const fieldsToFill = getFillOnlyFields(previewCard.fields, mergeTarget.fields);
    await services.fillMissingCardFields(
      userId,
      requestedCard.mergeTargetCardId,
      fieldsToFill,
    );
    result.mergedCardIds.push(requestedCard.mergeTargetCardId);
  }

  record.consumedByKey = request.idempotencyKey;
  record.commitRecords.set(request.idempotencyKey, {
    fingerprint: commitFingerprint,
    result,
    succeeded: true,
  });
  services.store.set(record);
  return result;
}

function validatePreviewRequestShape(request: CreatePreviewRequest) {
  if (!request.targetDeckId) throw new ValidationError('targetDeckId is required');
  if (!request.templateId) throw new ValidationError('templateId is required');
  if (!request.payload) throw new ValidationError('payload is required');
}

function validateCommitRequestShape(request: CreateCommitRequest) {
  if (!request.previewId) throw new ValidationError('previewId is required');
  if (!request.idempotencyKey?.trim()) {
    throw new ValidationError('idempotencyKey is required');
  }
  if (!Array.isArray(request.cards) || request.cards.length === 0) {
    throw new ValidationError('cards are required');
  }
}

function parsePayloadRows(request: CreatePreviewRequest): Array<Record<string, string>> {
  switch (request.source) {
    case 'manual':
      return [request.payload.fields ?? {}];
    case 'ai-paste':
      return parseAiPaste(request.payload);
    case 'csv':
      return parseCsv(request.payload);
    case 'json':
      return parseJson(request.payload);
  }
}

function parseAiPaste(payload: AiPastePayload) {
  if (payload.text.length > MAX_AI_TEXT_CHARS) {
    throw new PayloadTooLargeError('AI paste payload too large');
  }
  if (
    payload.requestedCount !== undefined &&
    (payload.requestedCount < 1 || payload.requestedCount > MAX_AI_REQUESTED_COUNT)
  ) {
    throw new ValidationError('requestedCount must be between 1 and 30');
  }
  const count = payload.requestedCount ?? 1;
  const lines = payload.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const source = lines.length > 0 ? lines : [payload.text.trim()];
  return Array.from({ length: count }, (_, index) => ({
    Front: source[index % source.length] ?? '',
    Back: '',
  }));
}

function parseCsv(payload: CsvPayload) {
  if (payload.content.length > MAX_IMPORT_BYTES) {
    throw new PayloadTooLargeError('CSV payload too large');
  }
  const delimiter = payload.delimiter ?? ',';
  const lines = payload.content.split(/\r?\n/).filter((line) => line.length > 0);
  const dataLines = payload.hasHeader ? lines.slice(1) : lines;
  if (dataLines.length > MAX_IMPORT_ROWS) {
    throw new PayloadTooLargeError('CSV row limit exceeded');
  }
  const headers = payload.hasHeader
    ? splitCsvLine(lines[0] ?? '', delimiter)
    : [];
  return dataLines.map((line) => {
    const values = splitCsvLine(line, delimiter);
    return Object.fromEntries(
      Object.entries(payload.fieldMapping).map(([fieldName, source]) => {
        const index = payload.hasHeader ? headers.indexOf(source) : Number(source);
        return [fieldName, Number.isInteger(index) && index >= 0 ? values[index] ?? '' : ''];
      }),
    );
  });
}

function parseJson(payload: JsonPayload) {
  if (payload.content.length > MAX_IMPORT_BYTES) {
    throw new PayloadTooLargeError('JSON payload too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.content);
  } catch {
    throw new ValidationError('Invalid JSON content');
  }
  if (!Array.isArray(parsed)) throw new ValidationError('JSON content must be an array');
  if (parsed.length > MAX_IMPORT_ROWS) {
    throw new PayloadTooLargeError('JSON row limit exceeded');
  }
  return parsed.map((row) => {
    if (typeof row !== 'object' || row === null) return {};
    const record = row as Record<string, unknown>;
    if (!payload.fieldMapping) {
      return Object.fromEntries(
        Object.entries(record).map(([key, value]) => [key, String(value ?? '')]),
      );
    }
    return Object.fromEntries(
      Object.entries(payload.fieldMapping).map(([fieldName, source]) => [
        fieldName,
        String(record[source] ?? ''),
      ]),
    );
  });
}

function splitCsvLine(line: string, delimiter: string) {
  return line.split(delimiter).map((value) => value.trim());
}

function normalizeFields(
  row: Record<string, string>,
  fields: TemplateFieldInfo[],
): Record<string, string> {
  return Object.fromEntries(
    [...fields]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((field) => [field.name, String(row[field.name] ?? '').trim()]),
  );
}

function requiredFieldErrors(
  fields: Record<string, string>,
  templateFieldsForRequest: TemplateFieldInfo[],
) {
  const missing = templateFieldsForRequest
    .filter((field) => field.isRequired && !fields[field.name]?.trim())
    .map((field) => field.name);
  return missing.length > 0 ? [`Required fields missing: ${missing.join(', ')}`] : [];
}

function findDuplicateCandidates(
  fields: Record<string, string>,
  existingCards: ExistingCardInfo[],
) {
  const title = firstNonEmptyField(fields);
  if (!title) return [];
  const normalizedTitle = normalize(title);
  return existingCards
    .map((card) => {
      const candidateTitle = normalize(card.title || firstNonEmptyField(card.fields));
      if (!candidateTitle) return null;
      const similarity =
        candidateTitle === normalizedTitle
          ? 1
          : candidateTitle.includes(normalizedTitle) ||
              normalizedTitle.includes(candidateTitle)
            ? 0.85
            : 0;
      if (similarity === 0) return null;
      return { cardId: card.id, similarity, title: card.title };
    })
    .filter(
      (
        candidate,
      ): candidate is { cardId: string; similarity: number; title: string } =>
        candidate !== null,
    )
    .sort((a, b) => b.similarity - a.similarity || a.cardId.localeCompare(b.cardId));
}

async function loadMergeTarget(
  services: CreatePreviewServices,
  userId: string,
  cardId: string,
  targetDeckId: string,
) {
  let mergeTarget: ExistingCardInfo;
  try {
    mergeTarget = await services.loadMergeCard(userId, cardId);
  } catch (error) {
    if (error instanceof NotFoundError) throw new NotFoundError('Merge target');
    throw error;
  }
  if (mergeTarget.deckId !== targetDeckId) throw new NotFoundError('Merge target');
  return mergeTarget;
}

function getFillOnlyFields(
  incoming: Record<string, string>,
  target: Record<string, string>,
) {
  const fill: Record<string, string> = {};
  const conflicts: string[] = [];
  for (const [fieldName, incomingValue] of Object.entries(incoming)) {
    const trimmedIncoming = incomingValue.trim();
    if (!trimmedIncoming) continue;
    const trimmedTarget = String(target[fieldName] ?? '').trim();
    if (!trimmedTarget) {
      fill[fieldName] = trimmedIncoming;
    } else if (trimmedTarget !== trimmedIncoming) {
      conflicts.push(fieldName);
    }
  }
  if (conflicts.length > 0) {
    throw new ConflictError(`Merge conflict: ${conflicts.join(', ')}`);
  }
  return fill;
}

async function loadDeckTemplateFields(userId: string, deckId: string) {
  const [deck] = await db
    .select({ templateId: decks.cardTemplateId })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);
  if (!deck) throw new NotFoundError('Deck');
  return db
    .select({
      id: templateFields.id,
      name: templateFields.name,
      sortOrder: templateFields.sortOrder,
      isRequired: templateFields.isRequired,
    })
    .from(templateFields)
    .where(eq(templateFields.templateId, deck.templateId));
}

function toFieldValues(
  fields: Record<string, string>,
  template: TemplateFieldInfo[],
) {
  const byName = new Map(template.map((field) => [field.name, field]));
  return Object.entries(fields)
    .filter(([, value]) => value.trim().length > 0)
    .map(([name, value]) => {
      const field = byName.get(name);
      if (!field) throw new ValidationError(`Unknown template field: ${name}`);
      return { templateFieldId: field.id, value };
    });
}

async function loadCardsWithNamedFields(deckId: string, cardIds?: string[]) {
  const cardRows = await db
    .select({
      id: cards.id,
      deckId: cards.deckId,
    })
    .from(cards)
    .where(
      cardIds && cardIds.length > 0
        ? and(eq(cards.deckId, deckId), inArray(cards.id, cardIds))
        : eq(cards.deckId, deckId),
    );
  if (cardRows.length === 0) return [];

  const ids = cardRows.map((card) => card.id);
  const values = await db
    .select({
      cardId: cardFieldValues.cardId,
      fieldName: templateFields.name,
      sortOrder: templateFields.sortOrder,
      value: cardFieldValues.value,
    })
    .from(cardFieldValues)
    .innerJoin(templateFields, eq(cardFieldValues.templateFieldId, templateFields.id))
    .where(inArray(cardFieldValues.cardId, ids));

  const fieldsByCard = new Map<string, Record<string, string>>();
  for (const value of values) {
    const fields = fieldsByCard.get(value.cardId) ?? {};
    fields[value.fieldName] = String(value.value ?? '');
    fieldsByCard.set(value.cardId, fields);
  }

  return cardRows.map((card) => {
    const fields = fieldsByCard.get(card.id) ?? {};
    return {
      id: card.id,
      deckId: card.deckId,
      title: firstNonEmptyField(fields),
      fields,
    };
  });
}

function firstNonEmptyField(fields: Record<string, string>) {
  return Object.values(fields).find((value) => value.trim().length > 0) ?? '';
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function fingerprint(value: unknown) {
  return JSON.stringify(sortForFingerprint(value));
}

function sortForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForFingerprint);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, sortForFingerprint(nested)]),
  );
}
