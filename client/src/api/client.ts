import axios from "axios";

import type {
  ChatHistoryMessage,
  ChatResponse,
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

export const sendChatMessage = async (input: {
  sessionId: string;
  message: string;
}) => {
  const response = await apiClient.post<ChatResponse>("/api/query/chat", input);
  return response.data;
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
