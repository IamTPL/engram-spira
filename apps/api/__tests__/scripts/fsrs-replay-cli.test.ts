import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  parseFsrsReplayArguments,
  redactDatabaseTarget,
  runFsrsReplayCli,
  serializeFsrsReplayCliError,
} from '../../src/scripts/fsrs-replay-cli';
import { createFsrsReplayService } from '../../src/modules/study/fsrs-replay.service';
import type {
  FsrsReplaySnapshot,
} from '../../src/modules/study/fsrs-replay-planner';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HASH = 'a'.repeat(64);
const CARD_ID = '22222222-2222-4222-8222-222222222222';
const LOG_ID = '44444444-4444-4444-8444-444444444444';

function runtime(snapshot: FsrsReplaySnapshot) {
  const service = createFsrsReplayService(
    {
      databaseTarget: 'postgresql://localhost/engram',
      async readDryRunSnapshot() {
        return snapshot;
      },
      async apply() {
        throw new Error('apply is not used by this dry-run test');
      },
    },
    () => 'UTC',
  );
  return async () => ({ service, close: async () => {} });
}

describe('FSRS replay CLI', () => {
  test('defaults to dry-run while requiring an explicit scope', () => {
    expect(parseFsrsReplayArguments(['--all-users'])).toEqual({
      mode: 'dry-run',
      scope: { kind: 'all_users' },
      allowProgressWithoutLogs: false,
    });
    expect(() => parseFsrsReplayArguments([])).toThrow('scope');
  });

  test('rejects conflicting, duplicate, and unknown arguments', () => {
    expect(() =>
      parseFsrsReplayArguments(['--all-users', '--user-id', USER_ID]),
    ).toThrow('exactly one');
    expect(() =>
      parseFsrsReplayArguments(['--all-users', '--all-users']),
    ).toThrow('Duplicate');
    expect(() => parseFsrsReplayArguments(['--wat'])).toThrow('Unknown');
  });

  test('apply requires both approved checksums', () => {
    expect(() =>
      parseFsrsReplayArguments(['--apply', '--all-users']),
    ).toThrow('expected-source-checksum');
    expect(
      parseFsrsReplayArguments([
        '--apply',
        '--user-id',
        USER_ID,
        '--expected-source-checksum',
        HASH,
        '--expected-result-checksum',
        HASH,
      ]),
    ).toEqual({
      mode: 'apply',
      scope: { kind: 'user', userId: USER_ID },
      expectedSourceChecksum: HASH,
      expectedResultChecksum: HASH,
      allowProgressWithoutLogs: false,
    });
  });

  test('accepts canonical UUID versions supported by the replay planner', () => {
    expect(
      parseFsrsReplayArguments([
        '--user-id',
        '11111111-1111-7111-8111-111111111111',
      ]).scope,
    ).toEqual({
      kind: 'user',
      userId: '11111111-1111-7111-8111-111111111111',
    });
  });

  test('redacts credentials and query parameters from database target', () => {
    expect(
      redactDatabaseTarget(
        'postgresql://secret:password@db.example:5432/engram?sslmode=require',
      ),
    ).toBe('postgresql://db.example:5432/engram');
    expect(() => redactDatabaseTarget('https://db.example/engram')).toThrow(
      'PostgreSQL',
    );
  });

  test('executable exits nonzero with structured JSON for invalid input', async () => {
    const processHandle = Bun.spawn(
      [process.execPath, 'run', 'src/scripts/fsrs-replay.ts'],
      {
        cwd: resolve(import.meta.dir, '../..'),
        env: {
          ...process.env,
          TZ: 'UTC',
          DATABASE_URL: 'postgresql://secret:password@localhost:5435/engram',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [exitCode, stderr] = await Promise.all([
      processHandle.exited,
      new Response(processHandle.stderr).text(),
    ]);

    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr)).toMatchObject({
      reportVersion: 'engram-fsrs-replay-report-v1',
      status: 'failed',
      error: { name: 'ValidationError' },
    });
    expect(stderr).not.toContain('password');
  });

  test('does not expose unexpected database details in structured errors', () => {
    const error = Object.assign(
      new Error('failing row contains secret vocabulary'),
      { code: '23514' },
    );

    expect(serializeFsrsReplayCliError(error)).toEqual({
      name: 'DatabaseError',
      message: 'FSRS replay database operation failed (23514)',
    });
  });

  test('all-user invalid data exits nonzero with deterministic context', async () => {
    const base: FsrsReplaySnapshot = {
      scope: { kind: 'all_users' },
      scopedUserIds: [USER_ID],
      legacyParameterRows: [],
      reviews: [],
      progress: [],
    };
    const parameterFailure = await runFsrsReplayCli(
      ['--all-users'],
      runtime({
        ...base,
        legacyParameterRows: [
          {
            userId: USER_ID,
            parameters: {
              request_retention: 2,
              credential: 'must-never-appear',
            },
          },
        ],
      }),
    );
    const reviewFailure = await runFsrsReplayCli(
      ['--all-users'],
      runtime({
        ...base,
        reviews: [
          {
            logId: LOG_ID,
            userId: USER_ID,
            cardId: CARD_ID,
            ownerUserId: USER_ID,
            rating: 'perfect' as 'good',
            legacyState: 'new',
            sourceReviewedAt: '2026-01-01T00:00:00.000000Z',
            schedulerReviewedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );

    expect(parameterFailure.exitCode).toBe(1);
    expect(parameterFailure.stderr).toContain(`user=${USER_ID}`);
    expect(parameterFailure.stderr).not.toContain('must-never-appear');
    expect(reviewFailure.exitCode).toBe(1);
    expect(reviewFailure.stderr).toContain(
      `user=${USER_ID} card=${CARD_ID} log=${LOG_ID}`,
    );
  });
});
