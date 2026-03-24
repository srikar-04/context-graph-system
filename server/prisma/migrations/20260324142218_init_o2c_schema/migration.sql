-- CreateTable
CREATE TABLE "BusinessPartner" (
    "businessPartner" TEXT NOT NULL,
    "customer" TEXT,
    "businessPartnerCategory" TEXT,
    "businessPartnerFullName" TEXT,
    "businessPartnerGrouping" TEXT,
    "businessPartnerName" TEXT,
    "correspondenceLanguage" TEXT,
    "createdByUser" TEXT,
    "creationDate" TIMESTAMP(3),
    "creationTime" JSONB,
    "firstName" TEXT,
    "formOfAddress" TEXT,
    "industry" TEXT,
    "lastChangeDate" TIMESTAMP(3),
    "lastName" TEXT,
    "organizationBpName1" TEXT,
    "organizationBpName2" TEXT,
    "businessPartnerIsBlocked" BOOLEAN,
    "isMarkedForArchiving" BOOLEAN,

    CONSTRAINT "BusinessPartner_pkey" PRIMARY KEY ("businessPartner")
);

-- CreateTable
CREATE TABLE "BusinessPartnerAddress" (
    "businessPartner" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "validityStartDate" TIMESTAMP(3),
    "validityEndDate" TIMESTAMP(3),
    "addressUuid" TEXT,
    "addressTimeZone" TEXT,
    "cityName" TEXT,
    "country" TEXT,
    "poBox" TEXT,
    "poBoxDeviatingCityName" TEXT,
    "poBoxDeviatingCountry" TEXT,
    "poBoxDeviatingRegion" TEXT,
    "poBoxIsWithoutNumber" BOOLEAN,
    "poBoxLobbyName" TEXT,
    "poBoxPostalCode" TEXT,
    "postalCode" TEXT,
    "region" TEXT,
    "streetName" TEXT,
    "taxJurisdiction" TEXT,
    "transportZone" TEXT,

    CONSTRAINT "BusinessPartnerAddress_pkey" PRIMARY KEY ("businessPartner","addressId")
);

-- CreateTable
CREATE TABLE "CustomerCompanyAssignment" (
    "customer" TEXT NOT NULL,
    "companyCode" TEXT NOT NULL,
    "accountingClerk" TEXT,
    "accountingClerkFaxNumber" TEXT,
    "accountingClerkInternetAddress" TEXT,
    "accountingClerkPhoneNumber" TEXT,
    "alternativePayerAccount" TEXT,
    "paymentBlockingReason" TEXT,
    "paymentMethodsList" TEXT,
    "paymentTerms" TEXT,
    "reconciliationAccount" TEXT,
    "deletionIndicator" BOOLEAN,
    "customerAccountGroup" TEXT,

    CONSTRAINT "CustomerCompanyAssignment_pkey" PRIMARY KEY ("customer","companyCode")
);

-- CreateTable
CREATE TABLE "CustomerSalesAreaAssignment" (
    "customer" TEXT NOT NULL,
    "salesOrganization" TEXT NOT NULL,
    "distributionChannel" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "billingIsBlockedForCustomer" TEXT,
    "completeDeliveryIsDefined" BOOLEAN,
    "creditControlArea" TEXT,
    "currency" TEXT,
    "customerPaymentTerms" TEXT,
    "deliveryPriority" TEXT,
    "incotermsClassification" TEXT,
    "incotermsLocation1" TEXT,
    "salesGroup" TEXT,
    "salesOffice" TEXT,
    "shippingCondition" TEXT,
    "slsUnlmtdOvrdelivIsAllwd" BOOLEAN,
    "supplyingPlant" TEXT,
    "salesDistrict" TEXT,
    "exchangeRateType" TEXT,

    CONSTRAINT "CustomerSalesAreaAssignment_pkey" PRIMARY KEY ("customer","salesOrganization","distributionChannel","division")
);

