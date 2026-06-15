import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryJobQueue } from '../../src/queue/in-memory-job.queue';
import { RedisJobQueue } from '../../src/queue/redis-job.queue';
import { InMemoryJobRepository } from '../../src/repositories/in-memory-job.repository';
import { RedisJobRepository } from '../../src/repositories/redis-job.repository';
import { MockJobProcessor } from '../../src/workers/job.processor';
import { WorkerPool } from '../../src/workers/worker-pool';
import { FakeRedis } from '../helpers/fake-redis';
import { testConfig } from '../helpers/test-config';

describe('WorkerPool', () => {
  let repository: InMemoryJobRepository;
  let queue: InMemoryJobQueue;
  let workerPool: WorkerPool;

  beforeEach(() => {
    repository = new InMemoryJobRepository(testConfig);
    queue = new InMemoryJobQueue();
    workerPool = new WorkerPool(
      queue,
      repository,
      new MockJobProcessor(testConfig),
      testConfig,
    );
  });

  afterEach(async () => {
    await workerPool.stop();
    repository.clear();
    queue.clear();
  });

  it('transitions a queued job through running to completed', async () => {
    const job = await repository.create({ sleepMs: 30 });
    await queue.enqueue(job.id);
    workerPool.start();

    await expect
      .poll(async () => (await repository.findById(job.id))?.status, { timeout: 3000 })
      .toBe('completed');

    const completed = await repository.findById(job.id);
    expect(completed?.result).toMatchObject({
      message: 'Job completed successfully',
      sleepMs: 30,
    });
    expect(completed?.startedAt).toBeTruthy();
    expect(completed?.completedAt).toBeTruthy();
  });

  it('retries transient failures and eventually completes', async () => {
    const job = await repository.create({
      sleepMs: 10,
      transientFailureCount: 2,
    });
    await queue.enqueue(job.id);
    workerPool.start();

    await expect
      .poll(async () => (await repository.findById(job.id))?.status, { timeout: 5000 })
      .toBe('completed');

    const completed = await repository.findById(job.id);
    expect(completed?.retryCount).toBe(2);
    expect(completed?.result?.attempts).toBe(3);
  });

  it('marks a job as failed after max retries are exhausted', async () => {
    const config = { ...testConfig, MAX_JOB_RETRIES: 1, RETRY_BACKOFF_MS: 5 };
    repository = new InMemoryJobRepository(config);
    workerPool = new WorkerPool(
      queue,
      repository,
      new MockJobProcessor(config),
      config,
    );

    const job = await repository.create({
      sleepMs: 5,
      transientFailureCount: 5,
    });
    await queue.enqueue(job.id);
    workerPool.start();

    await expect
      .poll(async () => (await repository.findById(job.id))?.status, { timeout: 5000 })
      .toBe('failed');

    const failed = await repository.findById(job.id);
    expect(failed?.retryCount).toBe(1);
    expect(failed?.error).toContain('Simulated transient failure');
  });

  it('marks jobs as failed on permanent processing errors', async () => {
    const job = await repository.create({ sleepMs: 10, shouldFail: true });
    await queue.enqueue(job.id);
    workerPool.start();

    await expect
      .poll(async () => (await repository.findById(job.id))?.status, { timeout: 3000 })
      .toBe('failed');

    const failed = await repository.findById(job.id);
    expect(failed?.error).toBe('Simulated permanent job failure');
    expect(failed?.result).toBeNull();
  });

  it('processes multiple jobs concurrently up to worker concurrency', async () => {
    const config = { ...testConfig, WORKER_CONCURRENCY: 2 };
    workerPool = new WorkerPool(
      queue,
      repository,
      new MockJobProcessor(config),
      config,
    );

    const jobs = await Promise.all([
      repository.create({ sleepMs: 80 }),
      repository.create({ sleepMs: 80 }),
      repository.create({ sleepMs: 80 }),
    ]);

    for (const job of jobs) {
      await queue.enqueue(job.id);
    }

    workerPool.start();

    await expect
      .poll(async () => {
        const statuses = await Promise.all(jobs.map((job) => repository.findById(job.id)));
        return statuses.every((job) => job?.status === 'completed');
      }, { timeout: 5000 })
      .toBe(true);
  });

  it('prevents duplicate processing when markRunning is called twice', async () => {
    const job = await repository.create({ sleepMs: 10 });

    const firstClaim = await repository.markRunning(job.id);
    const secondClaim = await repository.markRunning(job.id);

    expect(firstClaim?.status).toBe('running');
    expect(secondClaim).toBeNull();
  });
});

describe('WorkerPool with Redis storage', () => {
  let redis: FakeRedis;
  let repository: RedisJobRepository;
  let queue: RedisJobQueue;
  let workerPool: WorkerPool;

  beforeEach(() => {
    redis = new FakeRedis();
    repository = new RedisJobRepository(redis, testConfig);
    queue = new RedisJobQueue(redis);
    workerPool = new WorkerPool(
      queue,
      repository,
      new MockJobProcessor(testConfig),
      testConfig,
    );
  });

  afterEach(async () => {
    await workerPool.stop();
    redis.clear();
  });

  it('completes a job using Redis-backed repository and queue', async () => {
    const job = await repository.create({ sleepMs: 30 });
    await queue.enqueue(job.id);
    workerPool.start();

    await expect
      .poll(async () => (await repository.findById(job.id))?.status, { timeout: 3000 })
      .toBe('completed');
  });
});

describe('InMemoryJobRepository concurrency', () => {
  let repository: InMemoryJobRepository;

  beforeEach(() => {
    repository = new InMemoryJobRepository(testConfig);
  });

  afterEach(() => {
    repository.clear();
  });

  it('allows only one worker to claim a queued job under concurrent access', async () => {
    const job = await repository.create({ sleepMs: 10 });

    const claims = await Promise.all([
      repository.markRunning(job.id),
      repository.markRunning(job.id),
      repository.markRunning(job.id),
    ]);

    const successfulClaims = claims.filter((claim) => claim !== null);
    expect(successfulClaims).toHaveLength(1);
    expect(successfulClaims[0]?.status).toBe('running');
  });

  it('requeues a running job and increments retryCount', async () => {
    const job = await repository.create({ sleepMs: 10 });
    await repository.markRunning(job.id);

    const requeued = await repository.requeueForRetry(job.id, 'transient error');

    expect(requeued?.status).toBe('queued');
    expect(requeued?.retryCount).toBe(1);
    expect(requeued?.error).toBe('transient error');
  });
});
