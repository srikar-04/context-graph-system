import { Router } from "express";

import { createRateLimiter } from "../middleware/rateLimiter.js";
import { validateBody } from "../middleware/validator.js";
import { chatRequestSchema } from "../schemas/query.schema.js";
import { createChatSession, getChatMessages } from "../services/chatHistory.js";
import { answerQuery } from "../services/queryEngine.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";

const chatRateLimiter = createRateLimiter({
  limit: 20,
  windowMs: 60_000,
});

export const queryRouter = Router();

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
