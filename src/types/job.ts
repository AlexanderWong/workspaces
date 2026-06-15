export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface JobPayload {
  /** Simulated work duration in milliseconds */
  sleepMs?: number;
  /** When true, the mock processor throws to simulate failure */
  shouldFail?: boolean;
  /** Arbitrary client-provided data echoed back in the result */
  data?: Record<string, unknown>;
}

export interface JobResult {
  processedAt: string;
  sleepMs: number;
  message: string;
  input: JobPayload;
}

export interface Job {
  id: string;
  status: JobStatus;
  payload: JobPayload;
  result: JobResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface JobSummary {
  id: string;
  status: JobStatus;
}

export interface JobRepository {
  create(payload: JobPayload): Promise<Job>;
  findById(id: string): Promise<Job | null>;
  markRunning(id: string): Promise<Job | null>;
  markCompleted(id: string, result: JobResult): Promise<Job | null>;
  markFailed(id: string, error: string): Promise<Job | null>;
}

export interface JobQueue {
  enqueue(jobId: string): Promise<void>;
  dequeue(timeoutMs: number): Promise<string | null>;
  size(): number;
}
