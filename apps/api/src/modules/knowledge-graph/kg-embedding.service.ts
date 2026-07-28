import { sql } from 'drizzle-orm';

import { db, pgClient } from '../../db';
import {
  assertValidEmbeddingVector,
  getGeminiProvider,
  type GeminiUsage,
} from '../ai/gemini-provider';
import {
  writeCardEmbeddingInTransaction,
  type CardEmbeddingSqlClient,
} from '../embedding/card-embedding-storage';
import type { VocabularyArtifact } from './vocabulary-artifact';
import { ValidationError } from '../../shared/errors';

const EMBEDDING_DIMENSIONS = 768;
const REPRESENTATION_VERSION = 'v1';
const MAX_EMBEDDING_BATCH_SIZE = 50;

export type CardEmbeddingState = {
  cardId: string;
  embeddingCount: number;
  model: string | null;
  dimensions: number | null;
  representationVersion: string | null;
  contentHash: string | null;
};

export type KgEmbeddingWrite = {
  cardId: string;
  embedding: number[];
  model: string;
  dimensions: number;
  representationVersion: string;
  contentHash: string;
};

export type KgEmbeddingSqlClient = CardEmbeddingSqlClient;

export type KgEmbeddingDependencies = {
  loadStates(cardIds: string[]): Promise<CardEmbeddingState[]>;
  embedTexts(
    inputs: string[],
    signal?: AbortSignal,
  ): Promise<{ value: number[][]; usage: GeminiUsage }>;
  writeBatch(entries: KgEmbeddingWrite[]): Promise<void>;
  embeddingModel?: string;
};

type KgEmbeddingResult = {
  embedded: number;
  reused: number;
  usage: GeminiUsage;
};

export function buildKgEmbeddingRepresentation(
  artifact: VocabularyArtifact,
): string {
  const input = {
    representationVersion: artifact.representationVersion,
    sourceLanguageTag: artifact.sourceLanguageTag,
    definitionLanguageTag: artifact.definitionLanguageTag,
    lemma: artifact.lemma,
    normalizedLemma: artifact.normalizedLemma,
    partOfSpeech: artifact.partOfSpeech,
    definition: artifact.definition,
    normalizedDefinition: artifact.normalizedDefinition,
    ipa: artifact.ipa,
    examples: artifact.examples,
  };
  return `task: semantic similarity\ninput: ${JSON.stringify(input)}`;
}

export function isKgEmbeddingReusable(
  artifact: VocabularyArtifact,
  state: CardEmbeddingState | null,
  embeddingModel = 'gemini-embedding-2',
): boolean {
  return Boolean(
    state?.embeddingCount === 1 &&
      state.cardId === artifact.cardId &&
      state.model === embeddingModel &&
      state.dimensions === EMBEDDING_DIMENSIONS &&
      state.representationVersion === artifact.representationVersion &&
      state.contentHash === artifact.contentHash,
  );
}

export async function loadCardEmbeddingStates(
  cardIds: string[],
): Promise<CardEmbeddingState[]> {
  if (cardIds.length === 0) return [];
  return db.execute<CardEmbeddingState>(sql`
    SELECT
      requested.card_id AS "cardId",
      (
        SELECT count(*)::integer
        FROM card_field_values AS field_value
        WHERE field_value.card_id = requested.card_id
          AND field_value.embedding IS NOT NULL
      ) AS "embeddingCount",
      metadata.model,
      metadata.dimensions,
      metadata.representation_version AS "representationVersion",
      metadata.content_hash AS "contentHash"
    FROM unnest(${cardIds}::uuid[]) AS requested(card_id)
    LEFT JOIN card_embedding_metadata AS metadata
      ON metadata.card_id = requested.card_id
  `);
}

function defaultDependencies(): KgEmbeddingDependencies {
  const provider = getGeminiProvider();
  return {
    loadStates: loadCardEmbeddingStates,
    embedTexts: (inputs, signal) => provider.embedTexts(inputs, signal),
    writeBatch: writeKgEmbeddingBatch,
    embeddingModel: provider.embeddingModel,
  };
}

export async function ensureKgEmbeddings(
  artifacts: VocabularyArtifact[],
  dependencies: KgEmbeddingDependencies = defaultDependencies(),
  signal?: AbortSignal,
): Promise<KgEmbeddingResult> {
  if (artifacts.length === 0) {
    return {
      embedded: 0,
      reused: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const embeddingModel =
    dependencies.embeddingModel ?? 'gemini-embedding-2';
  const states = await dependencies.loadStates(
    artifacts.map((artifact) => artifact.cardId),
  );
  const stateByCardId = new Map(states.map((state) => [state.cardId, state]));
  const staleArtifacts = artifacts.filter(
    (artifact) =>
      !isKgEmbeddingReusable(
        artifact,
        stateByCardId.get(artifact.cardId) ?? null,
        embeddingModel,
      ),
  );
  const usage: GeminiUsage = { inputTokens: 0, outputTokens: 0 };

  for (
    let offset = 0;
    offset < staleArtifacts.length;
    offset += MAX_EMBEDDING_BATCH_SIZE
  ) {
    const batch = staleArtifacts.slice(
      offset,
      offset + MAX_EMBEDDING_BATCH_SIZE,
    );
    const result = await dependencies.embedTexts(
      batch.map(buildKgEmbeddingRepresentation),
      signal,
    );
    if (result.value.length !== batch.length) {
      throw new ValidationError(
        'Invalid Gemini embedding response: embedding count mismatch',
      );
    }
    usage.inputTokens =
      usage.inputTokens === null || result.usage.inputTokens === null
        ? null
        : usage.inputTokens + result.usage.inputTokens;
    usage.outputTokens =
      usage.outputTokens === null || result.usage.outputTokens === null
        ? null
        : usage.outputTokens + result.usage.outputTokens;
    await dependencies.writeBatch(
      batch.map((artifact, index) => ({
        cardId: artifact.cardId,
        embedding: result.value[index],
        model: embeddingModel,
        dimensions: EMBEDDING_DIMENSIONS,
        representationVersion: REPRESENTATION_VERSION,
        contentHash: artifact.contentHash,
      })),
    );
  }

  return {
    embedded: staleArtifacts.length,
    reused: artifacts.length - staleArtifacts.length,
    usage,
  };
}

export async function writeKgEmbeddingBatch(
  entries: KgEmbeddingWrite[],
  sqlClient: KgEmbeddingSqlClient = pgClient as unknown as KgEmbeddingSqlClient,
): Promise<void> {
  for (const entry of entries) {
    assertValidEmbeddingVector(entry.embedding);
    if (
      entry.dimensions !== EMBEDDING_DIMENSIONS ||
      entry.representationVersion !== REPRESENTATION_VERSION
    ) {
      throw new ValidationError('Invalid KG embedding provenance');
    }
  }
  if (entries.length === 0) return;

  await sqlClient.begin(async (transaction) => {
    const sortedEntries = entries
      .slice()
      .sort((left, right) => left.cardId.localeCompare(right.cardId));
    for (const entry of sortedEntries) {
      const written = await writeCardEmbeddingInTransaction(
        transaction,
        entry.cardId,
        entry.embedding,
        {
          model: entry.model,
          dimensions: entry.dimensions,
          representationVersion: entry.representationVersion,
          contentHash: entry.contentHash,
        },
      );
      if (!written) {
        throw new ValidationError('Card embedding target not found');
      }
    }
  });
}
