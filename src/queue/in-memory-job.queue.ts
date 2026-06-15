import { AsyncMutex } from '../concurrency/async-mutex';
import type { JobQueue } from '../types/job';

type QueueWaiter = (jobId: string) => void;

export class InMemoryJobQueue implements JobQueue {
  private readonly pending: string[] = [];
  private readonly waiters: QueueWaiter[] = [];
  private readonly mutex = new AsyncMutex();

  async enqueue(jobId: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(jobId);
        return;
      }

      this.pending.push(jobId);
    });
  }

  async dequeue(timeoutMs: number): Promise<string | null> {
    const immediate = await this.mutex.runExclusive(async () => this.pending.shift() ?? null);
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

      void this.mutex.runExclusive(async () => {
        const available = this.pending.shift();
        if (available) {
          finish(available);
          return;
        }

        this.waiters.push((jobId) => finish(jobId));
      });
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
