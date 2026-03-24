import type { RequestHandler } from "express";

export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${elapsedMs}ms`
    );
  });

  next();
};
