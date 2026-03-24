import { prisma } from "../lib/prisma.js";
import type {
  GraphData,
  GraphEdge,
  GraphNode,
  GraphNodeType,
} from "../types/graph.js";

const makeNodeId = (type: GraphNodeType, businessKey: string) =>
  `${type}:${businessKey}`;

const makeCompositeKey = (parts: Array<string | null | undefined>) =>
  parts.filter((value): value is string => Boolean(value)).join(":");

const addNode = (
  nodes: Map<string, GraphNode>,
  type: GraphNodeType,
  businessKey: string,
  label: string,
  data: Record<string, unknown>
) => {
  const id = makeNodeId(type, businessKey);

  nodes.set(id, {
    id,
    type,
    label,
    data: {
      businessKey,
      ...data,
    },
  });
};

const addEdge = (
  edges: Map<string, GraphEdge>,
  source: string | null,
  target: string | null,
  label: string
) => {
  if (!source || !target) {
    return;
  }

  const edgeKey = `${source}|${target}|${label}`;

  edges.set(edgeKey, {
    source,
    target,
    label,
  });
};

export const buildGraph = async (): Promise<GraphData> => {
  const [
    businessPartners,
    plants,
    products,
    salesOrders,
    salesOrderItems,
    scheduleLines,
    outboundDeliveryHeaders,
    outboundDeliveryItems,
    billingDocumentHeaders,
    billingDocumentItems,
    journalEntries,
    payments,
  ] = await Promise.all([
    prisma.businessPartner.findMany(),
    prisma.plant.findMany(),
    prisma.product.findMany(),
    prisma.salesOrderHeader.findMany(),
    prisma.salesOrderItem.findMany(),
    prisma.salesOrderScheduleLine.findMany(),
    prisma.outboundDeliveryHeader.findMany(),
    prisma.outboundDeliveryItem.findMany(),
    prisma.billingDocumentHeader.findMany(),
    prisma.billingDocumentItem.findMany(),
    prisma.journalEntryAccountsReceivable.findMany(),
    prisma.paymentAccountsReceivable.findMany(),
  ]);

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  for (const partner of businessPartners) {
    addNode(
      nodes,
      "BusinessPartner",
      partner.businessPartner,
      partner.businessPartnerName
        ? `${partner.businessPartnerName} (${partner.businessPartner})`
        : `Business Partner ${partner.businessPartner}`,
      {
        ...partner,
      }
    );
  }

  for (const plant of plants) {
    addNode(
      nodes,
      "Plant",
      plant.plant,
      plant.plantName ?? `Plant ${plant.plant}`,
      {
        ...plant,
      }
    );
  }

  for (const product of products) {
    addNode(
      nodes,
      "Product",
      product.product,
      product.productOldId
        ? `${product.productOldId} (${product.product})`
        : `Product ${product.product}`,
      {
        ...product,
      }
    );
  }

  for (const salesOrder of salesOrders) {
    addNode(
      nodes,
      "SalesOrder",
      salesOrder.salesOrder,
      `Sales Order ${salesOrder.salesOrder}`,
      {
        ...salesOrder,
      }
    );

    addEdge(
      edges,
      makeNodeId("SalesOrder", salesOrder.salesOrder),
      salesOrder.soldToParty
        ? makeNodeId("BusinessPartner", salesOrder.soldToParty)
        : null,
      "placed_by"
    );
  }

  for (const item of salesOrderItems) {
    const itemKey = makeCompositeKey([item.salesOrder, item.salesOrderItem]);

    addNode(
      nodes,
      "SalesOrderItem",
      itemKey,
      `Sales Order Item ${item.salesOrder}/${item.salesOrderItem}`,
      {
        ...item,
      }
    );

    addEdge(
      edges,
      makeNodeId("SalesOrderItem", itemKey),
      makeNodeId("SalesOrder", item.salesOrder),
      "part_of"
    );

    addEdge(
      edges,
      makeNodeId("SalesOrderItem", itemKey),
      item.material ? makeNodeId("Product", item.material) : null,
      "contains_product"
    );

    addEdge(
      edges,
      makeNodeId("SalesOrderItem", itemKey),
      item.productionPlant ? makeNodeId("Plant", item.productionPlant) : null,
      "produced_at"
    );
  }

  for (const scheduleLine of scheduleLines) {
    const scheduleKey = makeCompositeKey([
      scheduleLine.salesOrder,
      scheduleLine.salesOrderItem,
      scheduleLine.scheduleLine,
    ]);
    const itemKey = makeCompositeKey([
      scheduleLine.salesOrder,
      scheduleLine.salesOrderItem,
    ]);

    addNode(
      nodes,
      "ScheduleLine",
      scheduleKey,
      `Schedule Line ${scheduleLine.salesOrder}/${scheduleLine.salesOrderItem}/${scheduleLine.scheduleLine}`,
      {
        ...scheduleLine,
      }
    );

    addEdge(
      edges,
      makeNodeId("ScheduleLine", scheduleKey),
      makeNodeId("SalesOrderItem", itemKey),
      "scheduled_for"
    );
  }

  for (const delivery of outboundDeliveryHeaders) {
    addNode(
      nodes,
      "OutboundDelivery",
      delivery.deliveryDocument,
      `Delivery ${delivery.deliveryDocument}`,
      {
        ...delivery,
      }
    );
  }

  for (const deliveryItem of outboundDeliveryItems) {
    const deliveryItemKey = makeCompositeKey([
      deliveryItem.deliveryDocument,
      deliveryItem.deliveryDocumentItem,
    ]);
    const salesOrderItemKey =
      deliveryItem.referenceSdDocument &&
      deliveryItem.referenceSdDocumentItemNormalized
        ? makeCompositeKey([
            deliveryItem.referenceSdDocument,
            deliveryItem.referenceSdDocumentItemNormalized,
          ])
        : null;

    addNode(
      nodes,
      "OutboundDeliveryItem",
      deliveryItemKey,
      `Delivery Item ${deliveryItem.deliveryDocument}/${deliveryItem.deliveryDocumentItem}`,
      {
        ...deliveryItem,
      }
    );

    addEdge(
      edges,
      makeNodeId("OutboundDeliveryItem", deliveryItemKey),
      makeNodeId("OutboundDelivery", deliveryItem.deliveryDocument),
      "part_of"
    );

    addEdge(
      edges,
      makeNodeId("OutboundDeliveryItem", deliveryItemKey),
      deliveryItem.referenceSdDocument
        ? makeNodeId("SalesOrder", deliveryItem.referenceSdDocument)
        : null,
      "fulfills_order"
    );

    addEdge(
      edges,
      makeNodeId("OutboundDeliveryItem", deliveryItemKey),
      salesOrderItemKey
        ? makeNodeId("SalesOrderItem", salesOrderItemKey)
        : null,
      "fulfills_item"
    );

    addEdge(
      edges,
      makeNodeId("OutboundDeliveryItem", deliveryItemKey),
      deliveryItem.plant ? makeNodeId("Plant", deliveryItem.plant) : null,
      "ships_from"
    );
  }

  for (const billingDocument of billingDocumentHeaders) {
    addNode(
      nodes,
      "BillingDocument",
      billingDocument.billingDocument,
      `Billing Document ${billingDocument.billingDocument}`,
      {
        ...billingDocument,
      }
    );

    addEdge(
      edges,
      makeNodeId("BillingDocument", billingDocument.billingDocument),
      billingDocument.soldToParty
        ? makeNodeId("BusinessPartner", billingDocument.soldToParty)
        : null,
      "billed_to"
    );
  }

  for (const billingItem of billingDocumentItems) {
    const billingItemKey = makeCompositeKey([
      billingItem.billingDocument,
      billingItem.billingDocumentItem,
    ]);
    const deliveryItemKey =
      billingItem.referenceSdDocument &&
      billingItem.referenceSdDocumentItemNormalized
        ? makeCompositeKey([
            billingItem.referenceSdDocument,
            billingItem.referenceSdDocumentItemNormalized,
          ])
        : null;

    addNode(
      nodes,
      "BillingDocumentItem",
      billingItemKey,
      `Billing Item ${billingItem.billingDocument}/${billingItem.billingDocumentItem}`,
      {
        ...billingItem,
      }
    );

    addEdge(
      edges,
      makeNodeId("BillingDocumentItem", billingItemKey),
      makeNodeId("BillingDocument", billingItem.billingDocument),
      "part_of"
    );

    addEdge(
      edges,
      makeNodeId("BillingDocumentItem", billingItemKey),
      billingItem.referenceSdDocument
        ? makeNodeId("OutboundDelivery", billingItem.referenceSdDocument)
        : null,
      "billed_from_delivery"
    );

    addEdge(
      edges,
      makeNodeId("BillingDocumentItem", billingItemKey),
      deliveryItemKey
        ? makeNodeId("OutboundDeliveryItem", deliveryItemKey)
        : null,
      "billed_from_delivery_item"
    );

    addEdge(
      edges,
      makeNodeId("BillingDocumentItem", billingItemKey),
      billingItem.material ? makeNodeId("Product", billingItem.material) : null,
      "bills_product"
    );
  }

  for (const journalEntry of journalEntries) {
    const journalKey = makeCompositeKey([
      journalEntry.companyCode,
      journalEntry.fiscalYear,
      journalEntry.accountingDocument,
      journalEntry.accountingDocumentItem,
    ]);

    addNode(
      nodes,
      "JournalEntry",
      journalKey,
      `Journal Entry ${journalEntry.accountingDocument}/${journalEntry.accountingDocumentItem}`,
      {
        ...journalEntry,
      }
    );

    addEdge(
      edges,
      makeNodeId("JournalEntry", journalKey),
      journalEntry.referenceDocument
        ? makeNodeId("BillingDocument", journalEntry.referenceDocument)
        : null,
      "records_invoice"
    );

    addEdge(
      edges,
      makeNodeId("JournalEntry", journalKey),
      journalEntry.customer
        ? makeNodeId("BusinessPartner", journalEntry.customer)
        : null,
      "posted_for_customer"
    );
  }

  for (const payment of payments) {
    const paymentKey = makeCompositeKey([
      payment.companyCode,
      payment.fiscalYear,
      payment.accountingDocument,
      payment.accountingDocumentItem,
    ]);

    addNode(
      nodes,
      "Payment",
      paymentKey,
      `Payment ${payment.accountingDocument}/${payment.accountingDocumentItem}`,
      {
        ...payment,
      }
    );

    addEdge(
      edges,
      makeNodeId("Payment", paymentKey),
      makeNodeId("JournalEntry", paymentKey),
      "settles_entry"
    );

    addEdge(
      edges,
      makeNodeId("Payment", paymentKey),
      payment.customer ? makeNodeId("BusinessPartner", payment.customer) : null,
      "paid_by"
    );

    addEdge(
      edges,
      makeNodeId("Payment", paymentKey),
      payment.invoiceReference
        ? makeNodeId("BillingDocument", payment.invoiceReference)
        : null,
      "references_invoice"
    );

    addEdge(
      edges,
      makeNodeId("Payment", paymentKey),
      payment.salesDocument
        ? makeNodeId("SalesOrder", payment.salesDocument)
        : null,
      "references_order"
    );
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
};
