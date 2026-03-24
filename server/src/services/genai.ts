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

export const generateJsonResponse = async (
  messages: ChatCompletionMessageParam[]
) => {
  const openai = getClient();
  const response = await openai.chat.completions.create({
    model,
    messages,
    temperature: 0.1,
    response_format: {
      type: "json_object",
    },
  });

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
