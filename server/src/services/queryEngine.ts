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
import type { GraphNodeType } from "../types/graph.js";

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

type HighlightMode = "strict" | "relational" | "primary_only";

type QueryPlan = {
  promptHints: string[];
  directSql: {
    sql: string;
    explanation: string;
  } | null;
  highlightMode: HighlightMode;
  clarification: string | null;
};

type RecentChatMessage = Awaited<
  ReturnType<typeof getRecentChatMessages>
>[number];
type ProductDeliveryRelationMode =
  | "delivery_document_pairs"
  | "delivery_item_links";

type PreparedQueryResult =
  | {
      kind: "clarification";
      answer: string;
      sql: null;
      sqlExplanation: null;
      highlightMode: HighlightMode;
      nodesReferenced: string[];
      executionTimeMs: number;
    }
  | {
      kind: "out_of_scope";
      answer: string;
      sql: null;
      sqlExplanation: null;
      highlightMode: HighlightMode;
      nodesReferenced: string[];
      executionTimeMs: number;
    }
  | {
      kind: "no_data";
      answer: string;
      sql: string;
      sqlExplanation: string;
      highlightMode: HighlightMode;
      nodesReferenced: string[];
      executionTimeMs: number;
      rows: Record<string, unknown>[];
    }
  | {
      kind: "data";
      sql: string;
      sqlExplanation: string;
      highlightMode: HighlightMode;
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
11. When the user asks for incomplete, broken, missing, or unmatched Order-to-Cash flows, reason through document presence with LEFT JOINs across sales orders, delivery items, billing items, journal entries, and payments instead of relying only on status flags.
12. When the user writes a document item in compact form like 740565/40 or S40604/40, split it into the header document id and the normalized item id. Prefer the normalized item columns such as "salesOrderItemNormalized", "deliveryDocumentItemNormalized", "billingDocumentItemNormalized", "referenceSdDocumentItemNormalized", and "salesDocumentItemNormalized" when filtering short item numbers.
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
const IDENTIFIER_COLUMN_PATTERN =
  /(businesspartner|customer|product|material|salesorder|deliverydocument|billingdocument|accountingdocument|referencedocument|invoicereference|salesdocument|glaccount|companycode|fiscalyear|itemnormalized|scheduleline|businesskey)/i;
const TABLE_TO_NODE_TYPES: Partial<
  Record<(typeof ALLOWED_TABLES)[number], GraphNodeType[]>
> = {
  BusinessPartner: ["BusinessPartner"],
  Plant: ["Plant"],
  Product: ["Product"],
  ProductDescription: ["Product"],
  ProductPlant: ["Product", "Plant"],
  ProductStorageLocation: ["Product", "Plant"],
  SalesOrderHeader: ["SalesOrder"],
  SalesOrderItem: ["SalesOrderItem"],
  SalesOrderScheduleLine: ["ScheduleLine"],
  OutboundDeliveryHeader: ["OutboundDelivery"],
  OutboundDeliveryItem: ["OutboundDeliveryItem"],
  BillingDocumentHeader: ["BillingDocument"],
  BillingDocumentCancellation: ["BillingDocument"],
  BillingDocumentItem: ["BillingDocumentItem"],
  JournalEntryAccountsReceivable: ["JournalEntry"],
  PaymentAccountsReceivable: ["Payment"],
};

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
const normalizeItemNumber = (value: string) => {
  const normalized = value.trim().replace(/^0+/, "");
  return normalized === "" ? "0" : normalized;
};

const escapeSqlLiteral = (value: string) => value.replace(/'/g, "''");

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

const extractReferencedTablesFromSql = (sql: string) =>
  Array.from(sql.matchAll(/\b(?:from|join)\s+"?([A-Za-z][A-Za-z0-9_]*)"?/gi))
    .map((match) => match[1])
    .filter((tableName): tableName is string => Boolean(tableName))
    .filter(
      (tableName, index, tableNames) => tableNames.indexOf(tableName) === index
    );

const extractSalesOrderItemReference = (message: string) => {
  if (!/(sales order item|sales order|order item)/i.test(message)) {
    return null;
  }

  const match = message.match(/\b([A-Za-z]?\d{4,})\s*\/\s*(\d{1,6})\b/);

  if (!match) {
    return null;
  }

  const salesOrder = match[1];
  const itemNumber = match[2];

  if (!salesOrder || !itemNumber) {
    return null;
  }

  return {
    salesOrder,
    rawItemNumber: itemNumber,
    normalizedItemNumber: normalizeItemNumber(itemNumber),
  };
};

const extractBillingDocumentItemReference = (message: string) => {
  if (!/(billing item|billing document item|billing document)/i.test(message)) {
    return null;
  }

  const match = message.match(/\b(\d{6,})\s*\/\s*(\d{1,6})\b/);

  if (!match) {
    return null;
  }

  const billingDocument = match[1];
  const itemNumber = match[2];

  if (!billingDocument || !itemNumber) {
    return null;
  }

  return {
    billingDocument,
    rawItemNumber: itemNumber,
    normalizedItemNumber: normalizeItemNumber(itemNumber),
  };
};

const isBrokenFlowQuery = (message: string) =>
  /(broken|incomplete|missing|unmatched).*(flow|flows)|delivered\b.*\bnot billed|billed\b.*\bwithout delivery|order to cash flow/i.test(
    message
  );

const isRelationalMessage = (message: string) =>
  /(link|linked|relationship|relationships|flow|flows|path|chain|connected|connect|incomplete|broken)/i.test(
    message
  );

const needsClarificationForBroadRelationQuestion = (message: string) =>
  isProductDeliveryRelationQuery(message) &&
  /\bif the count is low\b/i.test(message) &&
  !/(<=|>=|<|>|less than|greater than|under|below|over|more than)\s*\d+/i.test(
    message
  );

const isProductDeliveryRelationQuery = (message: string) =>
  /(product).*(delivery)|(delivery).*(product)/i.test(message) &&
  /(relation|relations|related|count|how many)/i.test(message);

const isBillingFlowTraceQuery = (message: string) =>
  /(trace|show|follow).*(flow|chain|path)|sales order.*delivery.*billing.*journal entry|journal entry.*billing/i.test(
    message
  );

const isProductDeliveryClarificationPrompt = (message: string) =>
  /product-to-delivery/i.test(message) && /low relation count/i.test(message);

const parseLowRelationThreshold = (message: string) => {
  const patterns = [
    /<=\s*(\d+)/i,
    /less than or equal to\s*(\d+)/i,
    /at most\s*(\d+)/i,
    /up to\s*(\d+)/i,
    /below\s*(\d+)/i,
    /under\s*(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    const value = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;

    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
};

const parseProductDeliveryRelationMode = (
  message: string
): ProductDeliveryRelationMode | null => {
  if (
    /(item link|item links|item-level|item level|delivery item links?|item pairs?)/i.test(
      message
    )
  ) {
    return "delivery_item_links";
  }

  if (
    /(delivery-document pairs?|delivery document pairs?|document pairs?|document-level|document level)/i.test(
      message
    )
  ) {
    return "delivery_document_pairs";
  }

  return null;
};

const resolveProductDeliveryClarification = (input: {
  message: string;
  history: RecentChatMessage[];
}) => {
  const recentHistory = input.history.slice(-4);
  const hasClarificationPrompt = recentHistory.some(
    (entry) =>
      entry.role === "assistant" &&
      isProductDeliveryClarificationPrompt(entry.content)
  );
  const hasRecentBroadQuestion = recentHistory.some(
    (entry) =>
      entry.role === "user" && isProductDeliveryRelationQuery(entry.content)
  );

  if (!hasClarificationPrompt || !hasRecentBroadQuestion) {
    return null;
  }

  const relationMode = parseProductDeliveryRelationMode(input.message);
  const lowThreshold = parseLowRelationThreshold(input.message);

  if (!relationMode && !lowThreshold) {
    return null;
  }

  return {
    relationMode,
    lowThreshold,
  };
};

const buildBrokenFlowSql = () => ({
  sql: `
SELECT
  soh."salesOrder",
  soh."soldToParty",
  soh."creationDate",
  soh."overallDeliveryStatus",
  soh."overallOrdReltdBillgStatus",
  CAST(COUNT(DISTINCT soi."salesOrderItemNormalized") AS INTEGER) AS "salesOrderItemCount",
  CAST(SUM(
    CASE
      WHEN odi."deliveryDocument" IS NOT NULL AND bdi."billingDocument" IS NULL THEN 1
      ELSE 0
    END
  ) AS INTEGER) AS "deliveredNotBilledItemCount",
  CASE
    WHEN COALESCE(soh."overallOrdReltdBillgStatus", '') = 'C'
      AND COALESCE(soh."overallDeliveryStatus", '') <> 'C'
    THEN true
    ELSE false
  END AS "billedWithoutCompleteDelivery"
FROM "SalesOrderHeader" soh
JOIN "SalesOrderItem" soi
  ON soi."salesOrder" = soh."salesOrder"
LEFT JOIN "OutboundDeliveryItem" odi
  ON odi."referenceSdDocument" = soi."salesOrder"
 AND odi."referenceSdDocumentItemNormalized" = soi."salesOrderItemNormalized"
LEFT JOIN "BillingDocumentItem" bdi
  ON bdi."referenceSdDocument" = odi."deliveryDocument"
 AND bdi."referenceSdDocumentItemNormalized" = odi."deliveryDocumentItemNormalized"
GROUP BY
  soh."salesOrder",
  soh."soldToParty",
  soh."creationDate",
  soh."overallDeliveryStatus",
  soh."overallOrdReltdBillgStatus"
HAVING
  SUM(
    CASE
      WHEN odi."deliveryDocument" IS NOT NULL AND bdi."billingDocument" IS NULL THEN 1
      ELSE 0
    END
  ) > 0
  OR (
    COALESCE(soh."overallOrdReltdBillgStatus", '') = 'C'
    AND COALESCE(soh."overallDeliveryStatus", '') <> 'C'
  )
ORDER BY
  "deliveredNotBilledItemCount" DESC,
  "billedWithoutCompleteDelivery" DESC,
  soh."salesOrder"
LIMIT 50
  `.trim(),
  explanation:
    "the sales order has delivered items that still do not have matching billing items, or the order looks billed complete while delivery is not complete",
});

const buildProductDeliveryRelationSql = (input?: {
  relationMode?: ProductDeliveryRelationMode | null;
  lowThreshold?: number | null;
}) => {
  const relationMode = input?.relationMode ?? "delivery_document_pairs";
  const normalizedThreshold =
    input?.lowThreshold && Number.isFinite(input.lowThreshold)
      ? Math.max(1, Math.min(input.lowThreshold, 200))
      : null;
  const relationColumns =
    relationMode === "delivery_item_links"
      ? `soi."material" AS "product",
    odi."deliveryDocument",
    odi."deliveryDocumentItem"`
      : `soi."material" AS "product",
    odi."deliveryDocument"`;
  const selectedNullableColumns =
    relationMode === "delivery_item_links"
      ? `,
  rel."product",
  rel."deliveryDocument",
  rel."deliveryDocumentItem"`
      : `,
  rel."product",
  rel."deliveryDocument"`;
  const orderBy =
    relationMode === "delivery_item_links"
      ? `rel."product" NULLS LAST,
  rel."deliveryDocument" NULLS LAST,
  rel."deliveryDocumentItem" NULLS LAST`
      : `rel."product" NULLS LAST,
  rel."deliveryDocument" NULLS LAST`;
  const joinClause = normalizedThreshold
    ? `LEFT JOIN "ProductDeliveryRelations" rel
  ON rc."totalRelationCount" <= ${normalizedThreshold}`
    : `LEFT JOIN "ProductDeliveryRelations" rel
  ON true`;
  const explanation =
    relationMode === "delivery_item_links"
      ? normalizedThreshold
        ? `each relation is counted at the delivery-item level by linking a sales order item's material to the exact delivery item that fulfilled it, and the detailed rows are shown only when the total relation count is at most ${normalizedThreshold}`
        : "each relation is counted at the delivery-item level by linking a sales order item's material to the exact delivery item that fulfilled it"
      : normalizedThreshold
        ? `each relation is counted as a distinct product and delivery-document pair by linking a sales order item's material to the delivery document that fulfilled it, and the detailed rows are shown only when the total relation count is at most ${normalizedThreshold}`
        : "each relation is counted as a distinct product and delivery-document pair by linking a sales order item's material to the delivery document that fulfilled it";

  return {
    sql: `
WITH "ProductDeliveryRelations" AS (
  SELECT DISTINCT
    ${relationColumns}
  FROM "SalesOrderItem" soi
  JOIN "OutboundDeliveryItem" odi
    ON odi."referenceSdDocument" = soi."salesOrder"
   AND odi."referenceSdDocumentItemNormalized" = soi."salesOrderItemNormalized"
  WHERE soi."material" IS NOT NULL
    AND odi."deliveryDocument" IS NOT NULL
),
"RelationCount" AS (
  SELECT CAST(COUNT(*) AS INTEGER) AS "totalRelationCount"
  FROM "ProductDeliveryRelations"
)
SELECT
  rc."totalRelationCount"
  ${selectedNullableColumns}
FROM "RelationCount" rc
${joinClause}
ORDER BY
  ${orderBy}
LIMIT 200
  `.trim(),
    explanation,
  };
};

const buildSalesOrderItemMaterialGroupSql = (input: {
  salesOrder: string;
  normalizedItemNumber: string;
}) => ({
  sql: `
SELECT
  soi."salesOrder",
  soi."salesOrderItem",
  soi."salesOrderItemNormalized",
  soi."material",
  soi."materialGroup"
FROM "SalesOrderItem" soi
WHERE soi."salesOrder" = '${escapeSqlLiteral(input.salesOrder)}'
  AND soi."salesOrderItemNormalized" = '${escapeSqlLiteral(
    input.normalizedItemNumber
  )}'
LIMIT 10
  `.trim(),
  explanation:
    "the sales order item matches the requested sales order and normalized item number, and then return its material and material group details",
});

const buildBillingDocumentItemFlowSql = (input: {
  billingDocument: string;
  normalizedItemNumber: string;
}) => ({
  sql: `
SELECT
  bdi."billingDocument",
  bdi."billingDocumentItem",
  bdi."billingDocumentItemNormalized",
  bdi."material",
  odi."deliveryDocument",
  odi."deliveryDocumentItem",
  soi."salesOrder",
  soi."salesOrderItem",
  je."accountingDocument",
  je."accountingDocumentItem",
  je."companyCode",
  je."fiscalYear"
FROM "BillingDocumentItem" bdi
JOIN "BillingDocumentHeader" bdh
  ON bdh."billingDocument" = bdi."billingDocument"
LEFT JOIN "OutboundDeliveryItem" odi
  ON odi."deliveryDocument" = bdi."referenceSdDocument"
 AND odi."deliveryDocumentItemNormalized" = bdi."referenceSdDocumentItemNormalized"
LEFT JOIN "SalesOrderItem" soi
  ON soi."salesOrder" = odi."referenceSdDocument"
 AND soi."salesOrderItemNormalized" = odi."referenceSdDocumentItemNormalized"
LEFT JOIN "JournalEntryAccountsReceivable" je
  ON je."referenceDocument" = bdi."billingDocument"
WHERE bdi."billingDocument" = '${escapeSqlLiteral(input.billingDocument)}'
  AND bdi."billingDocumentItemNormalized" = '${escapeSqlLiteral(
    input.normalizedItemNumber
  )}'
ORDER BY
  je."accountingDocument",
  je."accountingDocumentItem"
LIMIT 20
  `.trim(),
  explanation:
    "the billing document item is matched first, then its linked delivery item, sales order item, and related journal entries are traced to show the full document flow",
});

const toSerializableValue = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toSerializableValue(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        toSerializableValue(nestedValue),
      ])
    );
  }

  return value;
};

