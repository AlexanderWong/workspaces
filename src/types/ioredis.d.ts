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
    brpop(key: string, timeout: number): Promise<[string, string] | null>;
    ping(): Promise<string>;
    quit(): Promise<'OK'>;
  }
}
