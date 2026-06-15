/**
 * Business logic — orchestrates job submission and lookup.
 * Does not perform processing; that is the worker pool's responsibility.
 */
import { NotFoundError } from '../errors/app-error';
import type { Job, JobPayload, JobQueue, JobRepository } from '../types/job';

export class JobService {
  constructor(
    private readonly repository: JobRepository,
    private readonly queue: JobQueue,
  ) {}

  /**
   * Persist the job, enqueue for background processing, and return immediately.
   * The HTTP caller gets back before any worker picks up the job.
   */
  async submitJob(payload: JobPayload): Promise<Job> {
    const job = await this.repository.create(payload);
    await this.queue.enqueue(job.id);
    return job;
  }

  async getJob(id: string): Promise<Job> {
    const job = await this.repository.findById(id);
    if (!job) {
      throw new NotFoundError('Job', id);
    }
    return job;
  }
}
