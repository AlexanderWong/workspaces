/** Redis FIFO queue — shared between API (enqueue) and worker (dequeue) processes. */
import type { RedisClient } from '../types/redis-client';
import type { JobQueue } from '../types/job';

const QUEUE_KEY = 'jobs:queue';

export class RedisJobQueue implements JobQueue {
  constructor(private readonly redis: RedisClient) {}

  async enqueue(jobId: string): Promise<void> {
    await this.redis.lpush(QUEUE_KEY, jobId);
  }

  async dequeue(timeoutMs: number): Promise<string | null> {
    const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const result = await this.redis.brpop(QUEUE_KEY, timeoutSeconds);
    return result ? result[1] : null;
  }

  size(): number {
    // Best-effort; Redis LLEN is async but interface is sync for in-memory parity
    return 0;
  }
}
