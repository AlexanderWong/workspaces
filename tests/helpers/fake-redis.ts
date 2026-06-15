import type { RedisClient } from '../../src/types/redis-client';
import {
  CLAIM_JOB_SCRIPT,
  MARK_COMPLETED_SCRIPT,
  MARK_FAILED_SCRIPT,
  MARK_RUNNING_SCRIPT,
  NACK_JOB_SCRIPT,
  REAP_EXPIRED_SCRIPT,
  REQUEUE_FOR_RETRY_SCRIPT,
} from '../../src/redis/lua-scripts';
import { DLQ_KEY, INFLIGHT_KEY, QUEUE_KEY, jobKey } from '../../src/redis/keys';

type RedisOp =
  | 'get'
  | 'set'
  | 'lpush'
  | 'rpop'
  | 'zadd'
  | 'zrem'
  | 'zscore'
  | 'zrangebyscore'
  | 'eval'
  | 'ping'
  | 'quit';

type SortedSetEntry = { member: string; score: number };

/**
 * In-memory Redis stand-in for unit tests.
 * Implements Lua scripts in TypeScript so queue/repository tests stay hermetic.
 */
export class FakeRedis implements RedisClient {
  private readonly strings = new Map<string, string>();
  private readonly lists = new Map<string, string[]>();
  private readonly sortedSets = new Map<string, SortedSetEntry[]>();
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

  async rpop(key: string): Promise<string | null> {
    this.assertOp('rpop');
    const list = this.lists.get(key);
    if (!list || list.length === 0) {
      return null;
    }

    const value = list.pop()!;
    if (list.length === 0) {
      this.lists.delete(key);
    } else {
      this.lists.set(key, list);
    }

    return value;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    this.assertOp('zadd');
    const entries = this.sortedSets.get(key) ?? [];
    const existingIndex = entries.findIndex((entry) => entry.member === member);
    if (existingIndex >= 0) {
      entries[existingIndex] = { member, score };
    } else {
      entries.push({ member, score });
    }
    this.sortedSets.set(key, entries);
    return 1;
  }

  async zrem(key: string, member: string): Promise<number> {
    this.assertOp('zrem');
    const entries = this.sortedSets.get(key) ?? [];
    const next = entries.filter((entry) => entry.member !== member);
    if (next.length === 0) {
      this.sortedSets.delete(key);
    } else {
      this.sortedSets.set(key, next);
    }
    return entries.length - next.length;
  }

  async zscore(key: string, member: string): Promise<string | null> {
    this.assertOp('zscore');
    const entry = (this.sortedSets.get(key) ?? []).find((item) => item.member === member);
    return entry ? String(entry.score) : null;
  }

  async zrangebyscore(
    key: string,
    min: string | number,
    max: string | number,
  ): Promise<string[]> {
    this.assertOp('zrangebyscore');
    const minScore = min === '-inf' ? Number.NEGATIVE_INFINITY : Number(min);
    const maxScore = Number(max);
    return (this.sortedSets.get(key) ?? [])
      .filter((entry) => entry.score >= minScore && entry.score <= maxScore)
      .sort((left, right) => left.score - right.score)
      .map((entry) => entry.member);
  }

