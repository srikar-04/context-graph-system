import "dotenv/config";

import { createReadStream } from "node:fs";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

type RawRecord = Record<string, unknown>;

type EntityConfig = {
  folder: string;
  label: string;
  mapRecord: (record: RawRecord) => unknown;
  createMany: (records: unknown[]) => Promise<number>;
};

type IngestionStats = {
  files: number;
  records: number;
  inserted: number;
};

const DATA_PATH = path.resolve(
  process.cwd(),
  process.env.DATA_PATH ?? "./data"
);
const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE ?? "500");

const toNullableString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();

  return normalized === "" ? null : normalized;
};

const toRequiredString = (value: unknown, field: string): string => {
  const normalized = toNullableString(value);

  if (!normalized) {
    throw new Error(`Missing required field: ${field}`);
  }

  return normalized;
};

const toBoolean = (value: unknown): boolean | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Invalid boolean value: ${String(value)}`);
};

const toDate = (value: unknown): Date | null => {
  const normalized = toNullableString(value);

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value: ${normalized}`);
  }

  return parsed;
};

const toDecimal = (value: unknown): Prisma.Decimal | null => {
  const normalized = toNullableString(value);

  if (!normalized) {
    return null;
  }

  return new Prisma.Decimal(normalized);
};

const toJson = (
  value: unknown
): Prisma.InputJsonValue | typeof Prisma.JsonNull => {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }

  return value as Prisma.InputJsonValue;
};

const normalizeItemNumber = (value: unknown): string | null => {
  const normalized = toNullableString(value);

  if (!normalized) {
    return null;
  }

  const trimmed = normalized.replace(/^0+/, "");

  return trimmed === "" ? "0" : trimmed;
};

const toRequiredNormalizedItemNumber = (
  value: unknown,
  field: string
): string => {
  const normalized = normalizeItemNumber(value);

  if (!normalized) {
    throw new Error(`Missing required normalized item field: ${field}`);
  }

  return normalized;
};

const buildBusinessPartner = (record: RawRecord) => ({
  businessPartner: toRequiredString(record.businessPartner, "businessPartner"),
  customer: toNullableString(record.customer),
  businessPartnerCategory: toNullableString(record.businessPartnerCategory),
  businessPartnerFullName: toNullableString(record.businessPartnerFullName),
  businessPartnerGrouping: toNullableString(record.businessPartnerGrouping),
  businessPartnerName: toNullableString(record.businessPartnerName),
  correspondenceLanguage: toNullableString(record.correspondenceLanguage),
  createdByUser: toNullableString(record.createdByUser),
  creationDate: toDate(record.creationDate),
  creationTime: toJson(record.creationTime),
  firstName: toNullableString(record.firstName),
  formOfAddress: toNullableString(record.formOfAddress),
  industry: toNullableString(record.industry),
  lastChangeDate: toDate(record.lastChangeDate),
  lastName: toNullableString(record.lastName),
  organizationBpName1: toNullableString(record.organizationBpName1),
  organizationBpName2: toNullableString(record.organizationBpName2),
  businessPartnerIsBlocked: toBoolean(record.businessPartnerIsBlocked),
  isMarkedForArchiving: toBoolean(record.isMarkedForArchiving),
});

const buildBusinessPartnerAddress = (record: RawRecord) => ({
  businessPartner: toRequiredString(record.businessPartner, "businessPartner"),
  addressId: toRequiredString(record.addressId, "addressId"),
  validityStartDate: toDate(record.validityStartDate),
  validityEndDate: toDate(record.validityEndDate),
  addressUuid: toNullableString(record.addressUuid),
  addressTimeZone: toNullableString(record.addressTimeZone),
  cityName: toNullableString(record.cityName),
  country: toNullableString(record.country),
  poBox: toNullableString(record.poBox),
  poBoxDeviatingCityName: toNullableString(record.poBoxDeviatingCityName),
  poBoxDeviatingCountry: toNullableString(record.poBoxDeviatingCountry),
  poBoxDeviatingRegion: toNullableString(record.poBoxDeviatingRegion),
  poBoxIsWithoutNumber: toBoolean(record.poBoxIsWithoutNumber),
  poBoxLobbyName: toNullableString(record.poBoxLobbyName),
  poBoxPostalCode: toNullableString(record.poBoxPostalCode),
  postalCode: toNullableString(record.postalCode),
  region: toNullableString(record.region),
  streetName: toNullableString(record.streetName),
  taxJurisdiction: toNullableString(record.taxJurisdiction),
  transportZone: toNullableString(record.transportZone),
});

