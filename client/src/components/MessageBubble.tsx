import type { UiMessage } from "../types";

const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
});

const renderTimestamp = (value: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return timeFormatter.format(date);
};

const renderExecutionTime = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return `${value.toLocaleString("en-IN")} ms`;
};

type MessageBubbleProps = {
  message: UiMessage;
};

export const MessageBubble = ({ message }: MessageBubbleProps) => {
  const executionTime = renderExecutionTime(message.executionTimeMs);

  return (
    <article
      className={`message-bubble message-bubble--${message.role}${
        message.isError ? " message-bubble--error" : ""
      }`}
    >
      <header className="message-bubble__meta">
        <span className="message-bubble__role">
          {message.role === "user" ? "You" : "Assistant"}
        </span>
        <span className="message-bubble__timestamp">
          {renderTimestamp(message.createdAt)}
        </span>
      </header>

      <p className="message-bubble__content">{message.content}</p>

      {(message.generatedSql || executionTime) && (
        <footer className="message-bubble__footer">
          {executionTime && (
            <span
              className="message-chip"
              aria-label={`Execution time ${executionTime}`}
            >
              {executionTime}
            </span>
          )}

          {message.generatedSql && (
            <details className="message-sql">
              <summary>Generated SQL</summary>
              <pre>{message.generatedSql}</pre>
            </details>
          )}
        </footer>
      )}
    </article>
  );
};
