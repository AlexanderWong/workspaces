/**
 * Job processor — executes the actual work for a queued job.
 *
 * MockJobProcessor simulates work with a sleep. Swap this implementation
 * (via the JobProcessor interface) for real workloads without changing workers.
 */
import type { Env } from '../config/env';
import type { JobPayload, JobResult } from '../types/job';

export interface JobProcessor {
  process(payload: JobPayload): Promise<JobResult>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockJobProcessor implements JobProcessor {
  constructor(private readonly config: Pick<Env, 'DEFAULT_JOB_SLEEP_MS'>) {}

  async process(payload: JobPayload): Promise<JobResult> {
    const sleepMs = payload.sleepMs ?? this.config.DEFAULT_JOB_SLEEP_MS;
    await sleep(sleepMs);

    if (payload.shouldFail) {
      throw new Error('Simulated job failure');
    }

    return {
      processedAt: new Date().toISOString(),
      sleepMs,
      message: 'Job completed successfully',
      input: payload,
    };
  }
}
