import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { bindJson, bindTimestamp } from '../../../src/db/pg-codecs';
import {
  dueDecksSql,
  totalDueSql,
} from '../../../src/modules/notifications/notifications.service';
import {
  dueDecksSummarySql,
  reviewQueueSql,
} from '../../../src/modules/experience/command-center.service';
import { deckStudySummarySql } from '../../../src/modules/experience/deck-workspace.service';
import {
  AT_RISK_CARD_LIMIT,
  atRiskCardsSql,
  reviewedThisWeekSql,
} from '../../../src/modules/experience/insights-overview.service';
import { libraryClassesSql } from '../../../src/modules/experience/library-explorer.service';
import {
  queueRowsSql,
  type StudyQueueScope,
} from '../../../src/modules/experience/study-queue.service';
import { retentionOverviewSql } from '../../../src/modules/study/retention-overview.service';
import {
  atRiskCardsSql as forecastAtRiskCardsSql,
  forecastSql,
  heatmapSql,
} from '../../../src/modules/study/forecast.service';
import { fsrsForgettingCurveConstants } from '../../../src/modules/study/fsrs-revision';
import {
  canonicalJson,
  sha256Canonical,
} from '../../../src/modules/study/fsrs-canonical';
import {
  FSRS_ALGORITHM_VERSION,
  FSRS_LIBRARY_VERSION,
  FSRS_POLICY_VERSION,
  normalizeFsrsParameters,
} from '../../../src/modules/study/fsrs.engine';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../src/db/migrations');
const DATABASE_NAME =
  `engram_fsrs_consumers_${crypto.randomUUID().replaceAll('-', '')}`;
const AS_OF = new Date('2026-01-11T12:00:00.000Z');
const LAST_REVIEWED_AT = new Date('2026-01-01T12:00:00.000Z');
const REVISION_CREATED_AT = new Date('2025-12-01T00:00:00.000Z');
const DAY_MS = 86_400_000;
/** Either composite state index is an acceptable access path (0028). */
const STATE_INDEXES = /idx_fsrs_card_states_(card_user|user_due)/u;

const dialect = new PgDialect();

let admin: Sql;
/**
 * The one client the whole test uses: seeded through, and wrapped by
 * `drizzle()` in `beforeAll`. That wrap mutates the client — timestamp and
 * json codecs become identity functions — so this file is the production
 * `db`/`pgClient` shape exactly, and every seed binds ISO text (`bindTimestamp`)
 * and `$n::text::jsonb` (`bindJson`) rather than a `Date` or an object.
 */
let raw: Sql;
let db: ReturnType<typeof drizzle>;

interface SeededDeck {
  userId: string;
  deckId: string;
  deckName: string;
  templateId: string;
  cardIds: string[];
}

interface SeededScenario extends SeededDeck {
  revisionId: string;
}

function assertDisposableName(name: string) {
  if (!/^engram_fsrs_consumers_[a-f0-9]+$/u.test(name)) {
    throw new Error(`Unsafe disposable database name: ${name}`);
  }
}

async function applyMigrations(database: Sql) {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
    .sort();
  for (const file of files) {
    const source = await Bun.file(resolve(MIGRATIONS_DIR, file)).text();
    const statements = source
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    // 0027 issues a bare `LOCK TABLE`, which Postgres only allows inside a
    // transaction block — same shape as fsrs-deck-reads.postgres.test.ts.
    await database.begin(async (transaction) => {
      for (const statement of statements) {
        await transaction.unsafe(statement);
      }
    });
  }
}

