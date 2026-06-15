declare module 'ioredis' {
  import type { RedisClient } from './redis-client';

  interface RedisOptions {
    maxRetriesPerRequest?: null | number;
    connectTimeout?: number;
    retryStrategy?: () => number | null | undefined;
  }

  export default class Redis implements RedisClient {
    constructor(url: string, options?: RedisOptions);
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<'OK'>;
    lpush(key: string, ...values: string[]): Promise<number>;
    rpop(key: string): Promise<string | null>;
    zadd(key: string, score: number, member: string): Promise<number>;
    zrem(key: string, member: string): Promise<number>;
    zscore(key: string, member: string): Promise<string | null>;
    zrangebyscore(key: string, min: string | number, max: string | number): Promise<string[]>;
    eval(script: string, numKeys: number, ...args: string[]): Promise<string | number | null>;
    ping(): Promise<string>;
    quit(): Promise<'OK'>;
  }
}