const buildCustomerCompanyAssignment = (record: RawRecord) => ({
  customer: toRequiredString(record.customer, "customer"),
  companyCode: toRequiredString(record.companyCode, "companyCode"),
  accountingClerk: toNullableString(record.accountingClerk),
  accountingClerkFaxNumber: toNullableString(record.accountingClerkFaxNumber),
  accountingClerkInternetAddress: toNullableString(
    record.accountingClerkInternetAddress
  ),
  accountingClerkPhoneNumber: toNullableString(
    record.accountingClerkPhoneNumber
  ),
  alternativePayerAccount: toNullableString(record.alternativePayerAccount),
  paymentBlockingReason: toNullableString(record.paymentBlockingReason),
  paymentMethodsList: toNullableString(record.paymentMethodsList),
  paymentTerms: toNullableString(record.paymentTerms),
  reconciliationAccount: toNullableString(record.reconciliationAccount),
  deletionIndicator: toBoolean(record.deletionIndicator),
  customerAccountGroup: toNullableString(record.customerAccountGroup),
});

const buildCustomerSalesAreaAssignment = (record: RawRecord) => ({
  customer: toRequiredString(record.customer, "customer"),
  salesOrganization: toRequiredString(
    record.salesOrganization,
    "salesOrganization"
  ),
  distributionChannel: toRequiredString(
    record.distributionChannel,
    "distributionChannel"
  ),
  division: toRequiredString(record.division, "division"),
  billingIsBlockedForCustomer: toNullableString(
    record.billingIsBlockedForCustomer
  ),
  completeDeliveryIsDefined: toBoolean(record.completeDeliveryIsDefined),
  creditControlArea: toNullableString(record.creditControlArea),
  currency: toNullableString(record.currency),
  customerPaymentTerms: toNullableString(record.customerPaymentTerms),
  deliveryPriority: toNullableString(record.deliveryPriority),
  incotermsClassification: toNullableString(record.incotermsClassification),
  incotermsLocation1: toNullableString(record.incotermsLocation1),
  salesGroup: toNullableString(record.salesGroup),
  salesOffice: toNullableString(record.salesOffice),
  shippingCondition: toNullableString(record.shippingCondition),
  slsUnlmtdOvrdelivIsAllwd: toBoolean(record.slsUnlmtdOvrdelivIsAllwd),
  supplyingPlant: toNullableString(record.supplyingPlant),
  salesDistrict: toNullableString(record.salesDistrict),
  exchangeRateType: toNullableString(record.exchangeRateType),
});

const buildPlant = (record: RawRecord) => ({
  plant: toRequiredString(record.plant, "plant"),
  plantName: toNullableString(record.plantName),
  valuationArea: toNullableString(record.valuationArea),
  plantCustomer: toNullableString(record.plantCustomer),
  plantSupplier: toNullableString(record.plantSupplier),
  factoryCalendar: toNullableString(record.factoryCalendar),
  defaultPurchasingOrganization: toNullableString(
    record.defaultPurchasingOrganization
  ),
  salesOrganization: toNullableString(record.salesOrganization),
  addressId: toNullableString(record.addressId),
  plantCategory: toNullableString(record.plantCategory),
  distributionChannel: toNullableString(record.distributionChannel),
  division: toNullableString(record.division),
  language: toNullableString(record.language),
  isMarkedForArchiving: toBoolean(record.isMarkedForArchiving),
});

