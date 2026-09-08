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
import { NotFoundError, ValidationError } from '../../../src/shared/errors';
import {
  createPostgresCanonicalFsrsReadLoader,
} from '../../../src/modules/study/fsrs-read.postgres';
import {
  calculateCanonicalFsrsRetrievability,
} from '../../../src/modules/study/fsrs-retention';
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
import { fsrsForgettingCurveConstants } from '../../../src/modules/study/fsrs-revision';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../src/db/migrations');
const DATABASE_NAME =
  `engram_fsrs_read_${crypto.randomUUID().replaceAll('-', '')}`;

let admin: Sql;
let sql: Sql;
let queryCount = 0;

interface SeededUser {
  userId: string;
  cardIds: string[];
}

interface SeededRevision {
  id: string;
  parameters: Record<string, unknown>;
  paramsHash: string;
}

function assertDisposableName(name: string) {
  if (!/^engram_fsrs_read_[a-f0-9]+$/u.test(name)) {
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

async function seedUser(cardCount = 2): Promise<SeededUser> {
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
  return { userId, cardIds };
}

async function insertRevision(
  userId: string,
  revision: number,
  parametersInput: Record<string, unknown>,
  timestamps: {
    activatedAt: Date;
    retiredAt: Date | null;
  },
): Promise<SeededRevision> {
  const parameters = JSON.parse(
    canonicalJson(normalizeFsrsParameters(parametersInput)),
  ) as Record<string, unknown>;
  const paramsHash = sha256Canonical(parameters);
  const curve = fsrsForgettingCurveConstants(parameters);
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO fsrs_parameter_revisions (
      user_id, revision, engine_version, algorithm_version, policy_version,
      parameters, params_hash, source, decay, factor,
      created_at, activated_at, retired_at
    ) VALUES (
      ${userId}, ${revision}, ${FSRS_LIBRARY_VERSION},
      ${FSRS_ALGORITHM_VERSION}, ${FSRS_POLICY_VERSION},
      ${sql.json(parameters as any)}, ${paramsHash}, 'manual',
      ${curve.decay}, ${curve.factor},
      ${timestamps.activatedAt}, ${timestamps.activatedAt},
      ${timestamps.retiredAt}
    )
    RETURNING id
  `;
  return { id: row.id, parameters, paramsHash };
}

async function insertState(
  userId: string,
  cardId: string,
  parameterRevisionId: string,
) {
  await sql`
    INSERT INTO fsrs_card_states (
      user_id, card_id, next_review_at, last_reviewed_at,
      stability, difficulty, state, elapsed_days, scheduled_days,
      learning_steps, reps, lapses, parameter_revision_id,
      state_version, learning_cycle, updated_at
    ) VALUES (
      ${userId}, ${cardId}, ${new Date('2026-01-11T12:00:00.000Z')},
      ${new Date('2026-01-01T12:00:00.000Z')},
      10.123456789, 5.5, 'review', 10, 10, 0, 3, 1,
      ${parameterRevisionId}, 3, 1,
      ${new Date('2026-01-01T12:00:00.000Z')}
    )
  `;
}

async function seedRetiredStateAndActiveRevision() {
  const seeded = await seedUser();
  const defaults = normalizeFsrsParameters();
  const oldWeights = [...defaults.w];
  oldWeights[20] = 0.3;
  const oldRevision = await insertRevision(
    seeded.userId,
    1,
    { request_retention: 0.83, w: oldWeights },
    {
      activatedAt: new Date('2025-12-01T00:00:00.000Z'),
      retiredAt: new Date('2026-01-02T00:00:00.000Z'),
    },
  );
  await insertState(seeded.userId, seeded.cardIds[0]!, oldRevision.id);
  const activeRevision = await insertRevision(
    seeded.userId,
    2,
    { request_retention: 0.95 },
    {
      activatedAt: new Date('2026-01-02T00:00:00.000Z'),
      retiredAt: null,
    },
  );
  return { seeded, oldRevision, activeRevision };
}

beforeAll(async () => {
  assertDisposableName(DATABASE_NAME);
  admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${DATABASE_NAME}"`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${DATABASE_NAME}`;
  sql = postgres(url.toString(), {
    max: 4,
    onnotice: () => {},
    debug() {
      queryCount += 1;
    },
  });
  await applyMigrations(sql);
});

afterAll(async () => {
  await sql?.end();
  assertDisposableName(DATABASE_NAME);
  await admin?.unsafe(`DROP DATABASE IF EXISTS "${DATABASE_NAME}" WITH (FORCE)`);
  await admin?.end();
});

describe('PostgreSQL canonical FSRS read loader', () => {
  test('loads stable requested order in one query, preserves New as null, and never leaks the active revision', async () => {
    const { seeded, oldRevision, activeRevision } =
      await seedRetiredStateAndActiveRevision();
    const loader = createPostgresCanonicalFsrsReadLoader(sql);
    queryCount = 0;

    const result = await loader.loadByCardIds(
      seeded.userId,
      [seeded.cardIds[1]!, seeded.cardIds[0]!],
    );

    expect(queryCount).toBe(1);
    expect(result.map((item) => item.cardId)).toEqual([
      seeded.cardIds[1],
      seeded.cardIds[0],
    ]);
    expect(result[0]).toEqual({
      cardId: seeded.cardIds[1],
      read: null,
    });
    expect(result[1]!.read?.state.cardId).toBe(seeded.cardIds[0]);
    expect(result[1]!.read?.revision).toMatchObject({
      id: oldRevision.id,
      userId: seeded.userId,
      revision: 1,
      paramsHash: oldRevision.paramsHash,
      retiredAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    expect(result[1]!.read?.revision.id).not.toBe(activeRevision.id);
    expect(
      calculateCanonicalFsrsRetrievability(
        result[1]!.read!,
        new Date('2026-01-11T12:00:00.000Z'),
      ),
    ).not.toBe(0.90084075);
  });

  test('rejects duplicate requested IDs before querying and performs no query for an empty batch', async () => {
    const seeded = await seedUser();
    const loader = createPostgresCanonicalFsrsReadLoader(sql);
    queryCount = 0;

    await expect(
      loader.loadByCardIds(
        seeded.userId,
        [seeded.cardIds[0]!, seeded.cardIds[0]!],
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(queryCount).toBe(0);
    await expect(
      loader.loadByCardIds(seeded.userId, []),
    ).resolves.toEqual([]);
    expect(queryCount).toBe(0);
  });

  test('rejects a mixed owned and foreign card batch as NotFound without returning a partial mapping', async () => {
    const owner = await seedUser();
    const outsider = await seedUser();
    const loader = createPostgresCanonicalFsrsReadLoader(sql);
    queryCount = 0;

    await expect(
      loader.loadByCardIds(
        owner.userId,
        [owner.cardIds[0]!, outsider.cardIds[0]!],
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(queryCount).toBe(1);
  });

  test('fails closed when a corrupted state points at another user parameter revision', async () => {
    const owner = await seedUser(1);
    const outsider = await seedUser(1);
    const outsiderRevision = await insertRevision(
      outsider.userId,
      1,
      {},
      {
        activatedAt: new Date('2025-12-01T00:00:00.000Z'),
        retiredAt: null,
      },
    );
    await sql.unsafe('SET session_replication_role = replica');
    try {
      await insertState(
        owner.userId,
        owner.cardIds[0]!,
        outsiderRevision.id,
      );
    } finally {
      await sql.unsafe('SET session_replication_role = origin');
    }
    const loader = createPostgresCanonicalFsrsReadLoader(sql);
    queryCount = 0;

    await expect(
      loader.loadByCardIds(owner.userId, [owner.cardIds[0]!]),
    ).rejects.toThrow('revision');
    expect(queryCount).toBe(1);
  });

  test('fails closed on unsupported or noncanonical persisted revisions', async () => {
    const unsupported = await seedRetiredStateAndActiveRevision();
    await sql`
      UPDATE fsrs_parameter_revisions
      SET engine_version = 'ts-fsrs@next'
      WHERE id = ${unsupported.oldRevision.id}
    `;
    await expect(
      createPostgresCanonicalFsrsReadLoader(sql).loadByCardIds(
        unsupported.seeded.userId,
        [unsupported.seeded.cardIds[0]!],
      ),
    ).rejects.toThrow('provenance');

    const noncanonical = await seedRetiredStateAndActiveRevision();
    await sql`
      UPDATE fsrs_parameter_revisions
      SET parameters = ${sql.json({})}
      WHERE id = ${noncanonical.oldRevision.id}
    `;
    await expect(
      createPostgresCanonicalFsrsReadLoader(sql).loadByCardIds(
        noncanonical.seeded.userId,
        [noncanonical.seeded.cardIds[0]!],
      ),
    ).rejects.toThrow('canonical');
  });

  test('rejects duplicate query rows from an injected database boundary', async () => {
    const userId = crypto.randomUUID();
    const cardId = crypto.randomUUID();
    const duplicateRows = [
      {
        ordinal: 1,
        requestedCardId: cardId,
        ownedCardId: cardId,
        stateId: null,
      },
      {
        ordinal: 1,
        requestedCardId: cardId,
        ownedCardId: cardId,
        stateId: null,
      },
    ];
    const loader = createPostgresCanonicalFsrsReadLoader({
      unsafe: (() =>
        Promise.resolve(duplicateRows)) as never,
    });

    await expect(
      loader.loadByCardIds(userId, [cardId]),
    ).rejects.toThrow('exactly one');
  });
});
