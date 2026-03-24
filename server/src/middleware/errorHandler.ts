import type { ErrorRequestHandler } from "express";

import { ApiError } from "../utils/apiError.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      details: error.details ?? null,
    });
  }

  console.error(error);

  return res.status(500).json({
    error: "Internal server error",
    code: "INTERNAL_ERROR",
  });
};
