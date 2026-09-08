import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { forgetting_curve } from 'ts-fsrs';
import { fsrsForgettingCurveConstants } from '../../../src/modules/study/fsrs-revision';
import { normalizeFsrsParameters } from '../../../src/modules/study/fsrs.engine';

const ADMIN_URL =
  process.env.TEST_POSTGRES_ADMIN_URL ??
  'postgresql://postgres:postgrespassword@localhost:5435/postgres';
const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../src/db/migrations');
const DATABASE_NAME = `engram_fsrs_sql_${crypto.randomUUID().replaceAll('-', '')}`;

let admin: Sql;
let sql: Sql;

beforeAll(async () => {
  admin = postgres(ADMIN_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${DATABASE_NAME}"`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${DATABASE_NAME}`;
  sql = postgres(url.toString(), { max: 2, onnotice: () => {} });
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_.+\.sql$/u.test(f)).sort();
  for (const file of files) {
    const source = await Bun.file(resolve(MIGRATIONS_DIR, file)).text();
    const statements = source.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
    // Migration 0027 issues a bare `LOCK TABLE`, which Postgres only allows
    // inside a transaction block — mirror fsrs-deck-reads.postgres.test.ts's
    // `applyMigrations` and run each file's statements as one transaction.
    await sql.begin(async (transaction) => {
      for (const statement of statements) {
        await transaction.unsafe(statement);
      }
    });
  }
});

afterAll(async () => {
  await sql?.end();
  await admin?.unsafe(`DROP DATABASE IF EXISTS "${DATABASE_NAME}" WITH (FORCE)`);
  await admin?.end();
});

function seeded(seed: number) {
  // deterministic LCG so a failure is reproducible
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('fsrs_retrievability() vs ts-fsrs forgetting_curve()', () => {
  test('agrees exactly (8 decimals) on 5000 random (w20, S, t) triples', async () => {
    const random = seeded(20260908);
    const cases: Array<{ w20: number; stability: number; elapsedDays: number }> = [];
    for (let i = 0; i < 5000; i += 1) {
      cases.push({
        w20: 0.1 + random() * 0.7,
        stability: 0.01 + random() * 3650,
        elapsedDays: random() * 3650,
      });
    }
    const rows = await sql.unsafe<{ r: number }[]>(
      `SELECT fsrs_retrievability(s, t * 86400.0, d, f) AS r
       FROM unnest($1::float8[], $2::float8[], $3::float8[], $4::float8[]) AS x(s, t, d, f)`,
      [
        cases.map((c) => c.stability),
        cases.map((c) => c.elapsedDays),
        cases.map((c) => -c.w20),
        cases.map((c) => Number((Math.exp(Math.log(0.9) / -c.w20) - 1).toFixed(8))),
      ],
    );
    let mismatches = 0;
    let worst: { index: number; diff: number } | null = null;
    rows.forEach((row, index) => {
      const c = cases[index]!;
      const w = [...normalizeFsrsParameters().w];
      w[20] = c.w20;
      const expected = forgetting_curve(w, c.elapsedDays, c.stability);
      const diff = Math.abs(row.r - expected);
      if (diff > 1e-8) {
        mismatches += 1;
        if (!worst || diff > worst.diff) worst = { index, diff };
      }
    });
    if (mismatches > 0) {
      const c = cases[worst!.index]!;
      // eslint-disable-next-line no-console
      console.log(
        `fsrs_retrievability mismatches: ${mismatches}/5000, worst diff=${worst!.diff} at`,
        c,
      );
    }
    expect(mismatches).toBe(0);
  });

  test('constants helper and SQL backfill formula agree', async () => {
    const parameters = normalizeFsrsParameters();
    const { decay, factor } = fsrsForgettingCurveConstants(parameters);
    const [row] = await sql.unsafe<{ f: number }[]>(
      `SELECT round((exp(ln(0.9) / $1::float8) - 1)::numeric, 8)::float8 AS f`,
      [decay],
    );
    expect(row!.f).toBe(factor);
  });
});
