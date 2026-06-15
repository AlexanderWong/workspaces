import { env } from '../../src/config/env';

export const testConfig = {
  ...env,
  NODE_ENV: 'test' as const,
  DEFAULT_JOB_SLEEP_MS: 50,
  WORKER_POLL_INTERVAL_MS: 25,
  WORKER_CONCURRENCY: 2,
};
