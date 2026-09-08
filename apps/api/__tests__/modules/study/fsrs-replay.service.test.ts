import { describe, expect, test } from 'bun:test';
import type { FsrsReplaySnapshot } from '../../../src/modules/study/fsrs-replay-planner';
import {
  createFsrsReplayService,
  type FsrsReplayRepository,
} from '../../../src/modules/study/fsrs-replay.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CARD_ID = '22222222-2222-4222-8222-222222222222';
const LOG_ID = '44444444-4444-4444-8444-444444444444';

function snapshot(progress = false): FsrsReplaySnapshot {
  return {
    scope: { kind: 'user', userId: USER_ID },
    scopedUserIds: [USER_ID],
    legacyParameterRows: [],
    reviews: [],
    progress: progress
      ? [{ userId: USER_ID, cardId: CARD_ID, ownerUserId: USER_ID }]
      : [],
  };
}

function repository(source: FsrsReplaySnapshot): FsrsReplayRepository & {
  applyCalls: number;
} {
  return {
    databaseTarget: 'postgresql://localhost:5435/engram',
    applyCalls: 0,
    async readDryRunSnapshot() {
      return source;
    },
    async apply(input) {
      this.applyCalls += 1;
      const manifest = input.createPlan(source);
      return {
        runId: '33333333-3333-4333-8333-333333333333',
        reused: false,
        recoveredRuns: 0,
        manifest,
      };
    },
  };
}

describe('FSRS replay service', () => {
  test('dry-run plans without invoking the write path', async () => {
    const repo = repository(snapshot());
    const service = createFsrsReplayService(repo, () => 'UTC');

    const result = await service.dryRun({
      kind: 'user',
      userId: USER_ID,
    });

    expect(result.mode).toBe('dry-run');
    expect(result.manifest.counts.users).toBe(1);
    expect(repo.applyCalls).toBe(0);
  });

  test('apply rejects source checksum drift before persistence', async () => {
    const repo = repository(snapshot());
    const service = createFsrsReplayService(repo, () => 'UTC');
    const dryRun = await service.dryRun({
      kind: 'user',
      userId: USER_ID,
    });

    await expect(
      service.apply({
        scope: { kind: 'user', userId: USER_ID },
        expectedSourceChecksum: '0'.repeat(64),
        expectedResultChecksum: dryRun.manifest.resultChecksum,
        allowProgressWithoutLogs: false,
      }),
    ).rejects.toThrow('source checksum');
  });

  test('apply requires acknowledgement before resetting progress without history', async () => {
    const repo = repository(snapshot(true));
    const service = createFsrsReplayService(repo, () => 'UTC');
    const dryRun = await service.dryRun({
      kind: 'user',
      userId: USER_ID,
    });

    await expect(
      service.apply({
        scope: { kind: 'user', userId: USER_ID },
        expectedSourceChecksum: dryRun.manifest.sourceChecksum,
        expectedResultChecksum: dryRun.manifest.resultChecksum,
        allowProgressWithoutLogs: false,
      }),
    ).rejects.toThrow('allow-progress-without-logs');
  });

  test('apply requires a UTC runtime', async () => {
    const repo = repository(snapshot());
    const service = createFsrsReplayService(repo, () => 'Asia/Barnaul');
    const checksum = '0'.repeat(64);

    await expect(
      service.apply({
        scope: { kind: 'user', userId: USER_ID },
        expectedSourceChecksum: checksum,
        expectedResultChecksum: checksum,
        allowProgressWithoutLogs: false,
      }),
    ).rejects.toThrow('TZ=UTC');
  });

  test('all-user parameter failures identify the offending user', async () => {
    const source = snapshot();
    source.scope = { kind: 'all_users' };
    source.legacyParameterRows = [
      {
        userId: USER_ID,
        parameters: {
          request_retention: 2,
          credential: 'must-never-appear',
        },
      },
    ];
    const service = createFsrsReplayService(repository(source), () => 'UTC');

    await expect(service.dryRun({ kind: 'all_users' })).rejects.toThrow(
      `user=${USER_ID}`,
    );
    try {
      await service.dryRun({ kind: 'all_users' });
    } catch (error) {
      expect((error as Error).message).not.toContain('must-never-appear');
    }
  });

  test('all-user review failures identify user, card, and log', async () => {
    const source = snapshot();
    source.scope = { kind: 'all_users' };
    source.reviews = [
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
    ];
    const service = createFsrsReplayService(repository(source), () => 'UTC');

    await expect(service.dryRun({ kind: 'all_users' })).rejects.toThrow(
      `user=${USER_ID} card=${CARD_ID} log=${LOG_ID}`,
    );
  });
});
