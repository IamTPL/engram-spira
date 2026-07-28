import { createHash } from 'node:crypto';
import { ValidationError } from '../../shared/errors';
import {
  assertVocabularyTemplate,
  buildVocabularyArtifact,
  type VocabularyArtifact,
  type VocabularyFieldValue,
  type VocabularyTemplateField,
} from './vocabulary-artifact';

export type DeckVocabularyCard = {
  cardId: string;
  fieldValues: VocabularyFieldValue[];
};

export type DeckVocabularySource = {
  deckId: string;
  templateId: string;
  templateFields: VocabularyTemplateField[];
  cards: DeckVocabularyCard[];
};

export type DeckIndexSnapshotEntry = {
  cardId: string;
  contentHash: string;
};

export type DeckIndexSnapshot = {
  representationVersion: 'v1';
  cards: DeckIndexSnapshotEntry[];
  snapshotHash: string;
};

export type IndexingLexeme = {
  key: string;
  languageTag: string;
  lemma: string;
  normalizedLemma: string;
};

export type IndexingSense = {
  key: string;
  lexemeKey: string;
  partOfSpeech: string;
  definitionLanguageTag: string;
  definition: string;
  normalizedDefinition: string;
  ipa: string | null;
  examples: string[];
};

export type IndexingMapping = {
  cardId: string;
  senseKey: string;
};

export type DeckIndexingPlan = {
  lexemes: IndexingLexeme[];
  senses: IndexingSense[];
  mappings: IndexingMapping[];
};

export type DeckIndexingStats = {
  lexemes: number;
  senses: number;
  mappings: number;
};

export type DeckIndexingTransaction = {
  loadDeckSource(
    userId: string,
    deckId: string,
  ): Promise<DeckVocabularySource>;
  persistPlan(
    userId: string,
    deckId: string,
    plan: DeckIndexingPlan,
  ): Promise<DeckIndexingStats>;
};

export type DeckIndexingRepository = {
  loadDeckSource(
    userId: string,
    deckId: string,
  ): Promise<DeckVocabularySource>;
  transaction<T>(
    userId: string,
    operation: (transaction: DeckIndexingTransaction) => Promise<T>,
  ): Promise<T>;
};

export type DeckIndexingInput = {
  userId: string;
  deckId: string;
  sourceLanguageTag: string;
  definitionLanguageTag: string;
};

export type DeckIndexPublishInput = DeckIndexingInput & {
  snapshot: unknown;
};

export type DeckIndexPublishOptions = {
  retryDelay?: (retryNumber: number, error: unknown) => Promise<void>;
};

const MAX_TRANSACTION_ATTEMPTS = 3;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function compareCardId(
  left: Pick<VocabularyArtifact, 'cardId'>,
  right: Pick<VocabularyArtifact, 'cardId'>,
): number {
  if (left.cardId < right.cardId) return -1;
  if (left.cardId > right.cardId) return 1;
  return 0;
}

function identityKey(parts: string[]): string {
  return JSON.stringify(parts);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function buildArtifacts(
  input: DeckIndexingInput,
  source: DeckVocabularySource,
): VocabularyArtifact[] {
  assertVocabularyTemplate(source.templateFields);
  return source.cards
    .map((card) =>
      buildVocabularyArtifact({
        cardId: card.cardId,
        sourceLanguageTag: input.sourceLanguageTag,
        definitionLanguageTag: input.definitionLanguageTag,
        templateFields: source.templateFields,
        fieldValues: card.fieldValues,
      }),
    )
    .sort(compareCardId);
}

function hashSnapshotCards(cards: DeckIndexSnapshotEntry[]): string {
  return createHash('sha256').update(JSON.stringify(cards)).digest('hex');
}

export function buildDeckIndexSnapshot(
  artifacts: VocabularyArtifact[],
): DeckIndexSnapshot {
  const cards = artifacts
    .map(({ cardId, contentHash }) => ({ cardId, contentHash }))
    .sort(compareCardId);

  return {
    representationVersion: 'v1',
    cards,
    snapshotHash: hashSnapshotCards(cards),
  };
}

function invalidDeckIndexSnapshot(): never {
  throw new ValidationError('Invalid deck index snapshot');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: string[],
): boolean {
  const keys = Object.keys(value).sort(compareText);
  const expected = [...expectedKeys].sort(compareText);
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}

export function parseDeckIndexSnapshot(value: unknown): DeckIndexSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'representationVersion',
      'cards',
      'snapshotHash',
    ]) ||
    value.representationVersion !== 'v1' ||
    !Array.isArray(value.cards) ||
    typeof value.snapshotHash !== 'string' ||
    !SHA256_PATTERN.test(value.snapshotHash)
  ) {
    return invalidDeckIndexSnapshot();
  }

  const cards: DeckIndexSnapshotEntry[] = [];
  let previousCardId: string | null = null;
  for (const candidate of value.cards) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ['cardId', 'contentHash']) ||
      typeof candidate.cardId !== 'string' ||
      !UUID_PATTERN.test(candidate.cardId) ||
      typeof candidate.contentHash !== 'string' ||
      !SHA256_PATTERN.test(candidate.contentHash) ||
      (previousCardId !== null && candidate.cardId <= previousCardId)
    ) {
      return invalidDeckIndexSnapshot();
    }
    cards.push({
      cardId: candidate.cardId,
      contentHash: candidate.contentHash,
    });
    previousCardId = candidate.cardId;
  }

  if (hashSnapshotCards(cards) !== value.snapshotHash) {
    return invalidDeckIndexSnapshot();
  }

  return {
    representationVersion: 'v1',
    cards,
    snapshotHash: value.snapshotHash,
  };
}

