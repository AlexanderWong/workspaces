/** Shared test overrides — shorter sleep/poll/backoff intervals so tests finish quickly. */
import { env } from '../../src/config/env';

export const testConfig = {
  ...env,
  NODE_ENV: 'test' as const,
  DEFAULT_JOB_SLEEP_MS: 50,
  WORKER_POLL_INTERVAL_MS: 25,
  WORKER_CONCURRENCY: 2,
  MAX_JOB_RETRIES: 3,
  RETRY_BACKOFF_MS: 10,
  WORKERS_ENABLED: true,
};
