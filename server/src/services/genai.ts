import "dotenv/config";

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { ApiError } from "../utils/apiError.js";

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const baseURL =
  process.env.GEMINI_OPENAI_BASE_URL ??
  "https://generativelanguage.googleapis.com/v1beta/openai/";

let client: OpenAI | null = null;
const MODEL_RETRY_LIMIT = 3;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

export const ensureGenAiConfigured = () => {
  if (!apiKey) {
    throw new ApiError(
      503,
      "GEMINI_API_KEY_MISSING",
      "GEMINI_API_KEY is not configured for the query interface."
    );
  }
};

const getClient = () => {
  ensureGenAiConfigured();
  const configuredApiKey = apiKey;

  if (!configuredApiKey) {
    throw new ApiError(
      503,
      "GEMINI_API_KEY_MISSING",
      "GEMINI_API_KEY is not configured for the query interface."
    );
  }

  if (!client) {
    client = new OpenAI({
      apiKey: configuredApiKey,
      baseURL,
    });
  }

  return client;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const emitChunkProgressively = async (
  text: string,
  onChunk: (chunk: string) => void
) => {
  if (text.length <= 48) {
    onChunk(text);
    return;
  }

  const segments: string[] = [];
  let currentSegment = "";

  for (const token of text.split(/(\s+)/)) {
    if (!token) {
      continue;
    }

    if (
      (currentSegment + token).length > 32 &&
      currentSegment.trim().length > 0
    ) {
      segments.push(currentSegment);
      currentSegment = token;
      continue;
    }

    currentSegment += token;
  }

  if (currentSegment) {
    segments.push(currentSegment);
  }

  for (let index = 0; index < segments.length; index += 1) {
    onChunk(segments[index] ?? "");

    if (index < segments.length - 1) {
      await sleep(12);
    }
  }
};

const getErrorStatus = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
};

const getErrorCode = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
};

const getErrorType = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const type = (error as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
};

const isRetryableModelError = (error: unknown) => {
  const status = getErrorStatus(error);
  const code = getErrorCode(error)?.toLowerCase() ?? "";
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  if (status !== undefined && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }

  return (
    code.includes("timeout") ||
    code.includes("temporarily_unavailable") ||
    code.includes("connection") ||
    message.includes("timeout") ||
    message.includes("temporarily unavailable") ||
    message.includes("connection") ||
    message.includes("socket hang up") ||
    message.includes("econnreset")
  );
};

const mapModelError = (error: unknown) => {
  if (error instanceof ApiError) {
    return error;
  }

  const status = getErrorStatus(error);
  const code = getErrorCode(error);
  const type = getErrorType(error);
  const message = error instanceof Error ? error.message : String(error);
  const details = {
    status,
    code,
    type,
    message,
  };

  if (status === 400) {
    return new ApiError(
      502,
      "MODEL_REQUEST_REJECTED",
      "The model rejected the request payload.",
      details
    );
  }

  if (status === 401 || status === 403) {
    return new ApiError(
      503,
      "MODEL_AUTHENTICATION_FAILED",
      "The model provider credentials are invalid or missing permissions.",
      details
    );
  }

  if (status === 429) {
    return new ApiError(
      503,
      "MODEL_RATE_LIMITED",
      "The model provider is rate limiting requests right now. Please retry shortly.",
      details
    );
  }

  if (status !== undefined && status >= 500) {
    return new ApiError(
      502,
      "MODEL_PROVIDER_ERROR",
      "The model provider returned a temporary server error.",
      details
    );
  }

  return new ApiError(
    502,
    "MODEL_REQUEST_FAILED",
    "The model request failed before a valid response was returned.",
    details
  );
};

const runModelRequest = async <T>(
  operationName: string,
  execute: () => Promise<T>
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MODEL_RETRY_LIMIT; attempt += 1) {
    try {
      return await execute();
    } catch (error) {
      lastError = error;

      if (!isRetryableModelError(error) || attempt === MODEL_RETRY_LIMIT) {
        break;
      }

      await sleep(250 * attempt);
    }
  }

  throw mapModelError(
    lastError ??
      new Error(`${operationName} failed without a recoverable response.`)
  );
};

export const generateJsonResponse = async (
  messages: ChatCompletionMessageParam[]
) => {
  const openai = getClient();
  const response = await runModelRequest("generateJsonResponse", () =>
    openai.chat.completions.create({
      model,
      messages,
      temperature: 0.1,
      response_format: {
        type: "json_object",
      },
    })
  );

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new ApiError(
      502,
      "MODEL_RESPONSE_EMPTY",
      "The model returned an empty response."
    );
  }

  return content.trim();
};

export const generateTextResponse = async (
  messages: ChatCompletionMessageParam[]
) => {
  const openai = getClient();
  const response = await runModelRequest("generateTextResponse", () =>
    openai.chat.completions.create({
      model,
      messages,
      temperature: 0.2,
    })
  );

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new ApiError(
      502,
      "MODEL_RESPONSE_EMPTY",
      "The model returned an empty response."
    );
  }

  return content.trim();
};

export const streamTextResponse = async (
  messages: ChatCompletionMessageParam[],
  onChunk: (chunk: string) => void
) => {
  const openai = getClient();
  let stream = await runModelRequest("streamTextResponse", () =>
    openai.chat.completions.create({
      model,
      messages,
      temperature: 0.2,
      stream: true,
    })
  );

  let content = "";
  let attempt = 1;

  while (attempt <= MODEL_RETRY_LIMIT) {
    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;

        if (!delta) {
          continue;
        }

        content += delta;
        await emitChunkProgressively(delta, onChunk);
      }

      break;
    } catch (error) {
      if (
        content.length > 0 ||
        !isRetryableModelError(error) ||
        attempt === MODEL_RETRY_LIMIT
      ) {
        throw mapModelError(error);
      }

      attempt += 1;
      await sleep(250 * attempt);
      stream = await runModelRequest("streamTextResponse", () =>
        openai.chat.completions.create({
          model,
          messages,
          temperature: 0.2,
          stream: true,
        })
      );
    }
  }

  const trimmedContent = content.trim();

  if (!trimmedContent) {
    throw new ApiError(
      502,
      "MODEL_RESPONSE_EMPTY",
      "The model returned an empty streamed response."
    );
  }

  return trimmedContent;
};