const buildProduct = (record: RawRecord) => ({
  product: toRequiredString(record.product, "product"),
  productType: toNullableString(record.productType),
  crossPlantStatus: toNullableString(record.crossPlantStatus),
  crossPlantStatusValidityDate: toDate(record.crossPlantStatusValidityDate),
  creationDate: toDate(record.creationDate),
  createdByUser: toNullableString(record.createdByUser),
  lastChangeDate: toDate(record.lastChangeDate),
  lastChangeDateTime: toDate(record.lastChangeDateTime),
  isMarkedForDeletion: toBoolean(record.isMarkedForDeletion),
  productOldId: toNullableString(record.productOldId),
  grossWeight: toDecimal(record.grossWeight),
  weightUnit: toNullableString(record.weightUnit),
  netWeight: toDecimal(record.netWeight),
  productGroup: toNullableString(record.productGroup),
  baseUnit: toNullableString(record.baseUnit),
  division: toNullableString(record.division),
  industrySector: toNullableString(record.industrySector),
});

const buildProductDescription = (record: RawRecord) => ({
  product: toRequiredString(record.product, "product"),
  language: toRequiredString(record.language, "language"),
  productDescription: toNullableString(record.productDescription),
});

const buildProductPlant = (record: RawRecord) => ({
  product: toRequiredString(record.product, "product"),
  plant: toRequiredString(record.plant, "plant"),
  countryOfOrigin: toNullableString(record.countryOfOrigin),
  regionOfOrigin: toNullableString(record.regionOfOrigin),
  productionInvtryManagedLoc: toNullableString(
    record.productionInvtryManagedLoc
  ),
  availabilityCheckType: toNullableString(record.availabilityCheckType),
  fiscalYearVariant: toNullableString(record.fiscalYearVariant),
  profitCenter: toNullableString(record.profitCenter),
  mrpType: toNullableString(record.mrpType),
});

const buildProductStorageLocation = (record: RawRecord) => ({
  product: toRequiredString(record.product, "product"),
  plant: toRequiredString(record.plant, "plant"),
  storageLocation: toRequiredString(record.storageLocation, "storageLocation"),
  physicalInventoryBlockInd: toNullableString(record.physicalInventoryBlockInd),
  dateOfLastPostedCntUnRstrcdStk: toDate(record.dateOfLastPostedCntUnRstrcdStk),
});

const buildSalesOrderHeader = (record: RawRecord) => ({
  salesOrder: toRequiredString(record.salesOrder, "salesOrder"),
  salesOrderType: toNullableString(record.salesOrderType),
  salesOrganization: toNullableString(record.salesOrganization),
  distributionChannel: toNullableString(record.distributionChannel),
  organizationDivision: toNullableString(record.organizationDivision),
  salesGroup: toNullableString(record.salesGroup),
  salesOffice: toNullableString(record.salesOffice),
  soldToParty: toNullableString(record.soldToParty),
  creationDate: toDate(record.creationDate),
  createdByUser: toNullableString(record.createdByUser),
  lastChangeDateTime: toDate(record.lastChangeDateTime),
  totalNetAmount: toDecimal(record.totalNetAmount),
  overallDeliveryStatus: toNullableString(record.overallDeliveryStatus),
  overallOrdReltdBillgStatus: toNullableString(
    record.overallOrdReltdBillgStatus
  ),
  overallSdDocReferenceStatus: toNullableString(
    record.overallSdDocReferenceStatus
  ),
  transactionCurrency: toNullableString(record.transactionCurrency),
  pricingDate: toDate(record.pricingDate),
  requestedDeliveryDate: toDate(record.requestedDeliveryDate),
  headerBillingBlockReason: toNullableString(record.headerBillingBlockReason),
  deliveryBlockReason: toNullableString(record.deliveryBlockReason),
  incotermsClassification: toNullableString(record.incotermsClassification),
  incotermsLocation1: toNullableString(record.incotermsLocation1),
  customerPaymentTerms: toNullableString(record.customerPaymentTerms),
  totalCreditCheckStatus: toNullableString(record.totalCreditCheckStatus),
});

const buildSalesOrderItem = (record: RawRecord) => ({
  salesOrder: toRequiredString(record.salesOrder, "salesOrder"),
  salesOrderItem: toRequiredString(record.salesOrderItem, "salesOrderItem"),
  salesOrderItemNormalized: toRequiredNormalizedItemNumber(
    record.salesOrderItem,
    "salesOrderItem"
  ),
  salesOrderItemCategory: toNullableString(record.salesOrderItemCategory),
  material: toNullableString(record.material),
  requestedQuantity: toDecimal(record.requestedQuantity),
  requestedQuantityUnit: toNullableString(record.requestedQuantityUnit),
  transactionCurrency: toNullableString(record.transactionCurrency),
  netAmount: toDecimal(record.netAmount),
  materialGroup: toNullableString(record.materialGroup),
  productionPlant: toNullableString(record.productionPlant),
  storageLocation: toNullableString(record.storageLocation),
  salesDocumentRjcnReason: toNullableString(record.salesDocumentRjcnReason),
  itemBillingBlockReason: toNullableString(record.itemBillingBlockReason),
});