async function seedDeck(cardCount = 5): Promise<SeededDeck> {
  const userId = crypto.randomUUID();
  const suffix = userId.slice(0, 8);
  await raw`
    INSERT INTO users (id, email, password_hash)
    VALUES (${userId}, ${`${suffix}@example.com`}, 'hash')
  `;
  const [template] = await raw<{ id: string }[]>`
    INSERT INTO card_templates (user_id, name)
    VALUES (${userId}, ${`Template ${suffix}`})
    RETURNING id
  `;
  const [ownedClass] = await raw<{ id: string }[]>`
    INSERT INTO classes (user_id, name)
    VALUES (${userId}, ${`Class ${suffix}`})
    RETURNING id
  `;
  const [folder] = await raw<{ id: string }[]>`
    INSERT INTO folders (class_id, name)
    VALUES (${ownedClass!.id}, ${`Folder ${suffix}`})
    RETURNING id
  `;
  const deckName = `Deck ${suffix}`;
  const [deck] = await raw<{ id: string }[]>`
    INSERT INTO decks (user_id, folder_id, card_template_id, name)
    VALUES (${userId}, ${folder!.id}, ${template!.id}, ${deckName})
    RETURNING id
  `;
  await raw`
    INSERT INTO cards (deck_id, sort_order)
    SELECT ${deck!.id}, series
    FROM generate_series(0, ${cardCount - 1}) AS series
  `;
  const cards = await raw<{ id: string }[]>`
    SELECT id::text AS id
    FROM cards
    WHERE deck_id = ${deck!.id}
    ORDER BY sort_order, id
  `;
  return {
    userId,
    deckId: deck!.id,
    deckName,
    templateId: template!.id,
    cardIds: cards.map((card) => card.id),
  };
}

async function seedFields(templateId: string, cardId: string) {
  const [laterField] = await raw<{ id: string }[]>`
    INSERT INTO template_fields (template_id, name, field_type, side, sort_order)
    VALUES (${templateId}, 'Back', 'text', 'back', 1)
    RETURNING id
  `;
  const [firstField] = await raw<{ id: string }[]>`
    INSERT INTO template_fields (template_id, name, field_type, side, sort_order)
    VALUES (${templateId}, 'Front', 'text', 'front', 0)
    RETURNING id
  `;
  await raw`
    INSERT INTO card_field_values (card_id, template_field_id, value)
    VALUES
      (${cardId}, ${laterField!.id}, ${bindJson('back')}::text::jsonb),
      (${cardId}, ${firstField!.id}, ${bindJson('front')}::text::jsonb)
  `;
}

async function insertRevision(
  userId: string,
  parametersInput: Record<string, unknown> = {},
) {
  const parameters = JSON.parse(
    canonicalJson(normalizeFsrsParameters(parametersInput)),
  ) as Record<string, unknown>;
  const curve = fsrsForgettingCurveConstants(parameters);
  const [row] = await raw<{ id: string }[]>`
    INSERT INTO fsrs_parameter_revisions (
      user_id, revision, engine_version, algorithm_version, policy_version,
      parameters, params_hash, source, created_at, activated_at, decay, factor
    ) VALUES (
      ${userId}, 1, ${FSRS_LIBRARY_VERSION}, ${FSRS_ALGORITHM_VERSION},
      ${FSRS_POLICY_VERSION},
      ${bindJson(parameters)}::text::jsonb, ${sha256Canonical(parameters)},
      'manual',
      ${bindTimestamp(REVISION_CREATED_AT)}::timestamptz,
      ${bindTimestamp(REVISION_CREATED_AT)}::timestamptz,
      ${curve.decay}, ${curve.factor}
    )
    RETURNING id
  `;
  return row!.id;
}

async function insertState(
  userId: string,
  cardId: string,
  revisionId: string,
  input: {
    nextReviewAt: Date;
    state: 'learning' | 'review' | 'relearning';
    stability: number;
  },
) {
  await raw`
    INSERT INTO fsrs_card_states (
      user_id, card_id, next_review_at, last_reviewed_at, stability, difficulty,
      state, elapsed_days, scheduled_days, learning_steps, reps, lapses,
      parameter_revision_id, state_version, learning_cycle, updated_at
    ) VALUES (
      ${userId}, ${cardId},
      ${bindTimestamp(input.nextReviewAt)}::timestamptz,
      ${bindTimestamp(LAST_REVIEWED_AT)}::timestamptz,
      ${input.stability}, 5.5, ${input.state}, 10, 10, 0, 3, 1,
      ${revisionId}, 3, 1, ${bindTimestamp(LAST_REVIEWED_AT)}::timestamptz
    )
  `;
}

