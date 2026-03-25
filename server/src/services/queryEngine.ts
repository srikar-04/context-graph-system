import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import {
  ALLOWED_TABLES,
  getDatabaseSchemaPrompt,
} from "../constants/schema.js";
import { getCachedGraph, rebuildGraphCache } from "./graphCacheService.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../utils/apiError.js";
import {
  ensureChatSession,
  getRecentChatMessages,
  saveChatMessage,
} from "./chatHistory.js";
import {
  ensureGenAiConfigured,
  generateJsonResponse,
  generateTextResponse,
  streamTextResponse,
} from "./genai.js";

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

type PreparedQueryResult =
  | {
      kind: "out_of_scope";
      answer: string;
      sql: null;
      nodesReferenced: string[];
      executionTimeMs: number;
    }
  | {
      kind: "no_data";
      answer: string;
      sql: string;
      nodesReferenced: string[];
      executionTimeMs: number;
      rows: Record<string, unknown>[];
    }
  | {
      kind: "data";
      sql: string;
      nodesReferenced: string[];
      executionTimeMs: number;
      rows: Record<string, unknown>[];
    };

const buildHistoryTranscript = (
  messages: Awaited<ReturnType<typeof getRecentChatMessages>>
) =>
  messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");

const SQL_SYSTEM_INSTRUCTIONS = `
You are a data analyst assistant for an SAP Order-to-Cash (O2C) dataset.
You have access ONLY to the PostgreSQL tables in the schema below.

Rules:
1. ONLY answer questions that can be answered using the provided tables.
2. Return ONLY a valid JSON object.
3. For valid dataset questions, return exactly:
   {"sql":"<SELECT query>", "explanation":"<brief reasoning note>"}
4. If the question is unrelated, not answerable from the dataset, or asks for general knowledge, return exactly:
   {"error":"out_of_scope"}
5. NEVER generate INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, or any non-SELECT SQL.
6. Use table names and column names exactly as provided.
7. Keep the SQL focused and safe. No multiple statements. No semicolons.
8. Prefer returning the identifiers and business fields needed to explain entity relationships, not only aggregates.
`.trim();

const ANSWER_SYSTEM_INSTRUCTIONS = `
You are explaining verified SAP Order-to-Cash query results to a business user.

Rules:
1. Base every claim only on the provided SQL and result rows.
2. Explain the business relationship between the entities when possible.
3. Do NOT dump raw arrays or JSON into the answer.
4. Keep the answer concise and readable: usually 2 to 5 sentences.
5. If there are many rows, summarize the count and mention the most useful identifiers.
6. If there is a clear direct answer, start with it.
7. Never say you are guessing or hallucinate missing facts.
`.trim();

const OUT_OF_SCOPE_ANSWER =
  "This system is designed to answer questions about the SAP Order-to-Cash dataset only.";
const NO_DATA_ANSWER = "No data was found for this query in the dataset.";

const sanitizeModelResponse = (text: string) =>
  text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

