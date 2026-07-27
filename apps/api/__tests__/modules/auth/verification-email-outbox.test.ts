import { describe, expect, it } from 'bun:test';
import {
  createVerificationEmailWorker,
  processVerificationEmailBatch,
  type VerificationEmailBatchDependencies,
  type VerificationEmailFailure,
  type VerificationEmailJob,
} from '../../../src/modules/auth/verification-email-outbox';

const baseJob: VerificationEmailJob = {
  id: 'job-1',
  userId: 'user-1',
  tokenVersion: 3,
  attemptCount: 1,
  maxAttempts: 5,
};

function createLogger() {
  const info: Array<{
    context: Record<string, unknown>;
    message: string;
  }> = [];
  const warn: Array<{
    context: Record<string, unknown>;
    message: string;
  }> = [];
  const error: Array<{
    context: Record<string, unknown>;
    message: string;
  }> = [];

  return {
    entries: { info, warn, error },
    logger: {
      info(context: Record<string, unknown>, message: string) {
        info.push({ context, message });
      },
      warn(context: Record<string, unknown>, message: string) {
        warn.push({ context, message });
      },
      error(context: Record<string, unknown>, message: string) {
        error.push({ context, message });
      },
    },
  };
}

function createDependencies(
  overrides: Partial<VerificationEmailBatchDependencies> = {},
): VerificationEmailBatchDependencies {
  const { logger } = createLogger();

  return {
    claimBatch: async () => [baseJob],
    loadPayload: async () => ({
      email: 'person@example.com',
      token: 'a'.repeat(64),
    }),
    send: async () => ({ messageId: 'smtp-message-1' }),
    markSent: async () => true,
    markCancelled: async () => true,
    reschedule: async () => true,
    markFailed: async () => true,
    logger,
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for asynchronous test condition');
}

describe('verification email outbox batch processor', () => {
  it('stores the SMTP message id after successful delivery', async () => {
    const sent: Array<{
      job: VerificationEmailJob;
      messageId: string | null;
    }> = [];
    const dependencies = createDependencies({
      markSent: async (job, messageId) => {
        sent.push({ job, messageId });
        return true;
      },
    });

    const result = await processVerificationEmailBatch(dependencies);

    expect(sent).toEqual([
      {
        job: baseJob,
        messageId: 'smtp-message-1',
      },
    ]);
    expect(result).toEqual({
      claimed: 1,
      sent: 1,
      retried: 0,
      failed: 0,
      cancelled: 0,
      superseded: 0,
      schemaUnavailable: false,
    });
  });

  it('reschedules transient failures with exponential backoff and sanitized errors', async () => {
    const token = 'b'.repeat(64);
    const rescheduled: Array<{
      failure: VerificationEmailFailure;
      delayMs: number;
    }> = [];
    const { logger, entries } = createLogger();
    const dependencies = createDependencies({
      claimBatch: async () => [
        {
          ...baseJob,
          attemptCount: 2,
        },
      ],
      send: async () => {
        const error = new Error(
          `SMTP failed for private@example.com at https://app.test/verify?token=${token} ${'x'.repeat(1_000)}`,
        ) as Error & { code: string };
        error.code = 'ETIMEDOUT';
        throw error;
      },
      reschedule: async (_job, failure, delayMs) => {
        rescheduled.push({ failure, delayMs });
        return true;
      },
      logger,
      random: () => 0.5,
      retryBaseMs: 1_000,
      retryMaxMs: 10_000,
    });

    const result = await processVerificationEmailBatch(dependencies);

    expect(result.retried).toBe(1);
    expect(rescheduled).toHaveLength(1);
    expect(rescheduled[0]?.delayMs).toBe(1_500);
    expect(rescheduled[0]?.failure.code).toBe('ETIMEDOUT');
    expect(rescheduled[0]?.failure.message).not.toContain(
      'private@example.com',
    );
    expect(rescheduled[0]?.failure.message).not.toContain(token);
    expect(rescheduled[0]?.failure.message).toContain('[REDACTED_EMAIL]');
    expect(rescheduled[0]?.failure.message).toContain('[REDACTED_TOKEN]');
    expect(rescheduled[0]?.failure.message.length).toBe(500);
    expect(entries.warn[0]?.context.errorMessage).not.toContain(token);
  });

  it('marks the job failed at max attempts and logs identifiers only', async () => {
    const { logger, entries } = createLogger();
    const failed: VerificationEmailFailure[] = [];
    const dependencies = createDependencies({
      claimBatch: async () => [
        {
          ...baseJob,
          attemptCount: 5,
          maxAttempts: 5,
        },
      ],
      send: async () => {
        throw new Error('Mailbox unavailable for private@example.com');
      },
      markFailed: async (_job, failure) => {
        failed.push(failure);
        return true;
      },
      logger,
    });

    const result = await processVerificationEmailBatch(dependencies);

    expect(result.failed).toBe(1);
    expect(failed[0]?.message).not.toContain('private@example.com');
    expect(entries.error).toEqual([
      {
        context: {
          jobId: 'job-1',
          userId: 'user-1',
          attempt: 5,
        },
        message: 'Verification email delivery permanently failed',
      },
    ]);
  });

  it('does not send again when reclaiming an exhausted processing lease', async () => {
    let sendCalls = 0;
    let payloadLoads = 0;
    const failed: VerificationEmailFailure[] = [];
    const dependencies = createDependencies({
      claimBatch: async () => [
        {
          ...baseJob,
          attemptCount: 6,
          maxAttempts: 5,
        },
      ],
      loadPayload: async () => {
        payloadLoads += 1;
        return {
          email: 'person@example.com',
          token: 'token',
        };
      },
      send: async () => {
        sendCalls += 1;
      },
      markFailed: async (_job, failure) => {
        failed.push(failure);
        return true;
      },
    });

    const result = await processVerificationEmailBatch(dependencies);

    expect(payloadLoads).toBe(0);
    expect(sendCalls).toBe(0);
    expect(failed[0]?.code).toBe('MAX_ATTEMPTS_EXHAUSTED');
    expect(result.failed).toBe(1);
  });

  it('cancels a claimed job when its current user/token payload is stale', async () => {
    const cancelled: VerificationEmailJob[] = [];
    let sendCalls = 0;
    const dependencies = createDependencies({
      loadPayload: async () => null,
      send: async () => {
        sendCalls += 1;
      },
      markCancelled: async (job) => {
        cancelled.push(job);
        return true;
      },
    });

    const result = await processVerificationEmailBatch(dependencies);

    expect(cancelled).toEqual([baseJob]);
    expect(sendCalls).toBe(0);
    expect(result.cancelled).toBe(1);
  });

  it('sends jobs sequentially within a batch', async () => {
    const secondJob: VerificationEmailJob = {
      ...baseJob,
      id: 'job-2',
      userId: 'user-2',
    };
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstDelivery = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const dependencies = createDependencies({
      claimBatch: async () => [baseJob, secondJob],
      loadPayload: async (job) => ({
        email: `${job.id}@example.com`,
        token: `${job.id}-token`,
      }),
      send: async (email) => {
        order.push(`start:${email}`);
        if (email.startsWith('job-1')) await firstDelivery;
        order.push(`finish:${email}`);
      },
    });

    const processing = processVerificationEmailBatch(dependencies);
    await waitFor(() => order.length === 1);

    expect(order).toEqual(['start:job-1@example.com']);
    releaseFirst?.();
    await processing;

    expect(order).toEqual([
      'start:job-1@example.com',
      'finish:job-1@example.com',
      'start:job-2@example.com',
      'finish:job-2@example.com',
    ]);
  });
});

describe('verification email worker scheduling', () => {
  it('coalesces wake-ups without overlapping batch executions', async () => {
    const releases: Array<() => void> = [];
    let runs = 0;
    let active = 0;
    let maximumActive = 0;
    const worker = createVerificationEmailWorker({
      pollIntervalMs: 60_000,
      processBatch: async () => {
        runs += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        active -= 1;
      },
      onError: (error) => {
        throw error;
      },
    });

    worker.request();
    await waitFor(() => releases.length === 1);

    worker.request();
    worker.request();
    expect(runs).toBe(1);
    expect(maximumActive).toBe(1);

    releases[0]?.();
    await waitFor(() => releases.length === 2);

    expect(runs).toBe(2);
    expect(maximumActive).toBe(1);

    releases[1]?.();
    await waitFor(() => !worker.isRunning());
    await worker.stop();
  });
});
