/**
 * Minimal Redis client surface used by repositories and queues.
 * Keeps storage implementations independent of the ioredis import path.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<'OK'>;
  lpush(key: string, ...values: string[]): Promise<number>;
  brpop(key: string, timeout: number): Promise<[string, string] | null>;
  ping(): Promise<string>;
  quit(): Promise<'OK'>;
}
