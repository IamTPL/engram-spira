import { ValidationError } from '../../shared/errors';
import {
  createFsrsReplayPlan,
  type FsrsReplayManifest,
  type FsrsReplayScope,
  type FsrsReplaySnapshot,
} from './fsrs-replay-planner';

const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;

export interface FsrsReplayApplyRepositoryInput {
  scope: FsrsReplayScope;
  expectedSourceChecksum: string;
  expectedResultChecksum: string;
  allowProgressWithoutLogs: boolean;
  createPlan(snapshot: FsrsReplaySnapshot): FsrsReplayManifest;
}

export interface FsrsReplayRepository {
  databaseTarget: string;
  readDryRunSnapshot(scope: FsrsReplayScope): Promise<FsrsReplaySnapshot>;
  apply(input: FsrsReplayApplyRepositoryInput): Promise<{
    runId: string;
    reused: boolean;
    recoveredRuns: number;
    manifest: FsrsReplayManifest;
  }>;
}

export interface FsrsReplayApplyInput {
  scope: FsrsReplayScope;
  expectedSourceChecksum: string;
  expectedResultChecksum: string;
  allowProgressWithoutLogs: boolean;
}

export function createFsrsReplayService(
  repository: FsrsReplayRepository,
  timezone: () => string | undefined = () => process.env.TZ,
) {
  function validatePlan(
    manifest: FsrsReplayManifest,
    input: FsrsReplayApplyInput,
  ) {
    if (manifest.sourceChecksum !== input.expectedSourceChecksum) {
      throw new ValidationError(
        'FSRS replay source checksum does not match the approved dry-run',
      );
    }
    if (manifest.resultChecksum !== input.expectedResultChecksum) {
      throw new ValidationError(
        'FSRS replay result checksum does not match the approved dry-run',
      );
    }
    if (
      manifest.counts.progressWithoutHistory > 0 &&
      !input.allowProgressWithoutLogs
    ) {
      throw new ValidationError(
        'Replay requires --allow-progress-without-logs acknowledgement',
      );
    }
    return manifest;
  }

  return {
    async dryRun(scope: FsrsReplayScope) {
      assertUtc(timezone());
      const snapshot = await repository.readDryRunSnapshot(scope);
      return {
        mode: 'dry-run' as const,
        databaseTarget: repository.databaseTarget,
        manifest: createFsrsReplayPlan(snapshot),
      };
    },
    async apply(input: FsrsReplayApplyInput) {
      assertUtc(timezone());
      validateChecksum(input.expectedSourceChecksum, 'source');
      validateChecksum(input.expectedResultChecksum, 'result');
      const result = await repository.apply({
        ...input,
        createPlan(snapshot) {
          return validatePlan(createFsrsReplayPlan(snapshot), input);
        },
      });
      validatePlan(result.manifest, input);
      return {
        mode: 'apply' as const,
        databaseTarget: repository.databaseTarget,
        ...result,
      };
    },
  };
}

function assertUtc(timezone: string | undefined) {
  if (timezone !== 'UTC') {
    throw new ValidationError('FSRS replay requires TZ=UTC');
  }
}

function validateChecksum(checksum: string, label: string) {
  if (!CHECKSUM_PATTERN.test(checksum)) {
    throw new ValidationError(
      `Expected ${label} checksum must be a lowercase SHA-256`,
    );
  }
}