const buildSalesOrderScheduleLine = (record: RawRecord) => ({
  salesOrder: toRequiredString(record.salesOrder, "salesOrder"),
  salesOrderItem: toRequiredString(record.salesOrderItem, "salesOrderItem"),
  scheduleLine: toRequiredString(record.scheduleLine, "scheduleLine"),
  confirmedDeliveryDate: toDate(record.confirmedDeliveryDate),
  orderQuantityUnit: toNullableString(record.orderQuantityUnit),
  confdOrderQtyByMatlAvailCheck: toDecimal(
    record.confdOrderQtyByMatlAvailCheck
  ),
});

const buildOutboundDeliveryHeader = (record: RawRecord) => ({
  deliveryDocument: toRequiredString(
    record.deliveryDocument,
    "deliveryDocument"
  ),
  actualGoodsMovementDate: toDate(record.actualGoodsMovementDate),
  actualGoodsMovementTime: toJson(record.actualGoodsMovementTime),
  creationDate: toDate(record.creationDate),
  creationTime: toJson(record.creationTime),
  deliveryBlockReason: toNullableString(record.deliveryBlockReason),
  hdrGeneralIncompletionStatus: toNullableString(
    record.hdrGeneralIncompletionStatus
  ),
  headerBillingBlockReason: toNullableString(record.headerBillingBlockReason),
  lastChangeDate: toDate(record.lastChangeDate),
  overallGoodsMovementStatus: toNullableString(
    record.overallGoodsMovementStatus
  ),
  overallPickingStatus: toNullableString(record.overallPickingStatus),
  overallProofOfDeliveryStatus: toNullableString(
    record.overallProofOfDeliveryStatus
  ),
  shippingPoint: toNullableString(record.shippingPoint),
});

const buildOutboundDeliveryItem = (record: RawRecord) => ({
  deliveryDocument: toRequiredString(
    record.deliveryDocument,
    "deliveryDocument"
  ),
  deliveryDocumentItem: toRequiredString(
    record.deliveryDocumentItem,
    "deliveryDocumentItem"
  ),
  deliveryDocumentItemNormalized: toRequiredNormalizedItemNumber(
    record.deliveryDocumentItem,
    "deliveryDocumentItem"
  ),
  actualDeliveryQuantity: toDecimal(record.actualDeliveryQuantity),
  batch: toNullableString(record.batch),
  deliveryQuantityUnit: toNullableString(record.deliveryQuantityUnit),
  itemBillingBlockReason: toNullableString(record.itemBillingBlockReason),
  lastChangeDate: toDate(record.lastChangeDate),
  plant: toNullableString(record.plant),
  referenceSdDocument: toNullableString(record.referenceSdDocument),
  referenceSdDocumentItem: toNullableString(record.referenceSdDocumentItem),
  referenceSdDocumentItemNormalized: normalizeItemNumber(
    record.referenceSdDocumentItem
  ),
  storageLocation: toNullableString(record.storageLocation),
});

const buildBillingDocumentHeader = (record: RawRecord) => ({
  billingDocument: toRequiredString(record.billingDocument, "billingDocument"),
  billingDocumentType: toNullableString(record.billingDocumentType),
  creationDate: toDate(record.creationDate),
  creationTime: toJson(record.creationTime),
  lastChangeDateTime: toDate(record.lastChangeDateTime),
  billingDocumentDate: toDate(record.billingDocumentDate),
  billingDocumentIsCancelled: toBoolean(record.billingDocumentIsCancelled),
  cancelledBillingDocument: toNullableString(record.cancelledBillingDocument),
  totalNetAmount: toDecimal(record.totalNetAmount),
  transactionCurrency: toNullableString(record.transactionCurrency),
  companyCode: toNullableString(record.companyCode),
  fiscalYear: toNullableString(record.fiscalYear),
  accountingDocument: toNullableString(record.accountingDocument),
  soldToParty: toNullableString(record.soldToParty),
});

