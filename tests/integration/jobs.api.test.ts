import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { InMemoryJobQueue } from '../../src/queue/in-memory-job.queue';
import { InMemoryJobRepository } from '../../src/repositories/in-memory-job.repository';
import { MockJobProcessor } from '../../src/workers/job.processor';
import { WorkerPool } from '../../src/workers/worker-pool';
import { testConfig } from '../helpers/test-config';

describe('Jobs API integration', () => {
  let repository: InMemoryJobRepository;
  let queue: InMemoryJobQueue;
  let workerPool: WorkerPool;
  let app: ReturnType<typeof createApp>['app'];

  beforeEach(() => {
    repository = new InMemoryJobRepository();
    queue = new InMemoryJobQueue();
    workerPool = new WorkerPool(
      queue,
      repository,
      new MockJobProcessor(testConfig),
      testConfig,
    );

    ({ app } = createApp(testConfig, {
      jobRepository: repository,
      jobQueue: queue,
      workerPool,
      startWorkers: false,
    }));
  });

  afterEach(async () => {
    await workerPool.stop();
    repository.clear();
    queue.clear();
  });

  it('accepts a job and returns an id immediately with queued status', async () => {
    workerPool.start();

    const response = await request(app)
      .post('/api/v1/jobs')
      .send({ sleepMs: 50, data: { task: 'demo' } })
      .expect(202);

    expect(response.body.data.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(response.body.data.status).toBe('queued');
  });

  it('processes a submitted job to completion', async () => {
    workerPool.start();

    const submitResponse = await request(app)
      .post('/api/v1/jobs')
      .send({ sleepMs: 50, data: { task: 'demo' } })
      .expect(202);

    const jobId = submitResponse.body.data.id as string;

    await expect
      .poll(async () => {
        const statusResponse = await request(app).get(`/api/v1/jobs/${jobId}`);
        return statusResponse.body.data.status;
      }, { timeout: 3000 })
      .toBe('completed');

    const finalResponse = await request(app).get(`/api/v1/jobs/${jobId}`).expect(200);

    expect(finalResponse.body.data.status).toBe('completed');
    expect(finalResponse.body.data.result).toMatchObject({
      message: 'Job completed successfully',
      sleepMs: 50,
      input: { sleepMs: 50, data: { task: 'demo' } },
    });
    expect(finalResponse.body.data.error).toBeNull();
    expect(finalResponse.body.data.startedAt).toBeTruthy();
    expect(finalResponse.body.data.completedAt).toBeTruthy();
  });

  it('marks jobs as failed when processing throws', async () => {
    workerPool.start();

    const submitResponse = await request(app)
      .post('/api/v1/jobs')
      .send({ sleepMs: 10, shouldFail: true })
      .expect(202);

    const jobId = submitResponse.body.data.id as string;

    await expect
      .poll(async () => {
        const statusResponse = await request(app).get(`/api/v1/jobs/${jobId}`);
        return statusResponse.body.data.status;
      }, { timeout: 3000 })
      .toBe('failed');

    const finalResponse = await request(app).get(`/api/v1/jobs/${jobId}`).expect(200);

    expect(finalResponse.body.data.status).toBe('failed');
    expect(finalResponse.body.data.error).toBe('Simulated job failure');
    expect(finalResponse.body.data.result).toBeNull();
  });

  it('returns 404 for unknown job ids', async () => {
    const response = await request(app)
      .get('/api/v1/jobs/00000000-0000-4000-8000-000000000000')
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for invalid job submission payloads', async () => {
    const response = await request(app)
      .post('/api/v1/jobs')
      .send({ sleepMs: -1 })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Health endpoint integration', () => {
  it('returns ok status', async () => {
    const { app } = createApp(testConfig, { startWorkers: false });

    const response = await request(app).get('/health').expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.timestamp).toBeTruthy();
  });
});
