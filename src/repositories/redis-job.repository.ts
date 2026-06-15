/**
 * Redis-backed job store for production deployments where the API and
 * worker processes run separately and share state via Redis.
 */
import { randomUUID } from 'crypto';
import type { RedisClient } from '../types/redis-client';
import type { Env } from '../config/env';
import type { Job, JobPayload, JobRepository, JobResult } from '../types/job';

const jobKey = (id: string): string => `job:${id}`;

export class RedisJobRepository implements JobRepository {
  constructor(
    private readonly redis: RedisClient,
    private readonly config: Pick<Env, 'MAX_JOB_RETRIES'>,
  ) {}

  async create(payload: JobPayload): Promise<Job> {
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

    await this.redis.set(jobKey(job.id), JSON.stringify(job));
    return job;
  }

  async findById(id: string): Promise<Job | null> {
    const raw = await this.redis.get(jobKey(id));
    return raw ? (JSON.parse(raw) as Job) : null;
  }

  async markRunning(id: string): Promise<Job | null> {
    return this.transition(id, 'queued', (job) => ({
      ...job,
      status: 'running',
      startedAt: new Date().toISOString(),
    }));
  }

  async markCompleted(id: string, result: JobResult): Promise<Job | null> {
    return this.transition(id, 'running', (job) => ({
      ...job,
      status: 'completed',
      result,
      error: null,
      completedAt: new Date().toISOString(),
    }));
  }

  async markFailed(id: string, error: string): Promise<Job | null> {
    return this.transition(id, 'running', (job) => ({
      ...job,
      status: 'failed',
      error,
      completedAt: new Date().toISOString(),
    }));
  }

  async requeueForRetry(id: string, error: string): Promise<Job | null> {
    const job = await this.findById(id);
    if (!job || job.status !== 'running') {
      return null;
    }

    const nextRetryCount = job.retryCount + 1;
    if (nextRetryCount > job.maxRetries) {
      return null;
    }

    const updated: Job = {
      ...job,
      status: 'queued',
      error,
      retryCount: nextRetryCount,
      updatedAt: new Date().toISOString(),
      startedAt: null,
    };

    await this.redis.set(jobKey(id), JSON.stringify(updated));
    return updated;
  }

  /** Read-modify-write with status guard to prevent invalid transitions */
  private async transition(
    id: string,
    expectedStatus: Job['status'],
    transform: (job: Job) => Job,
  ): Promise<Job | null> {
    const job = await this.findById(id);
    if (!job || job.status !== expectedStatus) {
      return null;
    }

    const updated: Job = {
      ...transform(job),
      updatedAt: new Date().toISOString(),
    };

    await this.redis.set(jobKey(id), JSON.stringify(updated));
    return updated;
  }
}
