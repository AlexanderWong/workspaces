import { randomUUID } from 'crypto';
import type { Job, JobPayload, JobRepository, JobResult } from '../types/job';

export class InMemoryJobRepository implements JobRepository {
  private readonly jobs = new Map<string, Job>();

  async create(payload: JobPayload): Promise<Job> {
    const now = new Date().toISOString();
    const job: Job = {
      id: randomUUID(),
      status: 'queued',
      payload,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };

    this.jobs.set(job.id, job);
    return job;
  }

  async findById(id: string): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }

  async markRunning(id: string): Promise<Job | null> {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'queued') {
      return null;
    }

    const now = new Date().toISOString();
    const updated: Job = {
      ...job,
      status: 'running',
      updatedAt: now,
      startedAt: now,
    };

    this.jobs.set(id, updated);
    return updated;
  }

  async markCompleted(id: string, result: JobResult): Promise<Job | null> {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'running') {
      return null;
    }

    const now = new Date().toISOString();
    const updated: Job = {
      ...job,
      status: 'completed',
      result,
      error: null,
      updatedAt: now,
      completedAt: now,
    };

    this.jobs.set(id, updated);
    return updated;
  }

  async markFailed(id: string, error: string): Promise<Job | null> {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'running') {
      return null;
    }

    const now = new Date().toISOString();
    const updated: Job = {
      ...job,
      status: 'failed',
      error,
      updatedAt: now,
      completedAt: now,
    };

    this.jobs.set(id, updated);
    return updated;
  }

  /** Test helper to reset state between tests */
  clear(): void {
    this.jobs.clear();
  }
}
