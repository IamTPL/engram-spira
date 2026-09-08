import { describe, expect, test } from 'bun:test';
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  normalizeRelation,
} from 'drizzle-orm/relations';
import { getTableConfig } from 'drizzle-orm/pg-core';

import * as schema from '../../src/db/schema';

const expectedExports = [
  'fsrsParameterRevisions',
  'fsrsParameterRevisionsRelations',
  'fsrsCardStates',
  'fsrsCardStatesRelations',
  'fsrsReviewEvents',
  'fsrsReviewEventsRelations',
  'fsrsMigrationRuns',
  'fsrsMigrationRunsRelations',
] as const;

describe('FSRS-only Drizzle schema', () => {
  test('exports every table and relation through the schema barrel', () => {
    for (const exportName of expectedExports) {
      expect(schema).toHaveProperty(exportName);
    }
  });

  test('relates FSRS states and events to parameter revisions by revision and owner', () => {
    const { tables, tableNamesMap } = extractTablesRelationalConfig(
      schema,
      createTableRelationsHelpers,
    );

    for (const relation of [
      tables.fsrsCardStates.relations.parameterRevision,
      tables.fsrsReviewEvents.relations.parameterRevision,
    ]) {
      const normalized = normalizeRelation(tables, tableNamesMap, relation);

      expect(normalized.fields.map((field) => field.name)).toEqual([
        'parameter_revision_id',
        'user_id',
      ]);
      expect(normalized.references.map((reference) => reference.name)).toEqual([
        'id',
        'user_id',
      ]);
    }
  });

  test('models stable named constraints and every foreign-key support index', () => {
    const typedSchema = schema as typeof schema & {
      fsrsParameterRevisions: Parameters<typeof getTableConfig>[0];
      fsrsCardStates: Parameters<typeof getTableConfig>[0];
      fsrsReviewEvents: Parameters<typeof getTableConfig>[0];
      fsrsMigrationRuns: Parameters<typeof getTableConfig>[0];
    };

    const revisionConfig = getTableConfig(typedSchema.fsrsParameterRevisions);
    const stateConfig = getTableConfig(typedSchema.fsrsCardStates);
    const eventConfig = getTableConfig(typedSchema.fsrsReviewEvents);
    const runConfig = getTableConfig(typedSchema.fsrsMigrationRuns);

    expect(
      revisionConfig.uniqueConstraints.map((constraint) => constraint.name),
    ).toEqual(expect.arrayContaining([
      'uq_fsrs_parameter_revisions_user_revision',
      'uq_fsrs_parameter_revisions_resolved_params',
    ]));
    expect(revisionConfig.indexes.map((index) => index.config.name)).toContain(
      'uq_fsrs_parameter_revisions_active_user',
    );

    expect(
      stateConfig.uniqueConstraints.map((constraint) => constraint.name),
    ).toContain('uq_fsrs_card_states_user_card');
    expect(stateConfig.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'idx_fsrs_card_states_user_due',
        'idx_fsrs_card_states_card_user',
        'idx_fsrs_card_states_parameter_revision',
      ]),
    );

    expect(
      eventConfig.uniqueConstraints.map((constraint) => constraint.name),
    ).toEqual(expect.arrayContaining([
      'uq_fsrs_review_events_user_request',
      'uq_fsrs_review_events_user_card_cycle_sequence',
    ]));
    expect(eventConfig.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'idx_fsrs_review_events_user_reviewed',
        'idx_fsrs_review_events_card',
        'idx_fsrs_review_events_parameter_revision',
      ]),
    );
    expect(runConfig.indexes.map((index) => index.config.name)).toContain(
      'idx_fsrs_migration_runs_status_started',
    );
    expect(runConfig.checks.map((constraint) => constraint.name)).toContain(
      'chk_fsrs_migration_runs_lifecycle',
    );

    expect(typedSchema.fsrsCardStates.lastReviewedAt.notNull).toBe(true);
    expect(typedSchema.fsrsCardStates.learningCycle.notNull).toBe(true);
    expect(typedSchema.fsrsCardStates.learningCycle.hasDefault).toBe(true);
    expect(typedSchema.fsrsReviewEvents.learningCycle.notNull).toBe(true);
    expect(typedSchema.fsrsReviewEvents.learningCycle.hasDefault).toBe(true);
  });
});
