/**
 * In-memory job store with mutex-protected reads and writes.
 *
 * HTTP handlers and workers share this store concurrently. Every operation
 * runs inside AsyncMutex.runExclusive() to prevent interleaved updates.
 * Status guards (e.g. only queued → running) prevent invalid transitions.
 */
import { randomUUID } from 'crypto';
import { AsyncMutex } from '../concurrency/async-mutex';
import type { Env } from '../config/env';
import type { Job, JobPayload, JobRepository, JobResult } from '../types/job';

export class InMemoryJobRepository implements JobRepository {
  private readonly jobs = new Map<string, Job>();
  private readonly mutex = new AsyncMutex();

  constructor(private readonly config: Pick<Env, 'MAX_JOB_RETRIES'>) {}

  async create(payload: JobPayload): Promise<Job> {
    return this.mutex.runExclusive(() => {
      const now = new Date().toISOString();
      const job: Job = {
        id: randomUUID(),
        status: 'queued',
        payload,
        result: null,
        error: null,
        retryCount: 0,
        maxRetries: this.config.MAX_JOB_RETRIES,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
      };

      this.jobs.set(job.id, job);
      return job;
    });
  }

  async findById(id: string): Promise<Job | null> {
    return this.mutex.runExclusive(() => this.jobs.get(id) ?? null);
  }

  /** Returns null if the job is not in queued state (prevents double-processing). */
  async markRunning(id: string): Promise<Job | null> {
    return this.mutex.runExclusive(() => {
      const job = this.jobs.get(id);
      if (!job || job.status !== 'queued') {
        return null;
      }

      const now = new Date().toISOString();
      const updated: Job = {
        ...job,
        status: 'running',
        updatedAt: now,
        startedAt: now,
      };

      this.jobs.set(id, updated);
      return updated;
    });
  }

  async markCompleted(id: string, result: JobResult): Promise<Job | null> {
    return this.mutex.runExclusive(() => {
      const job = this.jobs.get(id);
      if (!job || job.status !== 'running') {
        return null;
      }

      const now = new Date().toISOString();
      const updated: Job = {
        ...job,
        status: 'completed',
        result,
        error: null,
        updatedAt: now,
        completedAt: now,
      };

      this.jobs.set(id, updated);
      return updated;
    });
  }

  async markFailed(id: string, error: string): Promise<Job | null> {
    return this.mutex.runExclusive(() => {
      const job = this.jobs.get(id);
      if (!job || job.status !== 'running') {
        return null;
      }

      const now = new Date().toISOString();
      const updated: Job = {
        ...job,
        status: 'failed',
        error,
        updatedAt: now,
        completedAt: now,
      };

      this.jobs.set(id, updated);
      return updated;
    });
  }

  /**
   * Returns the requeued job, or null if max retries exceeded.
   * Caller should markFailed when null is returned.
   */
  async requeueForRetry(id: string, error: string): Promise<Job | null> {
    return this.mutex.runExclusive(() => {
      const job = this.jobs.get(id);
      if (!job || job.status !== 'running') {
        return null;
      }

      const nextRetryCount = job.retryCount + 1;
      if (nextRetryCount > job.maxRetries) {
        return null;
      }

      const now = new Date().toISOString();
      const updated: Job = {
        ...job,
        status: 'queued',
        error,
        retryCount: nextRetryCount,
        updatedAt: now,
        startedAt: null,
      };

      this.jobs.set(id, updated);
      return updated;
    });
  }

  /** Test helper to reset state between tests */
  clear(): void {
    this.jobs.clear();
  }
}