const buildBillingDocumentItem = (record: RawRecord) => ({
  billingDocument: toRequiredString(record.billingDocument, "billingDocument"),
  billingDocumentItem: toRequiredString(
    record.billingDocumentItem,
    "billingDocumentItem"
  ),
  billingDocumentItemNormalized: toRequiredNormalizedItemNumber(
    record.billingDocumentItem,
    "billingDocumentItem"
  ),
  material: toNullableString(record.material),
  billingQuantity: toDecimal(record.billingQuantity),
  billingQuantityUnit: toNullableString(record.billingQuantityUnit),
  netAmount: toDecimal(record.netAmount),
  transactionCurrency: toNullableString(record.transactionCurrency),
  referenceSdDocument: toNullableString(record.referenceSdDocument),
  referenceSdDocumentItem: toNullableString(record.referenceSdDocumentItem),
  referenceSdDocumentItemNormalized: normalizeItemNumber(
    record.referenceSdDocumentItem
  ),
});

const buildBillingDocumentCancellation = (record: RawRecord) => ({
  billingDocument: toRequiredString(record.billingDocument, "billingDocument"),
  billingDocumentType: toNullableString(record.billingDocumentType),
  creationDate: toDate(record.creationDate),
  creationTime: toJson(record.creationTime),
  lastChangeDateTime: toDate(record.lastChangeDateTime),
  billingDocumentDate: toDate(record.billingDocumentDate),
  billingDocumentIsCancelled: toBoolean(record.billingDocumentIsCancelled),
  cancelledBillingDocument: toNullableString(record.cancelledBillingDocument),
  totalNetAmount: toDecimal(record.totalNetAmount),
  transactionCurrency: toNullableString(record.transactionCurrency),
  companyCode: toNullableString(record.companyCode),
  fiscalYear: toNullableString(record.fiscalYear),
  accountingDocument: toNullableString(record.accountingDocument),
  soldToParty: toNullableString(record.soldToParty),
});

const buildJournalEntryAccountsReceivable = (record: RawRecord) => ({
  companyCode: toRequiredString(record.companyCode, "companyCode"),
  fiscalYear: toRequiredString(record.fiscalYear, "fiscalYear"),
  accountingDocument: toRequiredString(
    record.accountingDocument,
    "accountingDocument"
  ),
  accountingDocumentItem: toRequiredString(
    record.accountingDocumentItem,
    "accountingDocumentItem"
  ),
  glAccount: toNullableString(record.glAccount),
  referenceDocument: toNullableString(record.referenceDocument),
  costCenter: toNullableString(record.costCenter),
  profitCenter: toNullableString(record.profitCenter),
  transactionCurrency: toNullableString(record.transactionCurrency),
  amountInTransactionCurrency: toDecimal(record.amountInTransactionCurrency),
  companyCodeCurrency: toNullableString(record.companyCodeCurrency),
  amountInCompanyCodeCurrency: toDecimal(record.amountInCompanyCodeCurrency),
  postingDate: toDate(record.postingDate),
  documentDate: toDate(record.documentDate),
  accountingDocumentType: toNullableString(record.accountingDocumentType),
  assignmentReference: toNullableString(record.assignmentReference),
  lastChangeDateTime: toDate(record.lastChangeDateTime),
  customer: toNullableString(record.customer),
  financialAccountType: toNullableString(record.financialAccountType),
  clearingDate: toDate(record.clearingDate),
  clearingAccountingDocument: toNullableString(
    record.clearingAccountingDocument
  ),
  clearingDocFiscalYear: toNullableString(record.clearingDocFiscalYear),
});

