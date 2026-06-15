import type { RedisClient } from '../types/redis-client';

interface RedisConnectOptions {
  maxRetriesPerRequest: null;
  connectTimeout: number;
  retryStrategy: () => null;
}

const REDIS_OPTIONS: RedisConnectOptions = {
  maxRetriesPerRequest: null,
  connectTimeout: 2000,
  retryStrategy: () => null,
};

/** Creates a connected Redis client — sole module that loads the ioredis package. */
export async function createRedisClient(url: string): Promise<RedisClient> {
  const { default: IORedis } = await import('ioredis');
  const client = new IORedis(url, REDIS_OPTIONS) as RedisClient;
  await client.ping();
  return client;
}
