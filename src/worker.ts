/**
 * Worker-only entry point for DigitalOcean worker components.
 * Connects to Redis for shared job state with the API service.
 */
import { env } from './config/env';
import { createJobStorage } from './storage';
import { MockJobProcessor } from './workers/job.processor';
import { WorkerPool } from './workers/worker-pool';

async function main(): Promise<void> {
  if (!env.REDIS_URL) {
    throw new Error('REDIS_URL is required for the standalone worker process');
  }

  const storage = await createJobStorage(env);
  const workerPool = new WorkerPool(
    storage.queue,
    storage.repository,
    new MockJobProcessor(env),
    env,
  );

  workerPool.start();
  console.log(`Worker service started with concurrency ${env.WORKER_CONCURRENCY}`);

  async function shutdown(signal: string): Promise<void> {
    console.log(`Worker received ${signal}, shutting down...`);
    await workerPool.stop();
    await storage.close();
    process.exit(0);
  }

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

void main();
