import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RedisJobQueue } from '../../src/queue/redis-job.queue';
import { RedisJobRepository } from '../../src/repositories/redis-job.repository';
import { FakeRedis } from '../helpers/fake-redis';
import { testConfig } from '../helpers/test-config';

describe('RedisJobRepository', () => {
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

  async function claimJob(jobId: string): Promise<void> {
    await queue.enqueue(jobId);
    const claimed = await queue.claim(1000);
    expect(claimed).toBe(jobId);
  }

  it('creates a job with queued status and persists it in Redis', async () => {
    const job = await repository.create({ sleepMs: 100, data: { task: 'redis' } });

    expect(job.status).toBe('queued');
    expect(job.retryCount).toBe(0);
    expect(job.maxRetries).toBe(testConfig.MAX_JOB_RETRIES);

    const stored = await repository.findById(job.id);
    expect(stored).toEqual(job);
  });

  it('returns null for unknown job ids', async () => {
    expect(await repository.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('rejects markRunning when the job is not queued', async () => {
    const job = await repository.create({ sleepMs: 10 });
    await claimJob(job.id);
    await repository.markRunning(job.id);

    const secondClaim = await repository.markRunning(job.id);
    expect(secondClaim).toBeNull();
  });

  it('rejects markRunning when the job is not in-flight', async () => {
    const job = await repository.create({ sleepMs: 10 });

    const running = await repository.markRunning(job.id);
    expect(running).toBeNull();
  });

  it('rejects markCompleted when the job is not running', async () => {
    const job = await repository.create({ sleepMs: 10 });

    const result = await repository.markCompleted(job.id, {
      processedAt: new Date().toISOString(),
      sleepMs: 10,
      message: 'done',
      input: job.payload,
      attempts: 1,
    });

    expect(result).toBeNull();
  });

  it('rejects markFailed when the job is not running', async () => {
    const job = await repository.create({ sleepMs: 10 });

    const result = await repository.markFailed(job.id, 'too early');
    expect(result).toBeNull();
  });

  it('transitions a job through queued → running → completed', async () => {
    const job = await repository.create({ sleepMs: 10 });
    await claimJob(job.id);

    const running = await repository.markRunning(job.id);
    expect(running?.status).toBe('running');
    expect(running?.startedAt).toBeTruthy();

    const completed = await repository.markCompleted(job.id, {
      processedAt: new Date().toISOString(),
      sleepMs: 10,
      message: 'done',
      input: job.payload,
      attempts: 1,
    });

    expect(completed?.status).toBe('completed');
    expect(completed?.result?.message).toBe('done');
    expect(completed?.completedAt).toBeTruthy();
  });

  it('requeues a running job and increments retryCount', async () => {
    const job = await repository.create({ sleepMs: 10 });
    await claimJob(job.id);
    await repository.markRunning(job.id);

    const requeued = await repository.requeueForRetry(job.id, 'transient outage');

    expect(requeued?.status).toBe('queued');
    expect(requeued?.retryCount).toBe(1);
    expect(requeued?.error).toBe('transient outage');
    expect(requeued?.startedAt).toBeNull();
  });

  it('returns null from requeueForRetry when max retries are exceeded', async () => {
    const config = { ...testConfig, MAX_JOB_RETRIES: 1 };
    repository = new RedisJobRepository(redis, config);
    queue = new RedisJobQueue(redis, config.VISIBILITY_TIMEOUT_MS);

    const job = await repository.create({ sleepMs: 10 });
    await claimJob(job.id);
    await repository.markRunning(job.id);
    await repository.requeueForRetry(job.id, 'retry 1');
    await claimJob(job.id);
    await repository.markRunning(job.id);

    const exhausted = await repository.requeueForRetry(job.id, 'retry 2');
    expect(exhausted).toBeNull();
  });

  it('returns null from requeueForRetry when the job is not running', async () => {
    const job = await repository.create({ sleepMs: 10 });

    const result = await repository.requeueForRetry(job.id, 'not running yet');
    expect(result).toBeNull();
  });

  it('throws when stored job JSON is corrupted', async () => {
    const job = await repository.create({ sleepMs: 10 });
    redis.corrupt(`job:${job.id}`, '{not-valid-json');

    await expect(repository.findById(job.id)).rejects.toThrow();
  });

  it('propagates Redis errors on create', async () => {
    redis.failOn('set');

    await expect(repository.create({ sleepMs: 10 })).rejects.toThrow(
      'Simulated Redis failure on set',
    );
  });

  it('propagates Redis errors on findById', async () => {
    const job = await repository.create({ sleepMs: 10 });
    redis.failOn('get');

    await expect(repository.findById(job.id)).rejects.toThrow(
      'Simulated Redis failure on get',
    );
  });
});