  async eval(
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<string | number | null> {
    this.assertOp('eval');
    const keys = args.slice(0, numKeys);
    const argv = args.slice(numKeys);

    if (script === CLAIM_JOB_SCRIPT) {
      return this.runClaim(keys[0], keys[1], keys[2], argv[0]);
    }
    if (script === MARK_RUNNING_SCRIPT) {
      return this.runMarkRunning(keys[0], keys[1], argv[0], argv[1]);
    }
    if (script === MARK_COMPLETED_SCRIPT) {
      return this.runMarkCompleted(keys[0], keys[1], argv[0], argv[1]);
    }
    if (script === MARK_FAILED_SCRIPT) {
      return this.runMarkFailed(keys[0], keys[1], keys[2], argv[0], argv[1]);
    }
    if (script === REQUEUE_FOR_RETRY_SCRIPT) {
      return this.runRequeueForRetry(keys[0], keys[1], argv[0], argv[1]);
    }
    if (script === NACK_JOB_SCRIPT) {
      return this.runNack(keys[0], keys[1], keys[2], argv[0], argv[1]);
    }
    if (script === REAP_EXPIRED_SCRIPT) {
      return this.runReapExpired(keys[0], keys[1], keys[2], argv[0], argv[1]);
    }

    throw new Error('Unsupported Lua script in FakeRedis');
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
    this.sortedSets.clear();
    this.failingOps.clear();
  }

  getList(key: string): string[] {
    return [...(this.lists.get(key) ?? [])];
  }

  getSortedSet(key: string): SortedSetEntry[] {
    return [...(this.sortedSets.get(key) ?? [])];
  }

  private async runClaim(
    queueKey: string,
    jobKeyPrefix: string,
    inflightKey: string,
    visibilityDeadline: string,
  ): Promise<string | null> {
    const jobId = await this.rpop(queueKey);
    if (!jobId) {
      return null;
    }

    const raw = await this.get(`${jobKeyPrefix}${jobId}`);
    if (!raw) {
      return null;
    }

    const job = JSON.parse(raw) as { status: string };
    if (job.status !== 'queued') {
      return null;
    }

    await this.zadd(inflightKey, Number(visibilityDeadline), jobId);
    return jobId;
  }

  private async runMarkRunning(
    key: string,
    inflightKey: string,
    now: string,
    visibilityDeadline: string,
  ): Promise<string | null> {
    const raw = await this.get(key);
    if (!raw) {
      return null;
    }

    const job = JSON.parse(raw) as {
      id: string;
      status: string;
      startedAt: string | null;
      updatedAt: string;
    };

    if (job.status !== 'queued') {
      return null;
    }

    if ((await this.zscore(inflightKey, job.id)) === null) {
      return null;
    }

    job.status = 'running';
    job.startedAt = now;
    job.updatedAt = now;
    await this.set(key, JSON.stringify(job));
    await this.zadd(inflightKey, Number(visibilityDeadline), job.id);
    return JSON.stringify(job);
  }

  private async runMarkCompleted(
    key: string,
    inflightKey: string,
    resultJson: string,
    now: string,
  ): Promise<string | null> {
    const raw = await this.get(key);
    if (!raw) {
      return null;
    }

    const job = JSON.parse(raw) as {
      id: string;
      status: string;
      result: unknown;
      error: string | null;
      completedAt: string | null;
      updatedAt: string;
    };

    if (job.status !== 'running') {
      return null;
    }

    job.status = 'completed';
    job.result = JSON.parse(resultJson);
    job.error = null;
    job.completedAt = now;
    job.updatedAt = now;
    await this.set(key, JSON.stringify(job));
    await this.zrem(inflightKey, job.id);
    return JSON.stringify(job);
  }

  private async runMarkFailed(
    key: string,
    inflightKey: string,
    dlqKey: string,
    error: string,
    now: string,
  ): Promise<string | null> {
    const raw = await this.get(key);
    if (!raw) {
      return null;
    }

    const job = JSON.parse(raw) as {
      id: string;
      status: string;
      error: string | null;
      completedAt: string | null;
      updatedAt: string;
    };

    if (job.status !== 'running') {
      return null;
    }

    job.status = 'failed';
    job.error = error;
    job.completedAt = now;
    job.updatedAt = now;
    await this.set(key, JSON.stringify(job));
    await this.zrem(inflightKey, job.id);
    await this.lpush(dlqKey, job.id);
    return JSON.stringify(job);
  }

  private async runRequeueForRetry(
    key: string,
    inflightKey: string,
    error: string,
    now: string,
  ): Promise<string | null> {
    const raw = await this.get(key);
    if (!raw) {
      return null;
    }

    const job = JSON.parse(raw) as {
      id: string;
      status: string;
      error: string | null;
      retryCount: number;
      maxRetries: number;
      startedAt: string | null;
      updatedAt: string;
    };

    if (job.status !== 'running') {
      return null;
    }

    const nextRetryCount = job.retryCount + 1;
    if (nextRetryCount > job.maxRetries) {
      return null;
    }

    job.status = 'queued';
    job.error = error;
    job.retryCount = nextRetryCount;
    job.updatedAt = now;
    job.startedAt = null;
    await this.set(key, JSON.stringify(job));
    await this.zrem(inflightKey, job.id);
    return JSON.stringify(job);
  }

  private async runNack(
    key: string,
    inflightKey: string,
    queueKey: string,
    jobId: string,
    now: string,
  ): Promise<number> {
    const raw = await this.get(key);
    if (raw) {
      const job = JSON.parse(raw) as {
        id: string;
        status: string;
        startedAt: string | null;
        updatedAt: string;
      };

      if (job.status === 'running') {
        job.status = 'queued';
        job.startedAt = null;
        job.updatedAt = now;
        await this.set(key, JSON.stringify(job));
        await this.lpush(queueKey, job.id);
      }
    }

    await this.zrem(inflightKey, jobId);
    return 1;
  }

  private async runReapExpired(
    inflightKey: string,
    jobKeyPrefix: string,
    queueKey: string,
    now: string,
    timestamp: string,
  ): Promise<number> {
    const expired = await this.zrangebyscore(inflightKey, '-inf', now);
    let requeued = 0;

    for (const jobId of expired) {
      const raw = await this.get(`${jobKeyPrefix}${jobId}`);
      if (raw) {
        const job = JSON.parse(raw) as {
          status: string;
          startedAt: string | null;
          updatedAt: string;
        };

        if (job.status === 'running' || job.status === 'queued') {
          job.status = 'queued';
          job.startedAt = null;
          job.updatedAt = timestamp;
          await this.set(`${jobKeyPrefix}${jobId}`, JSON.stringify(job));
          await this.lpush(queueKey, jobId);
          requeued += 1;
        }
      }

      await this.zrem(inflightKey, jobId);
    }

    return requeued;
  }

  private assertOp(op: RedisOp): void {
    if (this.failingOps.has(op)) {
      throw new Error(`Simulated Redis failure on ${op}`);
    }
  }
}

// Re-export keys for tests that assert on DLQ/inflight state.
export { DLQ_KEY, INFLIGHT_KEY, QUEUE_KEY, jobKey };
