/** Validates and coerces req.body / params / query with Zod before the handler runs. */
import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';

type RequestValidation = {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
};

export function validateRequest(schemas: RequestValidation): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as typeof req.query;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