-- CreateTable
CREATE TABLE "Plant" (
    "plant" TEXT NOT NULL,
    "plantName" TEXT,
    "valuationArea" TEXT,
    "plantCustomer" TEXT,
    "plantSupplier" TEXT,
    "factoryCalendar" TEXT,
    "defaultPurchasingOrganization" TEXT,
    "salesOrganization" TEXT,
    "addressId" TEXT,
    "plantCategory" TEXT,
    "distributionChannel" TEXT,
    "division" TEXT,
    "language" TEXT,
    "isMarkedForArchiving" BOOLEAN,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("plant")
);

-- CreateTable
CREATE TABLE "Product" (
    "product" TEXT NOT NULL,
    "productType" TEXT,
    "crossPlantStatus" TEXT,
    "crossPlantStatusValidityDate" TIMESTAMP(3),
    "creationDate" TIMESTAMP(3),
    "createdByUser" TEXT,
    "lastChangeDate" TIMESTAMP(3),
    "lastChangeDateTime" TIMESTAMP(3),
    "isMarkedForDeletion" BOOLEAN,
    "productOldId" TEXT,
    "grossWeight" DECIMAL(65,30),
    "weightUnit" TEXT,
    "netWeight" DECIMAL(65,30),
    "productGroup" TEXT,
    "baseUnit" TEXT,
    "division" TEXT,
    "industrySector" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("product")
);

-- CreateTable
CREATE TABLE "ProductDescription" (
    "product" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "productDescription" TEXT,

    CONSTRAINT "ProductDescription_pkey" PRIMARY KEY ("product","language")
);

-- CreateTable
CREATE TABLE "ProductPlant" (
    "product" TEXT NOT NULL,
    "plant" TEXT NOT NULL,
    "countryOfOrigin" TEXT,
    "regionOfOrigin" TEXT,
    "productionInvtryManagedLoc" TEXT,
    "availabilityCheckType" TEXT,
    "fiscalYearVariant" TEXT,
    "profitCenter" TEXT,
    "mrpType" TEXT,

    CONSTRAINT "ProductPlant_pkey" PRIMARY KEY ("product","plant")
);

-- CreateTable
CREATE TABLE "ProductStorageLocation" (
    "product" TEXT NOT NULL,
    "plant" TEXT NOT NULL,
    "storageLocation" TEXT NOT NULL,
    "physicalInventoryBlockInd" TEXT,
    "dateOfLastPostedCntUnRstrcdStk" TIMESTAMP(3),

    CONSTRAINT "ProductStorageLocation_pkey" PRIMARY KEY ("product","plant","storageLocation")
);

-- CreateTable
CREATE TABLE "SalesOrderHeader" (
    "salesOrder" TEXT NOT NULL,
    "salesOrderType" TEXT,
    "salesOrganization" TEXT,
    "distributionChannel" TEXT,
    "organizationDivision" TEXT,
    "salesGroup" TEXT,
    "salesOffice" TEXT,
    "soldToParty" TEXT,
    "creationDate" TIMESTAMP(3),
    "createdByUser" TEXT,
    "lastChangeDateTime" TIMESTAMP(3),
    "totalNetAmount" DECIMAL(65,30),
    "overallDeliveryStatus" TEXT,
    "overallOrdReltdBillgStatus" TEXT,
    "overallSdDocReferenceStatus" TEXT,
    "transactionCurrency" TEXT,
    "pricingDate" TIMESTAMP(3),
    "requestedDeliveryDate" TIMESTAMP(3),
    "headerBillingBlockReason" TEXT,
    "deliveryBlockReason" TEXT,
    "incotermsClassification" TEXT,
    "incotermsLocation1" TEXT,
    "customerPaymentTerms" TEXT,
    "totalCreditCheckStatus" TEXT,

    CONSTRAINT "SalesOrderHeader_pkey" PRIMARY KEY ("salesOrder")
);

