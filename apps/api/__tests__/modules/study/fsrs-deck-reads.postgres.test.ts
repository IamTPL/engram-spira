import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { forgetting_curve, type FSRSParameters } from 'ts-fsrs';
import { NotFoundError } from '../../../src/shared/errors';
import {
  DUE_CARD_IDS_SQL,
  createPostgresFsrsDeckReadRepository,
} from '../../../src/modules/study/fsrs-deck-reads.postgres';
import {
  canonicalJson,
  sha256Canonical,
} from '../../../src/modules/study/fsrs-replay-planner';
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
  `engram_fsrs_deck_reads_${crypto.randomUUID().replaceAll('-', '')}`;
const AS_OF = new Date('2026-01-11T12:00:00.000Z');

let admin: Sql;
let sql: Sql;
/**
 * Mirrors the production `pgClient`: `drizzle()` mutates the postgres.js
 * client it wraps, replacing the timestamp serializers and parsers with
 * identity functions. Repositories that share that client must not rely
 * on the driver converting `Date` values in either direction.
 */
let drizzleWrappedSql: Sql;

interface SeededDeck {
  userId: string;
  deckId: string;
  templateId: string;
  cardIds: string[];
}

interface SeededRevision {
  id: string;
  parameters: Record<string, unknown>;
}

function assertDisposableName(name: string) {
  if (!/^engram_fsrs_deck_reads_[a-f0-9]+$/u.test(name)) {
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
    await database.begin(async (transaction) => {
      for (const statement of statements) {
        await transaction.unsafe(statement);
      }
    });
  }
}

async function seedDeck(cardCount = 4): Promise<SeededDeck> {
  const userId = crypto.randomUUID();
  const suffix = userId.slice(0, 8);
  await sql`
    INSERT INTO users (id, email, password_hash)
    VALUES (${userId}, ${`${suffix}@example.com`}, 'hash')
  `;
  const [template] = await sql<{ id: string }[]>`
    INSERT INTO card_templates (user_id, name)
    VALUES (${userId}, ${`Template ${suffix}`})
    RETURNING id
  `;
  const [ownedClass] = await sql<{ id: string }[]>`
    INSERT INTO classes (user_id, name)
    VALUES (${userId}, ${`Class ${suffix}`})
    RETURNING id
  `;
  const [folder] = await sql<{ id: string }[]>`
    INSERT INTO folders (class_id, name)
    VALUES (${ownedClass.id}, ${`Folder ${suffix}`})
    RETURNING id
  `;
  const [deck] = await sql<{ id: string }[]>`
    INSERT INTO decks (user_id, folder_id, card_template_id, name)
    VALUES (${userId}, ${folder.id}, ${template.id}, ${`Deck ${suffix}`})
    RETURNING id
  `;
  await sql`
    INSERT INTO cards (deck_id, sort_order)
    SELECT ${deck.id}, series
    FROM generate_series(0, ${cardCount - 1}) AS series
  `;
  const cards = await sql<{ id: string }[]>`
    SELECT id::text AS id
    FROM cards
    WHERE deck_id = ${deck.id}
    ORDER BY sort_order, id
  `;
  return {
    userId,
    deckId: deck.id,
    templateId: template.id,
    cardIds: cards.map((card) => card.id),
  };
}

