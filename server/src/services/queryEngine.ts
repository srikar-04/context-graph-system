import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import {
  ALLOWED_TABLES,
  getDatabaseSchemaPrompt,
} from "../constants/schema.js";
import {
  getCachedGraph,
  rebuildGraphCache,
} from "../services/graphCacheService.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/apiError.js";
import {
  ensureChatSession,
  getRecentChatMessages,
  saveChatMessage,
} from "./chatHistory.js";
import { ensureGenAiConfigured, generateJsonResponse } from "./genai.js";

const llmSuccessSchema = z.object({
  sql: z.string().min(1),
  explanation: z.string().min(1),
});

const llmOutOfScopeSchema = z.object({
  error: z.literal("out_of_scope"),
});

type QueryResponse = {
  answer: string;
  sql: string | null;
  nodesReferenced: string[];
  executionTimeMs: number;
};

const buildHistoryTranscript = (
  messages: Awaited<ReturnType<typeof getRecentChatMessages>>
) =>
  messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");

const SYSTEM_INSTRUCTIONS = `
You are a data analyst assistant for an SAP Order-to-Cash (O2C) dataset.
You have access ONLY to the PostgreSQL tables in the schema below.

Rules:
1. ONLY answer questions that can be answered using the provided tables.
2. Return ONLY a valid JSON object.
3. For valid dataset questions, return exactly:
   {"sql":"<SELECT query>", "explanation":"<natural language template using {{RESULT}}>"}
4. If the question is unrelated, not answerable from the dataset, or asks for general knowledge, return exactly:
   {"error":"out_of_scope"}
5. NEVER generate INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, or any non-SELECT SQL.
6. Use table names and column names exactly as provided.
7. Keep the SQL focused and safe. No multiple statements. No semicolons.
8. The explanation must stay grounded in the SQL result only.
`.trim();

const sanitizeModelResponse = (text: string) =>
  text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const validateSql = (sql: string) => {
  const trimmed = sql.trim();

  if (!/^select\b/i.test(trimmed)) {
    throw new ApiError(
      502,
      "UNSAFE_SQL_GENERATED",
      "The model generated SQL that was not a SELECT statement."
    );
  }

  if (trimmed.includes(";")) {
    throw new ApiError(
      502,
      "MULTI_STATEMENT_SQL_REJECTED",
      "The model generated SQL with semicolons or multiple statements."
    );
  }

  if (
    /\b(insert|update|delete|drop|alter|truncate|grant|revoke|merge|call|copy|create)\b/i.test(
      trimmed
    )
  ) {
    throw new ApiError(
      502,
      "FORBIDDEN_SQL_KEYWORD",
      "The model generated SQL containing forbidden keywords."
    );
  }

  const referencedTables = Array.from(
    trimmed.matchAll(/\b(?:from|join)\s+"?([A-Za-z][A-Za-z0-9_]*)"?/gi)
  ).map((match) => match[1]);

  if (referencedTables.length === 0) {
    throw new ApiError(
      502,
      "NO_TABLE_REFERENCES",
      "The model generated SQL without a valid table reference."
    );
  }

  const invalidTables = referencedTables.filter(
    (table) =>
      table &&
      !ALLOWED_TABLES.includes(table as (typeof ALLOWED_TABLES)[number])
  );

  if (invalidTables.length > 0) {
    throw new ApiError(
      502,
      "UNKNOWN_TABLE_REFERENCED",
      "The model generated SQL referencing tables outside the allowed schema.",
      {
        tables: invalidTables,
      }
    );
  }
};

const renderRows = (rows: Record<string, unknown>[]) => {
  if (rows.length === 0) {
    return "No data was found for this query in the dataset.";
  }

  if (rows.length === 1) {
    const firstRow = rows[0];

    if (!firstRow) {
      return "No data was found for this query in the dataset.";
    }

    const entries = Object.entries(firstRow);

    if (entries.length === 1) {
      return String(entries[0]?.[1] ?? "");
    }
  }

  return JSON.stringify(rows, null, 2);
};

const finalizeAnswer = (
  explanation: string,
  rows: Record<string, unknown>[]
) => {
  const renderedRows = renderRows(rows);

  if (!explanation.includes("{{RESULT}}")) {
    return `${explanation}\n\n${renderedRows}`.trim();
  }

  return explanation.replaceAll("{{RESULT}}", renderedRows).trim();
};

