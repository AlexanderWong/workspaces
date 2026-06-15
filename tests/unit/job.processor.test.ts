import { describe, expect, it } from 'vitest';
import type { Job } from '../../src/types/job';
import { MockJobProcessor } from '../../src/workers/job.processor';
import { testConfig } from '../helpers/test-config';

const baseJob = (overrides: Partial<Job> = {}): Job => ({
  id: '00000000-0000-4000-8000-000000000001',
  status: 'running',
  payload: {},
  result: null,
  error: null,
  retryCount: 0,
  maxRetries: 3,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
  ...overrides,
});

describe('MockJobProcessor', () => {
  const processor = new MockJobProcessor(testConfig);

  it('completes successfully after the configured sleep duration', async () => {
    const startedAt = Date.now();
    const result = await processor.process(
      baseJob({ payload: { sleepMs: 30, data: { key: 'value' } } }),
    );
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(result).toMatchObject({
      sleepMs: 30,
      message: 'Job completed successfully',
      input: { sleepMs: 30, data: { key: 'value' } },
      attempts: 1,
    });
    expect(result.processedAt).toBeTruthy();
  });

  it('uses DEFAULT_JOB_SLEEP_MS when sleepMs is omitted', async () => {
    const result = await processor.process(baseJob({ payload: { data: { task: 'default' } } }));

    expect(result.sleepMs).toBe(testConfig.DEFAULT_JOB_SLEEP_MS);
  });

  it('throws TransientProcessingError when retryCount is below transientFailureCount', async () => {
    await expect(
      processor.process(
        baseJob({
          retryCount: 0,
          payload: { sleepMs: 1, transientFailureCount: 2 },
        }),
      ),
    ).rejects.toMatchObject({ name: 'TransientProcessingError' });
  });

  it('succeeds once retryCount reaches transientFailureCount', async () => {
    const result = await processor.process(
      baseJob({
        retryCount: 2,
        payload: { sleepMs: 1, transientFailureCount: 2 },
      }),
    );

    expect(result.message).toBe('Job completed successfully');
    expect(result.attempts).toBe(3);
  });

  it('throws a permanent error when shouldFail is true', async () => {
    await expect(
      processor.process(baseJob({ payload: { sleepMs: 1, shouldFail: true } })),
    ).rejects.toThrow('Simulated permanent job failure');
  });
});