async function insertRevision(
  userId: string,
  revision: number,
  parametersInput: Record<string, unknown>,
  retiredAt: Date | null,
): Promise<SeededRevision> {
  const parameters = JSON.parse(
    canonicalJson(normalizeFsrsParameters(parametersInput)),
  ) as Record<string, unknown>;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO fsrs_parameter_revisions (
      user_id, revision, engine_version, algorithm_version, policy_version,
      parameters, params_hash, source, created_at, activated_at, retired_at
    ) VALUES (
      ${userId}, ${revision}, ${FSRS_LIBRARY_VERSION},
      ${FSRS_ALGORITHM_VERSION}, ${FSRS_POLICY_VERSION},
      ${sql.json(parameters as never)}, ${sha256Canonical(parameters)}, 'manual',
      ${new Date('2025-12-01T00:00:00.000Z')},
      ${new Date('2025-12-01T00:00:00.000Z')}, ${retiredAt}
    )
    RETURNING id
  `;
  return { id: row.id, parameters };
}

async function insertState(
  userId: string,
  cardId: string,
  parameterRevisionId: string,
  overrides: {
    lastReviewedAt?: Date;
    nextReviewAt?: Date;
    state?: 'learning' | 'review' | 'relearning';
  } = {},
) {
  await sql`
    INSERT INTO fsrs_card_states (
      user_id, card_id, next_review_at, last_reviewed_at,
      stability, difficulty, state, elapsed_days, scheduled_days,
      learning_steps, reps, lapses, parameter_revision_id,
      state_version, learning_cycle, updated_at
    ) VALUES (
      ${userId}, ${cardId},
      ${overrides.nextReviewAt ?? new Date('2026-01-12T12:00:00.000Z')},
      ${overrides.lastReviewedAt ?? new Date('2026-01-01T12:00:00.000Z')},
      10.123456789, 5.5, ${overrides.state ?? 'review'}, 10, 10,
      0, 3, 1, ${parameterRevisionId}, 3, 1,
      ${new Date('2026-01-01T12:00:00.000Z')}
    )
  `;
}

async function seedFields(templateId: string, cardId: string) {
  const [laterField] = await sql<{ id: string }[]>`
    INSERT INTO template_fields (template_id, name, field_type, side, sort_order)
    VALUES (${templateId}, 'Back', 'text', 'back', 1)
    RETURNING id
  `;
  const [firstField] = await sql<{ id: string }[]>`
    INSERT INTO template_fields (template_id, name, field_type, side, sort_order)
    VALUES (${templateId}, 'Front', 'text', 'front', 0)
    RETURNING id
  `;
  await sql`
    INSERT INTO card_field_values (card_id, template_field_id, value)
    VALUES
      (${cardId}, ${laterField.id}, ${sql.json('back')}),
      (${cardId}, ${firstField.id}, ${sql.json('front')})
  `;
}

function directRetrievability(
  parameters: Record<string, unknown>,
  lastReviewedAt: Date,
  asOf: Date,
) {
  return forgetting_curve(
    (parameters as unknown as FSRSParameters).w,
    (asOf.getTime() - lastReviewedAt.getTime()) / 86_400_000,
    10.12345679,
  );
}

beforeAll(async () => {
  assertDisposableName(DATABASE_NAME);
  admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${DATABASE_NAME}"`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${DATABASE_NAME}`;
  sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  await applyMigrations(sql);
  drizzleWrappedSql = postgres(url.toString(), { max: 2, onnotice: () => {} });
  drizzle(drizzleWrappedSql);
});

afterAll(async () => {
  await drizzleWrappedSql?.end();
  await sql?.end();
  assertDisposableName(DATABASE_NAME);
  await admin?.unsafe(`DROP DATABASE IF EXISTS "${DATABASE_NAME}" WITH (FORCE)`);
  await admin?.end();
});

describe('PostgreSQL canonical FSRS deck reads', () => {
  test('selects New and due cards, projects the exact FSRS progress shape, and scores with the retired state revision', async () => {
    const deck = await seedDeck();
    await seedFields(deck.templateId, deck.cardIds[0]!);
    const retiredParameters = normalizeFsrsParameters();
    const retiredWeights = [...retiredParameters.w];
    retiredWeights[20] = 0.3;
    const retired = await insertRevision(
      deck.userId,
      1,
      { request_retention: 0.83, w: retiredWeights },
      new Date('2026-01-10T00:00:00.000Z'),
    );
    const active = await insertRevision(deck.userId, 2, {}, null);
    const dueLastReviewedAt = new Date('2026-01-11T00:00:00.000Z');
    await insertState(deck.userId, deck.cardIds[1]!, retired.id, {
      lastReviewedAt: dueLastReviewedAt,
      nextReviewAt: AS_OF,
    });
    await insertState(deck.userId, deck.cardIds[2]!, active.id, {
      nextReviewAt: new Date('2026-01-11T12:30:00.000Z'),
      state: 'learning',
    });
    await insertState(deck.userId, deck.cardIds[3]!, active.id, {
      nextReviewAt: new Date('2026-01-13T12:00:00.000Z'),
    });

    const result = await createPostgresFsrsDeckReadRepository(sql).getDueCards({
      deckId: deck.deckId,
      userId: deck.userId,
      reviewAll: false,
      asOf: AS_OF,
    });

    expect(result.total).toBe(4);
    expect(result.due).toBe(2);
    expect(result.cards.map((card) => card.id)).toEqual([
      deck.cardIds[0],
      deck.cardIds[1],
    ]);
    expect(result.cards[0]!.progress).toBeNull();
    expect(result.cards[0]!.fields.map((field) => field.fieldName)).toEqual([
      'Front',
      'Back',
    ]);
    expect(Object.keys(result.cards[1]!.progress ?? {})).toEqual([
      'state',
      'stability',
      'difficulty',
      'retrievability',
      'nextReviewAt',
      'lastReviewedAt',
      'scheduledDays',
      'reps',
      'lapses',
      'learningCycle',
    ]);
    expect(result.cards[1]!.progress).toEqual({
      state: 'review',
      stability: 10.123456789,
      difficulty: 5.5,
      retrievability: directRetrievability(
        retired.parameters,
        dueLastReviewedAt,
        AS_OF,
      ),
      nextReviewAt: AS_OF.toISOString(),
      lastReviewedAt: dueLastReviewedAt.toISOString(),
      scheduledDays: 10,
      reps: 3,
      lapses: 1,
      learningCycle: 1,
    });
    expect(result.cards[1]!.progress?.retrievability).not.toBe(
      directRetrievability(active.parameters, dueLastReviewedAt, AS_OF),
    );
  });

  test('preserves selected first-request order while bypassing due filtering and reviewAll card order', async () => {
    const deck = await seedDeck();
    const revision = await insertRevision(deck.userId, 1, {}, null);
    await insertState(deck.userId, deck.cardIds[1]!, revision.id, {
      nextReviewAt: new Date('2026-01-13T12:00:00.000Z'),
    });
    const repository = createPostgresFsrsDeckReadRepository(sql);

    const selected = await repository.getDueCards({
      deckId: deck.deckId,
      userId: deck.userId,
      reviewAll: false,
      selectedCardIds: [deck.cardIds[1]!, deck.cardIds[0]!, deck.cardIds[1]!],
      asOf: AS_OF,
    });
    const reviewAll = await repository.getDueCards({
      deckId: deck.deckId,
      userId: deck.userId,
      reviewAll: true,
      asOf: AS_OF,
    });

    expect(selected.cards.map((card) => card.id)).toEqual([
      deck.cardIds[1],
      deck.cardIds[0],
    ]);
    expect(selected.total).toBe(2);
    expect(selected.due).toBe(2);
    expect(reviewAll.cards.map((card) => card.id)).toEqual(deck.cardIds);
    expect(reviewAll.total).toBe(4);
    expect(reviewAll.due).toBe(4);
  });

  test('keeps deck and selected-card ownership failures opaque', async () => {
    const owner = await seedDeck();
    const outsider = await seedDeck();
    const repository = createPostgresFsrsDeckReadRepository(sql);

    await expect(
      repository.getDueCards({
        deckId: outsider.deckId,
        userId: owner.userId,
        reviewAll: false,
        asOf: AS_OF,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      repository.getDueCards({
        deckId: owner.deckId,
        userId: owner.userId,
        reviewAll: false,
        selectedCardIds: [outsider.cardIds[0]!],
        asOf: AS_OF,
      }),
    ).rejects.toThrow('Card not found');
  });

  test('counts only review states as learned and preserves due-soon, nearest, and upcoming schedule semantics', async () => {
    const deck = await seedDeck();
    const revision = await insertRevision(deck.userId, 1, {}, null);
    await insertState(deck.userId, deck.cardIds[1]!, revision.id, {
      nextReviewAt: AS_OF,
      state: 'review',
    });
    await insertState(deck.userId, deck.cardIds[2]!, revision.id, {
      nextReviewAt: new Date('2026-01-11T12:30:00.000Z'),
      state: 'learning',
    });
    await insertState(deck.userId, deck.cardIds[3]!, revision.id, {
      nextReviewAt: new Date('2026-01-13T12:00:00.000Z'),
      state: 'review',
    });

    const result = await createPostgresFsrsDeckReadRepository(sql).getDeckSchedule({
      deckId: deck.deckId,
      userId: deck.userId,
      asOf: AS_OF,
    });

    expect(result).toEqual({
      totalCards: 4,
      learnedCards: 2,
      upcoming: [
        {
          daysFromNow: 2,
          count: 1,
          date: new Date('2026-01-13T12:00:00.000Z').toISOString(),
        },
      ],
      dueSoon: 1,
      nextReviewDate: new Date('2026-01-11T12:30:00.000Z').toISOString(),
    });
  });

  test('returns an explicit zero dueSoon value for an owned empty deck', async () => {
    const deck = await seedDeck(0);

    await expect(
      createPostgresFsrsDeckReadRepository(sql).getDeckSchedule({
        deckId: deck.deckId,
        userId: deck.userId,
        asOf: AS_OF,
      }),
    ).resolves.toEqual({
      totalCards: 0,
      learnedCards: 0,
      upcoming: [],
      dueSoon: 0,
      nextReviewDate: null,
    });
  });

  test('uses the supplied asOf for both due selection and continuous retrievability', async () => {
    const deck = await seedDeck(1);
    const revision = await insertRevision(deck.userId, 1, {}, null);
    const lastReviewedAt = new Date('2026-01-11T00:00:00.000Z');
    await insertState(deck.userId, deck.cardIds[0]!, revision.id, {
      lastReviewedAt,
      nextReviewAt: AS_OF,
    });

    const result = await createPostgresFsrsDeckReadRepository(sql).getDueCards({
      deckId: deck.deckId,
      userId: deck.userId,
      reviewAll: false,
      asOf: AS_OF,
    });

    expect(result.due).toBe(1);
    expect(result.cards[0]!.progress?.retrievability).toBe(
      directRetrievability(revision.parameters, lastReviewedAt, AS_OF),
    );
  });

  test('reads due cards and the schedule through a Drizzle-wrapped client with identity timestamp codecs', async () => {
    const deck = await seedDeck(3);
    const revision = await insertRevision(deck.userId, 1, {}, null);
    const lastReviewedAt = new Date('2026-01-11T00:00:00.000Z');
    await insertState(deck.userId, deck.cardIds[1]!, revision.id, {
      lastReviewedAt,
      nextReviewAt: AS_OF,
    });
    await insertState(deck.userId, deck.cardIds[2]!, revision.id, {
      nextReviewAt: new Date('2026-01-13T12:00:00.000Z'),
    });
    const repository = createPostgresFsrsDeckReadRepository(drizzleWrappedSql);

    const result = await repository.getDueCards({
      deckId: deck.deckId,
      userId: deck.userId,
      reviewAll: false,
      asOf: AS_OF,
    });

    expect(result.total).toBe(3);
    expect(result.due).toBe(2);
    expect(result.cards.map((card) => card.id)).toEqual([
      deck.cardIds[0],
      deck.cardIds[1],
    ]);
    expect(result.cards[0]!.createdAt).toBeInstanceOf(Date);
    expect(result.cards[0]!.progress).toBeNull();
    expect(result.cards[1]!.progress).toMatchObject({
      state: 'review',
      nextReviewAt: AS_OF.toISOString(),
      lastReviewedAt: lastReviewedAt.toISOString(),
      retrievability: directRetrievability(
        revision.parameters,
        lastReviewedAt,
        AS_OF,
      ),
    });

    await expect(
      repository.getDeckSchedule({
        deckId: deck.deckId,
        userId: deck.userId,
        asOf: AS_OF,
      }),
    ).resolves.toEqual({
      totalCards: 3,
      learnedCards: 2,
      upcoming: [
        {
          daysFromNow: 2,
          count: 1,
          date: new Date('2026-01-13T12:00:00.000Z').toISOString(),
        },
      ],
      dueSoon: 0,
      nextReviewDate: new Date('2026-01-13T12:00:00.000Z').toISOString(),
    });
  });

  test('uses the deck-sort and current-state composite indexes for the scaled due query under a forced plan', async () => {
    const deck = await seedDeck(300);
    const revision = await insertRevision(deck.userId, 1, {}, null);
    await sql`
      INSERT INTO fsrs_card_states (
        user_id, card_id, next_review_at, last_reviewed_at,
        stability, difficulty, state, elapsed_days, scheduled_days,
        learning_steps, reps, lapses, parameter_revision_id,
        state_version, learning_cycle, updated_at
      )
      SELECT
        ${deck.userId}, cards.id,
        ${new Date('2026-01-12T12:00:00.000Z')},
        ${new Date('2026-01-01T12:00:00.000Z')},
        10.123456789, 5.5, 'review', 10, 10, 0, 3, 1,
        ${revision.id}, 3, 1, ${new Date('2026-01-01T12:00:00.000Z')}
      FROM cards
      WHERE deck_id = ${deck.deckId}
    `;

    const plan = await sql.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL enable_seqscan = off');
      await transaction.unsafe('SET LOCAL enable_hashjoin = off');
      await transaction.unsafe('SET LOCAL enable_mergejoin = off');
      await transaction.unsafe('SET LOCAL enable_bitmapscan = off');
      await transaction.unsafe('SET LOCAL enable_material = off');
      const rows = await transaction.unsafe<Record<string, string>[]>(
        `EXPLAIN (ANALYZE, BUFFERS) ${DUE_CARD_IDS_SQL}`,
        [deck.deckId, deck.userId, AS_OF],
      );
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });

    expect(plan).toContain('idx_cards_deck_sort_order');
    expect(plan).toContain('uq_fsrs_card_states_user_card');
    expect(plan).not.toContain('Seq Scan on fsrs_card_states');
  });
});
