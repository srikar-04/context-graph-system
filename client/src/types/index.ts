export type GraphNodeType =
  | "BusinessPartner"
  | "Plant"
  | "Product"
  | "SalesOrder"
  | "SalesOrderItem"
  | "ScheduleLine"
  | "OutboundDelivery"
  | "OutboundDeliveryItem"
  | "BillingDocument"
  | "BillingDocumentItem"
  | "JournalEntry"
  | "Payment";

export type GraphNode = {
  id: string;
  type: GraphNodeType;
  label: string;
  data: Record<string, unknown>;
};

export type GraphEdge = {
  source: string;
  target: string;
  label: string;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type ChatHistoryMessage = {
  id: string;
  role: string;
  content: string;
  generatedSql: string | null;
  createdAt: string;
};

export type ChatSessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatResponse = {
  answer: string;
  sql: string | null;
  nodesReferenced: string[];
  executionTimeMs: number;
};

export type ChatStreamMeta = {
  sql: string | null;
  nodesReferenced: string[];
  executionTimeMs: number;
};

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  generatedSql?: string | null;
  executionTimeMs?: number | null;
  isError?: boolean;
  isStreaming?: boolean;
};
