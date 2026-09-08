import { AppError, ValidationError } from '../shared/errors';
import type { FsrsReplayScope } from '../modules/study/fsrs-replay-planner';
import type {
  createFsrsReplayService,
} from '../modules/study/fsrs-replay.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;

export type FsrsReplayCliArguments =
  | {
      mode: 'dry-run';
      scope: FsrsReplayScope;
      allowProgressWithoutLogs: boolean;
    }
  | {
      mode: 'apply';
      scope: FsrsReplayScope;
      expectedSourceChecksum: string;
      expectedResultChecksum: string;
      allowProgressWithoutLogs: boolean;
    };

export function parseFsrsReplayArguments(
  argv: readonly string[],
): FsrsReplayCliArguments {
  const seen = new Set<string>();
  let apply = false;
  let allUsers = false;
  let userId: string | undefined;
  let sourceChecksum: string | undefined;
  let resultChecksum: string | undefined;
  let allowProgressWithoutLogs = false;

  const takeValue = (name: string, index: number) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new ValidationError(`${name} requires a value`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith('--')) {
      throw new ValidationError(`Unexpected argument: ${argument}`);
    }
    if (seen.has(argument)) {
      throw new ValidationError(`Duplicate argument: ${argument}`);
    }
    seen.add(argument);
    switch (argument) {
      case '--apply':
        apply = true;
        break;
      case '--all-users':
        allUsers = true;
        break;
      case '--user-id':
        userId = takeValue(argument, index);
        index += 1;
        break;
      case '--expected-source-checksum':
        sourceChecksum = takeValue(argument, index);
        index += 1;
        break;
      case '--expected-result-checksum':
        resultChecksum = takeValue(argument, index);
        index += 1;
        break;
      case '--allow-progress-without-logs':
        allowProgressWithoutLogs = true;
        break;
      default:
        throw new ValidationError(`Unknown argument: ${argument}`);
    }
  }

  if (Number(allUsers) + Number(Boolean(userId)) !== 1) {
    throw new ValidationError(
      'Replay requires exactly one scope: --all-users or --user-id',
    );
  }
  if (userId && !UUID_PATTERN.test(userId)) {
    throw new ValidationError('--user-id must be a canonical UUID');
  }
  const scope: FsrsReplayScope = allUsers
    ? { kind: 'all_users' }
    : { kind: 'user', userId: userId! };

  if (!apply) {
    if (sourceChecksum || resultChecksum) {
      throw new ValidationError(
        'Expected checksums are only valid together with --apply',
      );
    }
    return { mode: 'dry-run', scope, allowProgressWithoutLogs };
  }
  if (!sourceChecksum || !CHECKSUM_PATTERN.test(sourceChecksum)) {
    throw new ValidationError(
      '--expected-source-checksum requires a lowercase SHA-256',
    );
  }
  if (!resultChecksum || !CHECKSUM_PATTERN.test(resultChecksum)) {
    throw new ValidationError(
      '--expected-result-checksum requires a lowercase SHA-256',
    );
  }
  return {
    mode: 'apply',
    scope,
    expectedSourceChecksum: sourceChecksum,
    expectedResultChecksum: resultChecksum,
    allowProgressWithoutLogs,
  };
}

export function redactDatabaseTarget(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new ValidationError(
        'DATABASE_URL must use a PostgreSQL protocol',
      );
    }
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/u, '');
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('DATABASE_URL is not a valid PostgreSQL URL');
  }
}

type ReplayResult = Awaited<
  ReturnType<ReturnType<typeof createFsrsReplayService>['dryRun']>
> | Awaited<
  ReturnType<ReturnType<typeof createFsrsReplayService>['apply']>
>;
type ReplayService = Pick<
  ReturnType<typeof createFsrsReplayService>,
  'dryRun' | 'apply'
>;

export interface FsrsReplayCliRuntime {
  service: ReplayService;
  close(): Promise<void>;
}

export interface FsrsReplayCliOutcome {
  exitCode: 0 | 1;
  stdout: string;
  stderr: string;
}

export async function runFsrsReplayCli(
  argv: readonly string[],
  openRuntime: () =>
    | FsrsReplayCliRuntime
    | Promise<FsrsReplayCliRuntime>,
): Promise<FsrsReplayCliOutcome> {
  let runtime: FsrsReplayCliRuntime | undefined;
  try {
    const input = parseFsrsReplayArguments(argv);
    runtime = await openRuntime();
    const result = input.mode === 'dry-run'
      ? await runtime.service.dryRun(input.scope)
      : await runtime.service.apply({
          scope: input.scope,
          expectedSourceChecksum: input.expectedSourceChecksum,
          expectedResultChecksum: input.expectedResultChecksum,
          allowProgressWithoutLogs: input.allowProgressWithoutLogs,
        });
    await runtime.close();
    runtime = undefined;
    return {
      exitCode: 0,
      stdout: JSON.stringify(formatFsrsReplayReport(result), null, 2),
      stderr: '',
    };
  } catch (error) {
    if (runtime) {
      try {
        await runtime.close();
      } catch {
        // Preserve the actionable replay failure that occurred first.
      }
    }
    return {
      exitCode: 1,
      stdout: '',
      stderr: JSON.stringify({
        reportVersion: 'engram-fsrs-replay-report-v1',
        status: 'failed',
        error: serializeFsrsReplayCliError(error),
      }),
    };
  }
}

export function formatFsrsReplayReport(result: ReplayResult) {
  return {
    reportVersion: 'engram-fsrs-replay-report-v1',
    mode: result.mode,
    databaseTarget: result.databaseTarget,
    scope: result.manifest.scope,
    versions: {
      replay: result.manifest.replayVersion,
      engine: result.manifest.engineVersion,
      algorithm: result.manifest.algorithmVersion,
      policy: result.manifest.policyVersion,
    },
    counts: result.manifest.counts,
    anomalies: result.manifest.anomalies,
    sourceChecksum: result.manifest.sourceChecksum,
    resultChecksum: result.manifest.resultChecksum,
    ...(result.mode === 'apply'
      ? {
          runId: result.runId,
          reused: result.reused,
          recoveredRuns: result.recoveredRuns,
        }
      : {}),
  };
}

export function serializeFsrsReplayCliError(error: unknown) {
  if (error instanceof AppError) {
    return { name: error.name, message: error.message };
  }
  const code = isRecord(error) && typeof error.code === 'string'
    ? error.code
    : null;
  if (code) {
    return {
      name: 'DatabaseError',
      message: `FSRS replay database operation failed (${code})`,
    };
  }
  return {
    name: 'Error',
    message: 'FSRS replay failed unexpectedly',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
