import type { RedisClient } from '../../src/types/redis-client';

type RedisOp = 'get' | 'set' | 'lpush' | 'brpop' | 'ping' | 'quit';

/**
 * In-memory Redis stand-in for unit tests.
 * Supports injected failures to exercise error paths without a live Redis server.
 */
export class FakeRedis implements RedisClient {
  private readonly strings = new Map<string, string>();
  private readonly lists = new Map<string, string[]>();
  private readonly failingOps = new Set<RedisOp>();

  failOn(...ops: RedisOp[]): this {
    for (const op of ops) {
      this.failingOps.add(op);
    }
    return this;
  }

  corrupt(key: string, raw: string): this {
    this.strings.set(key, raw);
    return this;
  }

  async get(key: string): Promise<string | null> {
    this.assertOp('get');
    return this.strings.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.assertOp('set');
    this.strings.set(key, value);
    return 'OK';
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    this.assertOp('lpush');
    const list = this.lists.get(key) ?? [];
    this.lists.set(key, [...values, ...list]);
    return this.lists.get(key)!.length;
  }

  async brpop(key: string, timeout: number): Promise<[string, string] | null> {
    this.assertOp('brpop');
    const list = this.lists.get(key);
    if (!list || list.length === 0) {
      // Simulate Redis blocking wait so workers do not spin the event loop
      await new Promise((resolve) => setTimeout(resolve, timeout * 1000));
      return null;
    }

    const value = list.pop()!;
    if (list.length === 0) {
      this.lists.delete(key);
    } else {
      this.lists.set(key, list);
    }

    return [key, value];
  }

  async ping(): Promise<string> {
    this.assertOp('ping');
    return 'PONG';
  }

  async quit(): Promise<'OK'> {
    this.assertOp('quit');
    return 'OK';
  }

  clear(): void {
    this.strings.clear();
    this.lists.clear();
    this.failingOps.clear();
  }

  private assertOp(op: RedisOp): void {
    if (this.failingOps.has(op)) {
      throw new Error(`Simulated Redis failure on ${op}`);
    }
  }
}
