import type { JobQueue } from '../types/job';

type QueueWaiter = (jobId: string) => void;

export class InMemoryJobQueue implements JobQueue {
  private readonly pending: string[] = [];
  private readonly waiters: QueueWaiter[] = [];

  enqueue(jobId: string): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(jobId);
      return;
    }

    this.pending.push(jobId);
  }

  async dequeue(timeoutMs: number): Promise<string | null> {
    const immediate = this.pending.shift();
    if (immediate) {
      return immediate;
    }

    return new Promise((resolve) => {
      let settled = false;

      const finish = (jobId: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(jobId);
      };

      const timeout = setTimeout(() => finish(null), timeoutMs);

      this.waiters.push((jobId) => finish(jobId));
    });
  }

  size(): number {
    return this.pending.length;
  }

  /** Test helper to reset state between tests */
  clear(): void {
    this.pending.length = 0;
    this.waiters.length = 0;
  }
}