export function buildIndexingPlan(
  artifacts: VocabularyArtifact[],
): DeckIndexingPlan {
  const sortedArtifacts = [...artifacts].sort(compareCardId);
  const lexemeByKey = new Map<string, IndexingLexeme>();
  const senseByKey = new Map<string, IndexingSense>();
  const mappings: IndexingMapping[] = [];

  for (const artifact of sortedArtifacts) {
    const lexemeKey = identityKey([
      artifact.sourceLanguageTag,
      artifact.normalizedLemma,
    ]);
    if (!lexemeByKey.has(lexemeKey)) {
      lexemeByKey.set(lexemeKey, {
        key: lexemeKey,
        languageTag: artifact.sourceLanguageTag,
        lemma: artifact.lemma,
        normalizedLemma: artifact.normalizedLemma,
      });
    }

    const senseKey = identityKey([
      lexemeKey,
      artifact.partOfSpeech,
      artifact.definitionLanguageTag,
      artifact.normalizedDefinition,
    ]);
    const existingSense = senseByKey.get(senseKey);
    if (!existingSense) {
      senseByKey.set(senseKey, {
        key: senseKey,
        lexemeKey,
        partOfSpeech: artifact.partOfSpeech,
        definitionLanguageTag: artifact.definitionLanguageTag,
        definition: artifact.definition,
        normalizedDefinition: artifact.normalizedDefinition,
        ipa: artifact.ipa,
        examples: artifact.examples,
      });
    } else {
      if (existingSense.ipa === null && artifact.ipa !== null) {
        existingSense.ipa = artifact.ipa;
      }
      if (existingSense.examples.length === 0 && artifact.examples.length > 0) {
        existingSense.examples = artifact.examples;
      }
    }

    mappings.push({ cardId: artifact.cardId, senseKey });
  }

  return {
    lexemes: [...lexemeByKey.values()].sort((left, right) =>
      compareText(left.key, right.key),
    ),
    senses: [...senseByKey.values()].sort((left, right) =>
      compareText(left.key, right.key),
    ),
    mappings: mappings.sort(
      (left, right) =>
        compareCardId(left, right) ||
        compareText(left.senseKey, right.senseKey),
    ),
  };
}

export async function snapshotDeckForIndexing(
  input: DeckIndexingInput,
  repository: DeckIndexingRepository,
): Promise<{
  artifacts: VocabularyArtifact[];
  snapshot: DeckIndexSnapshot;
  nextStage: 'indexing';
  progress: { snapshotCards: number };
  statsPatch: { snapshotCards: number };
}> {
  const source = await repository.loadDeckSource(input.userId, input.deckId);
  const artifacts = buildArtifacts(input, source);
  const snapshot = buildDeckIndexSnapshot(artifacts);

  return {
    artifacts,
    snapshot,
    nextStage: 'indexing',
    progress: { snapshotCards: artifacts.length },
    statsPatch: { snapshotCards: artifacts.length },
  };
}

function snapshotsMatch(
  expected: DeckIndexSnapshot,
  current: DeckIndexSnapshot,
): boolean {
  if (
    expected.representationVersion !== current.representationVersion ||
    expected.snapshotHash !== current.snapshotHash
  ) {
    return false;
  }
  if (expected.cards.length !== current.cards.length) return false;
  return expected.cards.every(
    (card, index) =>
      card.cardId === current.cards[index]?.cardId &&
      card.contentHash === current.cards[index]?.contentHash,
  );
}

function isRetryableTransactionConflict(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return false;
  }
  return error.code === '40001' || error.code === '40P01';
}

async function defaultTransactionRetryDelay(retryNumber: number): Promise<void> {
  const baseDelayMs = Math.min(20 * 2 ** (retryNumber - 1), 100);
  const jitterMs = Math.floor(Math.random() * baseDelayMs);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, baseDelayMs + jitterMs);
  });
}

export async function publishDeckIndex(
  input: DeckIndexPublishInput,
  repository: DeckIndexingRepository,
  options: DeckIndexPublishOptions = {},
): Promise<
  | { outcome: 'stale' }
  | {
      outcome: 'published';
      stats: DeckIndexingStats;
      nextStage: 'embeddings';
      progress: { indexedCards: number };
      statsPatch: {
        indexedLexemes: number;
        indexedSenses: number;
        indexedMappings: number;
      };
    }
> {
  const expectedSnapshot = parseDeckIndexSnapshot(input.snapshot);
  const retryDelay = options.retryDelay ?? defaultTransactionRetryDelay;

  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await repository.transaction(input.userId, async (transaction) => {
        const source = await transaction.loadDeckSource(
          input.userId,
          input.deckId,
        );
        const artifacts = buildArtifacts(input, source);
        const currentSnapshot = buildDeckIndexSnapshot(artifacts);
        if (!snapshotsMatch(expectedSnapshot, currentSnapshot)) {
          return { outcome: 'stale' };
        }

        const plan = buildIndexingPlan(artifacts);
        const stats = await transaction.persistPlan(
          input.userId,
          input.deckId,
          plan,
        );
        return {
          outcome: 'published',
          stats,
          nextStage: 'embeddings',
          progress: { indexedCards: stats.mappings },
          statsPatch: {
            indexedLexemes: stats.lexemes,
            indexedSenses: stats.senses,
            indexedMappings: stats.mappings,
          },
        };
      });
    } catch (error) {
      if (
        !isRetryableTransactionConflict(error) ||
        attempt === MAX_TRANSACTION_ATTEMPTS
      ) {
        throw error;
      }
      await retryDelay(attempt, error);
    }
  }

  throw new Error('Unreachable deck indexing retry state');
}
