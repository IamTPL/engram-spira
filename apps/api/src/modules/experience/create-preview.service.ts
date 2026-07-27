import { and, eq, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';

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
import { enqueueEmbedding } from '../embedding/embedding.service';
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

type DuplicateCandidateSource = {
  card: ExistingCardInfo;
  normalizedTitle: string;
};

type AiPastePayload = Extract<
  CreatePreviewRequest,
  { source: 'ai-paste' }
>['payload'];
type CsvPayload = Extract<CreatePreviewRequest, { source: 'csv' }>['payload'];
type JsonPayload = Extract<CreatePreviewRequest, { source: 'json' }>['payload'];

type CommitRecord = {
  fingerprint: string;
  result: CreateCommitResponse | null;
  succeeded: boolean;
};

type ActivePreviewRecord = Omit<CreatePreviewRecord, 'requestFingerprint'> & {
  kind: 'active';
  commitRecords: Map<string, CommitRecord>;
  consumedByKey: string | null;
};

type CommitTombstone = {
  kind: 'commit';
  previewId: string;
  userId: string;
  commitRecords: Map<string, CommitRecord>;
  consumedByKey: string;
};

type InternalPreviewRecord = ActivePreviewRecord | CommitTombstone;

type InternalPreviewCards = ActivePreviewRecord['cards'];

type PreviewStorePrune = (nowMs: number) => void;

type CommitOperation =
  | { resolution: 'skip'; clientId: string }
  | { resolution: 'create'; clientId: string; fields: Record<string, string> }
  | {
      resolution: 'merge';
      clientId: string;
      mergeTargetCardId: string;
      fieldsToFill: Record<string, string>;
    };

export type PreviewStore = {
  get: (previewId: string) => InternalPreviewRecord | undefined;
  set: (record: InternalPreviewRecord) => void;
  clear: () => void;
  pruneExpired?: PreviewStorePrune;
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
  const scheduledExpirations = new Map<string, number>();
  const expiryHeap: Array<{ previewId: string; expiresAt: number }> = [];

  const pushExpiry = (previewId: string, expiresAt: number) => {
    expiryHeap.push({ previewId, expiresAt });
    let index = expiryHeap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (expiryHeap[parent].expiresAt <= expiresAt) break;
      expiryHeap[index] = expiryHeap[parent];
      index = parent;
    }
    expiryHeap[index] = { previewId, expiresAt };
  };

  const popExpiry = () => {
    const root = expiryHeap[0];
    const tail = expiryHeap.pop();
    if (!tail || expiryHeap.length === 0) return root;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= expiryHeap.length) break;
      const right = left + 1;
      const child =
        right < expiryHeap.length &&
        expiryHeap[right].expiresAt < expiryHeap[left].expiresAt
          ? right
          : left;
      if (expiryHeap[child].expiresAt >= tail.expiresAt) break;
      expiryHeap[index] = expiryHeap[child];
      index = child;
    }
    expiryHeap[index] = tail;
    return root;
  };

  return {
    get: (previewId) => records.get(previewId),
    set: (record) => {
      records.set(record.previewId, record);
      if (record.kind === 'active' && record.consumedByKey === null) {
        const expiresAt = new Date(record.expiresAt).getTime();
        if (scheduledExpirations.get(record.previewId) !== expiresAt) {
          scheduledExpirations.set(record.previewId, expiresAt);
          pushExpiry(record.previewId, expiresAt);
        }
      }
    },
    clear: () => {
      records.clear();
      scheduledExpirations.clear();
      expiryHeap.length = 0;
    },
    pruneExpired: (nowMs) => {
      while (expiryHeap[0]?.expiresAt <= nowMs) {
        const expired = popExpiry();
        if (!expired) break;
        if (
          scheduledExpirations.get(expired.previewId) !== expired.expiresAt
        ) {
          continue;
        }
        scheduledExpirations.delete(expired.previewId);
        const record = records.get(expired.previewId);
        if (
          record?.kind !== 'active' ||
          record.consumedByKey !== null ||
          new Date(record.expiresAt).getTime() !== expired.expiresAt
        ) {
          continue;
        }
        records.delete(expired.previewId);
      }
    },
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
      enqueueEmbedding(cardId);
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
  const duplicateCandidateSources = existingCards
    .map((card) => ({
      card,
      normalizedTitle: normalize(card.title || firstNonEmptyField(card.fields)),
    }))
    .sort((a, b) => a.card.id.localeCompare(b.card.id));
  const cardsForPreview = rows.map((row, index) => {
    const fields = normalizeFields(row, template.fields);
    const validationErrors = requiredFieldErrors(fields, template.fields);
    if (request.source === 'manual' && validationErrors.length > 0) {
      throw new ValidationError(validationErrors.join(', '));
    }
    const duplicateCandidates = findDuplicateCandidates(
      fields,
      duplicateCandidateSources,
    );
    return {
      clientId: `preview-card-${index + 1}`,
      fields,
      validationErrors,
      duplicateCandidates,
      defaultResolution:
        duplicateCandidates.length > 0 ? ('merge' as const) : ('create' as const),
    };
  });

  const nowMs = services.now().getTime();
  services.store.pruneExpired?.(nowMs);
  const expiresAt = new Date(nowMs + services.previewTtlMs).toISOString();
  const previewId = crypto.randomUUID();
  const record: ActivePreviewRecord = {
    kind: 'active',
    previewId,
    userId,
    targetDeckId: request.targetDeckId,
    templateId: request.templateId,
    source: request.source,
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
    throw new ConflictError('Commit already attempted');
  }

  if (record.consumedByKey && record.consumedByKey !== request.idempotencyKey) {
    throw new ConflictError('Preview already committed');
  }

  if (record.kind === 'commit') {
    throw new ConflictError('Commit already attempted');
  }

  const nowMs = services.now().getTime();
  services.store.pruneExpired?.(nowMs);
  if (new Date(record.expiresAt).getTime() <= nowMs) {
    throw new ConflictError('Preview expired');
  }

  const previousCommitRecords = record.commitRecords;
  record.consumedByKey = request.idempotencyKey;
  record.commitRecords = new Map(previousCommitRecords);
  record.commitRecords.set(request.idempotencyKey, {
    fingerprint: commitFingerprint,
    result: null,
    succeeded: false,
  });
  services.store.set(record);

  let operations: CommitOperation[];
  try {
    operations = await planCommitOperations(services, userId, record, request);
  } catch (error) {
    const currentRecord = services.store.get(record.previewId) ?? record;
    const currentCommit = currentRecord.commitRecords.get(request.idempotencyKey);
    if (
      currentRecord.kind === 'active' &&
      currentRecord.consumedByKey === request.idempotencyKey &&
      currentCommit &&
      !currentCommit.succeeded &&
      currentCommit.result === null
    ) {
      currentRecord.consumedByKey = null;
      currentRecord.commitRecords = previousCommitRecords;
      services.store.set(currentRecord);
    }
    throw error;
  }

  const tombstone: CommitTombstone = {
    kind: 'commit',
    previewId: record.previewId,
    userId: record.userId,
    consumedByKey: request.idempotencyKey,
    commitRecords: new Map(record.commitRecords),
  };
  services.store.set(tombstone);

  const result: CreateCommitResponse = {
    createdCardIds: [],
    skippedClientIds: [],
    mergedCardIds: [],
  };

  for (const operation of operations) {
    if (operation.resolution === 'skip') {
      result.skippedClientIds.push(operation.clientId);
      continue;
    }

    if (operation.resolution === 'create') {
      const created = await services.createCard(
        userId,
        record.targetDeckId,
        operation.fields,
      );
      result.createdCardIds.push(created.id);
      continue;
    }

    await services.fillMissingCardFields(
      userId,
      operation.mergeTargetCardId,
      operation.fieldsToFill,
    );
    result.mergedCardIds.push(operation.mergeTargetCardId);
  }

  tombstone.commitRecords.set(request.idempotencyKey, {
    fingerprint: commitFingerprint,
    result,
    succeeded: true,
  });
  services.store.set(tombstone);
  return result;
}