/**
 * Appends one immutable audit row. Every NOT NULL column is bound explicitly
 * (timestamps through `bindTimestamp`, because the client is drizzle-wrapped),
 * and the projection checks 0027 installs are respected:
 * `after_state_version = after_reps = sequence`, and the `before_*` snapshot is
 * all-NULL exactly when `sequence = 1`.
 */
async function insertEvent(
  userId: string,
  cardId: string,
  revisionId: string,
  input: {
    sequence: number;
    reviewedAt: Date;
    origin: 'live' | 'migration';
  },
) {
  const first = input.sequence === 1;
  await raw`
    INSERT INTO fsrs_review_events (
      request_id, user_id, card_id, learning_cycle, sequence, rating,
      reviewed_at, received_at, duration_ms, parameter_revision_id, origin,
      before_state, before_due_at, before_stability, before_difficulty,
      before_scheduled_days, before_learning_steps,
      elapsed_days, after_state, after_due_at, after_stability,
      after_difficulty, after_scheduled_days, after_learning_steps,
      after_reps, after_lapses, after_state_version
    ) VALUES (
      ${crypto.randomUUID()}::uuid, ${userId}::uuid, ${cardId}::uuid,
      1, ${input.sequence}::int, 'good',
      ${bindTimestamp(input.reviewedAt)}::timestamptz,
      ${bindTimestamp(input.reviewedAt)}::timestamptz,
      1200::int, ${revisionId}::uuid, ${input.origin},
      ${first ? null : 'review'},
      ${first ? null : bindTimestamp(LAST_REVIEWED_AT)}::timestamptz,
      ${first ? null : 5}::double precision,
      ${first ? null : 5.5}::double precision,
      ${first ? null : 5}::int,
      ${first ? null : 0}::int,
      10::int, 'review',
      ${bindTimestamp(
        new Date(input.reviewedAt.getTime() + 10 * DAY_MS),
      )}::timestamptz,
      10::double precision, 5.5::double precision, 10::int, 0::int,
      ${input.sequence}::int, 0::int, ${input.sequence}::bigint
    )
  `;
}

/**
 * One deck of 6 cards, ten days after their last review:
 * `[0]` New, `[1]` due review (S=10, R=0.9), `[2]` learning not yet due
 * (S=0.5, R≈0.627), `[3]` at-risk review (S=1, R≈0.693 < 0.9 target),
 * `[4]` on-track review (S=1000, R≈0.998), `[5]` **due** learning (S=0.5,
 * `next_review_at` an hour before `AS_OF`).
 *
 * `[5]` is what separates the two `learningCount` spellings: it is learning
 * *and* due, so "learning" alone would count it while the agreed
 * "learning AND not yet due" does not — and it is due, so every due counter
 * must pick it up.
 */
async function seedScenario(): Promise<SeededScenario> {
  const deck = await seedDeck(6);
  const revision = await insertRevision(deck.userId);
  await insertState(deck.userId, deck.cardIds[1]!, revision, {
    nextReviewAt: AS_OF,
    state: 'review',
    stability: 10,
  });
  await insertState(deck.userId, deck.cardIds[2]!, revision, {
    nextReviewAt: new Date('2026-01-11T12:30:00.000Z'),
    state: 'learning',
    stability: 0.5,
  });
  await insertState(deck.userId, deck.cardIds[3]!, revision, {
    nextReviewAt: new Date('2026-02-01T00:00:00.000Z'),
    state: 'review',
    stability: 1,
  });
  await insertState(deck.userId, deck.cardIds[4]!, revision, {
    nextReviewAt: new Date('2026-02-01T00:00:00.000Z'),
    state: 'review',
    stability: 1000,
  });
  await insertState(deck.userId, deck.cardIds[5]!, revision, {
    nextReviewAt: new Date('2026-01-11T11:00:00.000Z'),
    state: 'learning',
    stability: 0.5,
  });
  return { ...deck, revisionId: revision };
}

