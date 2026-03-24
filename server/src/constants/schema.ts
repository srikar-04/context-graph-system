import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const migrationsRoot = path.resolve(process.cwd(), "prisma", "migrations");

export const ALLOWED_TABLES = [
  "BusinessPartner",
  "BusinessPartnerAddress",
  "CustomerCompanyAssignment",
  "CustomerSalesAreaAssignment",
  "Plant",
  "Product",
  "ProductDescription",
  "ProductPlant",
  "ProductStorageLocation",
  "SalesOrderHeader",
  "SalesOrderItem",
  "SalesOrderScheduleLine",
  "OutboundDeliveryHeader",
  "OutboundDeliveryItem",
  "BillingDocumentHeader",
  "BillingDocumentCancellation",
  "BillingDocumentItem",
  "JournalEntryAccountsReceivable",
  "PaymentAccountsReceivable",
  "ChatSession",
  "ChatMessage",
] as const;

let cachedSchemaPrompt: string | null = null;

export const getDatabaseSchemaPrompt = async (): Promise<string> => {
  if (cachedSchemaPrompt) {
    return cachedSchemaPrompt;
  }

  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  const migrationFolders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  const latestMigration = migrationFolders[0];

  if (!latestMigration) {
    throw new Error("No Prisma migration found for schema prompt generation.");
  }

  const migrationPath = path.join(
    migrationsRoot,
    latestMigration,
    "migration.sql"
  );
  cachedSchemaPrompt = await readFile(migrationPath, "utf8");

  return cachedSchemaPrompt;
};
