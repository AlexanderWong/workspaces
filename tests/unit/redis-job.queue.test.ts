import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RedisJobQueue } from '../../src/queue/redis-job.queue';
import { RedisJobRepository } from '../../src/repositories/redis-job.repository';
import { DLQ_KEY, FakeRedis, INFLIGHT_KEY, QUEUE_KEY } from '../helpers/fake-redis';
import { testConfig } from '../helpers/test-config';

describe('RedisJobQueue', () => {
  let redis: FakeRedis;
  let repository: RedisJobRepository;
  let queue: RedisJobQueue;

  beforeEach(() => {
    redis = new FakeRedis();
    repository = new RedisJobRepository(redis, testConfig);
    queue = new RedisJobQueue(redis, testConfig.VISIBILITY_TIMEOUT_MS);
  });

  afterEach(() => {
    redis.clear();
  });

  it('claims jobs in FIFO order', async () => {
    const first = await repository.create({ sleepMs: 10 });
    const second = await repository.create({ sleepMs: 10 });
    const third = await repository.create({ sleepMs: 10 });

    await queue.enqueue(first.id);
    await queue.enqueue(second.id);
    await queue.enqueue(third.id);

    expect(await queue.claim(1000)).toBe(first.id);
    expect(await queue.claim(1000)).toBe(second.id);
    expect(await queue.claim(1000)).toBe(third.id);
  });

  it('registers claimed jobs in the in-flight set', async () => {
    const job = await repository.create({ sleepMs: 10 });
    await queue.enqueue(job.id);

    await queue.claim(1000);

    expect(redis.getSortedSet(INFLIGHT_KEY)).toHaveLength(1);
    expect(redis.getSortedSet(INFLIGHT_KEY)[0]?.member).toBe(job.id);
  });

  it('returns null when the queue is empty', async () => {
    expect(await queue.claim(100)).toBeNull();
  });

  it('delivers each job id to only one consumer', async () => {
    const first = await repository.create({ sleepMs: 10 });
    const second = await repository.create({ sleepMs: 10 });

    await queue.enqueue(first.id);
    await queue.enqueue(second.id);

    const claims = await Promise.all([
      queue.claim(1000),
      queue.claim(1000),
      queue.claim(1000),
    ]);

    const claimed = claims.filter(Boolean);
    expect(claimed).toHaveLength(2);
    expect(claimed).toContain(first.id);
    expect(claimed).toContain(second.id);
  });

  it('requeues expired in-flight jobs via reapExpired', async () => {
    const shortVisibilityConfig = { ...testConfig, VISIBILITY_TIMEOUT_MS: 1 };
    queue = new RedisJobQueue(redis, shortVisibilityConfig.VISIBILITY_TIMEOUT_MS);

    const job = await repository.create({ sleepMs: 10 });
    await queue.enqueue(job.id);
    await queue.claim(1000);

    await new Promise((resolve) => setTimeout(resolve, 5));

    const requeued = await queue.reapExpired();
    expect(requeued).toBe(1);
    expect(redis.getList(QUEUE_KEY)).toContain(job.id);
    expect(redis.getSortedSet(INFLIGHT_KEY)).toHaveLength(0);
  });

  it('nacks a running job back to the queue', async () => {
    const job = await repository.create({ sleepMs: 10 });
    await queue.enqueue(job.id);
    const claimedId = await queue.claim(1000);
    expect(claimedId).toBe(job.id);
    await repository.markRunning(job.id);

    await queue.nack(job.id);

    expect(redis.getList(QUEUE_KEY)).toContain(job.id);
    expect(redis.getSortedSet(INFLIGHT_KEY)).toHaveLength(0);

    const stored = await repository.findById(job.id);
    expect(stored?.status).toBe('queued');
    expect(stored?.startedAt).toBeNull();
  });

  it('propagates Redis errors on enqueue', async () => {
    redis.failOn('lpush');

    await expect(queue.enqueue('job-1')).rejects.toThrow('Simulated Redis failure on lpush');
  });

  it('propagates Redis errors on claim', async () => {
    const job = await repository.create({ sleepMs: 10 });
    await queue.enqueue(job.id);
    redis.failOn('eval');

    await expect(queue.claim(1000)).rejects.toThrow('Simulated Redis failure on eval');
  });
});

describe('RedisJobRepository DLQ', () => {
  let redis: FakeRedis;
  let repository: RedisJobRepository;

  beforeEach(() => {
    redis = new FakeRedis();
    repository = new RedisJobRepository(redis, testConfig);
  });

  afterEach(() => {
    redis.clear();
  });

  it('pushes permanently failed jobs to the dead-letter queue', async () => {
    const queue = new RedisJobQueue(redis, testConfig.VISIBILITY_TIMEOUT_MS);
    const job = await repository.create({ sleepMs: 10 });
    await queue.enqueue(job.id);
    await queue.claim(1000);
    await repository.markRunning(job.id);

    await repository.markFailed(job.id, 'permanent failure');

    expect(redis.getList(DLQ_KEY)).toEqual([job.id]);
  });
});
