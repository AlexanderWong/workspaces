import { NotFoundError } from '../errors/app-error';
import type { Job, JobPayload, JobQueue, JobRepository } from '../types/job';

export class JobService {
  constructor(
    private readonly repository: JobRepository,
    private readonly queue: JobQueue,
  ) {}

  async submitJob(payload: JobPayload): Promise<Job> {
    const job = await this.repository.create(payload);
    this.queue.enqueue(job.id);
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
