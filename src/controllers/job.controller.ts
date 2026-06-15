/**
 * HTTP layer — maps requests/responses only; no business logic here.
 * Delegates to JobService for all job operations.
 */
import type { Request, Response } from 'express';
import type { JobService } from '../services/job.service';

export class JobController {
  constructor(private readonly jobService: JobService) {}

  submit = async (req: Request, res: Response): Promise<void> => {
    const job = await this.jobService.submitJob(req.body);
    // 202 Accepted: job is queued but processing has not finished
    res.status(202).json({
      data: {
        id: job.id,
        status: job.status,
      },
    });
  };

  getStatus = async (req: Request, res: Response): Promise<void> => {
    const job = await this.jobService.getJob(String(req.params.id));
    res.status(200).json({
      data: {
        id: job.id,
        status: job.status,
        payload: job.payload,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      },
    });
  };
}
