import { useEffect, useState } from "react";
import axios from "axios";

import {
  createChatSession,
  getChatHistory,
  getErrorMessage,
  sendChatMessage,
} from "../api/client";
import type { ChatResponse, UiMessage } from "../types";

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
}) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initializeSession = async (replaceExisting: boolean) => {
    setIsBootstrapping(true);
    setError(null);

    if (replaceExisting) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      setMessages([]);
    }

    const persistedSessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);

    if (!replaceExisting && persistedSessionId) {
      try {
        const history = await getChatHistory(persistedSessionId);
        setSessionId(history.sessionId);
        setMessages(history.messages.map(mapHistoryMessage));
        setIsBootstrapping(false);
        return;
      } catch (nextError) {
        if (axios.isAxiosError(nextError) && nextError.response?.status === 404) {
          sessionStorage.removeItem(SESSION_STORAGE_KEY);
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

    try {
      const nextSession = await createChatSession();
      sessionStorage.setItem(SESSION_STORAGE_KEY, nextSession.sessionId);
      setSessionId(nextSession.sessionId);
      setMessages([]);
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

    setMessages((currentMessages) => [
      ...currentMessages,
      optimisticUserMessage,
    ]);
    setError(null);
    setIsSending(true);

    try {
      const response = await sendChatMessage({
        sessionId,
        message: trimmedContent,
      });

      const assistantMessage: UiMessage = {
        id: `local-assistant-${Date.now()}`,
        role: "assistant",
        content: response.answer,
        generatedSql: response.sql,
        executionTimeMs: response.executionTimeMs,
        createdAt: new Date().toISOString(),
      };

      setMessages((currentMessages) => [
        ...currentMessages,
        assistantMessage,
      ]);
      options.onAnswer?.(response);
    } catch (nextError) {
      setError(
        getErrorMessage(
          nextError,
          "The question could not be sent. Please try again in a moment."
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  return {
    sessionId,
    messages,
    isBootstrapping,
    isSending,
    error,
    sendMessage,
    startNewSession,
  };
};
