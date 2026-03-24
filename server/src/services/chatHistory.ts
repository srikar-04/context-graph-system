import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/apiError.js";

const HISTORY_LIMIT = 20;

export const createChatSession = async () => {
  return prisma.chatSession.create({
    data: {},
  });
};

export const ensureChatSession = async (sessionId: string) => {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new ApiError(
      404,
      "CHAT_SESSION_NOT_FOUND",
      "Chat session not found."
    );
  }

  return session;
};

export const getChatMessages = async (sessionId: string) => {
  await ensureChatSession(sessionId);

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  return messages;
};

export const getRecentChatMessages = async (sessionId: string) => {
  await ensureChatSession(sessionId);

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });

  return messages.reverse();
};

export const saveChatMessage = async (input: {
  sessionId: string;
  role: string;
  content: string;
  generatedSql?: string | null;
}) => {
  return prisma.chatMessage.create({
    data: {
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      generatedSql: input.generatedSql ?? null,
    },
  });
};