const buildPaymentAccountsReceivable = (record: RawRecord) => ({
  companyCode: toRequiredString(record.companyCode, "companyCode"),
  fiscalYear: toRequiredString(record.fiscalYear, "fiscalYear"),
  accountingDocument: toRequiredString(
    record.accountingDocument,
    "accountingDocument"
  ),
  accountingDocumentItem: toRequiredString(
    record.accountingDocumentItem,
    "accountingDocumentItem"
  ),
  clearingDate: toDate(record.clearingDate),
  clearingAccountingDocument: toNullableString(
    record.clearingAccountingDocument
  ),
  clearingDocFiscalYear: toNullableString(record.clearingDocFiscalYear),
  amountInTransactionCurrency: toDecimal(record.amountInTransactionCurrency),
  transactionCurrency: toNullableString(record.transactionCurrency),
  amountInCompanyCodeCurrency: toDecimal(record.amountInCompanyCodeCurrency),
  companyCodeCurrency: toNullableString(record.companyCodeCurrency),
  customer: toNullableString(record.customer),
  invoiceReference: toNullableString(record.invoiceReference),
  invoiceReferenceFiscalYear: toNullableString(
    record.invoiceReferenceFiscalYear
  ),
  salesDocument: toNullableString(record.salesDocument),
  salesDocumentItem: toNullableString(record.salesDocumentItem),
  salesDocumentItemNormalized: normalizeItemNumber(record.salesDocumentItem),
  postingDate: toDate(record.postingDate),
  documentDate: toDate(record.documentDate),
  assignmentReference: toNullableString(record.assignmentReference),
  glAccount: toNullableString(record.glAccount),
  financialAccountType: toNullableString(record.financialAccountType),
  profitCenter: toNullableString(record.profitCenter),
  costCenter: toNullableString(record.costCenter),
});

