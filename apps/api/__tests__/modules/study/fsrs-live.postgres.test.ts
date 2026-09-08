import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { State } from 'ts-fsrs';
import { ConflictError, NotFoundError } from '../../../src/shared/errors';
import {
  createPostgresFsrsLiveRepository,
  type FsrsLivePostgresHooks,
} from '../../../src/modules/study/fsrs-live.postgres';
import { createFsrsLiveService } from '../../../src/modules/study/fsrs-live.service';
import {
  FSRS_ALGORITHM_VERSION,
  FSRS_LIBRARY_VERSION,
  FSRS_POLICY_VERSION,
  normalizeFsrsParameters,
  scheduleFsrsReview,
} from '../../../src/modules/study/fsrs.engine';
import {
  canonicalJson,
  FSRS_REPLAY_UUID_NAMESPACE,
  sha256Canonical,
  uuidV5,
} from '../../../src/modules/study/fsrs-replay-planner';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../src/db/migrations');
const DATABASE_NAME =
  `engram_fsrs_live_${crypto.randomUUID().replaceAll('-', '')}`;
const RECEIVED_AT = new Date('2026-07-29T12:00:00.000Z');

let admin: Sql;
let sql: Sql;
let databaseUrl: string;

interface SeededUser {
  userId: string;
  deckId: string;
  cardIds: string[];
}