async function planCommitOperations(
  services: CreatePreviewServices,
  userId: string,
  record: ActivePreviewRecord,
  request: CreateCommitRequest,
): Promise<CommitOperation[]> {
  const operations: CommitOperation[] = [];
  const previewCardsByClientId = new Map<string, InternalPreviewCards[number]>();
  for (const card of record.cards) {
    if (!previewCardsByClientId.has(card.clientId)) {
      previewCardsByClientId.set(card.clientId, card);
    }
  }

  for (const requestedCard of request.cards) {
    const previewCard = previewCardsByClientId.get(requestedCard.clientId);
    if (!previewCard) throw new ConflictError('Unknown preview record');

    if (requestedCard.resolution === 'skip') {
      operations.push({ resolution: 'skip', clientId: requestedCard.clientId });
      continue;
    }

    if (previewCard.validationErrors.length > 0) {
      throw new ValidationError(previewCard.validationErrors.join(', '));
    }

    if (requestedCard.resolution === 'create') {
      operations.push({
        resolution: 'create',
        clientId: requestedCard.clientId,
        fields: previewCard.fields,
      });
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
    operations.push({
      resolution: 'merge',
      clientId: requestedCard.clientId,
      mergeTargetCardId: requestedCard.mergeTargetCardId,
      fieldsToFill,
    });
  }

  return operations;
}

function validatePreviewRequestShape(
  request: unknown,
): asserts request is CreatePreviewRequest {
  if (!isRecord(request)) throw new ValidationError('Invalid preview request');
  if (!isNonEmptyString(request.targetDeckId)) {
    throw new ValidationError('targetDeckId is required');
  }
  if (!isNonEmptyString(request.templateId)) {
    throw new ValidationError('templateId is required');
  }
  if (!isRecord(request.payload)) throw new ValidationError('payload is required');

  switch (request.source) {
    case 'manual':
      if (!isRecord(request.payload.fields)) {
        throw new ValidationError('fields are required');
      }
      return;
    case 'ai-paste':
      if (!isString(request.payload.text)) throw new ValidationError('text is required');
      if (request.payload.mode !== 'vocabulary' && request.payload.mode !== 'qa') {
        throw new ValidationError('mode must be vocabulary or qa');
      }
      if (
        request.payload.requestedCount !== undefined &&
        !Number.isInteger(request.payload.requestedCount)
      ) {
        throw new ValidationError('requestedCount must be between 1 and 30');
      }
      return;
    case 'csv':
      if (!isString(request.payload.filename)) {
        throw new ValidationError('filename is required');
      }
      if (!isString(request.payload.content)) {
        throw new ValidationError('content is required');
      }
      if (typeof request.payload.hasHeader !== 'boolean') {
        throw new ValidationError('hasHeader is required');
      }
      if (!isRecord(request.payload.fieldMapping)) {
        throw new ValidationError('fieldMapping is required');
      }
      if (
        request.payload.delimiter !== undefined &&
        request.payload.delimiter !== ',' &&
        request.payload.delimiter !== ';' &&
        request.payload.delimiter !== '\t'
      ) {
        throw new ValidationError('delimiter is invalid');
      }
      return;
    case 'json':
      if (!isString(request.payload.filename)) {
        throw new ValidationError('filename is required');
      }
      if (!isString(request.payload.content)) {
        throw new ValidationError('content is required');
      }
      if (
        request.payload.fieldMapping !== undefined &&
        !isRecord(request.payload.fieldMapping)
      ) {
        throw new ValidationError('fieldMapping is invalid');
      }
      return;
    default:
      throw new ValidationError('Invalid create source');
  }
}

function validateCommitRequestShape(
  request: unknown,
): asserts request is CreateCommitRequest {
  if (!isRecord(request)) throw new ValidationError('Invalid commit request');
  if (!isNonEmptyString(request.previewId)) {
    throw new ValidationError('previewId is required');
  }
  if (!isNonEmptyString(request.idempotencyKey)) {
    throw new ValidationError('idempotencyKey is required');
  }
  if (!Array.isArray(request.cards) || request.cards.length === 0) {
    throw new ValidationError('cards are required');
  }

  for (const card of request.cards) {
    if (!isRecord(card)) throw new ValidationError('Invalid commit card');
    if (!isNonEmptyString(card.clientId)) {
      throw new ValidationError('clientId is required');
    }
    if (
      card.resolution !== 'create' &&
      card.resolution !== 'skip' &&
      card.resolution !== 'merge'
    ) {
      throw new ValidationError('Invalid card resolution');
    }
    if (
      card.fields !== undefined &&
      (card.resolution === 'skip' || !isStringRecord(card.fields))
    ) {
      throw new ValidationError('fields are invalid');
    }
    if (
      card.resolution === 'merge' &&
      card.mergeTargetCardId !== undefined &&
      !isNonEmptyString(card.mergeTargetCardId)
    ) {
      throw new ValidationError('Merge target is required');
    }
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
    default:
      throw new ValidationError('Invalid create source');
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
  sources: DuplicateCandidateSource[],
) {
  const title = firstNonEmptyField(fields);
  if (!title) return [];
  const normalizedTitle = normalize(title);
  const exact: Array<{ cardId: string; similarity: number; title: string }> = [];
  const partial: Array<{ cardId: string; similarity: number; title: string }> = [];
  for (const { card, normalizedTitle: candidateTitle } of sources) {
    if (!candidateTitle) continue;
    if (candidateTitle === normalizedTitle) {
      exact.push({ cardId: card.id, similarity: 1, title: card.title });
    } else if (
      candidateTitle.includes(normalizedTitle) ||
      normalizedTitle.includes(candidateTitle)
    ) {
      partial.push({ cardId: card.id, similarity: 0.85, title: card.title });
    }
  }
  return exact.concat(partial);
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
    if (error instanceof NotFoundError) {
      throw new ConflictError('Merge target not found');
    }
    throw error;
  }
  if (mergeTarget.deckId !== targetDeckId) {
    throw new ConflictError('Merge target not found');
  }
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
  // Bind one PostgreSQL array value instead of one parameter per card so very
  // large decks cannot hit the 65,535 bind-parameter ceiling.
  const cardIdArrayLiteral = `{${ids.join(',')}}`;
  const values = await db.execute<{
    cardId: string;
    fieldName: string;
    sortOrder: number;
    value: unknown;
  }>(sql`
    SELECT
      cfv.card_id AS "cardId",
      tf.name AS "fieldName",
      tf.sort_order AS "sortOrder",
      cfv.value
    FROM card_field_values AS cfv
    INNER JOIN template_fields AS tf ON tf.id = cfv.template_field_id
    WHERE cfv.card_id = ANY(${cardIdArrayLiteral}::uuid[])
  `);

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
  return createHash('sha256')
    .update(JSON.stringify(sortForFingerprint(value)))
    .digest('base64url');
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}