const collectScalarValues = (value: unknown, values: Set<string>) => {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectScalarValues(item, values);
    }
    return;
  }

  if (typeof value === "object") {
    for (const nestedValue of Object.values(value)) {
      collectScalarValues(nestedValue, values);
    }
    return;
  }

  if (typeof value === "string" || typeof value === "number") {
    values.add(String(value));
  }
};

const extractNodeReferences = async (rows: Record<string, unknown>[]) => {
  const graph = getCachedGraph() ?? (await rebuildGraphCache());

  if (!graph) {
    return [];
  }

  const businessKeyIndex = new Map<string, string[]>();

  for (const node of graph.nodes) {
    const businessKey = node.data.businessKey;

    if (typeof businessKey !== "string" || businessKey.length === 0) {
      continue;
    }

    const nodeIds = businessKeyIndex.get(businessKey) ?? [];
    nodeIds.push(node.id);
    businessKeyIndex.set(businessKey, nodeIds);
  }

  const discoveredValues = new Set<string>();

  for (const row of rows) {
    collectScalarValues(row, discoveredValues);
  }

  const nodeReferences = new Set<string>();

  for (const value of discoveredValues) {
    const matches = businessKeyIndex.get(value);

    if (!matches) {
      continue;
    }

    for (const nodeId of matches) {
      nodeReferences.add(nodeId);
    }
  }

  return Array.from(nodeReferences).slice(0, 50);
};

const buildMessages = async (input: {
  message: string;
  historyTranscript: string;
}): Promise<ChatCompletionMessageParam[]> => {
  const schemaPrompt = await getDatabaseSchemaPrompt();

  return [
    {
      role: "system",
      content: SYSTEM_INSTRUCTIONS,
    },
    {
      role: "user",
      content: `
Schema:
${schemaPrompt}

Conversation history:
${input.historyTranscript || "No previous conversation history."}

User question:
${input.message}
`.trim(),
    },
  ];
};

const parseModelResponse = (rawText: string) => {
  const sanitized = sanitizeModelResponse(rawText);
  let parsed: unknown;

  try {
    parsed = JSON.parse(sanitized);
  } catch {
    throw new ApiError(
      502,
      "MODEL_RESPONSE_INVALID_JSON",
      "The model returned invalid JSON.",
      {
        rawText,
      }
    );
  }

  const outOfScope = llmOutOfScopeSchema.safeParse(parsed);

  if (outOfScope.success) {
    return outOfScope.data;
  }

  const success = llmSuccessSchema.safeParse(parsed);

  if (!success.success) {
    throw new ApiError(
      502,
      "MODEL_RESPONSE_INVALID_SHAPE",
      "The model returned a response with an unexpected shape.",
      {
        rawText,
      }
    );
  }

  return success.data;
};

export const answerQuery = async (input: {
  sessionId: string;
  message: string;
}): Promise<QueryResponse> => {
  ensureGenAiConfigured();
  await ensureChatSession(input.sessionId);
  await saveChatMessage({
    sessionId: input.sessionId,
    role: "user",
    content: input.message,
  });

  const history = await getRecentChatMessages(input.sessionId);
  const messages = await buildMessages({
    message: input.message,
    historyTranscript: buildHistoryTranscript(history),
  });

  const rawModelResponse = await generateJsonResponse(messages);
  const parsedResponse = parseModelResponse(rawModelResponse);

  if ("error" in parsedResponse) {
    const answer =
      "This system is designed to answer questions about the SAP Order-to-Cash dataset only.";

    await saveChatMessage({
      sessionId: input.sessionId,
      role: "assistant",
      content: answer,
    });

    return {
      answer,
      sql: null,
      nodesReferenced: [],
      executionTimeMs: 0,
    };
  }

  validateSql(parsedResponse.sql);

  const startedAt = Date.now();
  let rows: Record<string, unknown>[];

  try {
    rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      parsedResponse.sql
    );
  } catch (error) {
    throw new ApiError(
      502,
      "SQL_EXECUTION_FAILED",
      "The generated SQL could not be executed safely.",
      {
        message: error instanceof Error ? error.message : String(error),
      }
    );
  }

  const executionTimeMs = Date.now() - startedAt;

  const answer =
    rows.length === 0
      ? "No data was found for this query in the dataset."
      : finalizeAnswer(parsedResponse.explanation, rows);

  const nodesReferenced = await extractNodeReferences(rows);

  await saveChatMessage({
    sessionId: input.sessionId,
    role: "assistant",
    content: answer,
    generatedSql: parsedResponse.sql,
  });

  return {
    answer,
    sql: parsedResponse.sql,
    nodesReferenced,
    executionTimeMs,
  };
};