-- CreateTable
CREATE TABLE "SalesOrderItem" (
    "salesOrder" TEXT NOT NULL,
    "salesOrderItem" TEXT NOT NULL,
    "salesOrderItemNormalized" TEXT NOT NULL,
    "salesOrderItemCategory" TEXT,
    "material" TEXT,
    "requestedQuantity" DECIMAL(65,30),
    "requestedQuantityUnit" TEXT,
    "transactionCurrency" TEXT,
    "netAmount" DECIMAL(65,30),
    "materialGroup" TEXT,
    "productionPlant" TEXT,
    "storageLocation" TEXT,
    "salesDocumentRjcnReason" TEXT,
    "itemBillingBlockReason" TEXT,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("salesOrder","salesOrderItem")
);

-- CreateTable
CREATE TABLE "SalesOrderScheduleLine" (
    "salesOrder" TEXT NOT NULL,
    "salesOrderItem" TEXT NOT NULL,
    "scheduleLine" TEXT NOT NULL,
    "confirmedDeliveryDate" TIMESTAMP(3),
    "orderQuantityUnit" TEXT,
    "confdOrderQtyByMatlAvailCheck" DECIMAL(65,30),

    CONSTRAINT "SalesOrderScheduleLine_pkey" PRIMARY KEY ("salesOrder","salesOrderItem","scheduleLine")
);

-- CreateTable
CREATE TABLE "OutboundDeliveryHeader" (
    "deliveryDocument" TEXT NOT NULL,
    "actualGoodsMovementDate" TIMESTAMP(3),
    "actualGoodsMovementTime" JSONB,
    "creationDate" TIMESTAMP(3),
    "creationTime" JSONB,
    "deliveryBlockReason" TEXT,
    "hdrGeneralIncompletionStatus" TEXT,
    "headerBillingBlockReason" TEXT,
    "lastChangeDate" TIMESTAMP(3),
    "overallGoodsMovementStatus" TEXT,
    "overallPickingStatus" TEXT,
    "overallProofOfDeliveryStatus" TEXT,
    "shippingPoint" TEXT,

    CONSTRAINT "OutboundDeliveryHeader_pkey" PRIMARY KEY ("deliveryDocument")
);

-- CreateTable
CREATE TABLE "OutboundDeliveryItem" (
    "deliveryDocument" TEXT NOT NULL,
    "deliveryDocumentItem" TEXT NOT NULL,
    "deliveryDocumentItemNormalized" TEXT NOT NULL,
    "actualDeliveryQuantity" DECIMAL(65,30),
    "batch" TEXT,
    "deliveryQuantityUnit" TEXT,
    "itemBillingBlockReason" TEXT,
    "lastChangeDate" TIMESTAMP(3),
    "plant" TEXT,
    "referenceSdDocument" TEXT,
    "referenceSdDocumentItem" TEXT,
    "referenceSdDocumentItemNormalized" TEXT,
    "storageLocation" TEXT,

    CONSTRAINT "OutboundDeliveryItem_pkey" PRIMARY KEY ("deliveryDocument","deliveryDocumentItem")
);

-- CreateTable
CREATE TABLE "BillingDocumentHeader" (
    "billingDocument" TEXT NOT NULL,
    "billingDocumentType" TEXT,
    "creationDate" TIMESTAMP(3),
    "creationTime" JSONB,
    "lastChangeDateTime" TIMESTAMP(3),
    "billingDocumentDate" TIMESTAMP(3),
    "billingDocumentIsCancelled" BOOLEAN,
    "cancelledBillingDocument" TEXT,
    "totalNetAmount" DECIMAL(65,30),
    "transactionCurrency" TEXT,
    "companyCode" TEXT,
    "fiscalYear" TEXT,
    "accountingDocument" TEXT,
    "soldToParty" TEXT,

    CONSTRAINT "BillingDocumentHeader_pkey" PRIMARY KEY ("billingDocument")
);

