import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { RedisJobQueue } from '../../src/queue/redis-job.queue';
import { RedisJobRepository } from '../../src/repositories/redis-job.repository';
import { MockJobProcessor } from '../../src/workers/job.processor';
import { WorkerPool } from '../../src/workers/worker-pool';
import { FakeRedis } from '../helpers/fake-redis';
import { testConfig } from '../helpers/test-config';

/**
 * Simulates production: API and worker are separate processes sharing Redis.
 * FakeRedis stands in for the managed Redis cluster on DigitalOcean.
 */
describe('Redis-backed split API + worker integration', () => {
  let redis: FakeRedis;
  let repository: RedisJobRepository;
  let queue: RedisJobQueue;
  let workerPool: WorkerPool;
  let app: Awaited<ReturnType<typeof createApp>>['app'];

  beforeEach(async () => {
    redis = new FakeRedis();
    repository = new RedisJobRepository(redis, testConfig);
    queue = new RedisJobQueue(redis, testConfig.VISIBILITY_TIMEOUT_MS);
    workerPool = new WorkerPool(
      queue,
      repository,
      new MockJobProcessor(testConfig),
      testConfig,
    );

    ({ app } = await createApp(testConfig, {
      jobRepository: repository,
      jobQueue: queue,
      workerPool,
      startWorkers: false,
    }));
  });

  afterEach(async () => {
    await workerPool.stop();
    redis.clear();
  });

  it('allows the API to submit while a separate worker completes the job', async () => {
    workerPool.start();

    const submitResponse = await request(app)
      .post('/api/v1/jobs')
      .send({ sleepMs: 30, data: { via: 'redis' } })
      .expect(202);

    const jobId = submitResponse.body.data.id as string;

    await expect
      .poll(async () => (await repository.findById(jobId))?.status, { timeout: 5000 })
      .toBe('completed');

    const statusResponse = await request(app).get(`/api/v1/jobs/${jobId}`).expect(200);

    expect(statusResponse.body.data.status).toBe('completed');
    expect(statusResponse.body.data.result.input.data).toEqual({ via: 'redis' });
  });

  it('retries transient failures across API and worker boundaries', async () => {
    workerPool.start();

    const submitResponse = await request(app)
      .post('/api/v1/jobs')
      .send({ sleepMs: 10, transientFailureCount: 2 })
      .expect(202);

    const jobId = submitResponse.body.data.id as string;

    await expect
      .poll(async () => (await repository.findById(jobId))?.status, { timeout: 5000 })
      .toBe('completed');

    const job = await repository.findById(jobId);
    expect(job?.retryCount).toBe(2);
    expect(job?.result?.attempts).toBe(3);
  });

  it('marks jobs failed on permanent errors without retrying', async () => {
    workerPool.start();

    const submitResponse = await request(app)
      .post('/api/v1/jobs')
      .send({ sleepMs: 10, shouldFail: true })
      .expect(202);

    const jobId = submitResponse.body.data.id as string;

    await expect
      .poll(async () => (await repository.findById(jobId))?.status, { timeout: 5000 })
      .toBe('failed');

    const job = await repository.findById(jobId);
    expect(job?.retryCount).toBe(0);
    expect(job?.error).toBe('Simulated permanent job failure');
  });

  it('fails jobs that exhaust max retries for transient errors', async () => {
    await workerPool.stop();

    const config = { ...testConfig, MAX_JOB_RETRIES: 1, RETRY_BACKOFF_MS: 5 };
    repository = new RedisJobRepository(redis, config);
    workerPool = new WorkerPool(
      queue,
      repository,
      new MockJobProcessor(config),
      config,
    );
    ({ app } = await createApp(config, {
      jobRepository: repository,
      jobQueue: queue,
      workerPool,
      startWorkers: false,
    }));

    workerPool.start();

    const submitResponse = await request(app)
      .post('/api/v1/jobs')
      .send({ sleepMs: 5, transientFailureCount: 5 })
      .expect(202);

    const jobId = submitResponse.body.data.id as string;

    await expect
      .poll(async () => (await repository.findById(jobId))?.status, { timeout: 5000 })
      .toBe('failed');

    const job = await repository.findById(jobId);
    expect(job?.retryCount).toBe(1);
  });

  it('returns 404 when polling a job id that was never created', async () => {
    const response = await request(app)
      .get('/api/v1/jobs/00000000-0000-4000-8000-000000000000')
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('skips orphaned queue entries when the job record is missing', async () => {
    const orphanId = '00000000-0000-4000-8000-000000000099';
    await queue.enqueue(orphanId);
    workerPool.start();

    // Give the worker time to claim and skip the missing job
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(await repository.findById(orphanId)).toBeNull();
  });

  it('surfaces Redis write failures during submission to the client', async () => {
    redis.failOn('set');

    const response = await request(app)
      .post('/api/v1/jobs')
      .send({ sleepMs: 10 })
      .expect(500);

    expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
  });
});