/** Rows as a plain array — postgres.js returns an Array subclass. */
async function run<T extends Record<string, unknown>>(
  statement: SQL,
): Promise<T[]> {
  const rows = await db.execute<T>(statement);
  return [...rows] as T[];
}

/**
 * Forces the planner off sequential scans and asserts the statement reaches
 * `fsrs_card_states` through one of the two composite indexes 0028 installed.
 *
 * At this seeded scale `dueDecksSql` picks `idx_fsrs_card_states_card_user`
 * (nested loop off `cards`) and the deck-scoped statements pick
 * `idx_fsrs_card_states_user_due`, which is why either is accepted. With a few
 * hundred analysed state rows the planner instead full-scans the narrower
 * `idx_fsrs_card_states_parameter_revision` for the same `user_id` predicate —
 * still index-only access, so this gate protects against a `Seq Scan`
 * regression, not against that plan switch.
 */
async function explainUsesStateIndex(statement: SQL) {
  const { sql: text, params } = dialect.sqlToQuery(statement);
  await raw.begin(async (transaction) => {
    await transaction.unsafe('SET LOCAL enable_seqscan = off');
    const rows = await transaction.unsafe<Record<string, string>[]>(
      `EXPLAIN (FORMAT TEXT) ${text}`,
      params as never[],
    );
    const plan = rows.map((row) => Object.values(row)[0]).join('\n');
    expect(plan).toMatch(STATE_INDEXES);
    expect(plan).not.toContain('Seq Scan on fsrs_card_states');
  });
}

beforeAll(async () => {
  assertDisposableName(DATABASE_NAME);
  admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${DATABASE_NAME}"`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${DATABASE_NAME}`;
  raw = postgres(url.toString(), { max: 4, onnotice: () => {} });
  await applyMigrations(raw);
  // Production shape: the SAME client is wrapped by drizzle.
  db = drizzle(raw);
});

afterAll(async () => {
  await raw?.end();
  assertDisposableName(DATABASE_NAME);
  await admin?.unsafe(`DROP DATABASE IF EXISTS "${DATABASE_NAME}" WITH (FORCE)`);
  await admin?.end();
});