-- CreateTable
CREATE TABLE "BillingDocumentCancellation" (
    "billingDocument" TEXT NOT NULL,
    "billingDocumentType" TEXT,
    "creationDate" TIMESTAMP(3),
    "creationTime" JSONB,
    "lastChangeDateTime" TIMESTAMP(3),
    "billingDocumentDate" TIMESTAMP(3),
    "billingDocumentIsCancelled" BOOLEAN,
    "cancelledBillingDocument" TEXT,
    "totalNetAmount" DECIMAL(65,30),
    "transactionCurrency" TEXT,
    "companyCode" TEXT,
    "fiscalYear" TEXT,
    "accountingDocument" TEXT,
    "soldToParty" TEXT,

    CONSTRAINT "BillingDocumentCancellation_pkey" PRIMARY KEY ("billingDocument")
);

-- CreateTable
CREATE TABLE "BillingDocumentItem" (
    "billingDocument" TEXT NOT NULL,
    "billingDocumentItem" TEXT NOT NULL,
    "billingDocumentItemNormalized" TEXT NOT NULL,
    "material" TEXT,
    "billingQuantity" DECIMAL(65,30),
    "billingQuantityUnit" TEXT,
    "netAmount" DECIMAL(65,30),
    "transactionCurrency" TEXT,
    "referenceSdDocument" TEXT,
    "referenceSdDocumentItem" TEXT,
    "referenceSdDocumentItemNormalized" TEXT,

    CONSTRAINT "BillingDocumentItem_pkey" PRIMARY KEY ("billingDocument","billingDocumentItem")
);

-- CreateTable
CREATE TABLE "JournalEntryAccountsReceivable" (
    "companyCode" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "accountingDocument" TEXT NOT NULL,
    "accountingDocumentItem" TEXT NOT NULL,
    "glAccount" TEXT,
    "referenceDocument" TEXT,
    "costCenter" TEXT,
    "profitCenter" TEXT,
    "transactionCurrency" TEXT,
    "amountInTransactionCurrency" DECIMAL(65,30),
    "companyCodeCurrency" TEXT,
    "amountInCompanyCodeCurrency" DECIMAL(65,30),
    "postingDate" TIMESTAMP(3),
    "documentDate" TIMESTAMP(3),
    "accountingDocumentType" TEXT,
    "assignmentReference" TEXT,
    "lastChangeDateTime" TIMESTAMP(3),
    "customer" TEXT,
    "financialAccountType" TEXT,
    "clearingDate" TIMESTAMP(3),
    "clearingAccountingDocument" TEXT,
    "clearingDocFiscalYear" TEXT,

    CONSTRAINT "JournalEntryAccountsReceivable_pkey" PRIMARY KEY ("companyCode","fiscalYear","accountingDocument","accountingDocumentItem")
);

