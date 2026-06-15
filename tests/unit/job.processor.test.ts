import { describe, expect, it } from 'vitest';
import { MockJobProcessor } from '../../src/workers/job.processor';
import { testConfig } from '../helpers/test-config';

describe('MockJobProcessor', () => {
  const processor = new MockJobProcessor(testConfig);

  it('completes successfully after the configured sleep duration', async () => {
    const startedAt = Date.now();
    const result = await processor.process({ sleepMs: 30, data: { key: 'value' } });
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(result).toMatchObject({
      sleepMs: 30,
      message: 'Job completed successfully',
      input: { sleepMs: 30, data: { key: 'value' } },
    });
    expect(result.processedAt).toBeTruthy();
  });

  it('uses DEFAULT_JOB_SLEEP_MS when sleepMs is omitted', async () => {
    const result = await processor.process({ data: { task: 'default' } });

    expect(result.sleepMs).toBe(testConfig.DEFAULT_JOB_SLEEP_MS);
  });

  it('throws when shouldFail is true', async () => {
    await expect(processor.process({ sleepMs: 1, shouldFail: true })).rejects.toThrow(
      'Simulated job failure',
    );
  });
});