const normalizeReferenceKey = (value: string) => value.trim();
const sanitizeSql = (sql: string) =>
  sql
    .trim()
    .replace(/^```sql\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .split(";")[0]
    ?.trim() ?? "";

const expandReferenceKeys = (value: string) => {
  const normalized = normalizeReferenceKey(value);

  if (!normalized) {
    return [];
  }

  const keys = new Set<string>([normalized]);

  if (/^\d+$/.test(normalized)) {
    const unpadded = normalized.replace(/^0+/, "") || "0";
    keys.add(unpadded);

    if (normalized.length < 6) {
      keys.add(normalized.padStart(6, "0"));
    }
  }

  return Array.from(keys);
};

const validateSql = (sql: string) => {
  const trimmed = sanitizeSql(sql);

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

  return trimmed;
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

const extractLiteralCandidates = (text: string) => {
  const values = new Set<string>();

  for (const match of text.matchAll(/'([^']+)'/g)) {
    if (match[1]) {
      values.add(match[1]);
    }
  }

  for (const match of text.matchAll(/\b\d{4,}\b/g)) {
    if (match[0]) {
      values.add(match[0]);
    }
  }

  return values;
};

const extractNodeReferences = async (input: {
  rows: Record<string, unknown>[];
  sql: string;
  message: string;
}) => {
  const graph = getCachedGraph() ?? (await rebuildGraphCache());

  if (!graph) {
    return [];
  }

  const referenceIndex = new Map<string, Set<string>>();

  const addReference = (rawValue: string, nodeId: string) => {
    for (const key of expandReferenceKeys(rawValue)) {
      const nodeIds = referenceIndex.get(key) ?? new Set<string>();
      nodeIds.add(nodeId);
      referenceIndex.set(key, nodeIds);
    }
  };

  for (const node of graph.nodes) {
    addReference(node.id, node.id);
    addReference(node.label, node.id);

    const nodeValues = new Set<string>();
    collectScalarValues(node.data, nodeValues);

    for (const value of nodeValues) {
      addReference(value, node.id);
    }
  }

  const discoveredValues = new Set<string>();

  for (const row of input.rows) {
    collectScalarValues(row, discoveredValues);
  }

  for (const value of extractLiteralCandidates(input.sql)) {
    discoveredValues.add(value);
  }

  for (const value of extractLiteralCandidates(input.message)) {
    discoveredValues.add(value);
  }

  const nodeReferences = new Set<string>();

  for (const value of discoveredValues) {
    for (const key of expandReferenceKeys(value)) {
      const matches = referenceIndex.get(key);

      if (!matches) {
        continue;
      }

      for (const nodeId of matches) {
        nodeReferences.add(nodeId);
      }
    }
  }

  return Array.from(nodeReferences).slice(0, 50);
};

const buildSqlMessages = async (input: {
  message: string;
  historyTranscript: string;
}): Promise<ChatCompletionMessageParam[]> => {
  const schemaPrompt = await getDatabaseSchemaPrompt();

  return [
    {
      role: "system",
      content: SQL_SYSTEM_INSTRUCTIONS,
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

const buildAnswerMessages = (input: {
  message: string;
  sql: string;
  rows: Record<string, unknown>[];
  executionTimeMs: number;
}): ChatCompletionMessageParam[] => {
  const previewRows = input.rows.slice(0, 12);

  return [
    {
      role: "system",
      content: ANSWER_SYSTEM_INSTRUCTIONS,
    },
    {
      role: "user",
      content: `
User question:
${input.message}

Executed SQL:
${input.sql}

Execution time (ms):
${input.executionTimeMs}

Result row count:
${input.rows.length}

Result sample:
${JSON.stringify(previewRows, null, 2)}
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

const buildFallbackAnswer = (input: {
  message: string;
  rows: Record<string, unknown>[];
}) => {
  if (input.rows.length === 0) {
    return NO_DATA_ANSWER;
  }

  if (input.rows.length === 1) {
    const firstRow = input.rows[0];
    const rowSummary = Object.entries(firstRow ?? {})
      .slice(0, 4)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(", ");

    return `I found 1 matching record for "${input.message}". ${rowSummary}`.trim();
  }

  const preview = input.rows
    .slice(0, 4)
    .map((row) =>
      Object.values(row)
        .filter(
          (value) =>
            value !== null &&
            value !== undefined &&
            (typeof value === "string" || typeof value === "number")
        )
        .slice(0, 3)
        .join(" • ")
    )
    .filter(Boolean)
    .join("; ");

  return `I found ${input.rows.length} matching records for "${input.message}". Representative values include ${preview}.`.trim();
};

const prepareQueryExecution = async (input: {
  sessionId: string;
  message: string;
}): Promise<PreparedQueryResult> => {
  ensureGenAiConfigured();
  await ensureChatSession(input.sessionId);

  const history = await getRecentChatMessages(input.sessionId);

  await saveChatMessage({
    sessionId: input.sessionId,
    role: "user",
    content: input.message,
  });

  const messages = await buildSqlMessages({
    message: input.message,
    historyTranscript: buildHistoryTranscript(history),
  });

  const rawModelResponse = await generateJsonResponse(messages);
  const parsedResponse = parseModelResponse(rawModelResponse);

  if ("error" in parsedResponse) {
    return {
      kind: "out_of_scope",
      answer: OUT_OF_SCOPE_ANSWER,
      sql: null,
      nodesReferenced: [],
      executionTimeMs: 0,
    };
  }

  const safeSql = validateSql(parsedResponse.sql);

  const startedAt = Date.now();
  let rows: Record<string, unknown>[];

  try {
    rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(safeSql);
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

  const nodesReferenced = await extractNodeReferences({
    rows,
    sql: safeSql,
    message: input.message,
  });

  if (rows.length === 0) {
    return {
      kind: "no_data",
      answer: NO_DATA_ANSWER,
      sql: safeSql,
      nodesReferenced,
      executionTimeMs,
      rows,
    };
  }

  return {
    kind: "data",
    sql: safeSql,
    nodesReferenced,
    executionTimeMs,
    rows,
  };
};

export const answerQuery = async (input: {
  sessionId: string;
  message: string;
}): Promise<QueryResponse> => {
  const prepared = await prepareQueryExecution(input);

  if (prepared.kind === "out_of_scope" || prepared.kind === "no_data") {
    await saveChatMessage({
      sessionId: input.sessionId,
      role: "assistant",
      content: prepared.answer,
      generatedSql: prepared.sql,
    });

    return {
      answer: prepared.answer,
      sql: prepared.sql,
      nodesReferenced: prepared.nodesReferenced,
      executionTimeMs: prepared.executionTimeMs,
    };
  }

  const answerMessages = buildAnswerMessages({
    message: input.message,
    sql: prepared.sql,
    rows: prepared.rows,
    executionTimeMs: prepared.executionTimeMs,
  });

  const fallbackAnswer = buildFallbackAnswer({
    message: input.message,
    rows: prepared.rows,
  });

  let answer = fallbackAnswer;

  try {
    answer = await generateTextResponse(answerMessages);
  } catch {
    // `answer` is already initialized to `fallbackAnswer`, so we don't need
    // to reassign it here.
  }

  await saveChatMessage({
    sessionId: input.sessionId,
    role: "assistant",
    content: answer,
    generatedSql: prepared.sql,
  });

  return {
    answer,
    sql: prepared.sql,
    nodesReferenced: prepared.nodesReferenced,
    executionTimeMs: prepared.executionTimeMs,
  };
};

export const streamAnswerQuery = async (
  input: {
    sessionId: string;
    message: string;
  },
  handlers: {
    onMeta: (meta: {
      sql: string | null;
      nodesReferenced: string[];
      executionTimeMs: number;
    }) => void;
    onChunk: (chunk: string) => void;
  }
): Promise<QueryResponse> => {
  const prepared = await prepareQueryExecution(input);

  handlers.onMeta({
    sql: prepared.sql,
    nodesReferenced: prepared.nodesReferenced,
    executionTimeMs: prepared.executionTimeMs,
  });

  if (prepared.kind === "out_of_scope" || prepared.kind === "no_data") {
    handlers.onChunk(prepared.answer);

    await saveChatMessage({
      sessionId: input.sessionId,
      role: "assistant",
      content: prepared.answer,
      generatedSql: prepared.sql,
    });

    return {
      answer: prepared.answer,
      sql: prepared.sql,
      nodesReferenced: prepared.nodesReferenced,
      executionTimeMs: prepared.executionTimeMs,
    };
  }

  const answerMessages = buildAnswerMessages({
    message: input.message,
    sql: prepared.sql,
    rows: prepared.rows,
    executionTimeMs: prepared.executionTimeMs,
  });

  const fallbackAnswer = buildFallbackAnswer({
    message: input.message,
    rows: prepared.rows,
  });

  let answer = fallbackAnswer;

  try {
    answer = await streamTextResponse(answerMessages, handlers.onChunk);
  } catch {
    handlers.onChunk(fallbackAnswer);
    // `answer` is already initialized to `fallbackAnswer`, so we don't need
    // to reassign it here.
  }

  await saveChatMessage({
    sessionId: input.sessionId,
    role: "assistant",
    content: answer,
    generatedSql: prepared.sql,
  });

  return {
    answer,
    sql: prepared.sql,
    nodesReferenced: prepared.nodesReferenced,
    executionTimeMs: prepared.executionTimeMs,
  };
};
