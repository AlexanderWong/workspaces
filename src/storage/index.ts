/**
 * Storage factory — selects in-memory (local dev) or Redis (production)
 * based on whether REDIS_URL is configured.
 */
import type { Env } from '../config/env';
import { InMemoryJobQueue } from '../queue/in-memory-job.queue';
import { RedisJobQueue } from '../queue/redis-job.queue';
import { InMemoryJobRepository } from '../repositories/in-memory-job.repository';
import { RedisJobRepository } from '../repositories/redis-job.repository';
import type { JobStorage } from '../types/job';
import { createRedisClient } from './create-redis-client';

export async function createJobStorage(config: Env): Promise<JobStorage> {
  if (config.REDIS_URL) {
    const redis = await createRedisClient(config.REDIS_URL);

    return {
      repository: new RedisJobRepository(redis, config),
      queue: new RedisJobQueue(redis, config.VISIBILITY_TIMEOUT_MS),
      close: async () => {
        await redis.quit();
      },
    };
  }

  return {
    repository: new InMemoryJobRepository(config),
    queue: new InMemoryJobQueue(),
    close: async () => {},
  };
}
