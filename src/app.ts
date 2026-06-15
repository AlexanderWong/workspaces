/**
 * Application bootstrap — wires HTTP routes, shared dependencies, and the worker pool.
 *
 * Request flow:  routes → controllers → services → repository / queue
 * Background flow: worker pool → queue → processor → repository
 *
 * Dependencies can be injected for tests (see AppDependencies).
 */
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env, type Env } from './config/env';
import { JobController } from './controllers/job.controller';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { InMemoryJobQueue } from './queue/in-memory-job.queue';
import { InMemoryJobRepository } from './repositories/in-memory-job.repository';
import { createHealthRouter } from './routes/health.routes';
import { createJobRouter } from './routes/job.routes';
import { JobService } from './services/job.service';
import { createJobStorage } from './storage';
import type { JobQueue, JobRepository } from './types/job';
import { MockJobProcessor } from './workers/job.processor';
import { WorkerPool } from './workers/worker-pool';

export interface AppDependencies {
  jobRepository?: JobRepository;
  jobQueue?: JobQueue;
  workerPool?: WorkerPool;
  startWorkers?: boolean;
  closeStorage?: () => Promise<void>;
}

export interface AppInstance {
  app: express.Application;
  workerPool: WorkerPool;
  close: () => Promise<void>;
}

export async function createApp(
  config: Env = env,
  dependencies: AppDependencies = {},
): Promise<AppInstance> {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use(createHealthRouter());

  const storage =
    dependencies.jobRepository && dependencies.jobQueue
      ? {
          repository: dependencies.jobRepository,
          queue: dependencies.jobQueue,
          close: dependencies.closeStorage ?? (async () => {}),
        }
      : await createJobStorage(config);

  const { repository: jobRepository, queue: jobQueue } = storage;
  const jobService = new JobService(jobRepository, jobQueue);
  const jobController = new JobController(jobService);

  app.use(`${config.API_PREFIX}/jobs`, createJobRouter(jobController));

  app.use(notFoundHandler);
  app.use(errorHandler);

  const workerPool =
    dependencies.workerPool ??
    new WorkerPool(jobQueue, jobRepository, new MockJobProcessor(config), config);

  const shouldStartWorkers =
    dependencies.startWorkers ?? (config.WORKERS_ENABLED && config.NODE_ENV !== 'test');
  if (shouldStartWorkers) {
    workerPool.start();
  }

  return {
    app,
    workerPool,
    close: async () => {
      await workerPool.stop();
      await storage.close();
    },
  };
}

/** Factory helpers for tests using in-memory storage */
export function createInMemoryStorage(config: Env): {
  repository: InMemoryJobRepository;
  queue: InMemoryJobQueue;
} {
  return {
    repository: new InMemoryJobRepository(config),
    queue: new InMemoryJobQueue(),
  };
}