function assertDisposableName(name: string) {
  if (!/^engram_fsrs_live_[a-f0-9]+$/u.test(name)) {
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

async function seedUser(cardCount = 1): Promise<SeededUser> {
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
    VALUES (
      ${userId}, ${folder.id}, ${template.id}, ${`Deck ${suffix}`}
    )
    RETURNING id
  `;
  const cardIds: string[] = [];
  for (let index = 0; index < cardCount; index += 1) {
    const [card] = await sql<{ id: string }[]>`
      INSERT INTO cards (deck_id, sort_order)
      VALUES (${deck.id}, ${index})
      RETURNING id
    `;
    cardIds.push(card.id);
  }
  return { userId, deckId: deck.id, cardIds };
}

async function seedAdditionalDeck(
  seeded: SeededUser,
): Promise<{ deckId: string; cardId: string }> {
  const [deck] = await sql<{ id: string }[]>`
    INSERT INTO decks (user_id, folder_id, card_template_id, name)
    SELECT user_id, folder_id, card_template_id, ${`Deck ${crypto.randomUUID()}`}
    FROM decks
    WHERE id = ${seeded.deckId}
    RETURNING id
  `;
  const [card] = await sql<{ id: string }[]>`
    INSERT INTO cards (deck_id) VALUES (${deck.id}) RETURNING id
  `;
  return { deckId: deck.id, cardId: card.id };
}

function review(
  cardId: string,
  overrides: Partial<{
    requestId: string;
    rating: 'again' | 'hard' | 'good' | 'easy';
    reviewedAt: string;
    durationMs: number;
  }> = {},
) {
  return {
    requestId: crypto.randomUUID(),
    cardId,
    rating: 'good' as const,
    reviewedAt: '2026-07-29T11:00:00.000Z',
    ...overrides,
  };
}

function service(
  client: Sql = sql,
  hooks: FsrsLivePostgresHooks = {},
  clock = () => new Date(RECEIVED_AT),
) {
  return createFsrsLiveService(
    createPostgresFsrsLiveRepository(client, { hooks }),
    clock,
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function contender(name: string) {
  return postgres(databaseUrl, {
    max: 1,
    connection: { application_name: name },
    onnotice: () => {},
  });
}

async function waitForDatabaseLock(applicationName: string) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const [row] = await sql<{ waiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND application_name = ${applicationName}
          AND wait_event_type = 'Lock'
      ) AS waiting
    `;
    if (row?.waiting) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${applicationName} database lock`);
}

async function insertRevision(
  userId: string,
  parameters: Record<string, unknown>,
  revision = 1,
) {
  const normalized = JSON.parse(
    canonicalJson(normalizeFsrsParameters(parameters)),
  ) as Record<string, unknown>;
  const paramsHash = sha256Canonical(normalized);
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO fsrs_parameter_revisions (
      user_id, revision, engine_version, algorithm_version, policy_version,
      parameters, params_hash, source
    ) VALUES (
      ${userId}, ${revision}, ${FSRS_LIBRARY_VERSION},
      ${FSRS_ALGORITHM_VERSION}, ${FSRS_POLICY_VERSION},
      ${sql.json(normalized as any)}, ${paramsHash}, 'manual'
    )
    RETURNING id
  `;
  return row.id;
}

async function insertRawLiveEvent(
  client: Sql,
  userId: string,
  input: ReturnType<typeof review>,
  parameterRevisionId: string,
  parameters?: unknown,
) {
  const scheduled = scheduleFsrsReview({
    current: null,
    rating: input.rating,
    reviewedAt: new Date(input.reviewedAt),
    parameters,
  });
  const state =
    scheduled.after.state === State.Learning
      ? 'learning'
      : scheduled.after.state === State.Review
        ? 'review'
        : 'relearning';
  await client.unsafe(
    `INSERT INTO fsrs_review_events (
       request_id, user_id, card_id, learning_cycle, sequence, rating,
       reviewed_at, received_at, duration_ms, parameter_revision_id, origin,
       before_state, before_due_at, before_stability, before_difficulty,
       before_scheduled_days, before_learning_steps, elapsed_days,
       after_state, after_due_at, after_stability, after_difficulty,
       after_scheduled_days, after_learning_steps, after_reps, after_lapses,
       after_state_version
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, 1, 1, $4,
       $5::timestamptz, $6::timestamptz, $7::int, $8::uuid, 'live',
       NULL, NULL, NULL, NULL, NULL, NULL, $9::int,
       $10, $11::timestamptz, $12::double precision,
       $13::double precision, $14::int, $15::int, $16::int, $17::int, 1
     )`,
    [
      input.requestId,
      userId,
      input.cardId,
      input.rating,
      input.reviewedAt,
      RECEIVED_AT,
      input.durationMs ?? null,
      parameterRevisionId,
      scheduled.log.elapsed_days,
      state,
      scheduled.after.due,
      scheduled.after.stability,
      scheduled.after.difficulty,
      scheduled.after.scheduled_days,
      scheduled.after.learning_steps,
      scheduled.after.reps,
      scheduled.after.lapses,
    ],
  );
}

function deterministicDefaultRevision(userId: string) {
  const parameters = JSON.parse(
    canonicalJson(normalizeFsrsParameters()),
  ) as Record<string, unknown>;
  const paramsHash = sha256Canonical(parameters);
  const id = uuidV5(
    [
      'parameter-revision',
      userId,
      FSRS_LIBRARY_VERSION,
      FSRS_ALGORITHM_VERSION,
      FSRS_POLICY_VERSION,
      paramsHash,
    ].join('/'),
    FSRS_REPLAY_UUID_NAMESPACE,
  );
  return { id, parameters, paramsHash };
}

beforeAll(async () => {
  assertDisposableName(DATABASE_NAME);
  admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${DATABASE_NAME}"`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${DATABASE_NAME}`;
  databaseUrl = url.toString();
  sql = postgres(databaseUrl, { max: 8, onnotice: () => {} });
  await applyMigrations(sql);
});

afterAll(async () => {
  await sql?.end();
  assertDisposableName(DATABASE_NAME);
  await admin?.unsafe(`DROP DATABASE IF EXISTS "${DATABASE_NAME}" WITH (FORCE)`);
  await admin?.end();
});

describe('PostgreSQL canonical FSRS live writer', () => {
  test('creates, idempotently reuses, and reactivates immutable parameter revisions', async () => {
    const seeded = await seedUser();
    const live = service();

    const first = await live.rotateParameters(seeded.userId, {
      request_retention: 0.8,
    });
    const exactRetry = await live.rotateParameters(seeded.userId, {
      request_retention: 0.8,
    });
    const second = await live.rotateParameters(seeded.userId, {
      request_retention: 0.9,
    });
    const reactivated = await live.rotateParameters(seeded.userId, {
      request_retention: 0.8,
    });

    expect(first).toMatchObject({ revision: 1, status: 'created' });
    expect(exactRetry).toEqual({ ...first, status: 'active' });
    expect(second).toMatchObject({ revision: 2, status: 'created' });
    expect(reactivated).toEqual({ ...first, status: 'reactivated' });
    expect([
      ...await sql`
        SELECT id::text AS id, revision, source,
          retired_at IS NULL AS active
        FROM fsrs_parameter_revisions
        WHERE user_id = ${seeded.userId}
        ORDER BY revision
      `,
    ]).toEqual([
      { id: first.id, revision: 1, source: 'manual', active: true },
      { id: second.id, revision: 2, source: 'manual', active: false },
    ]);
  });

  test('uppercase and lowercase user IDs resolve to the same rotation identity', async () => {
    const seeded = await seedUser();
    const live = service();
    const parameters = { request_retention: 0.82 };

    const first = await live.rotateParameters(
      seeded.userId.toUpperCase(),
      parameters,
    );
    const exact = await live.rotateParameters(seeded.userId, parameters);

    expect(exact).toEqual({ ...first, status: 'active' });
    expect([
      ...await sql`
        SELECT count(*)::int AS count
        FROM fsrs_parameter_revisions
        WHERE user_id = ${seeded.userId}
      `,
    ]).toEqual([{ count: 1 }]);
  });

  test('reactivates a matching arbitrary-ID manual revision by its full resolved tuple', async () => {
    const seeded = await seedUser();
    const live = service();
    const initialParameters = { request_retention: 0.8 };
    const manualParametersInput = { request_retention: 0.84 };
    const initial = await live.rotateParameters(
      seeded.userId,
      initialParameters,
    );
    await live.reviewCard(seeded.userId, review(seeded.cardIds[0]!));
    const manualParameters = JSON.parse(
      canonicalJson(normalizeFsrsParameters(manualParametersInput)),
    ) as Record<string, unknown>;
    const manualHash = sha256Canonical(manualParameters);
    const manualId = crypto.randomUUID();
    await sql`
      INSERT INTO fsrs_parameter_revisions (
        id, user_id, revision, engine_version, algorithm_version,
        policy_version, parameters, params_hash, source, retired_at
      ) VALUES (
        ${manualId}, ${seeded.userId}, 2, ${FSRS_LIBRARY_VERSION},
        ${FSRS_ALGORITHM_VERSION}, ${FSRS_POLICY_VERSION},
        ${sql.json(manualParameters as any)}, ${manualHash}, 'manual',
        ${RECEIVED_AT}
      )
    `;

    const firstReactivation = await live.rotateParameters(
      seeded.userId,
      manualParametersInput,
    );
    const away = await live.rotateParameters(
      seeded.userId,
      initialParameters,
    );
    const secondReactivation = await live.rotateParameters(
      seeded.userId,
      manualParametersInput,
    );

    expect(firstReactivation).toEqual({
      id: manualId,
      revision: 2,
      status: 'reactivated',
      paramsHash: manualHash,
    });
    expect(away).toEqual({ ...initial, status: 'reactivated' });
    expect(secondReactivation).toEqual(firstReactivation);
    expect([
      ...await sql`
        SELECT id::text AS id, revision, retired_at IS NULL AS active
        FROM fsrs_parameter_revisions
        WHERE user_id = ${seeded.userId}
        ORDER BY revision
      `,
    ]).toEqual([
      { id: initial.id, revision: 1, active: false },
      { id: manualId, revision: 2, active: true },
    ]);
    expect([
      ...await sql`
        SELECT parameter_revision_id::text AS "parameterRevisionId"
        FROM fsrs_card_states
        WHERE user_id = ${seeded.userId}
          AND card_id = ${seeded.cardIds[0]!}
      `,
    ]).toEqual([{ parameterRevisionId: initial.id }]);
  });

  test('rotation rejects invalid parameters atomically and never rewrites an existing card state revision', async () => {
    const seeded = await seedUser();
    const live = service();
    const first = await live.rotateParameters(seeded.userId, {
      request_retention: 0.8,
    });
    await live.reviewCard(seeded.userId, review(seeded.cardIds[0]!));
    await expect(
      live.rotateParameters(seeded.userId, { request_retention: 0 }),
    ).rejects.toThrow('request_retention');
    const second = await live.rotateParameters(seeded.userId, {
      request_retention: 0.9,
    });

    expect(second.status).toBe('created');
    expect([
      ...await sql`
        SELECT parameter_revision_id::text AS revision
        FROM fsrs_card_states
        WHERE user_id = ${seeded.userId}
      `,
    ]).toEqual([{ revision: first.id }]);
    expect([
      ...await sql`
        SELECT count(*)::int AS count
        FROM fsrs_parameter_revisions
        WHERE user_id = ${seeded.userId}
      `,
    ]).toEqual([{ count: 2 }]);
  });

  test('concurrent exact parameter rotations serialize to one immutable active revision', async () => {
    const seeded = await seedUser();
    await service().rotateParameters(seeded.userId, {
      request_retention: 0.8,
    });
    const firstClient = contender('fsrs_rotation_first');
    const secondClient = contender('fsrs_rotation_second');
    const locked = deferred();
    const release = deferred();
    const parameters = { request_retention: 0.86 };
    try {
      const firstPromise = service(firstClient, {
        async afterUserLocked(context) {
          if (context.operation !== 'rotation') return;
          locked.resolve();
          await release.promise;
        },
      }).rotateParameters(seeded.userId, parameters);
      await locked.promise;
      const secondPromise = service(secondClient).rotateParameters(
        seeded.userId,
        parameters,
      );
      await waitForDatabaseLock('fsrs_rotation_second');
      release.resolve();

      const results = await Promise.all([firstPromise, secondPromise]);
      expect(results.map((result) => result.status)).toEqual([
        'created',
        'active',
      ]);
      expect(results[0]!.id).toBe(results[1]!.id);
    } finally {
      release.resolve();
      await firstClient.end();
      await secondClient.end();
    }
    const normalized = JSON.parse(
      canonicalJson(normalizeFsrsParameters(parameters)),
    ) as Record<string, unknown>;
    const paramsHash = sha256Canonical(normalized);
    const expectedId = uuidV5(
      [
        'parameter-revision',
        seeded.userId,
        FSRS_LIBRARY_VERSION,
        FSRS_ALGORITHM_VERSION,
        FSRS_POLICY_VERSION,
        paramsHash,
      ].join('/'),
      FSRS_REPLAY_UUID_NAMESPACE,
    );
    expect([
      ...await sql`
        SELECT id::text AS id, revision, params_hash AS "paramsHash",
          source, retired_at IS NULL AS active
        FROM fsrs_parameter_revisions
        WHERE user_id = ${seeded.userId}
          AND retired_at IS NULL
      `,
    ]).toEqual([
      {
        id: expectedId,
        revision: 2,
        paramsHash,
        source: 'manual',
        active: true,
      },
    ]);
  });

  test('exact retry reconstructs the immutable response without extra writes and payload reuse conflicts', async () => {
    const seeded = await seedUser();
    const input = review(seeded.cardIds[0]!, {
      requestId: crypto.randomUUID(),
      durationMs: 250,
    });
    const first = await service().reviewCard(seeded.userId, input, 0);
    const beforeRetry = [
      ...await sql`
        SELECT
          (SELECT count(*)::int FROM fsrs_parameter_revisions
            WHERE user_id = ${seeded.userId}) AS revisions,
          (SELECT count(*)::int FROM fsrs_review_events
            WHERE user_id = ${seeded.userId}) AS events,
          (SELECT count(*)::int FROM fsrs_card_states
            WHERE user_id = ${seeded.userId}) AS states,
          (SELECT coalesce(sum(cards_reviewed), 0)::int FROM study_daily_logs
            WHERE user_id = ${seeded.userId}) AS daily,
          (SELECT count(*)::int FROM study_progress
            WHERE user_id = ${seeded.userId}) AS legacy_progress,
          (SELECT count(*)::int FROM review_logs
            WHERE user_id = ${seeded.userId}) AS legacy_events
      `,
    ];

    const duplicate = await service().reviewCard(seeded.userId, input, 0);

    expect(first).toMatchObject({
      status: 'applied',
      learningCycle: 1,
      sequence: 1,
    });
    expect(duplicate).toEqual({ ...first, status: 'duplicate' });
    expect([
      ...await sql`
        SELECT
          (SELECT count(*)::int FROM fsrs_parameter_revisions
            WHERE user_id = ${seeded.userId}) AS revisions,
          (SELECT count(*)::int FROM fsrs_review_events
            WHERE user_id = ${seeded.userId}) AS events,
          (SELECT count(*)::int FROM fsrs_card_states
            WHERE user_id = ${seeded.userId}) AS states,
          (SELECT coalesce(sum(cards_reviewed), 0)::int FROM study_daily_logs
            WHERE user_id = ${seeded.userId}) AS daily,
          (SELECT count(*)::int FROM study_progress
            WHERE user_id = ${seeded.userId}) AS legacy_progress,
          (SELECT count(*)::int FROM review_logs
            WHERE user_id = ${seeded.userId}) AS legacy_events
      `,
    ]).toEqual(beforeRetry);
    expect([
      ...await sql`
        SELECT received_at AS "receivedAt"
        FROM fsrs_review_events
        WHERE user_id = ${seeded.userId}
      `,
    ]).toEqual([{ receivedAt: RECEIVED_AT }]);
    await expect(
      service().reviewCard(
        seeded.userId,
        { ...input, rating: 'hard' },
        0,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test('applies same-card events sequentially in input order with equal cycle sequence reps and state version', async () => {
    const seeded = await seedUser();
    const first = review(seeded.cardIds[0]!, {
      rating: 'again',
      reviewedAt: '2026-07-29T10:00:00.000Z',
    });
    const second = review(seeded.cardIds[0]!, {
      rating: 'good',
      reviewedAt: '2026-07-29T10:00:00.000Z',
    });

    const batch = await service().reviewBatch(
      seeded.userId,
      [first, second],
      0,
    );

    expect(batch).toMatchObject({
      applied: 2,
      duplicates: 0,
      results: [
        { requestId: first.requestId, learningCycle: 1, sequence: 1 },
        { requestId: second.requestId, learningCycle: 1, sequence: 2 },
      ],
    });
    expect([
      ...await sql`
        SELECT learning_cycle AS cycle, sequence,
          after_reps AS reps, after_state_version::int AS version
        FROM fsrs_review_events
        WHERE user_id = ${seeded.userId}
        ORDER BY sequence
      `,
    ]).toEqual([
      { cycle: 1, sequence: 1, reps: 1, version: 1 },
      { cycle: 1, sequence: 2, reps: 2, version: 2 },
    ]);
    expect(
      await service().reviewCard(seeded.userId, first, 0),
    ).toMatchObject({
      status: 'duplicate',
      learningCycle: 1,
      sequence: 1,
    });
    expect([
      ...await sql`
        SELECT learning_cycle AS cycle, reps,
          state_version::int AS version,
          (SELECT sum(cards_reviewed)::int FROM study_daily_logs
            WHERE user_id = ${seeded.userId}) AS daily
        FROM fsrs_card_states WHERE user_id = ${seeded.userId}
      `,
    ]).toEqual([{ cycle: 1, reps: 2, version: 2, daily: 2 }]);
  });

  test('rejects one unowned card atomically and rejects stale/future chronology before domain writes', async () => {
    const owner = await seedUser();
    const outsider = await seedUser();
    await expect(
      service().reviewBatch(
        owner.userId,
        [review(owner.cardIds[0]!), review(outsider.cardIds[0]!)],
        0,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect([
      ...await sql`
        SELECT count(*)::int AS count
        FROM fsrs_review_events WHERE user_id = ${owner.userId}
      `,
    ]).toEqual([{ count: 0 }]);

    await service().reviewCard(
      owner.userId,
      review(owner.cardIds[0]!, {
        reviewedAt: '2026-07-29T11:00:00.000Z',
      }),
    );
    await expect(
      service().reviewCard(
        owner.userId,
        review(owner.cardIds[0]!, {
          reviewedAt: '2026-07-29T10:59:59.999Z',
        }),
      ),
    ).rejects.toThrow('earlier than');
    await expect(
      service().reviewCard(
        owner.userId,
        review(owner.cardIds[0]!, {
          reviewedAt: '2026-07-29T12:05:00.001Z',
        }),
      ),
    ).rejects.toThrow('five minutes');
    expect([
      ...await sql`
        SELECT count(*)::int AS count
        FROM fsrs_review_events WHERE user_id = ${owner.userId}
      `,
    ]).toEqual([{ count: 1 }]);
  });

  test('uses active parameters for New, preserves the state revision after rotation, and rejects invalid active parameters', async () => {
    const seeded = await seedUser();
    const firstRevision = await insertRevision(seeded.userId, {
      request_retention: 0.8,
    });
    await service().reviewCard(seeded.userId, review(seeded.cardIds[0]!));
    await sql`
      UPDATE fsrs_parameter_revisions
      SET retired_at = ${RECEIVED_AT}
      WHERE id = ${firstRevision}
    `;
    const secondRevision = await insertRevision(
      seeded.userId,
      { request_retention: 0.95 },
      2,
    );

    await service().reviewCard(
      seeded.userId,
      review(seeded.cardIds[0]!, {
        reviewedAt: '2026-07-29T11:00:00.000Z',
      }),
    );
    const [revisionProjection] = await sql<{
      stateRevision: string;
      eventRevisions: string[];
    }[]>`
      SELECT
        (SELECT parameter_revision_id::text FROM fsrs_card_states
          WHERE user_id = ${seeded.userId}) AS "stateRevision",
        array_agg(parameter_revision_id::text ORDER BY sequence)
          AS "eventRevisions"
      FROM fsrs_review_events WHERE user_id = ${seeded.userId}
    `;
    expect(revisionProjection).toEqual({
      stateRevision: firstRevision,
      eventRevisions: [firstRevision, firstRevision],
    });
    expect(secondRevision).not.toBe(firstRevision);

    const invalid = await seedUser();
    const badParameters = { request_retention: 0 };
    await sql`
      INSERT INTO fsrs_parameter_revisions (
        user_id, revision, engine_version, algorithm_version, policy_version,
        parameters, params_hash, source
      ) VALUES (
        ${invalid.userId}, 1, ${FSRS_LIBRARY_VERSION},
        ${FSRS_ALGORITHM_VERSION}, ${FSRS_POLICY_VERSION},
        ${sql.json(badParameters)}, ${sha256Canonical(badParameters)}, 'manual'
      )
    `;
    await expect(
      service().reviewCard(invalid.userId, review(invalid.cardIds[0]!)),
    ).rejects.toThrow('request_retention');
    expect([
      ...await sql`
        SELECT count(*)::int AS count FROM fsrs_review_events
        WHERE user_id = ${invalid.userId}
      `,
    ]).toEqual([{ count: 0 }]);
  });

  test('fails closed when an existing state revision has a forged parameter hash', async () => {
    const seeded = await seedUser();
    const revisionId = await insertRevision(seeded.userId, {
      request_retention: 0.8,
    });
    await service().reviewCard(seeded.userId, review(seeded.cardIds[0]!));
    await sql`
      UPDATE fsrs_parameter_revisions
      SET params_hash = ${'f'.repeat(64)}
      WHERE id = ${revisionId}
    `;

    await expect(
      service().reviewCard(
        seeded.userId,
        review(seeded.cardIds[0]!, {
          reviewedAt: '2026-07-29T11:00:00.000Z',
        }),
      ),
    ).rejects.toThrow('hash');
    expect([
      ...await sql`
        SELECT count(*)::int AS count FROM fsrs_review_events
        WHERE user_id = ${seeded.userId}
      `,
    ]).toEqual([{ count: 1 }]);
  });

  test('fails closed when an existing state revision has unsupported scheduler provenance', async () => {
    const seeded = await seedUser();
    const revisionId = await insertRevision(seeded.userId, {
      request_retention: 0.8,
    });
    await service().reviewCard(seeded.userId, review(seeded.cardIds[0]!));
    await sql`
      UPDATE fsrs_parameter_revisions
      SET engine_version = 'forged-engine'
      WHERE id = ${revisionId}
    `;

    await expect(
      service().reviewCard(
        seeded.userId,
        review(seeded.cardIds[0]!, {
          reviewedAt: '2026-07-29T11:00:00.000Z',
        }),
      ),
    ).rejects.toThrow('provenance');
    expect([
      ...await sql`
        SELECT count(*)::int AS count FROM fsrs_review_events
        WHERE user_id = ${seeded.userId}
      `,
    ]).toEqual([{ count: 1 }]);
  });

  test('does not reactivate a retired non-default revision that only collides with the deterministic default hash', async () => {
    const seeded = await seedUser();
    const revisionId = await insertRevision(seeded.userId, {});
    await sql`
      UPDATE fsrs_parameter_revisions
      SET retired_at = clock_timestamp()
      WHERE id = ${revisionId}
    `;

    await expect(
      service().reviewCard(seeded.userId, review(seeded.cardIds[0]!)),
    ).rejects.toThrow('default revision identity');
    expect([
      ...await sql`
        SELECT source, retired_at IS NULL AS active
        FROM fsrs_parameter_revisions
        WHERE user_id = ${seeded.userId}
      `,
    ]).toEqual([{ source: 'manual', active: false }]);
  });

  test('groups newly applied daily activity across local dates and ignores duplicate retries', async () => {
    const seeded = await seedUser(2);
    const events = [
      review(seeded.cardIds[0]!, {
        reviewedAt: '2026-07-28T06:59:59.999Z',
      }),
      review(seeded.cardIds[1]!, {
        reviewedAt: '2026-07-28T07:00:00.000Z',
      }),
    ];
    await service().reviewBatch(seeded.userId, events, 420);
    const retry = await service().reviewBatch(seeded.userId, events, 420);

    expect(retry).toMatchObject({ applied: 0, duplicates: 2 });
    expect([
      ...await sql`
        SELECT study_date::text AS date, cards_reviewed AS count
        FROM study_daily_logs
        WHERE user_id = ${seeded.userId}
        ORDER BY study_date
      `,
    ]).toEqual([
      { date: '2026-07-27', count: 1 },
      { date: '2026-07-28', count: 1 },
    ]);
  });

  test('calls the injected scheduler exactly once per newly applied event and never for an exact duplicate', async () => {
    const seeded = await seedUser();
    let scheduleCalls = 0;
    const repository = createPostgresFsrsLiveRepository(sql, {
      schedule(input) {
        scheduleCalls += 1;
        return scheduleFsrsReview(input);
      },
    });
    const live = createFsrsLiveService(repository, () => new Date(RECEIVED_AT));
    const input = review(seeded.cardIds[0]!);

    await live.reviewCard(seeded.userId, input);
    await live.reviewCard(seeded.userId, input);

    expect(scheduleCalls).toBe(1);
  });

  test('exact duplicate reconstruction does not validate an unused active revision after reset', async () => {
    const seeded = await seedUser();
    const input = review(seeded.cardIds[0]!);
    await service().reviewCard(seeded.userId, input);
    await service().resetCard(seeded.userId, seeded.cardIds[0]!);
    await sql`
      UPDATE fsrs_parameter_revisions
      SET parameters = ${sql.json({ request_retention: 0 })}
      WHERE user_id = ${seeded.userId} AND retired_at IS NULL
    `;

    await expect(
      service().reviewCard(seeded.userId, input),
    ).resolves.toMatchObject({
      status: 'duplicate',
      sequence: 1,
    });
  });

  test('rolls back default revision event state and daily log after an injected mid-transaction failure', async () => {
    const seeded = await seedUser();
    const failure = new Error('injected live review failure');
    await expect(
      service(sql, {
        afterEventAndStateWrittenBeforeDailyLog() {
          throw failure;
        },
      }).reviewCard(seeded.userId, review(seeded.cardIds[0]!)),
    ).rejects.toBe(failure);
    expect([
      ...await sql`
        SELECT
          (SELECT count(*)::int FROM fsrs_parameter_revisions
            WHERE user_id = ${seeded.userId}) AS revisions,
          (SELECT count(*)::int FROM fsrs_review_events
            WHERE user_id = ${seeded.userId}) AS events,
          (SELECT count(*)::int FROM fsrs_card_states
            WHERE user_id = ${seeded.userId}) AS states,
          (SELECT count(*)::int FROM study_daily_logs
            WHERE user_id = ${seeded.userId}) AS daily
      `,
    ]).toEqual([{ revisions: 0, events: 0, states: 0, daily: 0 }]);
  });

  test('does not generically retry a named request unique violation when no immutable event exists to classify', async () => {
    const seeded = await seedUser();
    let scheduleCalls = 0;
    await sql.unsafe(`
      CREATE FUNCTION inject_unclassified_request_unique()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'injected unclassified request unique'
          USING
            ERRCODE = '23505',
            CONSTRAINT = 'uq_fsrs_review_events_user_request',
            TABLE = 'fsrs_review_events',
            SCHEMA = 'public';
      END
      $$
    `);
    await sql.unsafe(`
      CREATE TRIGGER inject_unclassified_request_unique
      BEFORE INSERT ON fsrs_review_events
      FOR EACH ROW EXECUTE FUNCTION inject_unclassified_request_unique()
    `);
    try {
      const live = createFsrsLiveService(
        createPostgresFsrsLiveRepository(sql, {
          schedule(input) {
            scheduleCalls += 1;
            return scheduleFsrsReview(input);
          },
        }),
        () => new Date(RECEIVED_AT),
      );
      await expect(
        live.reviewCard(seeded.userId, review(seeded.cardIds[0]!)),
      ).rejects.toMatchObject({
        code: '23505',
        constraint_name: 'uq_fsrs_review_events_user_request',
      });
      expect(scheduleCalls).toBe(1);
    } finally {
      await sql.unsafe(
        'DROP TRIGGER IF EXISTS inject_unclassified_request_unique ON fsrs_review_events',
      );
      await sql.unsafe(
        'DROP FUNCTION IF EXISTS inject_unclassified_request_unique()',
      );
    }
    expect([
      ...await sql`
        SELECT count(*)::int AS count FROM fsrs_review_events
        WHERE user_id = ${seeded.userId}
      `,
    ]).toEqual([{ count: 0 }]);
  });

  test('classifies an exact request row committed by an independent writer after rollback as duplicate', async () => {
    const seeded = await seedUser();
    const revisionId = await insertRevision(seeded.userId, {});
    const input = review(seeded.cardIds[0]!);
    const rawWriter = contender('fsrs_raw_request_exact');
    await sql.unsafe(`
      CREATE FUNCTION inject_request_unique_for_exact_classifier()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'injected request race'
          USING
            ERRCODE = '23505',
            CONSTRAINT = 'uq_fsrs_review_events_user_request',
            TABLE = 'fsrs_review_events',
            SCHEMA = 'public';
      END
      $$
    `);
    await sql.unsafe(`
      CREATE TRIGGER inject_request_unique_for_exact_classifier
      BEFORE INSERT ON fsrs_review_events
      FOR EACH ROW
      EXECUTE FUNCTION inject_request_unique_for_exact_classifier()
    `);
    try {
      const repository = createPostgresFsrsLiveRepository(sql, {
        hooks: {
          async afterUniqueRaceRollback(context: { kind: string }) {
            expect(context.kind).toBe('request');
            await sql.unsafe(
              'DROP TRIGGER inject_request_unique_for_exact_classifier ON fsrs_review_events',
            );
            await insertRawLiveEvent(
              rawWriter,
              seeded.userId,
              input,
              revisionId,
            );
          },
        } as any,
      });
      const result = await createFsrsLiveService(
        repository,
        () => new Date(RECEIVED_AT),
      ).reviewCard(seeded.userId, input);

      expect(result).toMatchObject({
        status: 'duplicate',
        learningCycle: 1,
        sequence: 1,
      });
    } finally {
      await rawWriter.end();
      await sql.unsafe(
        'DROP TRIGGER IF EXISTS inject_request_unique_for_exact_classifier ON fsrs_review_events',
      );
      await sql.unsafe(
        'DROP FUNCTION IF EXISTS inject_request_unique_for_exact_classifier()',
      );
    }
    expect([
      ...await sql`
        SELECT
          (SELECT count(*)::int FROM fsrs_review_events
            WHERE user_id = ${seeded.userId}) AS events,
          (SELECT count(*)::int FROM fsrs_card_states
            WHERE user_id = ${seeded.userId}) AS states,
          (SELECT count(*)::int FROM study_daily_logs
            WHERE user_id = ${seeded.userId}) AS daily
      `,
    ]).toEqual([{ events: 1, states: 0, daily: 0 }]);
  });

  test('classifies a conflicting request row committed after rollback as ConflictError', async () => {
    const seeded = await seedUser();
    const revisionId = await insertRevision(seeded.userId, {});
    const input = review(seeded.cardIds[0]!, { rating: 'good' });
    const rawWriter = contender('fsrs_raw_request_conflict');
    await sql.unsafe(`
      CREATE FUNCTION inject_request_unique_for_conflict_classifier()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'injected request race'
          USING
            ERRCODE = '23505',
            CONSTRAINT = 'uq_fsrs_review_events_user_request',
            TABLE = 'fsrs_review_events',
            SCHEMA = 'public';
      END
      $$
    `);
    await sql.unsafe(`
      CREATE TRIGGER inject_request_unique_for_conflict_classifier
      BEFORE INSERT ON fsrs_review_events
      FOR EACH ROW
      EXECUTE FUNCTION inject_request_unique_for_conflict_classifier()
    `);
    try {
      const repository = createPostgresFsrsLiveRepository(sql, {
        hooks: {
          async afterUniqueRaceRollback() {
            await sql.unsafe(
              'DROP TRIGGER inject_request_unique_for_conflict_classifier ON fsrs_review_events',
            );
            await insertRawLiveEvent(
              rawWriter,
              seeded.userId,
              { ...input, rating: 'hard' },
              revisionId,
            );
          },
        } as any,
      });
      await expect(
        createFsrsLiveService(
          repository,
          () => new Date(RECEIVED_AT),
        ).reviewCard(seeded.userId, input),
      ).rejects.toBeInstanceOf(ConflictError);
    } finally {
      await rawWriter.end();
      await sql.unsafe(
        'DROP TRIGGER IF EXISTS inject_request_unique_for_conflict_classifier ON fsrs_review_events',
      );
      await sql.unsafe(
        'DROP FUNCTION IF EXISTS inject_request_unique_for_conflict_classifier()',
      );
    }
  });

  test('reuses an exact deterministic default committed independently after a default unique rollback', async () => {
    const seeded = await seedUser();
    const input = review(seeded.cardIds[0]!);
    const rawWriter = contender('fsrs_raw_default_exact');
    const expected = deterministicDefaultRevision(seeded.userId);
    await sql.unsafe(`
      CREATE FUNCTION inject_default_revision_unique_for_classifier()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'injected default race'
          USING
            ERRCODE = '23505',
            CONSTRAINT = 'fsrs_parameter_revisions_pkey',
            TABLE = 'fsrs_parameter_revisions',
            SCHEMA = 'public';
      END
      $$
    `);
    await sql.unsafe(`
      CREATE TRIGGER inject_default_revision_unique_for_classifier
      BEFORE INSERT ON fsrs_parameter_revisions
      FOR EACH ROW
      EXECUTE FUNCTION inject_default_revision_unique_for_classifier()
    `);
    try {
      const repository = createPostgresFsrsLiveRepository(sql, {
        hooks: {
          async afterUniqueRaceRollback(context: { kind: string }) {
            expect(context.kind).toBe('default');
            await sql.unsafe(
              'DROP TRIGGER inject_default_revision_unique_for_classifier ON fsrs_parameter_revisions',
            );
            await rawWriter.unsafe(
              `INSERT INTO fsrs_parameter_revisions (
                 id, user_id, revision, engine_version, algorithm_version,
                 policy_version, parameters, params_hash, source
               ) VALUES (
                 $1::uuid, $2::uuid, 1, $3, $4, $5, $6::jsonb, $7, 'default'
               )`,
              [
                expected.id,
                seeded.userId,
                FSRS_LIBRARY_VERSION,
                FSRS_ALGORITHM_VERSION,
                FSRS_POLICY_VERSION,
                expected.parameters as any,
                expected.paramsHash,
              ],
            );
          },
        } as any,
      });
      const result = await createFsrsLiveService(
        repository,
        () => new Date(RECEIVED_AT),
      ).reviewCard(seeded.userId, input);

      expect(result.status).toBe('applied');
    } finally {
      await rawWriter.end();
      await sql.unsafe(
        'DROP TRIGGER IF EXISTS inject_default_revision_unique_for_classifier ON fsrs_parameter_revisions',
      );
      await sql.unsafe(
        'DROP FUNCTION IF EXISTS inject_default_revision_unique_for_classifier()',
      );
    }
    expect([
      ...await sql`
        SELECT
          (SELECT id::text FROM fsrs_parameter_revisions
            WHERE user_id = ${seeded.userId}) AS "revisionId",
          (SELECT source FROM fsrs_parameter_revisions
            WHERE user_id = ${seeded.userId}) AS "revisionSource",
          (SELECT params_hash FROM fsrs_parameter_revisions
            WHERE user_id = ${seeded.userId}) AS "paramsHash",
          (SELECT count(*)::int FROM fsrs_review_events
            WHERE user_id = ${seeded.userId}) AS events,
          (SELECT parameter_revision_id::text FROM fsrs_review_events
            WHERE user_id = ${seeded.userId}) AS "eventRevisionId",
          (SELECT parameter_revision_id::text FROM fsrs_card_states
            WHERE user_id = ${seeded.userId}) AS "stateRevisionId",
          (SELECT reps FROM fsrs_card_states
            WHERE user_id = ${seeded.userId}) AS reps,
          (SELECT state_version::int FROM fsrs_card_states
            WHERE user_id = ${seeded.userId}) AS version,
          (SELECT learning_cycle FROM fsrs_card_states
            WHERE user_id = ${seeded.userId}) AS cycle,
          (SELECT sum(cards_reviewed)::int FROM study_daily_logs
            WHERE user_id = ${seeded.userId}) AS daily
      `,
    ]).toEqual([
      {
        revisionId: expected.id,
        revisionSource: 'default',
        paramsHash: expected.paramsHash,
        events: 1,
        eventRevisionId: expected.id,
        stateRevisionId: expected.id,
        reps: 1,
        version: 1,
        cycle: 1,
        daily: 1,
      },
    ]);
  });

  test('card and deck reset keep events, repeated reset is a no-op, and the next review starts the next cycle', async () => {
    const seeded = await seedUser(2);
    const outsider = await seedUser();
    await service().reviewBatch(
      seeded.userId,
      seeded.cardIds.map((cardId) => review(cardId)),
      0,
    );
    expect(
      await service().resetCard(
        seeded.userId.toUpperCase(),
        seeded.cardIds[0]!.toUpperCase(),
      ),
    ).toBe(1);
    expect(await service().resetCard(seeded.userId, seeded.cardIds[0]!)).toBe(0);
    const afterReset = await service().reviewCard(
      seeded.userId,
      review(seeded.cardIds[0]!, {
        reviewedAt: '2026-07-29T11:00:00.000Z',
      }),
    );
    expect(afterReset).toMatchObject({ learningCycle: 2, sequence: 1 });
    await expect(
      service().resetDeck(outsider.userId, seeded.deckId),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await service().resetDeck(
        seeded.userId.toUpperCase(),
        seeded.deckId.toUpperCase(),
      ),
    ).toBe(2);
    expect([
      ...await sql`
        SELECT
          (SELECT count(*)::int FROM fsrs_review_events
            WHERE user_id = ${seeded.userId}) AS events,
          (SELECT count(*)::int FROM fsrs_card_states
            WHERE user_id = ${seeded.userId}) AS states,
          (SELECT sum(cards_reviewed)::int FROM study_daily_logs
            WHERE user_id = ${seeded.userId}) AS daily
      `,
    ]).toEqual([{ events: 3, states: 0, daily: 3 }]);
  });

  test('deck membership churn during reset resolves safely without leaking an internal retry sentinel', async () => {
    const seeded = await seedUser();
    const additional = await seedAdditionalDeck(seeded);
    await service().reviewCard(seeded.userId, review(seeded.cardIds[0]!));
    const candidatesRead = deferred();
    const release = deferred();
    const resetPromise = service(sql, {
      async afterDeckResetCandidatesRead() {
        candidatesRead.resolve();
        await release.promise;
      },
    } as any).resetDeck(seeded.userId, seeded.deckId);
    const firstBoundary = await Promise.race([
      candidatesRead.promise.then(() => 'hook' as const),
      resetPromise.then(() => 'completed' as const),
    ]);

    expect(firstBoundary).toBe('hook');
    await sql`
      UPDATE cards SET deck_id = ${additional.deckId}
      WHERE id = ${seeded.cardIds[0]!}
    `;
    release.resolve();
    try {
      await expect(resetPromise).resolves.toBe(0);
    } finally {
      release.resolve();
    }
    expect([
      ...await sql`
        SELECT count(*)::int AS count
        FROM fsrs_card_states
        WHERE user_id = ${seeded.userId}
          AND card_id = ${seeded.cardIds[0]!}
      `,
    ]).toEqual([{ count: 1 }]);
  });

  test('reset racing review is serializable in both acquisition orders', async () => {
    const reviewFirst = await seedUser();
    await service().reviewCard(
      reviewFirst.userId,
      review(reviewFirst.cardIds[0]!),
    );
    const reviewClient = contender('fsrs_reset_review_first');
    const resetClient = contender('fsrs_reset_second');
    const reviewWritten = deferred();
    const releaseReview = deferred();
    try {
      const reviewPromise = service(reviewClient, {
        async afterEventAndStateWrittenBeforeDailyLog() {
          reviewWritten.resolve();
          await releaseReview.promise;
        },
      }).reviewCard(
        reviewFirst.userId,
        review(reviewFirst.cardIds[0]!, {
          reviewedAt: '2026-07-29T11:00:00.000Z',
        }),
      );
      await reviewWritten.promise;
      const resetPromise = service(resetClient).resetCard(
        reviewFirst.userId,
        reviewFirst.cardIds[0]!,
      );
      await waitForDatabaseLock('fsrs_reset_second');
      releaseReview.resolve();
      await reviewPromise;
      expect(await resetPromise).toBe(1);
    } finally {
      releaseReview.resolve();
      await reviewClient.end();
      await resetClient.end();
    }
    expect([
      ...await sql`
        SELECT
          (SELECT count(*)::int FROM fsrs_review_events
            WHERE user_id = ${reviewFirst.userId}) AS events,
          (SELECT count(*)::int FROM fsrs_card_states
            WHERE user_id = ${reviewFirst.userId}) AS states
      `,
    ]).toEqual([{ events: 2, states: 0 }]);

    const resetFirst = await seedUser();
    await service().reviewCard(
      resetFirst.userId,
      review(resetFirst.cardIds[0]!),
    );
    const firstResetClient = contender('fsrs_reset_first');
    const secondReviewClient = contender('fsrs_review_second');
    const resetReady = deferred();
    const releaseReset = deferred();
    try {
      const resetPromise = service(firstResetClient, {
        async beforeResetStateDelete() {
          resetReady.resolve();
          await releaseReset.promise;
        },
      }).resetCard(resetFirst.userId, resetFirst.cardIds[0]!);
      await resetReady.promise;
      const reviewPromise = service(secondReviewClient).reviewCard(
        resetFirst.userId,
        review(resetFirst.cardIds[0]!, {
          reviewedAt: '2026-07-29T11:00:00.000Z',
        }),
      );
      await waitForDatabaseLock('fsrs_review_second');
      releaseReset.resolve();
      expect(await resetPromise).toBe(1);
      expect(await reviewPromise).toMatchObject({
        learningCycle: 2,
        sequence: 1,
      });
    } finally {
      releaseReset.resolve();
      await firstResetClient.end();
      await secondReviewClient.end();
    }
  });

  test('concurrent same-card reviews serialize into sequence one and two without a lost state update', async () => {
    const seeded = await seedUser();
    const firstClient = contender('fsrs_same_first');
    const secondClient = contender('fsrs_same_second');
    const locked = deferred();
    const release = deferred();
    const firstInput = review(seeded.cardIds[0]!, {
      rating: 'again',
      reviewedAt: '2026-07-29T10:00:00.000Z',
    });
    const secondInput = review(seeded.cardIds[0]!, {
      rating: 'good',
      reviewedAt: '2026-07-29T10:00:00.000Z',
    });
    try {
      const firstPromise = service(firstClient, {
        async afterUserLocked() {
          locked.resolve();
          await release.promise;
        },
      }).reviewCard(seeded.userId, firstInput);
      await locked.promise;
      const secondPromise = service(secondClient).reviewCard(
        seeded.userId,
        secondInput,
      );
      await waitForDatabaseLock('fsrs_same_second');
      release.resolve();

      expect(
        (await Promise.all([firstPromise, secondPromise])).map(
          (item) => item.sequence,
        ),
      ).toEqual([1, 2]);
    } finally {
      release.resolve();
      await firstClient.end();
      await secondClient.end();
    }
    expect([
      ...await sql`
        SELECT sequence, after_reps AS reps,
          after_state_version::int AS version
        FROM fsrs_review_events WHERE user_id = ${seeded.userId}
        ORDER BY sequence
      `,
    ]).toEqual([
      { sequence: 1, reps: 1, version: 1 },
      { sequence: 2, reps: 2, version: 2 },
    ]);
  });

  test('opposite-order overlapping batches use stable locks and complete without deadlock', async () => {
    const seeded = await seedUser(3);
    const additional = await seedAdditionalDeck(seeded);
    const firstClient = contender('fsrs_overlap_first');
    const secondClient = contender('fsrs_overlap_second');
    const cardProbe = contender('fsrs_overlap_card_probe');
    const locked = deferred();
    const release = deferred();
    const expectedCardIds = [
      seeded.cardIds[0]!,
      additional.cardId,
    ].sort();
    const expectedDeckIds = [
      seeded.deckId,
      additional.deckId,
    ].sort();
    const observedTargets: Array<{
      cardIds: readonly string[];
      deckIds: readonly string[];
    }> = [];
    try {
      const firstPromise = service(firstClient, {
        async afterCardsAndDecksLocked(context) {
          observedTargets.push({
            cardIds: [...context.cardIds],
            deckIds: [...context.deckIds],
          });
          locked.resolve();
          await release.promise;
        },
      }).reviewBatch(
        seeded.userId,
        [review(additional.cardId), review(seeded.cardIds[0]!)],
        0,
      );
      await locked.promise;
      const cardProbePromise = Promise.resolve(cardProbe`
        UPDATE cards SET sort_order = sort_order + 1
        WHERE id = ${additional.cardId}
      `);
      await waitForDatabaseLock('fsrs_overlap_card_probe');
      const secondPromise = service(secondClient, {
        afterCardsAndDecksLocked(context) {
          observedTargets.push({
            cardIds: [...context.cardIds],
            deckIds: [...context.deckIds],
          });
        },
      }).reviewBatch(
        seeded.userId,
        [review(seeded.cardIds[0]!), review(additional.cardId)],
        0,
      );
      await waitForDatabaseLock('fsrs_overlap_second');
      release.resolve();
      const results = await Promise.all([firstPromise, secondPromise]);
      await cardProbePromise;
      expect(results.map((result) => result.applied)).toEqual([2, 2]);
      expect(observedTargets).toEqual([
        { cardIds: expectedCardIds, deckIds: expectedDeckIds },
        { cardIds: expectedCardIds, deckIds: expectedDeckIds },
      ]);
      expect([
        ...await sql`
          SELECT card_id::text AS "cardId", learning_cycle AS cycle,
            reps, state_version::int AS version
          FROM fsrs_card_states
          WHERE user_id = ${seeded.userId}
          ORDER BY card_id
        `,
      ]).toEqual(
        expectedCardIds.map((cardId) => ({
          cardId,
          cycle: 1,
          reps: 2,
          version: 2,
        })),
      );
    } finally {
      release.resolve();
      await firstClient.end();
      await secondClient.end();
      await cardProbe.end();
    }
  });

  test('same-request and default-revision races create one event one revision and one daily increment', async () => {
    const seeded = await seedUser();
    const firstClient = contender('fsrs_duplicate_first');
    const secondClient = contender('fsrs_duplicate_second');
    const written = deferred();
    const release = deferred();
    const input = review(seeded.cardIds[0]!);
    try {
      const firstPromise = service(firstClient, {
        async afterEventAndStateWrittenBeforeDailyLog() {
          written.resolve();
          await release.promise;
        },
      }).reviewCard(seeded.userId, input);
      await written.promise;
      const secondPromise = service(secondClient).reviewCard(
        seeded.userId,
        input,
      );
      await waitForDatabaseLock('fsrs_duplicate_second');
      release.resolve();
      expect(
        (await Promise.all([firstPromise, secondPromise])).map(
          (item) => item.status,
        ),
      ).toEqual(['applied', 'duplicate']);
    } finally {
      release.resolve();
      await firstClient.end();
      await secondClient.end();
    }
    expect([
      ...await sql`
        SELECT
          (SELECT count(*)::int FROM fsrs_parameter_revisions
            WHERE user_id = ${seeded.userId}) AS revisions,
          (SELECT count(*)::int FROM fsrs_review_events
            WHERE user_id = ${seeded.userId}) AS events,
          (SELECT count(*)::int FROM fsrs_card_states
            WHERE user_id = ${seeded.userId}) AS states,
          (SELECT reps FROM fsrs_card_states
            WHERE user_id = ${seeded.userId}) AS reps,
          (SELECT state_version::int FROM fsrs_card_states
            WHERE user_id = ${seeded.userId}) AS version,
          (SELECT learning_cycle FROM fsrs_card_states
            WHERE user_id = ${seeded.userId}) AS cycle,
          (SELECT sum(cards_reviewed)::int FROM study_daily_logs
            WHERE user_id = ${seeded.userId}) AS daily
      `,
    ]).toEqual([
      {
        revisions: 1,
        events: 1,
        states: 1,
        reps: 1,
        version: 1,
        cycle: 1,
        daily: 1,
      },
    ]);
  });

  test('owner mutation before review is hidden as NotFound and review before mutation cannot leave mismatched ownership', async () => {
    const firstOwner = await seedUser();
    const nextOwner = await seedUser();
    const firstMutationClient = contender('fsrs_owner_mutation_first');
    const blockedReviewClient = contender('fsrs_owner_review_second');
    const mutationReady = deferred();
    const releaseMutation = deferred();
    const mutationPromise = firstMutationClient.begin(async (transaction) => {
      await transaction.unsafe(
        `
          UPDATE decks SET user_id = $1::uuid
          WHERE id = $2::uuid
        `,
        [nextOwner.userId, firstOwner.deckId],
      );
      mutationReady.resolve();
      await releaseMutation.promise;
    });
    await mutationReady.promise;
    const blockedReviewPromise = service(blockedReviewClient).reviewCard(
      firstOwner.userId,
      review(firstOwner.cardIds[0]!),
    );
    await waitForDatabaseLock('fsrs_owner_review_second');
    releaseMutation.resolve();
    try {
      await mutationPromise;
      await expect(blockedReviewPromise).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      releaseMutation.resolve();
      await firstMutationClient.end();
      await blockedReviewClient.end();
    }
    expect([
      ...await sql`
        SELECT count(*)::int AS count
        FROM fsrs_review_events
        WHERE user_id = ${firstOwner.userId}
      `,
    ]).toEqual([{ count: 0 }]);

    await expect(
      service().reviewCard(
        firstOwner.userId,
        review(firstOwner.cardIds[0]!),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    const liveOwner = await seedUser();
    const replacementOwner = await seedUser();
    const reviewClient = contender('fsrs_owner_review');
    const mutationClient = contender('fsrs_owner_mutation');
    const locked = deferred();
    const release = deferred();
    try {
      const reviewPromise = service(reviewClient, {
        async afterCardsAndDecksLocked() {
          locked.resolve();
          await release.promise;
        },
      }).reviewCard(liveOwner.userId, review(liveOwner.cardIds[0]!));
      await locked.promise;
      const mutationPromise = Promise.resolve(mutationClient`
          UPDATE decks SET user_id = ${replacementOwner.userId}
          WHERE id = ${liveOwner.deckId}
        `);
      await waitForDatabaseLock('fsrs_owner_mutation');
      release.resolve();
      await reviewPromise;
      await expect(mutationPromise).rejects.toMatchObject({
        code: '23503',
        constraint_name: 'fk_decks_fsrs_owner_consistency',
      });
    } finally {
      release.resolve();
      await reviewClient.end();
      await mutationClient.end();
    }
    expect([
      ...await sql`
        SELECT count(*)::int AS mismatches
        FROM fsrs_review_events event
        JOIN cards card ON card.id = event.card_id
        JOIN decks deck ON deck.id = card.deck_id
        WHERE event.user_id IS DISTINCT FROM deck.user_id
          AND event.user_id = ${liveOwner.userId}
      `,
    ]).toEqual([{ mismatches: 0 }]);
  });
});
