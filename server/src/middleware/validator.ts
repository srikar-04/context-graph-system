import type { RequestHandler } from "express";
import type { ZodType } from "zod";

import { ApiError } from "../utils/apiError.js";

export const validateBody =
  <T>(schema: ZodType<T>): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return next(
        new ApiError(400, "VALIDATION_ERROR", "Invalid request body.", {
          issues: result.error.issues,
        })
      );
    }

    req.body = result.data;
    return next();
  };
