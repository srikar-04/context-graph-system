import { useEffect, useRef, useState } from "react";

import { MessageBubble } from "./MessageBubble";
import type { UiMessage } from "../types";

const starterPrompts = [
  "Show billing documents for customer 320000083",
  "Find deliveries that were created but not billed",
  "Which payments cleared invoice 90000036?",
];

type ChatPanelProps = {
  sessionId: string | null;
  messages: UiMessage[];
  isBootstrapping: boolean;
  isSending: boolean;
  error: string | null;
  onSendMessage: (message: string) => Promise<void>;
  onStartNewSession: () => Promise<void>;
};

export const ChatPanel = ({
  sessionId,
  messages,
  isBootstrapping,
  isSending,
  error,
  onSendMessage,
  onStartNewSession,
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

  const isReady = Boolean(sessionId) && !isBootstrapping;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!draft.trim() || !isReady || isSending) {
      return;
    }

    const nextDraft = draft;
    setDraft("");
    await onSendMessage(nextDraft);
  };

  const applyPrompt = (prompt: string) => {
    setDraft(prompt);
    textareaRef.current?.focus();
  };

  return (
    <aside className="panel panel--chat" aria-labelledby="chat-panel-title">
      <header className="panel__header panel__header--chat">
        <div>
          <p className="panel__eyebrow">Grounded Answers</p>
          <h2 id="chat-panel-title">Dataset Conversation</h2>
          <p className="panel__copy">
            Ask for customers, orders, deliveries, invoices, journal entries,
            or payments. Every response is backed by SQL.
          </p>
        </div>

        <button
          type="button"
          className="ghost-button"
          onClick={() => void onStartNewSession()}
          disabled={isBootstrapping || isSending}
        >
          New Session
        </button>
      </header>

      <div className="chat-status" aria-live="polite">
        <span className="chat-status__pill">
          {isBootstrapping ? "Starting session…" : "Session ready"}
        </span>
        {sessionId && <code>{sessionId}</code>}
      </div>

      {messages.length === 0 && !isBootstrapping && (
        <section className="starter-panel" aria-labelledby="starter-prompts-title">
          <h3 id="starter-prompts-title">Start with a grounded question</h3>
          <p>
            The backend is already seeded and the graph is live, so you can
            jump straight into business questions.
          </p>
          <div className="starter-prompts">
            {starterPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="starter-prompts__button"
                onClick={() => applyPrompt(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="chat-feed" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {isSending && (
          <div className="chat-thinking" role="status">
            The assistant is generating SQL and grounding the answer…
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        <label className="chat-composer__label" htmlFor="chat-message">
          Ask about the SAP Order-to-Cash dataset
        </label>
        <textarea
          id="chat-message"
          name="message"
          ref={textareaRef}
          className="chat-composer__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about a customer, invoice, delivery, or payment…"
          rows={4}
          spellCheck={false}
          autoComplete="off"
          disabled={!isReady || isSending}
        />

        {error && (
          <p className="chat-composer__error" role="alert">
            {error}
          </p>
        )}

        <div className="chat-composer__actions">
          <p className="chat-composer__hint">
            Use concrete IDs for the strongest answers.
          </p>
          <button
            type="submit"
            className="primary-button"
            disabled={!draft.trim() || !isReady || isSending}
          >
            {isSending ? "Sending…" : "Send Question"}
          </button>
        </div>
      </form>
    </aside>
  );
};
