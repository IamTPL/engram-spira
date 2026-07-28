import type { Sql } from 'postgres';

import { pgClient } from '../../db';
import { NotFoundError } from '../../shared/errors';
import type {
  EnqueueDeckRunInput,
  EnqueueSenseExpansionRunInput,
  KgRunRecord,
  KgRunRepository,
} from './kg-runs.service';

type RunSql = Sql;

const RUN_SELECT = `
  id,
  user_id AS "userId",
  run_type AS "runType",
  deck_id AS "deckId",
  focus_sense_id AS "focusSenseId",
  status,
  stage,
  fingerprint,
  representation_version AS "representationVersion",
  embedding_model AS "embeddingModel",
  prompt_version AS "promptVersion",
  taxonomy_version AS "taxonomyVersion",
  source_language_tag AS "sourceLanguageTag",
  definition_language_tag AS "definitionLanguageTag",
  snapshot,
  progress,
  stats,
  error_code AS "errorCode",
  error_message AS "errorMessage",
  created_at AS "createdAt"
`;

async function selectOwnedRun(
  sql: RunSql,
  userId: string,
  runId: string,
  lock = false,
): Promise<KgRunRecord> {
  const rows = lock
    ? await sql.unsafe<KgRunRecord[]>(
        `
          SELECT ${RUN_SELECT}
          FROM kg_runs
          WHERE id = $1
            AND user_id = $2
          FOR UPDATE
        `,
        [runId, userId],
      )
    : await sql.unsafe<KgRunRecord[]>(
        `
          SELECT ${RUN_SELECT}
          FROM kg_runs
          WHERE id = $1
            AND user_id = $2
        `,
        [runId, userId],
      );
  const run = rows[0];
  if (!run) throw new NotFoundError('Knowledge graph run');
  return run;
}

async function enqueueDeckRun(
  sql: RunSql,
  input: EnqueueDeckRunInput,
): Promise<{ run: KgRunRecord; reused: boolean }> {
  return sql.begin(async (rawTransaction) => {
    const transaction = rawTransaction as unknown as RunSql;
    const completed = await transaction.unsafe<KgRunRecord[]>(
      `
        SELECT ${RUN_SELECT}
        FROM kg_runs
        WHERE user_id = $1
          AND fingerprint = $2
          AND status = 'completed'
        ORDER BY completed_at DESC NULLS LAST, created_at DESC, id
        LIMIT 1
      `,
      [input.userId, input.fingerprint],
    );
    if (completed[0]) return { run: completed[0], reused: true };

    const inserted = await transaction.unsafe<KgRunRecord[]>(
      `
        INSERT INTO kg_runs (
          user_id,
          run_type,
          deck_id,
          status,
          stage,
          fingerprint,
          representation_version,
          embedding_model,
          prompt_version,
          taxonomy_version,
          source_language_tag,
          definition_language_tag,
          snapshot,
          progress,
          stats
        )
        SELECT
          $1,
          'deck_index',
          d.id,
          'queued',
          'snapshot',
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10::text::jsonb,
          '{"completed":0,"total":6}'::jsonb,
          jsonb_build_object(
            'cards',
            jsonb_array_length($10::text::jsonb -> 'cards')
          )
        FROM decks d
        WHERE d.id = $2
          AND d.user_id = $1
        ON CONFLICT DO NOTHING
        RETURNING ${RUN_SELECT}
      `,
      [
        input.userId,
        input.deckId,
        input.fingerprint,
        input.representationVersion,
        input.embeddingModel,
        input.promptVersion,
        input.taxonomyVersion,
        input.sourceLanguageTag,
        input.definitionLanguageTag,
        JSON.stringify(input.snapshot),
      ],
    );
    if (inserted[0]) return { run: inserted[0], reused: false };

    const active = await transaction.unsafe<KgRunRecord[]>(
      `
        SELECT ${RUN_SELECT}
        FROM kg_runs
        WHERE user_id = $1
          AND deck_id = $2
          AND status IN ('queued', 'processing')
        ORDER BY created_at, id
        LIMIT 1
      `,
      [input.userId, input.deckId],
    );
    if (active[0]) return { run: active[0], reused: true };

    const ownedDeck = await transaction<{ id: string }[]>`
      SELECT id
      FROM decks
      WHERE id = ${input.deckId}
        AND user_id = ${input.userId}
    `;
    if (!ownedDeck[0]) throw new NotFoundError('Deck');

    const concurrentlyCompleted = await transaction.unsafe<KgRunRecord[]>(
      `
        SELECT ${RUN_SELECT}
        FROM kg_runs
        WHERE user_id = $1
          AND fingerprint = $2
          AND status = 'completed'
        ORDER BY completed_at DESC NULLS LAST, created_at DESC, id
        LIMIT 1
      `,
      [input.userId, input.fingerprint],
    );
    if (concurrentlyCompleted[0]) {
      return { run: concurrentlyCompleted[0], reused: true };
    }
    throw new Error('Knowledge graph run could not be enqueued');
  });
}

