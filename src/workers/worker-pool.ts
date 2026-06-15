import type { Env } from '../config/env';
import type { JobProcessor } from './job.processor';
import type { JobQueue, JobRepository } from '../types/job';

export class WorkerPool {
  private running = false;
  private readonly workerTasks: Promise<void>[] = [];

  constructor(
    private readonly queue: JobQueue,
    private readonly repository: JobRepository,
    private readonly processor: JobProcessor,
    private readonly config: Pick<Env, 'WORKER_CONCURRENCY' | 'WORKER_POLL_INTERVAL_MS'>,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    for (let index = 0; index < this.config.WORKER_CONCURRENCY; index += 1) {
      this.workerTasks.push(this.runWorker(index));
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.allSettled(this.workerTasks);
  }

  private async runWorker(workerId: number): Promise<void> {
    while (this.running) {
      const jobId = await this.queue.dequeue(this.config.WORKER_POLL_INTERVAL_MS);
      if (!jobId) {
        continue;
      }

      await this.processJob(jobId, workerId);
    }
  }

  private async processJob(jobId: string, workerId: number): Promise<void> {
    const job = await this.repository.markRunning(jobId);
    if (!job) {
      return;
    }

    try {
      const result = await this.processor.process(job.payload);
      await this.repository.markCompleted(jobId, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown processing error';
      console.error(`Worker ${workerId} failed job ${jobId}:`, message);
      await this.repository.markFailed(jobId, message);
    }
  }
}
