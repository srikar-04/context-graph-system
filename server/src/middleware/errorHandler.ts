import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error(error);

  res.status(500).json({
    error: "Internal server error",
    code: "INTERNAL_ERROR",
  });
};