async function enqueueSenseExpansionRun(
  sql: RunSql,
  input: EnqueueSenseExpansionRunInput,
): Promise<{ run: KgRunRecord; reused: boolean }> {
  return sql.begin(async (rawTransaction) => {
    const transaction = rawTransaction as unknown as RunSql;
    const completed = await transaction.unsafe<KgRunRecord[]>(
      `
        SELECT ${RUN_SELECT}
        FROM kg_runs
        WHERE user_id = $1
          AND run_type = 'sense_expansion'
          AND fingerprint = $2
          AND status = 'completed'
        ORDER BY completed_at DESC NULLS LAST, created_at DESC, id
        LIMIT 1
      `,
      [input.userId, input.fingerprint],
    );
    if (completed[0]) return { run: completed[0], reused: true };

    const inserted = await transaction.unsafe<KgRunRecord[]>(
      `
        INSERT INTO kg_runs (
          user_id,
          run_type,
          focus_sense_id,
          status,
          stage,
          fingerprint,
          representation_version,
          embedding_model,
          prompt_version,
          taxonomy_version,
          source_language_tag,
          definition_language_tag,
          snapshot,
          progress,
          stats
        )
        SELECT
          $1,
          'sense_expansion',
          sense.id,
          'queued',
          'snapshot',
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10::text::jsonb,
          '{"completed":0,"total":3}'::jsonb,
          '{"indexedSenses":1}'::jsonb
        FROM lexical_senses sense
        JOIN lexemes lexeme ON lexeme.id = sense.lexeme_id
        WHERE sense.id = $2
          AND lexeme.user_id = $1
        ON CONFLICT DO NOTHING
        RETURNING ${RUN_SELECT}
      `,
      [
        input.userId,
        input.focusSenseId,
        input.fingerprint,
        input.representationVersion,
        input.embeddingModel,
        input.promptVersion,
        input.taxonomyVersion,
        input.sourceLanguageTag,
        input.definitionLanguageTag,
        JSON.stringify(input.snapshot),
      ],
    );
    if (inserted[0]) return { run: inserted[0], reused: false };

    const active = await transaction.unsafe<KgRunRecord[]>(
      `
        SELECT ${RUN_SELECT}
        FROM kg_runs
        WHERE user_id = $1
          AND run_type = 'sense_expansion'
          AND focus_sense_id = $2
          AND status IN ('queued', 'processing')
        ORDER BY created_at, id
        LIMIT 1
      `,
      [input.userId, input.focusSenseId],
    );
    if (active[0]) return { run: active[0], reused: true };

    const ownedSense = await transaction<{ id: string }[]>`
      SELECT sense.id
      FROM lexical_senses sense
      JOIN lexemes lexeme ON lexeme.id = sense.lexeme_id
      WHERE sense.id = ${input.focusSenseId}
        AND lexeme.user_id = ${input.userId}
    `;
    if (!ownedSense[0]) throw new NotFoundError('Lexical sense');

    const concurrentlyCompleted =
      await transaction.unsafe<KgRunRecord[]>(
        `
          SELECT ${RUN_SELECT}
          FROM kg_runs
          WHERE user_id = $1
            AND run_type = 'sense_expansion'
            AND fingerprint = $2
            AND status = 'completed'
          ORDER BY completed_at DESC NULLS LAST, created_at DESC, id
          LIMIT 1
        `,
        [input.userId, input.fingerprint],
      );
    if (concurrentlyCompleted[0]) {
      return { run: concurrentlyCompleted[0], reused: true };
    }
    throw new Error('Sense expansion run could not be enqueued');
  });
}

async function cancelOwnedRun(
  sql: RunSql,
  userId: string,
  runId: string,
): Promise<KgRunRecord> {
  return sql.begin(async (rawTransaction) => {
    const transaction = rawTransaction as unknown as RunSql;
    const run = await selectOwnedRun(transaction, userId, runId, true);
    if (run.status === 'queued') {
      const rows = await transaction.unsafe<KgRunRecord[]>(
        `
          UPDATE kg_runs
          SET
            status = 'cancelled',
            cancel_requested_at = COALESCE(cancel_requested_at, now()),
            cancelled_at = COALESCE(cancelled_at, now()),
            locked_by = NULL,
            locked_until = NULL,
            heartbeat_at = NULL,
            updated_at = now()
          WHERE id = $1
            AND user_id = $2
            AND status = 'queued'
          RETURNING ${RUN_SELECT}
        `,
        [runId, userId],
      );
      return rows[0] ?? run;
    }
    if (run.status === 'processing') {
      const rows = await transaction.unsafe<KgRunRecord[]>(
        `
          UPDATE kg_runs
          SET
            cancel_requested_at = COALESCE(cancel_requested_at, now()),
            updated_at = now()
          WHERE id = $1
            AND user_id = $2
            AND status = 'processing'
          RETURNING ${RUN_SELECT}
        `,
        [runId, userId],
      );
      return rows[0] ?? run;
    }
    return run;
  });
}

export function createPostgresKgRunsRepository(
  sql: RunSql = pgClient,
): KgRunRepository {
  return {
    enqueueDeckRun: (input) => enqueueDeckRun(sql, input),
    enqueueSenseExpansionRun: (input) =>
      enqueueSenseExpansionRun(sql, input),
    getOwnedRun: (userId, runId) => selectOwnedRun(sql, userId, runId),
    cancelOwnedRun: (userId, runId) =>
      cancelOwnedRun(sql, userId, runId),
  };
}
