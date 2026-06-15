import { describe, expect, it } from 'vitest';
import { InMemoryJobQueue } from '../../src/queue/in-memory-job.queue';

describe('InMemoryJobQueue', () => {
  it('dequeues jobs in FIFO order', async () => {
    const queue = new InMemoryJobQueue();

    await queue.enqueue('job-1');
    await queue.enqueue('job-2');

    expect(await queue.dequeue(100)).toBe('job-1');
    expect(await queue.dequeue(100)).toBe('job-2');
    expect(await queue.dequeue(100)).toBeNull();
  });

  it('does not lose jobs when a dequeue times out before enqueue', async () => {
    const queue = new InMemoryJobQueue();

    const timedOut = queue.dequeue(10);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(await timedOut).toBeNull();

    await queue.enqueue('job-1');

    expect(await queue.dequeue(100)).toBe('job-1');
  });
});
