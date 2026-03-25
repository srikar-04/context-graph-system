import { useEffect, useState } from "react";
import axios from "axios";

import {
  createChatSession,
  getChatHistory,
  getChatSessions,
  getErrorMessage,
  streamChatMessage,
} from "../api/client";
import type {
  ChatResponse,
  ChatSessionSummary,
  ChatStreamMeta,
  UiMessage,
} from "../types";

const SESSION_STORAGE_KEY = "sap-o2c-session-id";

const mapHistoryRole = (role: string): "user" | "assistant" =>
  role === "user" ? "user" : "assistant";

const mapHistoryMessage = (message: {
  id: string;
  role: string;
  content: string;
  generatedSql: string | null;
  createdAt: string;
}): UiMessage => ({
  id: message.id,
  role: mapHistoryRole(message.role),
  content: message.content,
  generatedSql: message.generatedSql,
  createdAt: message.createdAt,
});

export const useChat = (options: {
  onAnswer?: (response: ChatResponse) => void;
  onMeta?: (meta: ChatStreamMeta) => void;
}) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSessions = async (preferredSessionId?: string | null) => {
    try {
      const response = await getChatSessions();
      let nextSessions = response.sessions;

      if (
        preferredSessionId &&
        !nextSessions.some((session) => session.id === preferredSessionId)
      ) {
        nextSessions = [
          {
            id: preferredSessionId,
            title: "New conversation",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          ...nextSessions,
        ];
      }

      setSessions(nextSessions);
    } catch (nextError) {
      setError(
        getErrorMessage(nextError, "The session list could not be loaded.")
      );
    }
  };

  const loadSession = async (nextSessionId: string) => {
    const history = await getChatHistory(nextSessionId);
    setStoredSessionId(nextSessionId);
    setSessionId(history.sessionId);
    setMessages(history.messages.map(mapHistoryMessage));
  };

  const initializeSession = async (replaceExisting: boolean) => {
    setIsBootstrapping(true);
    setError(null);

    if (replaceExisting) {
      clearStoredSessionId();
      setMessages([]);
    }

    let nextSessions: ChatSessionSummary[] = [];

    try {
      const response = await getChatSessions();
      nextSessions = response.sessions;
      setSessions(nextSessions);
    } catch (nextError) {
      setError(
        getErrorMessage(nextError, "The session list could not be loaded.")
      );
    }

    const persistedSessionId = replaceExisting ? null : getStoredSessionId();

    if (!replaceExisting && persistedSessionId) {
      try {
        await loadSession(persistedSessionId);
        await refreshSessions(persistedSessionId);
        setIsBootstrapping(false);
        return;
      } catch (nextError) {
        if (axios.isAxiosError(nextError) && nextError.response?.status === 404) {
          clearStoredSessionId();
        } else {
          setError(
            getErrorMessage(
              nextError,
              "The existing chat session could not be restored."
            )
          );
        }
      }
    }

    if (!replaceExisting && nextSessions.length > 0) {
      const latestSession = nextSessions[0];

      if (latestSession) {
        try {
          await loadSession(latestSession.id);
          await refreshSessions(latestSession.id);
          setIsBootstrapping(false);
          return;
        } catch (nextError) {
          setError(
            getErrorMessage(
              nextError,
              "The latest chat session could not be restored."
            )
          );
        }
      }
    }

    try {
      const nextSession = await createChatSession();
      setStoredSessionId(nextSession.sessionId);
      setSessionId(nextSession.sessionId);
      setMessages([]);
      await refreshSessions(nextSession.sessionId);
    } catch (nextError) {
      setError(
        getErrorMessage(
          nextError,
          "A chat session could not be created. Check that the backend is running."
        )
      );
    } finally {
      setIsBootstrapping(false);
    }
  };

  useEffect(() => {
    void initializeSession(false);
  }, []);

  const startNewSession = async () => {
    await initializeSession(true);
  };

  const selectSession = async (nextSessionId: string) => {
    if (!nextSessionId || nextSessionId === sessionId) {
      return;
    }

    setIsBootstrapping(true);
    setError(null);

    try {
      await loadSession(nextSessionId);
      await refreshSessions(nextSessionId);
    } catch (nextError) {
      setError(
        getErrorMessage(nextError, "The selected chat session could not be loaded.")
      );
    } finally {
      setIsBootstrapping(false);
    }
  };

  const sendMessage = async (content: string) => {
    const trimmedContent = content.trim();

    if (!sessionId || trimmedContent.length === 0 || isSending) {
      return;
    }

    const optimisticUserMessage: UiMessage = {
      id: `local-user-${Date.now()}`,
      role: "user",
      content: trimmedContent,
      createdAt: new Date().toISOString(),
    };
    const assistantMessageId = `local-assistant-${Date.now()}`;

    setMessages((currentMessages) => [
      ...currentMessages,
      optimisticUserMessage,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        isStreaming: true,
      },
    ]);
    setError(null);
    setIsSending(true);

    try {
      const response = await streamChatMessage(
        {
          sessionId,
          message: trimmedContent,
        },
        {
          onMeta: (meta) => {
            setMessages((currentMessages) =>
              currentMessages.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      generatedSql: meta.sql,
                      executionTimeMs: meta.executionTimeMs,
                    }
                  : message
              )
            );

            options.onMeta?.(meta);
          },
          onChunk: (chunk) => {
            setMessages((currentMessages) =>
              currentMessages.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: `${message.content}${chunk}`,
                    }
                  : message
              )
            );
          },
        }
      );

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: response.answer,
                generatedSql: response.sql,
                executionTimeMs: response.executionTimeMs,
                isStreaming: false,
              }
            : message
        )
      );

      options.onAnswer?.(response);
      await refreshSessions(sessionId);
    } catch (nextError) {
      const nextErrorMessage = getErrorMessage(
        nextError,
        "The question could not be sent. Please try again in a moment."
      );

      setError(nextErrorMessage);
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: nextErrorMessage,
                isError: true,
                isStreaming: false,
              }
            : message
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  return {
    sessionId,
    sessions,
    messages,
    isBootstrapping,
    isSending,
    error,
    sendMessage,
    startNewSession,
    selectSession,
  };
};
const getStoredSessionId = () => {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
};

const setStoredSessionId = (value: string) => {
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, value);
  } catch {
    // Ignore storage write failures and keep the in-memory session.
  }
};

const clearStoredSessionId = () => {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage write failures and keep going.
  }
};
