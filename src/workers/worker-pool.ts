/**
 * Background worker pool — pulls job IDs from the queue and processes them.
 *
 * Spawns WORKER_CONCURRENCY independent async loops. Each loop:
 *   claim → markRunning → process → markCompleted | requeue (retry) | markFailed
 *
 * A reaper loop requeues jobs whose visibility deadline expired (crash recovery).
 * On shutdown, in-flight jobs are nacked back to the queue after a drain window.
 */
import { isTransientProcessingError } from '../errors/processing-error';
import type { Env } from '../config/env';
import type { JobProcessor } from './job.processor';
import type { JobQueue, JobRepository } from '../types/job';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WorkerPool {
  private running = false;
  private readonly workerTasks: Promise<void>[] = [];
  private readonly activeJobs = new Map<number, string | null>();
  private reaperTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly queue: JobQueue,
    private readonly repository: JobRepository,
    private readonly processor: JobProcessor,
    private readonly config: Pick<
      Env,
      | 'WORKER_CONCURRENCY'
      | 'WORKER_POLL_INTERVAL_MS'
      | 'RETRY_BACKOFF_MS'
      | 'REAPER_INTERVAL_MS'
      | 'SHUTDOWN_DRAIN_MS'
    >,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    for (let index = 0; index < this.config.WORKER_CONCURRENCY; index += 1) {
      this.activeJobs.set(index, null);
      this.workerTasks.push(this.runWorker(index));
    }

    this.reaperTimer = setInterval(() => {
      void this.queue.reapExpired();
    }, this.config.REAPER_INTERVAL_MS);
    this.reaperTimer.unref();
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }

    await Promise.race([
      Promise.allSettled(this.workerTasks),
      sleep(this.config.SHUTDOWN_DRAIN_MS),
    ]);

    await this.nackActiveJobs();
  }

  /** Continuous loop — exits when stop() sets running = false */
  private async runWorker(workerId: number): Promise<void> {
    while (this.running) {
      const jobId = await this.queue.claim(this.config.WORKER_POLL_INTERVAL_MS);
      if (!jobId) {
        await sleep(this.config.WORKER_POLL_INTERVAL_MS);
        continue;
      }

      await this.processJob(jobId, workerId);
    }
  }

  private async processJob(jobId: string, workerId: number): Promise<void> {
    this.activeJobs.set(workerId, jobId);

    const job = await this.repository.markRunning(jobId);
    if (!job) {
      this.activeJobs.set(workerId, null);
      return; // already claimed or invalid state — skip
    }

    try {
      const result = await this.processor.process(job);
      await this.repository.markCompleted(jobId, result);
    } catch (error) {
      if (isTransientProcessingError(error)) {
        const requeued = await this.repository.requeueForRetry(jobId, error.message);
        if (requeued) {
          console.warn(
            `Worker ${workerId} transient failure on job ${jobId} — retry ${requeued.retryCount}/${requeued.maxRetries}`,
          );
          await sleep(this.config.RETRY_BACKOFF_MS);
          await this.queue.enqueue(jobId);
          return;
        }
      }

      const message = error instanceof Error ? error.message : 'Unknown processing error';
      console.error(`Worker ${workerId} failed job ${jobId}:`, message);
      await this.repository.markFailed(jobId, message);
    } finally {
      this.activeJobs.set(workerId, null);
    }
  }

  private async nackActiveJobs(): Promise<void> {
    const inFlight = [...this.activeJobs.values()].filter((jobId): jobId is string => Boolean(jobId));
    await Promise.all(inFlight.map((jobId) => this.queue.nack(jobId)));
  }
}
