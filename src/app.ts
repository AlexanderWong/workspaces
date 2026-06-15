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
import { MockJobProcessor } from './workers/job.processor';
import { WorkerPool } from './workers/worker-pool';

export interface AppDependencies {
  jobRepository?: InMemoryJobRepository;
  jobQueue?: InMemoryJobQueue;
  workerPool?: WorkerPool;
  startWorkers?: boolean;
}

export interface AppInstance {
  app: express.Application;
  workerPool: WorkerPool;
}

export function createApp(
  config: Env = env,
  dependencies: AppDependencies = {},
): AppInstance {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use(createHealthRouter());

  // Shared instances used by both HTTP handlers and background workers
  const jobRepository = dependencies.jobRepository ?? new InMemoryJobRepository();
  const jobQueue = dependencies.jobQueue ?? new InMemoryJobQueue();
  const jobService = new JobService(jobRepository, jobQueue);
  const jobController = new JobController(jobService);

  app.use(`${config.API_PREFIX}/jobs`, createJobRouter(jobController));

  app.use(notFoundHandler);
  app.use(errorHandler);

  const workerPool =
    dependencies.workerPool ??
    new WorkerPool(
      jobQueue,
      jobRepository,
      new MockJobProcessor(config),
      config,
    );

  // Workers are disabled in tests so each test can control start/stop timing
  const shouldStartWorkers = dependencies.startWorkers ?? config.NODE_ENV !== 'test';
  if (shouldStartWorkers) {
    workerPool.start();
  }

  return { app, workerPool };
}
