/** Production-safe Redis FIFO queue with claim semantics and crash recovery. */
import {
  CLAIM_JOB_SCRIPT,
  NACK_JOB_SCRIPT,
  REAP_EXPIRED_SCRIPT,
} from '../redis/lua-scripts';
import { INFLIGHT_KEY, QUEUE_KEY, jobKey } from '../redis/keys';
import type { RedisClient } from '../types/redis-client';
import type { JobQueue } from '../types/job';

const JOB_KEY_PREFIX = 'job:';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RedisJobQueue implements JobQueue {
  constructor(
    private readonly redis: RedisClient,
    private readonly visibilityTimeoutMs: number,
  ) {}

  async enqueue(jobId: string): Promise<void> {
    await this.redis.lpush(QUEUE_KEY, jobId);
  }

  /**
   * Atomically removes the next queued job id and registers it in the
   * in-flight ZSET with a visibility deadline (non-destructive handoff).
   */
  async claim(timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const visibilityDeadline = String(Date.now() + this.visibilityTimeoutMs);
      const jobId = await this.redis.eval(
        CLAIM_JOB_SCRIPT,
        3,
        QUEUE_KEY,
        JOB_KEY_PREFIX,
        INFLIGHT_KEY,
        visibilityDeadline,
      );

      if (typeof jobId === 'string' && jobId.length > 0) {
        return jobId;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }

      await sleep(Math.min(50, remaining));
    }

    return null;
  }

  /** Requeue a running job during graceful shutdown. */
  async nack(jobId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.redis.eval(
      NACK_JOB_SCRIPT,
      3,
      jobKey(jobId),
      INFLIGHT_KEY,
      QUEUE_KEY,
      jobId,
      now,
    );
  }

  /** Requeue jobs whose visibility deadline has passed (worker crash recovery). */
  async reapExpired(): Promise<number> {
    const now = String(Date.now());
    const timestamp = new Date().toISOString();
    const result = await this.redis.eval(
      REAP_EXPIRED_SCRIPT,
      3,
      INFLIGHT_KEY,
      JOB_KEY_PREFIX,
      QUEUE_KEY,
      now,
      timestamp,
    );

    return typeof result === 'number' ? result : Number(result ?? 0);
  }

  size(): number {
    return 0;
  }
}
