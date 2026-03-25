import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import {
  ALLOWED_TABLES,
  getDatabaseSchemaPrompt,
  getSchemaMetadata,
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
      sqlExplanation: null;
      nodesReferenced: string[];
      executionTimeMs: number;
    }
  | {
      kind: "no_data";
      answer: string;
      sql: string;
      sqlExplanation: string;
      nodesReferenced: string[];
      executionTimeMs: number;
      rows: Record<string, unknown>[];
    }
  | {
      kind: "data";
      sql: string;
      sqlExplanation: string;
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
6. Use PostgreSQL syntax only.
7. Every table name and every column name must use the exact case-sensitive identifier from the schema and must be wrapped in double quotes.
8. NEVER use lowercase or unquoted table names like salesorderheader. Use "SalesOrderHeader".
9. Keep the SQL focused and safe. Return exactly one SELECT statement. No commentary. No markdown.
10. Prefer returning the identifiers and business fields needed to explain entity relationships, not only aggregates.
`.trim();

const ANSWER_SYSTEM_INSTRUCTIONS = `
You are explaining verified SAP Order-to-Cash query results to a business user.

Rules:
1. Base every claim only on the provided SQL and result rows.
2. Explain what the SQL is doing in plain English. Assume the user does not know SQL or the schema.
3. Explain the business relationship between the entities when possible.
4. Start with the direct answer first, then explain how the data was found, then explain what it means in the Order-to-Cash flow.
5. Write for a non-technical user. Avoid jargon unless you immediately explain it.
6. Do NOT dump raw arrays or JSON into the answer.
7. Keep the answer concise but helpful: usually 3 to 6 sentences.
8. If there are many rows, summarize the count and mention the most useful identifiers instead of listing everything.
9. If there is a clear direct answer, start with it.
10. Never say you are guessing or hallucinate missing facts.
11. Prefer explaining how entities connect in the Order-to-Cash flow over listing raw arrays.
12. If a result sample is only a preview, say so clearly.
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
    ?.trim() ?? "";

const SQL_KEYWORDS = new Set([
  "all",
  "and",
  "any",
  "as",
  "asc",
  "avg",
  "between",
  "by",
  "case",
  "count",
  "cross",
  "current_date",
  "date",
  "desc",
  "distinct",
  "else",
  "end",
  "exists",
  "false",
  "from",
  "full",
  "group",
  "having",
  "ilike",
  "in",
  "inner",
  "interval",
  "is",
  "join",
  "left",
  "like",
  "limit",
  "max",
  "min",
  "not",
  "null",
  "offset",
  "on",
  "or",
  "order",
  "outer",
  "right",
  "select",
  "sum",
  "then",
  "true",
  "union",
  "when",
  "where",
]);

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

const buildActiveColumnLookup = (
  referencedTables: string[],
  schemaTables: Record<string, string[]>
) => {
  const activeColumns = new Map<string, string>();
  const ambiguousColumns = new Set<string>();

  for (const tableName of referencedTables) {
    const columns = schemaTables[tableName] ?? [];

    for (const columnName of columns) {
      const lookupKey = columnName.toLowerCase();
      const existingColumn = activeColumns.get(lookupKey);

      if (existingColumn && existingColumn !== columnName) {
        ambiguousColumns.add(lookupKey);
        continue;
      }

      activeColumns.set(lookupKey, columnName);
    }
  }

  return {
    activeColumns,
    ambiguousColumns,
  };
};

const canonicalizeSqlIdentifiers = async (sql: string) => {
  const metadata = await getSchemaMetadata();

  let repairedSql = sanitizeSql(sql).replace(
    /\b(from|join)\s+"?([A-Za-z][A-Za-z0-9_]*)"?/gi,
    (segment, keyword: string, tableName: string) => {
      const canonicalTableName =
        metadata.tableNameByLowercase[tableName.toLowerCase()];

      if (!canonicalTableName) {
        return segment;
      }

      return `${keyword} "${canonicalTableName}"`;
    }
  );

  const referencedTables = Array.from(
    repairedSql.matchAll(/\b(?:from|join)\s+"?([A-Za-z][A-Za-z0-9_]*)"?/gi)
  )
    .map((match) => {
      const matchedTableName = match[1];

      if (!matchedTableName) {
        return null;
      }

      return (
        metadata.tableNameByLowercase[matchedTableName.toLowerCase()] ??
        matchedTableName
      );
    })
    .filter((tableName): tableName is string => Boolean(tableName))
    .filter(
      (tableName, index, tableNames) => tableNames.indexOf(tableName) === index
    );

  const { activeColumns, ambiguousColumns } = buildActiveColumnLookup(
    referencedTables,
    metadata.tables
  );

  repairedSql = repairedSql.replace(
    /((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*\.\s*)"?([A-Za-z_][A-Za-z0-9_]*)"?/g,
    (segment, qualifier: string, columnName: string) => {
      const lookupKey = columnName.toLowerCase();
      const canonicalColumnName = activeColumns.get(lookupKey);

      if (!canonicalColumnName || ambiguousColumns.has(lookupKey)) {
        return segment;
      }

      return `${qualifier}"${canonicalColumnName}"`;
    }
  );

  repairedSql = repairedSql.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\b/g,
    (token: string, identifier: string, offset: number, fullSql: string) => {
      const previousCharacter = fullSql[offset - 1] ?? "";
      const nextCharacter = fullSql[offset + token.length] ?? "";
      const lookupKey = identifier.toLowerCase();

      if (
        previousCharacter === '"' ||
        nextCharacter === '"' ||
        previousCharacter === "."
      ) {
        return token;
      }

      if (
        SQL_KEYWORDS.has(lookupKey) ||
        metadata.tableNameByLowercase[lookupKey] ||
        ambiguousColumns.has(lookupKey)
      ) {
        return token;
      }

      const canonicalColumnName = activeColumns.get(lookupKey);

      if (!canonicalColumnName) {
        return token;
      }

      return `"${canonicalColumnName}"`;
    }
  );

  return repairedSql;
};

const validateSql = async (sql: string) => {
  const sanitized = sanitizeSql(sql);

  if (sanitized.length === 0) {
    throw new ApiError(
      502,
      "EMPTY_SQL_GENERATED",
      "The model returned an empty SQL query."
    );
  }

  if (sanitized.replace(/;\s*$/u, "").includes(";")) {
    throw new ApiError(
      502,
      "MULTI_STATEMENT_SQL_REJECTED",
      "The model generated SQL with semicolons or multiple statements."
    );
  }

  const trimmed = await canonicalizeSqlIdentifiers(
    sanitized.replace(/;\s*$/u, "")
  );

  if (!/^select\b/i.test(trimmed)) {
    throw new ApiError(
      502,
      "UNSAFE_SQL_GENERATED",
      "The model generated SQL that was not a SELECT statement."
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

  if (nodeReferences.size > 0) {
    const adjacency = new Map<string, Set<string>>();

    for (const edge of graph.edges) {
      const sourceNeighbors = adjacency.get(edge.source) ?? new Set<string>();
      sourceNeighbors.add(edge.target);
      adjacency.set(edge.source, sourceNeighbors);

      const targetNeighbors = adjacency.get(edge.target) ?? new Set<string>();
      targetNeighbors.add(edge.source);
      adjacency.set(edge.target, targetNeighbors);
    }

    for (const nodeId of Array.from(nodeReferences)) {
      const neighbors = adjacency.get(nodeId);

      if (!neighbors) {
        continue;
      }

      for (const neighborId of neighbors) {
        nodeReferences.add(neighborId);

        if (nodeReferences.size >= 50) {
          break;
        }
      }

      if (nodeReferences.size >= 50) {
        break;
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
Allowed tables:
${ALLOWED_TABLES.map((tableName) => `- "${tableName}"`).join("\n")}

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
  sqlExplanation: string;
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

Plain-English SQL intent:
${input.sqlExplanation}

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
  sqlExplanation: string;
  rows: Record<string, unknown>[];
}) => {
  const explanationPrefix = input.sqlExplanation
    ? `To answer your question, I looked for records where ${input.sqlExplanation.toLowerCase()}.`
    : "To answer your question, I queried the relevant Order-to-Cash records.";

  if (input.rows.length === 0) {
    return `${explanationPrefix} ${NO_DATA_ANSWER}`.trim();
  }

  if (input.rows.length === 1) {
    const firstRow = input.rows[0];
    const rowSummary = Object.entries(firstRow ?? {})
      .slice(0, 4)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(", ");

    return `${explanationPrefix} I found 1 matching record for "${input.message}". The key details are ${rowSummary}.`.trim();
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
        .join(" - ")
    )
    .filter(Boolean)
    .join("; ");

  return `${explanationPrefix} I found ${input.rows.length} matching records for "${input.message}". Representative results include ${preview}.`.trim();
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
      sqlExplanation: null,
      nodesReferenced: [],
      executionTimeMs: 0,
    };
  }

  const safeSql = await validateSql(parsedResponse.sql);

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
      sqlExplanation: parsedResponse.explanation,
      nodesReferenced,
      executionTimeMs,
      rows,
    };
  }

  return {
    kind: "data",
    sql: safeSql,
    sqlExplanation: parsedResponse.explanation,
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
    sqlExplanation: prepared.sqlExplanation,
    rows: prepared.rows,
    executionTimeMs: prepared.executionTimeMs,
  });

  const fallbackAnswer = buildFallbackAnswer({
    message: input.message,
    sqlExplanation: prepared.sqlExplanation,
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
    sqlExplanation: prepared.sqlExplanation,
    rows: prepared.rows,
    executionTimeMs: prepared.executionTimeMs,
  });

  const fallbackAnswer = buildFallbackAnswer({
    message: input.message,
    sqlExplanation: prepared.sqlExplanation,
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
