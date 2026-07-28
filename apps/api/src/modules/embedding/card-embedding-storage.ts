import { pgClient } from '../../db';
import { ValidationError } from '../../shared/errors';

const EMBEDDING_DIMENSIONS = 768;

type CardEmbeddingSqlRow = {
  id: string;
  hasEmbedding?: boolean;
};

export interface CardEmbeddingSqlClient {
  (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<CardEmbeddingSqlRow[]>;
  begin<T>(run: (sql: CardEmbeddingSqlClient) => Promise<T>): Promise<T>;
}

export type CardEmbeddingMetadataWrite = {
  model: string;
  dimensions: number;
  representationVersion: string;
  contentHash: string;
};

function assertValidStoredEmbedding(embedding: number[]): void {
  if (
    embedding.length !== EMBEDDING_DIMENSIONS ||
    !embedding.every((value) => Number.isFinite(value))
  ) {
    throw new ValidationError(
      `Invalid Gemini embedding response: expected ${EMBEDDING_DIMENSIONS} finite values`,
    );
  }
  const norm = Math.hypot(...embedding);
  if (!Number.isFinite(norm) || norm <= 1e-12) {
    throw new ValidationError(
      'Invalid Gemini embedding response: expected a finite non-zero norm',
    );
  }
}

export async function writeCardEmbeddingInTransaction(
  transaction: CardEmbeddingSqlClient,
  cardId: string,
  embedding: number[],
  metadata: CardEmbeddingMetadataWrite | null,
  onlyIfMissing = false,
): Promise<boolean> {
  assertValidStoredEmbedding(embedding);

  const cardRows = await transaction`
    SELECT card.id
    FROM cards AS card
    WHERE card.id = ${cardId}
    FOR KEY SHARE
  `;
  if (cardRows.length === 0) return false;

  const fieldRows = await transaction`
    SELECT
      field_value.id,
      (field_value.embedding IS NOT NULL) AS "hasEmbedding"
    FROM card_field_values AS field_value
    WHERE field_value.card_id = ${cardId}
    ORDER BY field_value.id
    FOR UPDATE
  `;
  if (fieldRows.length === 0) return false;
  if (
    onlyIfMissing &&
    fieldRows.some((fieldRow) => fieldRow.hasEmbedding === true)
  ) {
    return false;
  }
  if (metadata === null) {
    const provenanceRows = await transaction`
      SELECT metadata.card_id AS id
      FROM card_embedding_metadata AS metadata
      WHERE metadata.card_id = ${cardId}
    `;
    // The field-row lock serializes all writers for this card. Once a KG
    // provenance row exists, a legacy representation may not overwrite the
    // vector or erase its metadata; a later KG write remains authoritative.
    if (provenanceRows.length > 0) return false;
  }

  const targetId = fieldRows[0].id;
  const vectorLiteral = `[${embedding.join(',')}]`;
  await transaction`
    UPDATE card_field_values
    SET embedding = CASE
      WHEN id = ${targetId} THEN ${vectorLiteral}::vector
      ELSE NULL
    END
    WHERE card_id = ${cardId}
    RETURNING id
  `;

  if (metadata) {
    await transaction`
      INSERT INTO card_embedding_metadata (
        card_id,
        model,
        dimensions,
        representation_version,
        content_hash,
        embedded_at
      )
      VALUES (
        ${cardId},
        ${metadata.model},
        ${metadata.dimensions},
        ${metadata.representationVersion},
        ${metadata.contentHash},
        now()
      )
      ON CONFLICT (card_id) DO UPDATE SET
        model = EXCLUDED.model,
        dimensions = EXCLUDED.dimensions,
        representation_version = EXCLUDED.representation_version,
        content_hash = EXCLUDED.content_hash,
        embedded_at = EXCLUDED.embedded_at
    `;
  }

  return true;
}

export async function writeLegacyCardEmbedding(
  cardId: string,
  embedding: number[],
  onlyIfMissing = false,
  sqlClient: CardEmbeddingSqlClient = pgClient as unknown as CardEmbeddingSqlClient,
): Promise<boolean> {
  assertValidStoredEmbedding(embedding);
  return sqlClient.begin((transaction) =>
    writeCardEmbeddingInTransaction(
      transaction,
      cardId,
      embedding,
      null,
      onlyIfMissing,
    ),
  );
}
