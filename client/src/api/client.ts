import axios from "axios";

import type {
  ChatHistoryMessage,
  ChatResponse,
  ChatSessionSummary,
  ChatStreamMeta,
  GraphData,
  GraphNode,
} from "../types";

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const defaultBaseUrl = "http://localhost:3000";

const configuredBaseUrl =
  typeof import.meta.env.VITE_API_URL === "string" &&
  import.meta.env.VITE_API_URL.length > 0
    ? normalizeBaseUrl(import.meta.env.VITE_API_URL)
    : defaultBaseUrl;

export const apiClient = axios.create({
  baseURL: configuredBaseUrl,
  headers: {
    "Content-Type": "application/json",
  },
});

export const getGraph = async () => {
  const response = await apiClient.get<GraphData>("/api/graph");
  return response.data;
};

export const getGraphNode = async (nodeId: string) => {
  const response = await apiClient.get<GraphNode>(
    `/api/graph/node/${encodeURIComponent(nodeId)}`
  );
  return response.data;
};

export const createChatSession = async () => {
  const response = await apiClient.post<{ sessionId: string }>(
    "/api/query/session"
  );
  return response.data;
};

export const getChatHistory = async (sessionId: string) => {
  const response = await apiClient.get<{
    sessionId: string;
    messages: ChatHistoryMessage[];
  }>(`/api/query/history/${encodeURIComponent(sessionId)}`);

  return response.data;
};

export const getChatSessions = async () => {
  const response = await apiClient.get<{
    sessions: ChatSessionSummary[];
  }>("/api/query/sessions");

  return response.data;
};

export const sendChatMessage = async (input: {
  sessionId: string;
  message: string;
}) => {
  const response = await apiClient.post<ChatResponse>("/api/query/chat", input);
  return response.data;
};

export const streamChatMessage = async (
  input: {
    sessionId: string;
    message: string;
  },
  handlers: {
    onMeta?: (meta: ChatStreamMeta) => void;
    onChunk?: (chunk: string) => void;
  }
): Promise<ChatResponse> => {
  const response = await fetch(`${configuredBaseUrl}/api/query/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok || !response.body) {
    throw new Error("The chat stream could not be started.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload: ChatResponse | null = null;

  const processLine = (line: string) => {
    const event = JSON.parse(line) as
      | ({ type: "meta" } & ChatStreamMeta)
      | ({ type: "chunk"; content: string })
      | ({ type: "done" } & ChatResponse)
      | { type: "error"; error: string; code?: string };

    if (event.type === "meta") {
      handlers.onMeta?.({
        sql: event.sql,
        nodesReferenced: event.nodesReferenced,
        executionTimeMs: event.executionTimeMs,
      });
      return;
    }

    if (event.type === "chunk") {
      handlers.onChunk?.(event.content);
      return;
    }

    if (event.type === "done") {
      donePayload = {
        answer: event.answer,
        sql: event.sql,
        nodesReferenced: event.nodesReferenced,
        executionTimeMs: event.executionTimeMs,
      };
      return;
    }

    throw new Error(event.error || "The chat stream failed.");
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let newlineIndex = buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line) {
        processLine(line);
      }

      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      break;
    }
  }

  const finalLine = buffer.trim();

  if (finalLine) {
    processLine(finalLine);
  }

  if (!donePayload) {
    throw new Error("The chat stream ended before a final response arrived.");
  }

  return donePayload;
};

export const getErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as
      | { error?: string; message?: string; code?: string }
      | undefined;

    if (typeof data?.error === "string" && data.error.length > 0) {
      return data.error;
    }

    if (typeof data?.message === "string" && data.message.length > 0) {
      return data.message;
    }

    if (status === 429) {
      return "Too many requests. Wait a minute and try again.";
    }
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return fallback;
};
