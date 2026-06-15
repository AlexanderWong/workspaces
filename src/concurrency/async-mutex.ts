/**
 * Serializes async critical sections so concurrent callers
 * (HTTP handlers and background workers) cannot interleave
 * read-modify-write operations on shared state.
 */
export class AsyncMutex {
  private locked = false;
  private readonly waitQueue: Array<() => void> = [];

  async runExclusive<T>(callback: () => Promise<T> | T): Promise<T> {
    await this.acquire();
    try {
      return await callback();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.locked = true;
        resolve();
      });
    });
  }

  private release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next();
      return;
    }

    this.locked = false;
  }
}