const stringifyRowsForModel = (rows: Record<string, unknown>[]) =>
  JSON.stringify(
    rows.map((row) => toSerializableValue(row)),
    null,
    2
  );

const buildQueryPlan = (
  message: string,
  history: RecentChatMessage[]
): QueryPlan => {
  const promptHints: string[] = [];
  const salesOrderItemReference = extractSalesOrderItemReference(message);
  const billingDocumentItemReference =
    extractBillingDocumentItemReference(message);
  const productDeliveryClarification = resolveProductDeliveryClarification({
    message,
    history,
  });

  if (salesOrderItemReference) {
    promptHints.push(
      `The user referenced sales order ${salesOrderItemReference.salesOrder} and item ${salesOrderItemReference.rawItemNumber}. For SalesOrderItem filters, prefer "salesOrderItemNormalized" = '${salesOrderItemReference.normalizedItemNumber}' because the raw item field may be zero-padded.`
    );
  }

  if (billingDocumentItemReference) {
    promptHints.push(
      `The user referenced billing document ${billingDocumentItemReference.billingDocument} and item ${billingDocumentItemReference.rawItemNumber}. For BillingDocumentItem filters, prefer "billingDocumentItemNormalized" = '${billingDocumentItemReference.normalizedItemNumber}' because the raw item field may be zero-padded.`
    );
  }

  if (needsClarificationForBroadRelationQuestion(message)) {
    return {
      promptHints,
      directSql: null,
      highlightMode: "primary_only",
      clarification: [
        "I can answer this, but I need two details narrowed down first.",
        "Should I count distinct product-to-delivery document pairs, or product-to-delivery item links?",
        "Also, what should count as a low relation count: `<= 5`, `<= 10`, or `<= 20`?",
        "Reply with something like: `Use delivery-document pairs and treat <= 10 as low.`",
      ].join(" "),
    };
  }

  if (productDeliveryClarification) {
    if (
      productDeliveryClarification.relationMode &&
      productDeliveryClarification.lowThreshold
    ) {
      return {
        promptHints,
        directSql: buildProductDeliveryRelationSql({
          relationMode: productDeliveryClarification.relationMode,
          lowThreshold: productDeliveryClarification.lowThreshold,
        }),
        highlightMode: "primary_only",
        clarification: null,
      };
    }

    const clarificationParts = [
      "I still need one last detail before I can run that product-to-delivery query.",
    ];

    if (!productDeliveryClarification.relationMode) {
      clarificationParts.push(
        "Should I count delivery-document pairs or item-level links?"
      );
    }

    if (!productDeliveryClarification.lowThreshold) {
      clarificationParts.push(
        "What number should count as low: `<= 5`, `<= 10`, or `<= 20`?"
      );
    }

    return {
      promptHints,
      directSql: null,
      highlightMode: "primary_only",
      clarification: clarificationParts.join(" "),
    };
  }

  if (isBrokenFlowQuery(message)) {
    return {
      promptHints,
      directSql: buildBrokenFlowSql(),
      highlightMode: "primary_only",
      clarification: null,
    };
  }

  if (isProductDeliveryRelationQuery(message)) {
    return {
      promptHints,
      directSql: buildProductDeliveryRelationSql(),
      highlightMode: "primary_only",
      clarification: null,
    };
  }

  if (salesOrderItemReference && /material group/i.test(message)) {
    return {
      promptHints,
      directSql: buildSalesOrderItemMaterialGroupSql({
        salesOrder: salesOrderItemReference.salesOrder,
        normalizedItemNumber: salesOrderItemReference.normalizedItemNumber,
      }),
      highlightMode: "strict",
      clarification: null,
    };
  }

  if (billingDocumentItemReference && isBillingFlowTraceQuery(message)) {
    return {
      promptHints,
      directSql: buildBillingDocumentItemFlowSql({
        billingDocument: billingDocumentItemReference.billingDocument,
        normalizedItemNumber: billingDocumentItemReference.normalizedItemNumber,
      }),
      highlightMode: "relational",
      clarification: null,
    };
  }

  return {
    promptHints,
    directSql: null,
    highlightMode: isRelationalMessage(message) ? "relational" : "strict",
    clarification: null,
  };
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

  if (!/^(select|with)\b/i.test(trimmed)) {
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

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
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

const collectIdentifierValues = (
  value: unknown,
  values: Set<string>,
  fieldName?: string
) => {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectIdentifierValues(item, values, fieldName);
    }
    return;
  }

  if (typeof value === "object") {
    for (const [nestedFieldName, nestedValue] of Object.entries(value)) {
      collectIdentifierValues(nestedValue, values, nestedFieldName);
    }
    return;
  }

  if (
    !fieldName ||
    !IDENTIFIER_COLUMN_PATTERN.test(fieldName) ||
    !(
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint"
    )
  ) {
    return;
  }

  values.add(String(value));
};

