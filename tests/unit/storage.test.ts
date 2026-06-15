import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJobStorage } from '../../src/storage';
import { InMemoryJobQueue } from '../../src/queue/in-memory-job.queue';
import { InMemoryJobRepository } from '../../src/repositories/in-memory-job.repository';
import { testConfig } from '../helpers/test-config';

describe('createJobStorage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns in-memory storage when REDIS_URL is not set', async () => {
    vi.stubEnv('REDIS_URL', '');

    const storage = await createJobStorage({ ...testConfig, REDIS_URL: undefined });

    expect(storage.repository).toBeInstanceOf(InMemoryJobRepository);
    expect(storage.queue).toBeInstanceOf(InMemoryJobQueue);

    await storage.close();
  });

  it('throws when REDIS_URL is set but Redis is unreachable', async () => {
    await expect(
      createJobStorage({
        ...testConfig,
        REDIS_URL: 'redis://127.0.0.1:1',
      }),
    ).rejects.toThrow();
  }, 5000);
});
