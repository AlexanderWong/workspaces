/**
 * Job processor — executes the actual work for a queued job.
 *
 * MockJobProcessor simulates work with a sleep. Swap this implementation
 * (via the JobProcessor interface) for real workloads without changing workers.
 */
import { TransientProcessingError } from '../errors/processing-error';
import type { Env } from '../config/env';
import type { Job, JobResult } from '../types/job';

export interface JobProcessor {
  process(job: Job): Promise<JobResult>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockJobProcessor implements JobProcessor {
  constructor(private readonly config: Pick<Env, 'DEFAULT_JOB_SLEEP_MS'>) {}

  async process(job: Job): Promise<JobResult> {
    const { payload } = job;
    const sleepMs = payload.sleepMs ?? this.config.DEFAULT_JOB_SLEEP_MS;
    await sleep(sleepMs);

    // Simulate transient failures until retryCount reaches transientFailureCount
    const transientFailures = payload.transientFailureCount ?? 0;
    if (job.retryCount < transientFailures) {
      throw new TransientProcessingError(
        `Simulated transient failure (attempt ${job.retryCount + 1}/${transientFailures})`,
      );
    }

    if (payload.shouldFail) {
      throw new Error('Simulated permanent job failure');
    }

    return {
      processedAt: new Date().toISOString(),
      sleepMs,
      message: 'Job completed successfully',
      input: payload,
      attempts: job.retryCount + 1,
    };
  }
}
