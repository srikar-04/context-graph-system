import type { RequestHandler } from "express";

import { ApiError } from "../utils/apiError.js";

type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

const requestLog = new Map<string, number[]>();

export const createRateLimiter = ({
  limit,
  windowMs,
}: RateLimitOptions): RequestHandler => {
  return (req, _res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const windowStart = now - windowMs;
    const timestamps = (requestLog.get(key) ?? []).filter(
      (timestamp) => timestamp > windowStart
    );

    if (timestamps.length >= limit) {
      return next(
        new ApiError(
          429,
          "RATE_LIMIT_EXCEEDED",
          "Too many query requests. Please wait and try again."
        )
      );
    }

    timestamps.push(now);
    requestLog.set(key, timestamps);

    return next();
  };
};
