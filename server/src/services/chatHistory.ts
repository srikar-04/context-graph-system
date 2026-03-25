import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/apiError.js";

const HISTORY_LIMIT = 20;
const SESSION_LIST_LIMIT = 12;

const createSessionTitle = (content: string) => {
  const normalized = content.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "New conversation";
  }

  return normalized.length > 56
    ? `${normalized.slice(0, 55).trimEnd()}...`
    : normalized;
};

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

export const listChatSessions = async () => {
  const sessions = await prisma.chatSession.findMany({
    orderBy: { updatedAt: "desc" },
    take: SESSION_LIST_LIMIT,
    include: {
      messages: {
        where: { role: "user" },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  return sessions.map((session) => {
    const firstUserMessage = session.messages[0];

    return {
      id: session.id,
      title: createSessionTitle(firstUserMessage?.content ?? ""),
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
    };
  });
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