const extractNodeReferences = async (input: {
  rows: Record<string, unknown>[];
  sql: string;
  highlightMode: HighlightMode;
}) => {
  const graph = getCachedGraph() ?? (await rebuildGraphCache());

  if (!graph) {
    return [];
  }

  const referencedTables = extractReferencedTablesFromSql(input.sql);
  const focusTypes = new Set<GraphNodeType>(
    referencedTables.flatMap(
      (tableName) =>
        TABLE_TO_NODE_TYPES[tableName as (typeof ALLOWED_TABLES)[number]] ?? []
    )
  );

  const referenceIndex = new Map<string, Set<string>>();

  const addReference = (rawValue: string, nodeId: string) => {
    for (const key of expandReferenceKeys(rawValue)) {
      const nodeIds = referenceIndex.get(key) ?? new Set<string>();
      nodeIds.add(nodeId);
      referenceIndex.set(key, nodeIds);
    }
  };

  for (const node of graph.nodes) {
    if (focusTypes.size > 0 && !focusTypes.has(node.type)) {
      continue;
    }

    addReference(node.id, node.id);
    addReference(node.label, node.id);

    const nodeValues = new Set<string>();

    if (input.highlightMode === "primary_only") {
      const businessKey =
        node.data &&
        typeof node.data === "object" &&
        "businessKey" in node.data &&
        (typeof node.data.businessKey === "string" ||
          typeof node.data.businessKey === "number" ||
          typeof node.data.businessKey === "bigint")
          ? String(node.data.businessKey)
          : null;

      if (businessKey) {
        nodeValues.add(businessKey);
      }
    } else {
      collectIdentifierValues(node.data, nodeValues);
    }

    for (const value of nodeValues) {
      addReference(value, node.id);
    }
  }

  const discoveredValues = new Set<string>();

  for (const row of input.rows) {
    for (const [fieldName, fieldValue] of Object.entries(row)) {
      collectIdentifierValues(fieldValue, discoveredValues, fieldName);
    }
  }

  for (const value of extractLiteralCandidates(input.sql)) {
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

  if (nodeReferences.size > 0 && input.highlightMode === "relational") {
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

        if (nodeReferences.size >= 24) {
          break;
        }
      }

      if (nodeReferences.size >= 24) {
        break;
      }
    }
  }

  return Array.from(nodeReferences).slice(0, 24);
};

