import { describe, expect, test } from 'bun:test';
import { getTableConfig } from 'drizzle-orm/pg-core';

import * as schema from '../../src/db/schema';

const expectedExports = [
  'lexemes',
  'lexemesRelations',
  'lexicalSenses',
  'lexicalSensesRelations',
  'cardSenses',
  'cardSensesRelations',
  'senseRelations',
  'senseRelationsRelations',
  'kgRuns',
  'kgRunsRelations',
  'kgRelationSuggestions',
  'kgRelationSuggestionsRelations',
  'cardEmbeddingMetadata',
  'cardEmbeddingMetadataRelations',
] as const;

describe('language knowledge graph Drizzle schema', () => {
  test('exports every table and relation through the schema barrel', () => {
    for (const exportName of expectedExports) {
      expect(schema).toHaveProperty(exportName);
    }
  });

  test('keeps embedding provenance separate from the pgvector column', () => {
    const metadata = (
      schema as typeof schema & {
        cardEmbeddingMetadata: Parameters<typeof getTableConfig>[0];
      }
    ).cardEmbeddingMetadata;

    expect(metadata).toBeDefined();
    expect(getTableConfig(metadata).columns.map((column) => column.name)).toEqual([
      'card_id',
      'model',
      'dimensions',
      'representation_version',
      'content_hash',
      'embedded_at',
    ]);
  });

  test('models graph uniqueness and every foreign-key support index', () => {
    const typedSchema = schema as typeof schema & {
      cardLinks: Parameters<typeof getTableConfig>[0];
      kgRuns: Parameters<typeof getTableConfig>[0];
      kgRelationSuggestions: Parameters<typeof getTableConfig>[0];
    };
    const cardLinkConfig = getTableConfig(typedSchema.cardLinks);
    const cardLinkUnique = cardLinkConfig.uniqueConstraints.find(
      (constraint) => constraint.name === 'uq_card_link',
    );
    expect(cardLinkUnique?.columns.map((column) => column.name)).toEqual([
      'source_card_id',
      'target_card_id',
      'link_type',
    ]);

    const suggestionConfig = getTableConfig(
      typedSchema.kgRelationSuggestions,
    );
    const suggestionUnique = suggestionConfig.uniqueConstraints.find(
      (constraint) =>
        constraint.name === 'uq_kg_suggestions_user_fingerprint',
    );
    expect(suggestionUnique?.columns.map((column) => column.name)).toEqual([
      'user_id',
      'fingerprint',
    ]);

    expect(
      getTableConfig(typedSchema.kgRuns).indexes.map((index) => index.config.name),
    ).toEqual(expect.arrayContaining([
      'idx_kg_runs_deck',
      'idx_kg_runs_focus_sense',
    ]));
    expect(
      suggestionConfig.indexes.map(
        (index) => index.config.name,
      ),
    ).toContain('idx_kg_suggestions_accepted_relation');
  });
});