describe('canonical FSRS consumer statements (drizzle-wrapped client)', () => {
  test('notifications: due decks and total, through a state index', async () => {
    const deck = await seedScenario();

    // `fsrsDue` = no state row OR next_review_at <= asOf, so the New card,
    // the due review card and the due *learning* card all count: 3.
    expect(await run(dueDecksSql(deck.userId, AS_OF, 10))).toEqual([
      { deckId: deck.deckId, deckName: deck.deckName, dueCount: 3 },
    ]);
    expect(await run(totalDueSql(deck.userId, AS_OF))).toEqual([{ total: 3 }]);
    await explainUsesStateIndex(dueDecksSql(deck.userId, AS_OF, 10));
  });

  test('command center review queue and due-deck summary', async () => {
    const deck = await seedScenario();

    // dueCount here excludes New (it requires a state row): the due review
    // card plus the due learning card = 2. `learningCount` is "learning AND
    // not yet due", so only card [2] qualifies and stays 1.
    expect(await run(reviewQueueSql(deck.userId, AS_OF))).toEqual([
      { dueCount: 2, newCount: 1, learningCount: 1, atRiskCount: 1 },
    ]);
    const [top, ...rest] = await run<{
      id: string;
      dueCount: number;
      newCount: number;
      lastStudiedAt: string;
    }>(dueDecksSummarySql(deck.userId, AS_OF));
    expect(rest).toEqual([]);
    expect(top).toMatchObject({
      id: deck.deckId,
      name: deck.deckName,
      // `fsrsDue` again: New + due review + due learning.
      dueCount: 3,
      newCount: 1,
    });
    // The wrapped client's identity timestamp parser hands back Postgres text.
    expect(new Date(top!.lastStudiedAt).toISOString()).toBe(
      LAST_REVIEWED_AT.toISOString(),
    );
  });

  test('deck workspace summary in one statement, through a state index', async () => {
    const deck = await seedScenario();

    const [row] = await run<Record<string, number | null>>(
      deckStudySummarySql(deck.userId, deck.deckId, AS_OF),
    );
    // Same shape as `reviewQueueSql` now that both spell `learningCount` as
    // "learning AND not yet due": the due learning card lands in `dueCount`
    // only, so dueCount = 2 while learningCount stays 1.
    expect(row).toMatchObject({
      dueCount: 2,
      newCount: 1,
      learningCount: 1,
      atRiskCount: 1,
    });
    expect(row!.avgRetention).toBeGreaterThan(0);
    expect(row!.avgRetention).toBeLessThanOrEqual(1);
    await explainUsesStateIndex(
      deckStudySummarySql(deck.userId, deck.deckId, AS_OF),
    );
  });

  test('insights: at-risk cards and reviewed-this-week', async () => {
    const deck = await seedScenario();
    await seedFields(deck.templateId, deck.cardIds[3]!);

    // Four audit rows on the due card; only the first is both `live` and
    // inside the closed window [asOf - 7 days, asOf].
    const events: Array<{
      sequence: number;
      reviewedAt: Date;
      origin: 'live' | 'migration';
    }> = [
      { sequence: 1, reviewedAt: new Date(AS_OF.getTime() - DAY_MS), origin: 'live' },
      {
        sequence: 2,
        reviewedAt: new Date(AS_OF.getTime() - 8 * DAY_MS),
        origin: 'live',
      },
      {
        sequence: 3,
        reviewedAt: new Date(AS_OF.getTime() - DAY_MS),
        origin: 'migration',
      },
      { sequence: 4, reviewedAt: new Date(AS_OF.getTime() + DAY_MS), origin: 'live' },
    ];
    for (const event of events) {
      await insertEvent(deck.userId, deck.cardIds[1]!, deck.revisionId, event);
    }

    const atRisk = await run<{
      id: string;
      deckId: string;
      title: string | null;
      retentionEstimate: number;
    }>(atRiskCardsSql(deck.userId, AS_OF, AT_RISK_CARD_LIMIT));
    // At risk needs state='review' AND not due, so the due learning card is
    // not a candidate: still just card [3].
    expect(atRisk.map((row) => row.id)).toEqual([deck.cardIds[3]]);
    expect(atRisk[0]).toMatchObject({ deckId: deck.deckId, title: 'front' });
    expect(atRisk[0]!.retentionEstimate).toBeLessThan(0.9);
    expect(await run(reviewedThisWeekSql(deck.userId, AS_OF))).toEqual([
      { reviewedThisWeek: 1 },
    ]);
  });

  test('library explorer tree carries card and due counts', async () => {
    const deck = await seedScenario();

    const rows = await run<{
      classId: string;
      deckId: string | null;
      deckName: string | null;
      cardCount: number;
      dueCount: number;
    }>(libraryClassesSql(deck.userId, AS_OF));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deckId: deck.deckId,
      deckName: deck.deckName,
      cardCount: 6,
      dueCount: 3,
    });
  });

  test('study queue rows carry state and target for reason derivation', async () => {
    const deck = await seedScenario();
    const scope: StudyQueueScope = { deckId: deck.deckId };
    const statement = queueRowsSql(
      deck.userId,
      { mode: 'deck', deckId: deck.deckId, limit: 50 },
      scope,
      AS_OF,
    );

    const rows = await run<{
      id: string;
      state: string | null;
      targetRetention: number | null;
    }>(statement);
    // `fsrsDue` picks up all three due cards, ordered by
    // COALESCE(next_review_at, asOf) then sort_order: the due learning card
    // (11:00) precedes the New card (COALESCE -> 12:00, sort_order 0) and the
    // due review card (12:00, sort_order 1).
    expect(
      rows.map((row) => [row.id, row.state, row.targetRetention]),
    ).toEqual([
      [deck.cardIds[5], 'learning', 0.9],
      [deck.cardIds[0], null, null],
      [deck.cardIds[1], 'review', 0.9],
    ]);
    await explainUsesStateIndex(statement);
  });

  test('memory health overview aggregate, through a state index', async () => {
    const deck = await seedScenario();

    const [row] = await run<Record<string, unknown>>(
      retentionOverviewSql(deck.userId, deck.deckId, AS_OF),
    );
    // The due learning card is status 'due' (next_review_at <= asOf wins over
    // the state), so total 6 / dueCount 2 / attentionTotal 3; 'at_risk' and
    // 'on_track' are unchanged.
    expect(row).toMatchObject({
      owned: true,
      total: 6,
      newCount: 1,
      dueCount: 2,
      atRiskCount: 1,
      onTrackCount: 2,
      targetRetention: 0.9,
      attentionTotal: 3,
    });
    expect(row!.averageRetention as number).toBeGreaterThan(0);
    expect(row!.averageRetention as number).toBeLessThanOrEqual(1);
    const attention = row!.attention as Array<{
      cardId: string;
      status: string;
      retention: number;
      nextReviewAt: string;
    }>;
    // Due first, then retention ASC: the due learning card (S=0.5) outranks
    // the due review card (S=10, R=0.9), and at-risk trails both.
    expect(attention.map((item) => [item.cardId, item.status])).toEqual([
      [deck.cardIds[5], 'due'],
      [deck.cardIds[1], 'due'],
      [deck.cardIds[3], 'at_risk'],
    ]);
    expect(attention[0]!.nextReviewAt).toBe('2026-01-11T11:00:00.000Z');
    expect(attention[1]!.nextReviewAt).toBe('2026-01-11T12:00:00.000Z');
    await explainUsesStateIndex(
      retentionOverviewSql(deck.userId, deck.deckId, AS_OF),
    );
  });

  test('memory health attention caps at 12 and orders due before at-risk', async () => {
    // 7 due cards share one retention (S=10, same last review) so the tie-break
    // is exercised: next_review_at ASC, then sort_order. 6 at-risk cards have
    // distinct stabilities, so retention ASC pins their order and the highest
    // retention (S=5) is the one the cap drops. 3 New cards pad the deck.
    const deck = await seedDeck(16);
    const revision = await insertRevision(deck.userId);
    const dueOffsetDays = [0, -1, -2, -3, -3, -4, -4];
    for (const [index, offset] of dueOffsetDays.entries()) {
      await insertState(deck.userId, deck.cardIds[index]!, revision, {
        nextReviewAt: new Date(AS_OF.getTime() + offset * DAY_MS),
        state: 'review',
        stability: 10,
      });
    }
    const atRiskStabilities = [0.5, 1, 2, 3, 4, 5];
    for (const [index, stability] of atRiskStabilities.entries()) {
      await insertState(deck.userId, deck.cardIds[7 + index]!, revision, {
        nextReviewAt: new Date(AS_OF.getTime() + 30 * DAY_MS),
        state: 'review',
        stability,
      });
    }

    const [row] = await run<Record<string, unknown>>(
      retentionOverviewSql(deck.userId, deck.deckId, AS_OF),
    );
    expect(row).toMatchObject({
      owned: true,
      total: 16,
      newCount: 3,
      dueCount: 7,
      atRiskCount: 6,
      onTrackCount: 0,
      attentionTotal: 13,
    });
    const attention = row!.attention as Array<{
      cardId: string;
      status: string;
      retention: number;
    }>;
    expect(attention).toHaveLength(12);
    expect(attention.map((item) => item.cardId)).toEqual([
      // next_review_at ASC wins over sort_order, ties fall back to sort_order
      deck.cardIds[5],
      deck.cardIds[6],
      deck.cardIds[3],
      deck.cardIds[4],
      deck.cardIds[2],
      deck.cardIds[1],
      deck.cardIds[0],
      // then at-risk by retention ASC — S=5 (the highest) is cut by the cap
      deck.cardIds[7],
      deck.cardIds[8],
      deck.cardIds[9],
      deck.cardIds[10],
      deck.cardIds[11],
    ]);
    expect(attention.map((item) => item.status)).toEqual([
      ...Array.from({ length: 7 }, () => 'due'),
      ...Array.from({ length: 5 }, () => 'at_risk'),
    ]);
    const atRiskRetentions = attention.slice(7).map((item) => item.retention);
    expect(atRiskRetentions).toEqual([...atRiskRetentions].sort((a, b) => a - b));
    expect(Math.max(...atRiskRetentions)).toBeLessThan(0.9);
  });

  test('forecast counts every decayed state across the horizon', async () => {
    const deck = await seedScenario();

    const rows = await run<{
      offset: number;
      atRiskCount: number;
      avgRetention: number;
    }>(forecastSql(deck.userId, 3, AS_OF));
    // `states` has no state filter, so both learning cards (S=0.5) and the due
    // card (S=10) are in scope too: at asOf the two S=0.5 cards and S=1 are
    // under the 0.9 target; from day 1 the S=10 card has decayed under it too.
    expect(rows.map((row) => [Number(row.offset), row.atRiskCount])).toEqual([
      [0, 3],
      [1, 4],
      [2, 4],
    ]);
    for (const row of rows) {
      expect(row.avgRetention).toBeGreaterThan(0);
      expect(row.avgRetention).toBeLessThanOrEqual(1);
    }
    expect(rows[1]!.avgRetention).toBeLessThan(rows[0]!.avgRetention);
  });

  test('retention heatmap returns only cards with state, ordered by recall', async () => {
    const deck = await seedScenario();
    const outsider = await seedDeck(1);

    const rows = await run<{ cardId: string; retention: number }>(
      heatmapSql(deck.userId, deck.deckId, AS_OF),
    );
    // Cards [2] and [5] share S=0.5 and the same last review, so their
    // retention is bit-identical and `ORDER BY retention ASC, c.id` breaks the
    // tie on a random uuid — assert the pair, then the strict tail.
    const heatmapIds = rows.map((row) => row.cardId);
    expect(new Set(heatmapIds.slice(0, 2))).toEqual(
      new Set([deck.cardIds[2], deck.cardIds[5]]),
    );
    expect(heatmapIds.slice(2)).toEqual([
      deck.cardIds[3],
      deck.cardIds[1],
      deck.cardIds[4],
    ]);
    for (const row of rows) {
      expect(row.retention).toBeGreaterThan(0);
      expect(row.retention).toBeLessThanOrEqual(1);
    }
    const retentions = rows.map((row) => row.retention);
    expect(retentions).toEqual([...retentions].sort((a, b) => a - b));
    expect(
      await run(heatmapSql(deck.userId, outsider.deckId, AS_OF)),
    ).toEqual([]);
  });

  test('forecast at-risk cards honour the per-revision target and an override', async () => {
    const deck = await seedScenario();
    await seedFields(deck.templateId, deck.cardIds[3]!);

    const perRevision = await run<{
      cardId: string;
      deckName: string;
      retention: number;
      total: number;
      fields: Array<{ fieldName: string; side: string; value: unknown }>;
    }>(forecastAtRiskCardsSql(deck.userId, AS_OF, null, 20));
    expect(perRevision.map((row) => row.cardId)).toEqual([deck.cardIds[3]]);
    expect(perRevision[0]).toMatchObject({
      deckName: deck.deckName,
      total: 1,
    });
    expect(perRevision[0]!.fields.map((field) => field.fieldName)).toEqual([
      'Front',
      'Back',
    ]);

    // threshold 1.0 sweeps in every not-due review card (S=1 and S=1000).
    const overridden = await run<{ cardId: string; total: number }>(
      forecastAtRiskCardsSql(deck.userId, AS_OF, 1, 2),
    );
    expect(overridden.map((row) => row.cardId)).toEqual([
      deck.cardIds[3],
      deck.cardIds[4],
    ]);
    expect(overridden.map((row) => row.total)).toEqual([2, 2]);
  });
});
