/**
 * FIFO job queue that decouples HTTP submission from worker processing.
 *
 * Uses a waiter pattern: if a worker is blocked on claim, enqueue delivers
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
  async claim(timeoutMs: number): Promise<string | null> {
    const immediate = await this.mutex.runExclusive(async () => this.pending.shift() ?? null);
    if (immediate) {
      return immediate;
    }

    // No jobs available — register a waiter and block until enqueue or timeout
    return new Promise((resolve) => {
      let settled = false;
      let waiter: QueueWaiter | undefined;

      const finish = (jobId: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        resolve(jobId);
      };

      const timeoutHandle = setTimeout(() => {
        void this.mutex.runExclusive(async () => {
          if (waiter) {
            const index = this.waiters.indexOf(waiter);
            if (index >= 0) {
              this.waiters.splice(index, 1);
            }
          }
          finish(null);
        });
      }, timeoutMs);

      void this.mutex.runExclusive(async () => {
        // Re-check pending in case a job arrived between the first check and now
        const available = this.pending.shift();
        if (available) {
          clearTimeout(timeoutHandle);
          finish(available);
          return;
        }

        waiter = (jobId: string) => finish(jobId);
        this.waiters.push(waiter);
      });
    });
  }

  async nack(jobId: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      this.pending.unshift(jobId);
    });
  }

  async reapExpired(): Promise<number> {
    return 0;
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
