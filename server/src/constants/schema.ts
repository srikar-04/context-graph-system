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
let cachedSchemaMetadata: {
  tables: Record<string, string[]>;
  tableNameByLowercase: Record<string, string>;
} | null = null;

const parseSchemaMetadata = (schemaPrompt: string) => {
  const tables: Record<string, string[]> = {};
  const createTablePattern = /CREATE TABLE\s+"([^"]+)"\s*\(([\s\S]*?)\);\s*/gi;
  let match = createTablePattern.exec(schemaPrompt);

  while (match) {
    const tableName = match[1];
    const body = match[2];

    if (!tableName || !body) {
      match = createTablePattern.exec(schemaPrompt);
      continue;
    }

    const columns = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('"'))
      .map((line) => {
        const columnMatch = line.match(/^"([^"]+)"/);
        return columnMatch?.[1] ?? null;
      })
      .filter((columnName): columnName is string => Boolean(columnName));

    tables[tableName] = columns;
    match = createTablePattern.exec(schemaPrompt);
  }

  return {
    tables,
    tableNameByLowercase: Object.fromEntries(
      Object.keys(tables).map((nextTableName) => [
        nextTableName.toLowerCase(),
        nextTableName,
      ])
    ) as Record<string, string>,
  };
};

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

export const getSchemaMetadata = async () => {
  if (cachedSchemaMetadata) {
    return cachedSchemaMetadata;
  }

  const schemaPrompt = await getDatabaseSchemaPrompt();
  cachedSchemaMetadata = parseSchemaMetadata(schemaPrompt);

  return cachedSchemaMetadata;
};
