/**
 * FIFO job queue that decouples HTTP submission from worker processing.
 *
 * Uses a waiter pattern: if a worker is blocked on dequeue, enqueue delivers
 * the job directly to that worker instead of pushing to the pending array.
 * All shared-state access is mutex-protected.
 */
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
        // A worker is already waiting — hand off directly
        waiter(jobId);
        return;
      }

      this.pending.push(jobId);
    });
  }

  /**
   * Returns the next job ID, or null after timeoutMs if the queue is empty.
   * Workers call this in a loop with a short poll interval.
   */
  async dequeue(timeoutMs: number): Promise<string | null> {
    const immediate = await this.mutex.runExclusive(async () => this.pending.shift() ?? null);
    if (immediate) {
      return immediate;
    }

    // No jobs available — register a waiter and block until enqueue or timeout
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
        // Re-check pending in case a job arrived between the first check and now
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
