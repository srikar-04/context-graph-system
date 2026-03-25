import { useEffect, useRef, useState } from "react";

import { MessageBubble } from "./MessageBubble";
import type { ChatSessionSummary, UiMessage } from "../types";

type ChatPanelProps = {
  sessionId: string | null;
  sessions: ChatSessionSummary[];
  messages: UiMessage[];
  isBootstrapping: boolean;
  isSending: boolean;
  error: string | null;
  onSendMessage: (message: string) => Promise<void>;
  onStartNewSession: () => Promise<void>;
  onSelectSession: (sessionId: string) => Promise<void>;
};

export const ChatPanel = ({
  sessionId,
  sessions,
  messages,
  isBootstrapping,
  isSending,
  error,
  onSendMessage,
  onStartNewSession,
  onSelectSession,
}: ChatPanelProps) => {
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages.length, isSending]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [draft]);

  const isReady = Boolean(sessionId) && !isBootstrapping;

  const submitDraft = async () => {
    if (!draft.trim() || !isReady || isSending) {
      return;
    }

    const nextDraft = draft;
    setDraft("");
    await onSendMessage(nextDraft);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitDraft();
  };

  const handleKeyDown = async (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    await submitDraft();
  };

  return (
    <aside className="chat-shell" aria-labelledby="chat-panel-title">
      <header className="chat-shell__header">
        <div className="chat-shell__header-top">
          <div className="chat-shell__title">
            <p className="surface-eyebrow">Chat</p>
            <h2 id="chat-panel-title">Chat with graph</h2>
          </div>

          <button
            type="button"
            className="icon-button"
            aria-label="Start a new session"
            onClick={() => void onStartNewSession()}
            disabled={isBootstrapping || isSending}
          >
            +
          </button>
        </div>

        <div className="chat-shell__sessions" role="tablist" aria-label="Chat sessions">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              role="tab"
              aria-selected={session.id === sessionId}
              className={`chat-shell__session${
                session.id === sessionId ? " chat-shell__session--active" : ""
              }`}
              onClick={() => void onSelectSession(session.id)}
            >
              {session.title}
            </button>
          ))}
        </div>
      </header>

      <div className="chat-feed" role="log" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && !isBootstrapping && (
          <div className="chat-feed__placeholder">
            Ask about a customer, invoice, delivery, payment, or journal entry.
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {isSending && (
          <div className="chat-thinking" role="status">
            Streaming answer...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        {error && (
          <p className="chat-composer__error" role="alert">
            {error}
          </p>
        )}

        <div className="chat-composer__row">
          <textarea
            id="chat-message"
            name="message"
            ref={textareaRef}
            className="chat-composer__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Analyze anything"
            rows={1}
            spellCheck={false}
            autoComplete="off"
            disabled={!isReady || isSending}
          />

          <button
            type="submit"
            className="mini-button mini-button--solid"
            disabled={!draft.trim() || !isReady || isSending}
          >
            Send
          </button>
        </div>
      </form>
    </aside>
  );
};