const buildSqlMessages = async (input: {
  message: string;
  historyTranscript: string;
  promptHints: string[];
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

Reasoning hints:
${input.promptHints.length > 0 ? input.promptHints.map((hint) => `- ${hint}`).join("\n") : "- No extra reasoning hints."}

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
${stringifyRowsForModel(previewRows)}
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
  const queryPlan = buildQueryPlan(input.message, history);

  await saveChatMessage({
    sessionId: input.sessionId,
    role: "user",
    content: input.message,
  });

  if (queryPlan.clarification) {
    return {
      kind: "clarification",
      answer: queryPlan.clarification,
      sql: null,
      sqlExplanation: null,
      highlightMode: queryPlan.highlightMode,
      nodesReferenced: [],
      executionTimeMs: 0,
    };
  }

  const parsedResponse = queryPlan.directSql
    ? queryPlan.directSql
    : parseModelResponse(
        await generateJsonResponse(
          await buildSqlMessages({
            message: input.message,
            historyTranscript: buildHistoryTranscript(history),
            promptHints: queryPlan.promptHints,
          })
        )
      );

  if ("error" in parsedResponse) {
    return {
      kind: "out_of_scope",
      answer: OUT_OF_SCOPE_ANSWER,
      sql: null,
      sqlExplanation: null,
      highlightMode: queryPlan.highlightMode,
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
    highlightMode: queryPlan.highlightMode,
  });

  if (rows.length === 0) {
    return {
      kind: "no_data",
      answer: NO_DATA_ANSWER,
      sql: safeSql,
      sqlExplanation: parsedResponse.explanation,
      highlightMode: queryPlan.highlightMode,
      nodesReferenced,
      executionTimeMs,
      rows,
    };
  }

  return {
    kind: "data",
    sql: safeSql,
    sqlExplanation: parsedResponse.explanation,
    highlightMode: queryPlan.highlightMode,
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

  if (
    prepared.kind === "clarification" ||
    prepared.kind === "out_of_scope" ||
    prepared.kind === "no_data"
  ) {
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

  const fallbackAnswer = buildFallbackAnswer({
    message: input.message,
    sqlExplanation: prepared.sqlExplanation,
    rows: prepared.rows,
  });

  let answer = fallbackAnswer;

  try {
    const answerMessages = buildAnswerMessages({
      message: input.message,
      sql: prepared.sql,
      sqlExplanation: prepared.sqlExplanation,
      rows: prepared.rows,
      executionTimeMs: prepared.executionTimeMs,
    });

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

  if (
    prepared.kind === "clarification" ||
    prepared.kind === "out_of_scope" ||
    prepared.kind === "no_data"
  ) {
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

  const fallbackAnswer = buildFallbackAnswer({
    message: input.message,
    sqlExplanation: prepared.sqlExplanation,
    rows: prepared.rows,
  });

  let answer = fallbackAnswer;

  try {
    const answerMessages = buildAnswerMessages({
      message: input.message,
      sql: prepared.sql,
      sqlExplanation: prepared.sqlExplanation,
      rows: prepared.rows,
      executionTimeMs: prepared.executionTimeMs,
    });

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
