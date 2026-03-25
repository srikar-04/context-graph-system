import { Router } from "express";

import { createRateLimiter } from "../middleware/rateLimiter.js";
import { validateBody } from "../middleware/validator.js";
import { chatRequestSchema } from "../schemas/query.schema.js";
import {
  createChatSession,
  getChatMessages,
  listChatSessions,
} from "../services/chatHistory.js";
import { answerQuery, streamAnswerQuery } from "../services/queryEngine.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";

const chatRateLimiter = createRateLimiter({
  limit: 20,
  windowMs: 60_000,
});

export const queryRouter = Router();

queryRouter.get(
  "/sessions",
  asyncHandler(async (_req, res) => {
    const sessions = await listChatSessions();

    res.json({
      sessions,
    });
  })
);

queryRouter.post(
  "/session",
  asyncHandler(async (_req, res) => {
    const session = await createChatSession();

    res.status(201).json({
      sessionId: session.id,
    });
  })
);

queryRouter.get(
  "/history/:sessionId",
  asyncHandler(async (req, res) => {
    const sessionId = Array.isArray(req.params.sessionId)
      ? req.params.sessionId[0]
      : req.params.sessionId;

    if (!sessionId) {
      throw new ApiError(
        400,
        "CHAT_SESSION_ID_REQUIRED",
        "Chat session id is required."
      );
    }

    const messages = await getChatMessages(sessionId);

    res.json({
      sessionId,
      messages,
    });
  })
);

queryRouter.post(
  "/chat",
  chatRateLimiter,
  validateBody(chatRequestSchema),
  asyncHandler(async (req, res) => {
    const response = await answerQuery(req.body);

    res.json(response);
  })
);

queryRouter.post(
  "/chat/stream",
  chatRateLimiter,
  validateBody(chatRequestSchema),
  async (req, res) => {
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const writeEvent = (payload: Record<string, unknown>) => {
      res.write(`${JSON.stringify(payload)}\n`);
    };

    try {
      const response = await streamAnswerQuery(req.body, {
        onMeta: (meta) => {
          writeEvent({
            type: "meta",
            ...meta,
          });
        },
        onChunk: (chunk) => {
          writeEvent({
            type: "chunk",
            content: chunk,
          });
        },
      });

      writeEvent({
        type: "done",
        ...response,
      });
    } catch (error) {
      console.error("Query stream failed", {
        sessionId:
          typeof req.body?.sessionId === "string"
            ? req.body.sessionId
            : undefined,
        message:
          typeof req.body?.message === "string" ? req.body.message : undefined,
        error,
      });

      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(500, "INTERNAL_ERROR", "Internal server error.");

      writeEvent({
        type: "error",
        error: apiError.message,
        code: apiError.code,
      });
    } finally {
      res.end();
    }
  }
);
