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
