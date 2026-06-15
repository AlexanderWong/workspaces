/** Typed, validated environment config loaded once at startup. */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  API_PREFIX: z.string().default('/api/v1'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().nonnegative().default(250),
  DEFAULT_JOB_SLEEP_MS: z.coerce.number().int().positive().default(1000),
  MAX_JOB_RETRIES: z.coerce.number().int().nonnegative().default(3),
  RETRY_BACKOFF_MS: z.coerce.number().int().nonnegative().default(1000),
  /** When false, the HTTP server does not start background workers (use separate worker process) */
  WORKERS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Redis connection URL — required when API and workers run as separate processes */
  REDIS_URL: z.string().url().optional(),
  /** How long a claimed job may run before the reaper requeues it (crash recovery) */
  VISIBILITY_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /** How often the worker process scans for expired in-flight jobs */
  REAPER_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  /** Max time to wait for in-flight jobs to finish before nacking on shutdown */
  SHUTDOWN_DRAIN_MS: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${formatted}`);
  }

  return result.data;
}

/** Singleton config — import this rather than reading process.env directly. */
export const env = loadEnv();
