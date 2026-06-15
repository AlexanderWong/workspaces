import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryJobQueue } from '../../src/queue/in-memory-job.queue';
import { InMemoryJobRepository } from '../../src/repositories/in-memory-job.repository';
import { MockJobProcessor } from '../../src/workers/job.processor';
import { WorkerPool } from '../../src/workers/worker-pool';
import { testConfig } from '../helpers/test-config';

describe('WorkerPool', () => {
  let repository: InMemoryJobRepository;
  let queue: InMemoryJobQueue;
  let workerPool: WorkerPool;

  beforeEach(() => {
    repository = new InMemoryJobRepository();
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

  it('marks a job as failed when processing throws', async () => {
    const job = await repository.create({ sleepMs: 10, shouldFail: true });
    await queue.enqueue(job.id);
    workerPool.start();

    await expect
      .poll(async () => (await repository.findById(job.id))?.status, { timeout: 3000 })
      .toBe('failed');

    const failed = await repository.findById(job.id);
    expect(failed?.error).toBe('Simulated job failure');
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

describe('InMemoryJobRepository concurrency', () => {
  let repository: InMemoryJobRepository;

  beforeEach(() => {
    repository = new InMemoryJobRepository();
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

  it('returns consistent snapshots while HTTP reads overlap worker updates', async () => {
    const job = await repository.create({ sleepMs: 10 });
    await repository.markRunning(job.id);

    const [duringRunning, afterComplete] = await Promise.all([
      repository.findById(job.id),
      repository.markCompleted(job.id, {
        processedAt: new Date().toISOString(),
        sleepMs: 10,
        message: 'done',
        input: job.payload,
      }).then(() => repository.findById(job.id)),
    ]);

    expect(['running', 'completed']).toContain(duringRunning?.status);
    expect(afterComplete?.status).toBe('completed');
    expect(afterComplete?.result?.message).toBe('done');
  });
});
