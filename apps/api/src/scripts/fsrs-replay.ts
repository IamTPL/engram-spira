#!/usr/bin/env bun
import postgres from 'postgres';
import { ENV } from '../config/env';
import {
  createPostgresFsrsReplayRepository,
} from '../modules/study/fsrs-replay.postgres';
import { createFsrsReplayService } from '../modules/study/fsrs-replay.service';
import {
  redactDatabaseTarget,
  runFsrsReplayCli,
} from './fsrs-replay-cli';

async function main() {
  const outcome = await runFsrsReplayCli(
    process.argv.slice(2),
    async () => {
      const databaseTarget = redactDatabaseTarget(ENV.DATABASE_URL);
      const sql = postgres(ENV.DATABASE_URL, {
        max: 2,
        connect_timeout: 10,
        idle_timeout: 5,
        prepare: true,
      });
      const repository = createPostgresFsrsReplayRepository(
        sql,
        databaseTarget,
      );
      const service = createFsrsReplayService(repository);
      return {
        service,
        close: () => sql.end({ timeout: 5 }),
      };
    },
  );
  if (outcome.stdout) console.log(outcome.stdout);
  if (outcome.stderr) console.error(outcome.stderr);
  process.exitCode = outcome.exitCode;
}

await main();
