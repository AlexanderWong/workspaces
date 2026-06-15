/**
 * Redis-backed job store for production deployments where the API and
 * worker processes run separately and share state via Redis.
 *
 * State transitions use Lua scripts for atomic read-check-write.
 */
import { randomUUID } from 'crypto';
import {
  MARK_COMPLETED_SCRIPT,
  MARK_FAILED_SCRIPT,
  MARK_RUNNING_SCRIPT,
  REQUEUE_FOR_RETRY_SCRIPT,
} from '../redis/lua-scripts';
import { DLQ_KEY, INFLIGHT_KEY, jobKey } from '../redis/keys';
import type { RedisClient } from '../types/redis-client';
import type { Env } from '../config/env';
import type { Job, JobPayload, JobRepository, JobResult } from '../types/job';

export class RedisJobRepository implements JobRepository {
  constructor(
    private readonly redis: RedisClient,
    private readonly config: Pick<Env, 'MAX_JOB_RETRIES' | 'VISIBILITY_TIMEOUT_MS'>,
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
    const now = new Date().toISOString();
    const visibilityDeadline = String(Date.now() + this.config.VISIBILITY_TIMEOUT_MS);
    const raw = await this.redis.eval(
      MARK_RUNNING_SCRIPT,
      2,
      jobKey(id),
      INFLIGHT_KEY,
      now,
      visibilityDeadline,
    );

    return typeof raw === 'string' ? (JSON.parse(raw) as Job) : null;
  }

  async markCompleted(id: string, result: JobResult): Promise<Job | null> {
    const now = new Date().toISOString();
    const raw = await this.redis.eval(
      MARK_COMPLETED_SCRIPT,
      2,
      jobKey(id),
      INFLIGHT_KEY,
      JSON.stringify(result),
      now,
    );

    return typeof raw === 'string' ? (JSON.parse(raw) as Job) : null;
  }

  async markFailed(id: string, error: string): Promise<Job | null> {
    const now = new Date().toISOString();
    const raw = await this.redis.eval(
      MARK_FAILED_SCRIPT,
      3,
      jobKey(id),
      INFLIGHT_KEY,
      DLQ_KEY,
      error,
      now,
    );

    return typeof raw === 'string' ? (JSON.parse(raw) as Job) : null;
  }

  async requeueForRetry(id: string, error: string): Promise<Job | null> {
    const now = new Date().toISOString();
    const raw = await this.redis.eval(
      REQUEUE_FOR_RETRY_SCRIPT,
      2,
      jobKey(id),
      INFLIGHT_KEY,
      error,
      now,
    );

    return typeof raw === 'string' ? (JSON.parse(raw) as Job) : null;
  }
}
