import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RedisJobQueue } from '../../src/queue/redis-job.queue';
import { FakeRedis } from '../helpers/fake-redis';

describe('RedisJobQueue', () => {
  let redis: FakeRedis;
  let queue: RedisJobQueue;

  beforeEach(() => {
    redis = new FakeRedis();
    queue = new RedisJobQueue(redis);
  });

  afterEach(() => {
    redis.clear();
  });

  it('dequeues jobs in FIFO order', async () => {
    await queue.enqueue('job-1');
    await queue.enqueue('job-2');
    await queue.enqueue('job-3');

    expect(await queue.dequeue(1000)).toBe('job-1');
    expect(await queue.dequeue(1000)).toBe('job-2');
    expect(await queue.dequeue(1000)).toBe('job-3');
  });

  it('returns null when the queue is empty', async () => {
    expect(await queue.dequeue(1000)).toBeNull();
  });

  it('delivers each job id to only one consumer', async () => {
    await queue.enqueue('job-a');
    await queue.enqueue('job-b');

    const [first, second, third] = await Promise.all([
      queue.dequeue(1000),
      queue.dequeue(1000),
      queue.dequeue(1000),
    ]);

    const dequeued = [first, second, third].filter(Boolean);
    expect(dequeued).toHaveLength(2);
    expect(dequeued).toContain('job-a');
    expect(dequeued).toContain('job-b');
  });

  it('propagates Redis errors on enqueue', async () => {
    redis.failOn('lpush');

    await expect(queue.enqueue('job-1')).rejects.toThrow('Simulated Redis failure on lpush');
  });

  it('propagates Redis errors on dequeue', async () => {
    await queue.enqueue('job-1');
    redis.failOn('brpop');

    await expect(queue.dequeue(1000)).rejects.toThrow('Simulated Redis failure on brpop');
  });
});