-- CreateTable
CREATE TABLE "PaymentAccountsReceivable" (
    "companyCode" TEXT NOT NULL,
    "fiscalYear" TEXT NOT NULL,
    "accountingDocument" TEXT NOT NULL,
    "accountingDocumentItem" TEXT NOT NULL,
    "clearingDate" TIMESTAMP(3),
    "clearingAccountingDocument" TEXT,
    "clearingDocFiscalYear" TEXT,
    "amountInTransactionCurrency" DECIMAL(65,30),
    "transactionCurrency" TEXT,
    "amountInCompanyCodeCurrency" DECIMAL(65,30),
    "companyCodeCurrency" TEXT,
    "customer" TEXT,
    "invoiceReference" TEXT,
    "invoiceReferenceFiscalYear" TEXT,
    "salesDocument" TEXT,
    "salesDocumentItem" TEXT,
    "salesDocumentItemNormalized" TEXT,
    "postingDate" TIMESTAMP(3),
    "documentDate" TIMESTAMP(3),
    "assignmentReference" TEXT,
    "glAccount" TEXT,
    "financialAccountType" TEXT,
    "profitCenter" TEXT,
    "costCenter" TEXT,

    CONSTRAINT "PaymentAccountsReceivable_pkey" PRIMARY KEY ("companyCode","fiscalYear","accountingDocument","accountingDocumentItem")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "generatedSql" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessPartner_customer_idx" ON "BusinessPartner"("customer");

-- CreateIndex
CREATE INDEX "BusinessPartnerAddress_businessPartner_idx" ON "BusinessPartnerAddress"("businessPartner");

-- CreateIndex
CREATE INDEX "CustomerCompanyAssignment_customer_idx" ON "CustomerCompanyAssignment"("customer");

-- CreateIndex
CREATE INDEX "CustomerCompanyAssignment_companyCode_idx" ON "CustomerCompanyAssignment"("companyCode");

-- CreateIndex
CREATE INDEX "CustomerSalesAreaAssignment_customer_idx" ON "CustomerSalesAreaAssignment"("customer");

-- CreateIndex
CREATE INDEX "CustomerSalesAreaAssignment_salesOrganization_distributionC_idx" ON "CustomerSalesAreaAssignment"("salesOrganization", "distributionChannel", "division");

-- CreateIndex
CREATE INDEX "ProductDescription_product_idx" ON "ProductDescription"("product");

-- CreateIndex
CREATE INDEX "ProductPlant_product_idx" ON "ProductPlant"("product");

-- CreateIndex
CREATE INDEX "ProductPlant_plant_idx" ON "ProductPlant"("plant");

-- CreateIndex
CREATE INDEX "ProductStorageLocation_product_idx" ON "ProductStorageLocation"("product");

-- CreateIndex
CREATE INDEX "ProductStorageLocation_plant_idx" ON "ProductStorageLocation"("plant");

-- CreateIndex
CREATE INDEX "ProductStorageLocation_product_plant_idx" ON "ProductStorageLocation"("product", "plant");

-- CreateIndex
CREATE INDEX "SalesOrderHeader_soldToParty_idx" ON "SalesOrderHeader"("soldToParty");

-- CreateIndex
CREATE INDEX "SalesOrderHeader_salesOrganization_distributionChannel_orga_idx" ON "SalesOrderHeader"("salesOrganization", "distributionChannel", "organizationDivision");

-- CreateIndex
CREATE INDEX "SalesOrderItem_material_idx" ON "SalesOrderItem"("material");

-- CreateIndex
CREATE INDEX "SalesOrderItem_productionPlant_idx" ON "SalesOrderItem"("productionPlant");

-- CreateIndex
CREATE INDEX "SalesOrderItem_salesOrderItemNormalized_idx" ON "SalesOrderItem"("salesOrderItemNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderItem_salesOrder_salesOrderItemNormalized_key" ON "SalesOrderItem"("salesOrder", "salesOrderItemNormalized");

-- CreateIndex
CREATE INDEX "SalesOrderScheduleLine_salesOrder_salesOrderItem_idx" ON "SalesOrderScheduleLine"("salesOrder", "salesOrderItem");

-- CreateIndex
CREATE INDEX "OutboundDeliveryItem_plant_idx" ON "OutboundDeliveryItem"("plant");

-- CreateIndex
CREATE INDEX "OutboundDeliveryItem_referenceSdDocument_idx" ON "OutboundDeliveryItem"("referenceSdDocument");

-- CreateIndex
CREATE INDEX "OutboundDeliveryItem_referenceSdDocument_referenceSdDocumen_idx" ON "OutboundDeliveryItem"("referenceSdDocument", "referenceSdDocumentItemNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundDeliveryItem_deliveryDocument_deliveryDocumentItemN_key" ON "OutboundDeliveryItem"("deliveryDocument", "deliveryDocumentItemNormalized");

-- CreateIndex
CREATE INDEX "BillingDocumentHeader_soldToParty_idx" ON "BillingDocumentHeader"("soldToParty");

-- CreateIndex
CREATE INDEX "BillingDocumentHeader_accountingDocument_idx" ON "BillingDocumentHeader"("accountingDocument");

-- CreateIndex
CREATE INDEX "BillingDocumentHeader_companyCode_fiscalYear_idx" ON "BillingDocumentHeader"("companyCode", "fiscalYear");

-- CreateIndex
CREATE INDEX "BillingDocumentCancellation_accountingDocument_idx" ON "BillingDocumentCancellation"("accountingDocument");

-- CreateIndex
CREATE INDEX "BillingDocumentCancellation_soldToParty_idx" ON "BillingDocumentCancellation"("soldToParty");

-- CreateIndex
CREATE INDEX "BillingDocumentItem_material_idx" ON "BillingDocumentItem"("material");

-- CreateIndex
CREATE INDEX "BillingDocumentItem_referenceSdDocument_idx" ON "BillingDocumentItem"("referenceSdDocument");

-- CreateIndex
CREATE INDEX "BillingDocumentItem_referenceSdDocument_referenceSdDocument_idx" ON "BillingDocumentItem"("referenceSdDocument", "referenceSdDocumentItemNormalized");

-- CreateIndex
CREATE INDEX "JournalEntryAccountsReceivable_referenceDocument_idx" ON "JournalEntryAccountsReceivable"("referenceDocument");

-- CreateIndex
CREATE INDEX "JournalEntryAccountsReceivable_customer_idx" ON "JournalEntryAccountsReceivable"("customer");

-- CreateIndex
CREATE INDEX "JournalEntryAccountsReceivable_clearingAccountingDocument_idx" ON "JournalEntryAccountsReceivable"("clearingAccountingDocument");

-- CreateIndex
CREATE INDEX "PaymentAccountsReceivable_customer_idx" ON "PaymentAccountsReceivable"("customer");

-- CreateIndex
CREATE INDEX "PaymentAccountsReceivable_invoiceReference_idx" ON "PaymentAccountsReceivable"("invoiceReference");

-- CreateIndex
CREATE INDEX "PaymentAccountsReceivable_salesDocument_idx" ON "PaymentAccountsReceivable"("salesDocument");

-- CreateIndex
CREATE INDEX "PaymentAccountsReceivable_clearingAccountingDocument_idx" ON "PaymentAccountsReceivable"("clearingAccountingDocument");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "BusinessPartnerAddress" ADD CONSTRAINT "BusinessPartnerAddress_businessPartner_fkey" FOREIGN KEY ("businessPartner") REFERENCES "BusinessPartner"("businessPartner") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCompanyAssignment" ADD CONSTRAINT "CustomerCompanyAssignment_customer_fkey" FOREIGN KEY ("customer") REFERENCES "BusinessPartner"("businessPartner") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSalesAreaAssignment" ADD CONSTRAINT "CustomerSalesAreaAssignment_customer_fkey" FOREIGN KEY ("customer") REFERENCES "BusinessPartner"("businessPartner") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDescription" ADD CONSTRAINT "ProductDescription_product_fkey" FOREIGN KEY ("product") REFERENCES "Product"("product") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPlant" ADD CONSTRAINT "ProductPlant_product_fkey" FOREIGN KEY ("product") REFERENCES "Product"("product") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPlant" ADD CONSTRAINT "ProductPlant_plant_fkey" FOREIGN KEY ("plant") REFERENCES "Plant"("plant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStorageLocation" ADD CONSTRAINT "ProductStorageLocation_product_fkey" FOREIGN KEY ("product") REFERENCES "Product"("product") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStorageLocation" ADD CONSTRAINT "ProductStorageLocation_plant_fkey" FOREIGN KEY ("plant") REFERENCES "Plant"("plant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderHeader" ADD CONSTRAINT "SalesOrderHeader_soldToParty_fkey" FOREIGN KEY ("soldToParty") REFERENCES "BusinessPartner"("businessPartner") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_salesOrder_fkey" FOREIGN KEY ("salesOrder") REFERENCES "SalesOrderHeader"("salesOrder") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_material_fkey" FOREIGN KEY ("material") REFERENCES "Product"("product") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_productionPlant_fkey" FOREIGN KEY ("productionPlant") REFERENCES "Plant"("plant") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderScheduleLine" ADD CONSTRAINT "SalesOrderScheduleLine_salesOrder_salesOrderItem_fkey" FOREIGN KEY ("salesOrder", "salesOrderItem") REFERENCES "SalesOrderItem"("salesOrder", "salesOrderItem") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDeliveryItem" ADD CONSTRAINT "OutboundDeliveryItem_deliveryDocument_fkey" FOREIGN KEY ("deliveryDocument") REFERENCES "OutboundDeliveryHeader"("deliveryDocument") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDeliveryItem" ADD CONSTRAINT "OutboundDeliveryItem_plant_fkey" FOREIGN KEY ("plant") REFERENCES "Plant"("plant") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDeliveryItem" ADD CONSTRAINT "OutboundDeliveryItem_referenceSdDocument_fkey" FOREIGN KEY ("referenceSdDocument") REFERENCES "SalesOrderHeader"("salesOrder") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDeliveryItem" ADD CONSTRAINT "OutboundDeliveryItem_referenceSdDocument_referenceSdDocume_fkey" FOREIGN KEY ("referenceSdDocument", "referenceSdDocumentItemNormalized") REFERENCES "SalesOrderItem"("salesOrder", "salesOrderItemNormalized") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingDocumentHeader" ADD CONSTRAINT "BillingDocumentHeader_soldToParty_fkey" FOREIGN KEY ("soldToParty") REFERENCES "BusinessPartner"("businessPartner") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingDocumentCancellation" ADD CONSTRAINT "BillingDocumentCancellation_billingDocument_fkey" FOREIGN KEY ("billingDocument") REFERENCES "BillingDocumentHeader"("billingDocument") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingDocumentItem" ADD CONSTRAINT "BillingDocumentItem_billingDocument_fkey" FOREIGN KEY ("billingDocument") REFERENCES "BillingDocumentHeader"("billingDocument") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingDocumentItem" ADD CONSTRAINT "BillingDocumentItem_material_fkey" FOREIGN KEY ("material") REFERENCES "Product"("product") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingDocumentItem" ADD CONSTRAINT "BillingDocumentItem_referenceSdDocument_fkey" FOREIGN KEY ("referenceSdDocument") REFERENCES "OutboundDeliveryHeader"("deliveryDocument") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingDocumentItem" ADD CONSTRAINT "BillingDocumentItem_referenceSdDocument_referenceSdDocumen_fkey" FOREIGN KEY ("referenceSdDocument", "referenceSdDocumentItemNormalized") REFERENCES "OutboundDeliveryItem"("deliveryDocument", "deliveryDocumentItemNormalized") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryAccountsReceivable" ADD CONSTRAINT "JournalEntryAccountsReceivable_referenceDocument_fkey" FOREIGN KEY ("referenceDocument") REFERENCES "BillingDocumentHeader"("billingDocument") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryAccountsReceivable" ADD CONSTRAINT "JournalEntryAccountsReceivable_customer_fkey" FOREIGN KEY ("customer") REFERENCES "BusinessPartner"("businessPartner") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAccountsReceivable" ADD CONSTRAINT "PaymentAccountsReceivable_companyCode_fiscalYear_accountin_fkey" FOREIGN KEY ("companyCode", "fiscalYear", "accountingDocument", "accountingDocumentItem") REFERENCES "JournalEntryAccountsReceivable"("companyCode", "fiscalYear", "accountingDocument", "accountingDocumentItem") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAccountsReceivable" ADD CONSTRAINT "PaymentAccountsReceivable_customer_fkey" FOREIGN KEY ("customer") REFERENCES "BusinessPartner"("businessPartner") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAccountsReceivable" ADD CONSTRAINT "PaymentAccountsReceivable_invoiceReference_fkey" FOREIGN KEY ("invoiceReference") REFERENCES "BillingDocumentHeader"("billingDocument") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAccountsReceivable" ADD CONSTRAINT "PaymentAccountsReceivable_salesDocument_fkey" FOREIGN KEY ("salesDocument") REFERENCES "SalesOrderHeader"("salesOrder") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
