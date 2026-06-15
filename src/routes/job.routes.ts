import { Router } from 'express';
import { z } from 'zod';
import type { JobController } from '../controllers/job.controller';
import { asyncHandler } from '../middleware/async-handler';
import { validateRequest } from '../middleware/validate-request';

const idParamSchema = z.object({
  id: z.string().uuid('Invalid job id'),
});

const submitJobSchema = z.object({
  sleepMs: z.number().int().positive().max(60_000).optional(),
  shouldFail: z.boolean().optional(),
  data: z.record(z.unknown()).optional(),
});

export function createJobRouter(controller: JobController): Router {
  const router = Router();

  router.post('/', validateRequest({ body: submitJobSchema }), asyncHandler(controller.submit));
  router.get('/:id', validateRequest({ params: idParamSchema }), asyncHandler(controller.getStatus));

  return router;
}