const ENTITY_CONFIGS: EntityConfig[] = [
  {
    folder: "plants",
    label: "Plant",
    mapRecord: buildPlant,
    createMany: async (records) =>
      (
        await prisma.plant.createMany({
          data: records as Prisma.PlantCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "products",
    label: "Product",
    mapRecord: buildProduct,
    createMany: async (records) =>
      (
        await prisma.product.createMany({
          data: records as Prisma.ProductCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "product_descriptions",
    label: "ProductDescription",
    mapRecord: buildProductDescription,
    createMany: async (records) =>
      (
        await prisma.productDescription.createMany({
          data: records as Prisma.ProductDescriptionCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "product_plants",
    label: "ProductPlant",
    mapRecord: buildProductPlant,
    createMany: async (records) =>
      (
        await prisma.productPlant.createMany({
          data: records as Prisma.ProductPlantCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "product_storage_locations",
    label: "ProductStorageLocation",
    mapRecord: buildProductStorageLocation,
    createMany: async (records) =>
      (
        await prisma.productStorageLocation.createMany({
          data: records as Prisma.ProductStorageLocationCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "business_partners",
    label: "BusinessPartner",
    mapRecord: buildBusinessPartner,
    createMany: async (records) =>
      (
        await prisma.businessPartner.createMany({
          data: records as Prisma.BusinessPartnerCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "business_partner_addresses",
    label: "BusinessPartnerAddress",
    mapRecord: buildBusinessPartnerAddress,
    createMany: async (records) =>
      (
        await prisma.businessPartnerAddress.createMany({
          data: records as Prisma.BusinessPartnerAddressCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "customer_company_assignments",
    label: "CustomerCompanyAssignment",
    mapRecord: buildCustomerCompanyAssignment,
    createMany: async (records) =>
      (
        await prisma.customerCompanyAssignment.createMany({
          data: records as Prisma.CustomerCompanyAssignmentCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "customer_sales_area_assignments",
    label: "CustomerSalesAreaAssignment",
    mapRecord: buildCustomerSalesAreaAssignment,
    createMany: async (records) =>
      (
        await prisma.customerSalesAreaAssignment.createMany({
          data: records as Prisma.CustomerSalesAreaAssignmentCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "sales_order_headers",
    label: "SalesOrderHeader",
    mapRecord: buildSalesOrderHeader,
    createMany: async (records) =>
      (
        await prisma.salesOrderHeader.createMany({
          data: records as Prisma.SalesOrderHeaderCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "sales_order_items",
    label: "SalesOrderItem",
    mapRecord: buildSalesOrderItem,
    createMany: async (records) =>
      (
        await prisma.salesOrderItem.createMany({
          data: records as Prisma.SalesOrderItemCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "sales_order_schedule_lines",
    label: "SalesOrderScheduleLine",
    mapRecord: buildSalesOrderScheduleLine,
    createMany: async (records) =>
      (
        await prisma.salesOrderScheduleLine.createMany({
          data: records as Prisma.SalesOrderScheduleLineCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "outbound_delivery_headers",
    label: "OutboundDeliveryHeader",
    mapRecord: buildOutboundDeliveryHeader,
    createMany: async (records) =>
      (
        await prisma.outboundDeliveryHeader.createMany({
          data: records as Prisma.OutboundDeliveryHeaderCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "outbound_delivery_items",
    label: "OutboundDeliveryItem",
    mapRecord: buildOutboundDeliveryItem,
    createMany: async (records) =>
      (
        await prisma.outboundDeliveryItem.createMany({
          data: records as Prisma.OutboundDeliveryItemCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "billing_document_headers",
    label: "BillingDocumentHeader",
    mapRecord: buildBillingDocumentHeader,
    createMany: async (records) =>
      (
        await prisma.billingDocumentHeader.createMany({
          data: records as Prisma.BillingDocumentHeaderCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "billing_document_items",
    label: "BillingDocumentItem",
    mapRecord: buildBillingDocumentItem,
    createMany: async (records) =>
      (
        await prisma.billingDocumentItem.createMany({
          data: records as Prisma.BillingDocumentItemCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "billing_document_cancellations",
    label: "BillingDocumentCancellation",
    mapRecord: buildBillingDocumentCancellation,
    createMany: async (records) =>
      (
        await prisma.billingDocumentCancellation.createMany({
          data: records as Prisma.BillingDocumentCancellationCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "journal_entry_items_accounts_receivable",
    label: "JournalEntryAccountsReceivable",
    mapRecord: buildJournalEntryAccountsReceivable,
    createMany: async (records) =>
      (
        await prisma.journalEntryAccountsReceivable.createMany({
          data: records as Prisma.JournalEntryAccountsReceivableCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
  {
    folder: "payments_accounts_receivable",
    label: "PaymentAccountsReceivable",
    mapRecord: buildPaymentAccountsReceivable,
    createMany: async (records) =>
      (
        await prisma.paymentAccountsReceivable.createMany({
          data: records as Prisma.PaymentAccountsReceivableCreateManyInput[],
          skipDuplicates: true,
        })
      ).count,
  },
];

const readJsonLines = async function* (filePath: string) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const interfaceHandle = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of interfaceHandle) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    yield JSON.parse(trimmed) as RawRecord;
  }
};

const ensureDataPath = async () => {
  try {
    await access(DATA_PATH);
  } catch {
    throw new Error(`DATA_PATH does not exist: ${DATA_PATH}`);
  }
};

const ingestEntity = async (config: EntityConfig): Promise<IngestionStats> => {
  const folderPath = path.join(DATA_PATH, config.folder);
  const files = (await readdir(folderPath))
    .filter((file) => file.endsWith(".jsonl"))
    .sort((left, right) => left.localeCompare(right));

  let records = 0;
  let inserted = 0;
  let batch: unknown[] = [];

  const flushBatch = async () => {
    if (batch.length === 0) {
      return;
    }

    inserted += await config.createMany(batch);
    batch = [];
  };

  for (const file of files) {
    const filePath = path.join(folderPath, file);
    console.log(`[seed] ${config.label}: reading ${file}`);

    for await (const record of readJsonLines(filePath)) {
      records += 1;
      batch.push(config.mapRecord(record));

      if (batch.length >= BATCH_SIZE) {
        await flushBatch();
        console.log(
          `[seed] ${config.label}: processed ${records} records (${inserted} inserted)`
        );
      }
    }
  }

  await flushBatch();

  return {
    files: files.length,
    records,
    inserted,
  };
};

const main = async () => {
  await ensureDataPath();

  console.log(`[seed] data path: ${DATA_PATH}`);

  for (const config of ENTITY_CONFIGS) {
    const startedAt = Date.now();
    const stats = await ingestEntity(config);
    const elapsedMs = Date.now() - startedAt;

    console.log(
      `[seed] ${config.label}: finished ${stats.records} records from ${stats.files} file(s), inserted ${stats.inserted}, in ${elapsedMs}ms`
    );
  }
};

try {
  await main();
} catch (error) {
  console.error("[seed] ingestion failed");
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
