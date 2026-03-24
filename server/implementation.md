# Implementation Log

## Preparation - Codebase and Dataset Audit

### What I inspected before changing anything

- Read the existing server scaffold: `package.json`, `tsconfig.json`, `prisma.config.ts`, `src/index.ts`, `.gitignore`, `prisma/schema.prisma`, and the full `plan.md`.
- Verified the current state of the backend: the server implementation was still effectively a stub (`src/index.ts` only logged `hello world`), Prisma was configured but the schema only contained the generator/datasource boilerplate, and the dataset already existed locally in `server/data`.
- Profiled every dataset folder under `server/data` to understand the real entity shapes before writing the schema.

### Key dataset facts extracted from the JSONL files

- The dataset contains 19 folders and the record counts are:
  `billing_document_cancellations` 80,
  `billing_document_headers` 163,
  `billing_document_items` 245,
  `business_partner_addresses` 8,
  `business_partners` 8,
  `customer_company_assignments` 8,
  `customer_sales_area_assignments` 28,
  `journal_entry_items_accounts_receivable` 123,
  `outbound_delivery_headers` 86,
  `outbound_delivery_items` 137,
  `payments_accounts_receivable` 120,
  `plants` 44,
  `product_descriptions` 69,
  `product_plants` 3036,
  `product_storage_locations` 16723,
  `products` 69,
  `sales_order_headers` 100,
  `sales_order_items` 167,
  `sales_order_schedule_lines` 179.
- Every folder had a stable natural key or composite key. I verified there were no duplicate rows for the candidate keys used in the schema.
- Important relation discovery:
  `outbound_delivery_items.referenceSdDocument` maps cleanly back to `sales_order_headers.salesOrder` and `sales_order_items`.
- Important relation discovery:
  `billing_document_items.referenceSdDocument` maps cleanly to `outbound_delivery_headers.deliveryDocument` and to delivery items.
- Important relation discovery:
  `journal_entry_items_accounts_receivable.referenceDocument` maps to `billing_document_headers.billingDocument`.
- Important relation discovery:
  `payments_accounts_receivable` maps one-to-one to journal entries by `(companyCode, fiscalYear, accountingDocument, accountingDocumentItem)`.
- Important normalization discovery:
  SAP item numbers are not consistently formatted across folders. For example, delivery item references use values like `000010` while sales and billing item identifiers may use `10`. This required canonical normalized item-key fields in the schema plan.
- Important type discovery:
  several source files contain nested time objects such as `{ "hours": 11, "minutes": 31, "seconds": 13 }`, so the schema needs JSON columns for those values instead of forcing them into strings.

## Plan Improvements Applied

### Changes made to `plan.md`

- Added an execution note under the high-level flow section explaining that the executable ingestion script depends on the Prisma schema and generated client, so the practical build order must be dataset profiling -> schema/key design -> migration/client generation -> ingestion.
- Documented that some relationships are derived through item/reference tables, not header tables.
- Documented the need for canonical normalized item keys for reliable cross-table joins.
- Corrected the seed script path from `backend/src/scripts/seed.ts` to `server/src/scripts/seed.ts`.
- Corrected the schema-design note so it references the actual dataset location `server/data`.
- Expanded the normalization guidance to cover Prisma `Decimal`, JSON time fragments, and composite IDs.
- Added a frontend execution note after reading the locally vendored `client/.agents/skills/find-skills` and `client/.agents/skills/web-design-guidelines` skill folders.
- Recorded that the frontend should treat the web design guideline rules as build-time constraints, and that Tailwind is optional if a small shared CSS token system yields a more deliberate, accessible UI.

## Step 1 - Database Schema Design

### What changed

- Replaced the placeholder `prisma/schema.prisma` with a full dataset-driven Prisma schema.
- Modelled all 19 dataset entities plus the future chat/session tables:
  `BusinessPartner`,
  `BusinessPartnerAddress`,
  `CustomerCompanyAssignment`,
  `CustomerSalesAreaAssignment`,
  `Plant`,
  `Product`,
  `ProductDescription`,
  `ProductPlant`,
  `ProductStorageLocation`,
  `SalesOrderHeader`,
  `SalesOrderItem`,
  `SalesOrderScheduleLine`,
  `OutboundDeliveryHeader`,
  `OutboundDeliveryItem`,
  `BillingDocumentHeader`,
  `BillingDocumentCancellation`,
  `BillingDocumentItem`,
  `JournalEntryAccountsReceivable`,
  `PaymentAccountsReceivable`,
  `ChatSession`,
  `ChatMessage`.
- Used natural primary keys and composite primary keys wherever the dataset already had stable business keys, instead of inventing synthetic IDs for the raw SAP entities.
- Preserved source field names in camelCase so ingestion and future debugging stay traceable back to the raw JSONL payloads.
- Used `Decimal` for amount/quantity fields, `DateTime` for ISO dates, and `Json` for nested time fragments.
- Added canonical normalized item-number fields where cross-table relationships require zero-padding normalization:
  `salesOrderItemNormalized`,
  `deliveryDocumentItemNormalized`,
  `referenceSdDocumentItemNormalized`,
  `billingDocumentItemNormalized`,
  `salesDocumentItemNormalized`.
- Added actual relations based on the real data rather than the draft plan assumptions.

### Most important schema decisions

- `OutboundDeliveryHeader` was not given a direct sales-order relation because that foreign key does not exist in the raw header file. The real link is carried through `OutboundDeliveryItem.referenceSdDocument`.
- `BillingDocumentHeader` was not given direct sales-order or delivery foreign keys because those do not exist in the raw header file. The real delivery linkage is carried through `BillingDocumentItem.referenceSdDocument`.
- `PaymentAccountsReceivable` is modelled as a one-to-one companion of `JournalEntryAccountsReceivable` on the shared composite accounting key because the dataset supports that relation directly.
- `BillingDocumentCancellation` is stored as its own snapshot table linked one-to-one to `BillingDocumentHeader`, because the raw cancellation folder contains full cancelled billing records rather than just a lightweight mapping table.

### Verification completed

- `npx tsc --noEmit` succeeded.
- `npx prisma validate` succeeded after allowing Prisma to download its validation engine.
- `npx prisma generate` succeeded and generated the client into `src/generated/prisma`.

### Result at the end of this step

- The project now has a validated Prisma schema that matches the real dataset structure closely enough to support the next step: building the ingestion pipeline against generated Prisma models instead of placeholders.

## Step 2 - Data Ingestion Pipeline

### What changed

- Added [`src/lib/prisma.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\lib\prisma.ts) to create a shared Prisma client using the PostgreSQL adapter and the generated Prisma client.
- Added [`src/scripts/seed.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\scripts\seed.ts) as a real standalone ingestion script.
- Updated [`package.json`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\package.json) so the project has usable scripts for:
  `dev`,
  `build`,
  `db:generate`,
  `db:migrate`,
  `db:seed`.
- Prisma migration file was generated and applied at:
  `prisma/migrations/20260324142218_init_o2c_schema/migration.sql`.

### How the ingestion pipeline works now

- The script streams every `.jsonl` file line by line using Node `readline`, so we still avoid loading whole files into memory.
- Each raw record is normalized into database-ready values:
  empty strings -> `null`,
  ISO strings -> `Date`,
  numeric strings -> Prisma `Decimal`,
  nested time objects -> JSON,
  SAP item IDs -> canonical normalized item-number fields.
- The ingestion order follows the dependency chain established during schema design:
  plants -> products -> product descriptions -> product plants -> product storage locations -> business partners -> partner addresses -> customer company assignments -> customer sales area assignments -> sales order headers -> sales order items -> sales order schedule lines -> outbound delivery headers -> outbound delivery items -> billing document headers -> billing document items -> billing document cancellations -> journal entries -> payments.

### Important implementation improvement made after real execution

- I first implemented the seed as one-row-at-a-time Prisma `upsert`, matching the original architectural plan.
- That approach was correct logically but too slow in practice for the remote PostgreSQL database. It stalled on the large `product_storage_locations` folder and timed out twice.
- I then improved the loader to batch records with `createMany({ skipDuplicates: true })`.
- This preserved restart safety for the static dataset while making the full load complete successfully in under a minute on the final run.
- I added the same performance note back into [`plan.md`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\plan.md) so the plan stays aligned with the proven implementation.

### Execution and verification completed

- Applied the initial Prisma migration successfully with:
  `npx prisma migrate dev --name init_o2c_schema`
- Generated the Prisma client successfully with:
  `npx prisma generate`
- Ran the full seed successfully with:
  `npm run db:seed`
- Verified the final database counts with a read-only Postgres check. The inserted row counts match the dataset:
  `Plant` 44,
  `Product` 69,
  `ProductDescription` 69,
  `ProductPlant` 3036,
  `ProductStorageLocation` 16723,
  `BusinessPartner` 8,
  `BusinessPartnerAddress` 8,
  `CustomerCompanyAssignment` 8,
  `CustomerSalesAreaAssignment` 28,
  `SalesOrderHeader` 100,
  `SalesOrderItem` 167,
  `SalesOrderScheduleLine` 179,
  `OutboundDeliveryHeader` 86,
  `OutboundDeliveryItem` 137,
  `BillingDocumentHeader` 163,
  `BillingDocumentItem` 245,
  `BillingDocumentCancellation` 80,
  `JournalEntryAccountsReceivable` 123,
  `PaymentAccountsReceivable` 120.

### Result at the end of this step

- The backend now has a working, repeatable ingestion pipeline and a populated PostgreSQL database that matches the raw SAP dataset.

## Step 3 - Graph Construction Engine

### What changed

- Added [`src/types/graph.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\types\graph.ts) to define the graph contract used by the backend.
- Added [`src/graph/cache.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\graph\cache.ts) for in-memory graph and node caching.
- Added [`src/services/graphBuilder.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\services\graphBuilder.ts) to build graph nodes and edges from the populated PostgreSQL tables.
- Added [`src/services/graphCacheService.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\services\graphCacheService.ts) to rebuild and serve the cached graph.

### Important design improvement applied to the plan

- I updated [`plan.md`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\plan.md) so the node-ID guidance now reflects a safer implementation detail:
  graph node IDs must be globally unique, so the graph uses typed IDs such as `SalesOrder:740506` instead of raw business keys alone.
- The raw SAP key is still preserved in each node's `data.businessKey`.
- This avoids cross-entity collisions and makes the later query/highlight flow easier to reason about.

### Graph model implemented

- I intentionally focused the graph on the main transactional flow plus high-value master data instead of dumping every technical table into the visual graph.
- Current node types:
  `BusinessPartner`,
  `Plant`,
  `Product`,
  `SalesOrder`,
  `SalesOrderItem`,
  `ScheduleLine`,
  `OutboundDelivery`,
  `OutboundDeliveryItem`,
  `BillingDocument`,
  `BillingDocumentItem`,
  `JournalEntry`,
  `Payment`.
- Current edge types include:
  `placed_by`,
  `part_of`,
  `contains_product`,
  `produced_at`,
  `scheduled_for`,
  `fulfills_order`,
  `fulfills_item`,
  `ships_from`,
  `billed_to`,
  `billed_from_delivery`,
  `billed_from_delivery_item`,
  `bills_product`,
  `records_invoice`,
  `posted_for_customer`,
  `settles_entry`,
  `paid_by`,
  `references_invoice`,
  `references_order`.

### Verification completed

- Built the graph successfully against the populated database.
- The graph currently produces:
  `1441` nodes and `2957` edges.
- Verified example output:
  a business partner node such as `BusinessPartner:310000108` is produced correctly, and an edge such as `SalesOrder:740506 -> BusinessPartner:310000108 (placed_by)` is present.

### Result at the end of this step

- The backend now has a real graph-construction engine with in-memory caching, derived edges based on the real schema, and a stable node-ID strategy.

## Step 4 - Backend API Architecture

### What changed

- Added [`src/app.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\app.ts) to create the Express application.
- Updated [`src/index.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\index.ts) so startup now:
  loads env config,
  warms the graph cache,
  starts the server on `PORT` or `3000`.
- Added backend utility and middleware files:
  [`src/utils/asyncHandler.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\utils\asyncHandler.ts),
  [`src/middleware/logger.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\middleware\logger.ts),
  [`src/middleware/errorHandler.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\middleware\errorHandler.ts).
- Added route files:
  [`src/routes/health.routes.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\routes\health.routes.ts),
  [`src/routes/graph.routes.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\routes\graph.routes.ts).
- Added the missing `@types/express` dev dependency so the strict TypeScript build remains healthy.

### API surface implemented so far

- `GET /api/health`
- `GET /api/graph`
- `GET /api/graph/node/:id`
- `POST /api/graph/rebuild`

### Current backend behavior

- Every request is logged with method, path, and response time.
- The app sets simple CORS headers for the frontend origin.
- The graph API serves the cached graph instantly once startup has completed.
- Missing node lookups return a structured 404 response.
- Unhandled errors return a structured 500 response.

### Verification completed

- Installed missing Express type definitions successfully.
- `npx tsc --noEmit` succeeded after the backend files were added.
- `npm run build` succeeded.
- Ran the built server with `node dist/index.js` and confirmed startup reached:
  `Server listening on port 3000`

### Result at the end of this step

- The server is no longer a stub. It now exposes a working health endpoint and graph API on top of the seeded database and cached graph engine.

## Step 5 - LLM Query Interface

### Important plan improvement applied before implementation

- The Gemini transport strategy was improved twice during implementation:
  first away from deprecated `@google/generative-ai`,
  and then, based on your direction, to Gemini's OpenAI-compatible API using the standard `openai` client.
- I updated [`plan.md`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\plan.md) so it now reflects the OpenAI-compatible Gemini API approach instead of the Gemini-native SDK path.

### What changed

- Added [`src/constants/schema.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\constants\schema.ts) to load and cache the latest Prisma migration SQL as the schema prompt source for the model.
- Added [`src/services/genai.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\services\genai.ts) to wrap Gemini's OpenAI-compatible API client and fail cleanly when `GEMINI_API_KEY` is missing.
- [`src/services/genai.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\services\genai.ts) now uses:
  the `openai` package,
  Gemini's OpenAI-compatible base URL,
  `chat.completions.create(...)`,
  `response_format: { type: "json_object" }`.
- Added [`src/services/queryEngine.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\services\queryEngine.ts) to implement:
  prompt construction,
  model-response parsing,
  SQL safety validation,
  SQL execution,
  answer grounding,
  graph node reference extraction.
- Added [`src/schemas/query.schema.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\schemas\query.schema.ts) for chat request validation.
- Added [`src/routes/query.routes.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\routes\query.routes.ts) and mounted it in [`src/app.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\app.ts).
- Added [`src/middleware/validator.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\middleware\validator.ts), [`src/middleware/rateLimiter.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\middleware\rateLimiter.ts), and [`src/utils/apiError.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\utils\apiError.ts).
- Expanded [`server/.env.sample`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server.env.sample) with the environment variables the query layer now needs.
- Added support for `GEMINI_OPENAI_BASE_URL` in the environment template, with the Gemini OpenAI-compatible endpoint as the default.

### Query API surface implemented

- `POST /api/query/session`
- `GET /api/query/history/:sessionId`
- `POST /api/query/chat`

### Guardrails implemented

- Request validation via `zod`.
- In-memory rate limiting on `POST /api/query/chat` with a 20-requests-per-minute window.
- Model output parsing that accepts only:
  `{"sql":"...","explanation":"..."}` or `{"error":"out_of_scope"}`.
- SQL validation that rejects:
  non-`SELECT` statements,
  semicolons / multi-statement output,
  forbidden mutation keywords,
  references to tables outside the allowed schema.
- Grounding behavior that returns:
  a fixed out-of-scope response for off-domain questions,
  a fixed no-data response when the SQL result is empty.
- Node-reference extraction that maps SQL result values back to the graph's typed node IDs using cached `businessKey` metadata.

## Step 7 - Chat History and Session Management

### What changed

- Added [`src/services/chatHistory.ts`](c:\Users\srikar\OneDrive\desktop\code\context-graph-system\server\src\services\chatHistory.ts) to manage session creation, session existence checks, full history fetches, recent-history fetches, and message persistence.
- The query engine now loads the recent conversation history and includes it in the prompt text sent to Gemini.
- Session-backed query routes are now fully connected to the existing `ChatSession` and `ChatMessage` tables.

### Verification completed

- `npx tsc --noEmit` succeeded after the query/session layer was added.
- `npm run build` succeeded after the query/session layer was added.
- Ran database-backed runtime checks that verified:
  session creation works,
  empty history returns correctly,
  the query engine fails fast with a structured `503 GEMINI_API_KEY_MISSING` error when no API key is configured,
  missing-key failures do not mutate chat history.
- After you added a real Gemini API key, ran a real end-to-end query successfully through Gemini's OpenAI-compatible API:
  question: billing documents for customer `320000083`
  generated SQL: `SELECT "billingDocument" FROM "BillingDocumentHeader" WHERE "soldToParty" = '320000083'`
  query execution time: about `520ms`
  node references returned: `50`
- Ran a live Express API smoke test and verified:
  `GET /api/health`
  `POST /api/query/session`
  `POST /api/query/chat`
  `GET /api/query/history/:sessionId`
  all worked together against the real database and Gemini API.
- Ran an off-domain guardrail check with:
  `What is the capital of France?`
  and confirmed the planned out-of-scope response was returned with `sql: null`.

### Result at the end of these steps

- The backend now includes session creation, history retrieval, validated chat requests, guardrailed SQL generation/execution plumbing, and a working Gemini integration through the OpenAI-compatible API path.

## Step 6 - Frontend Architecture

### What I read and folded into the plan before building

- Read the locally vendored skill folders at:
  `client/.agents/skills/find-skills/SKILL.md` and
  `client/.agents/skills/web-design-guidelines/SKILL.md`.
- `find-skills` was useful as discovery context only, so it did not materially change the implementation plan.
- `web-design-guidelines` did change the durable frontend constraints, so I updated `plan.md` to record:
  semantic HTML expectations,
  visible focus treatment,
  reduced-motion handling,
  long-content safety,
  and the preference for a shared CSS token system over ad-hoc styling.
- I also fetched the latest published guideline file from the referenced GitHub source and used it as a quick review checklist while polishing the client.

### What changed

- Bootstrapped a real React + TypeScript + Vite frontend in `client/`.
- Added the client package/tooling files:
  `client/.gitignore`,
  `client/package.json`,
  `client/tsconfig.json`,
  `client/tsconfig.app.json`,
  `client/tsconfig.node.json`,
  `client/vite.config.ts`,
  `client/index.html`.
- Added a documented frontend environment template:
  `client/.env.sample`
  with `VITE_API_URL`.
- Added the full app shell and UI implementation:
  `client/src/main.tsx`,
  `client/src/App.tsx`,
  `client/src/index.css`.
- Added typed frontend contracts and API helpers:
  `client/src/types/index.ts`,
  `client/src/api/client.ts`.
- Added the data/state hooks:
  `client/src/hooks/useGraph.ts`,
  `client/src/hooks/useChat.ts`.
- Added the component layer:
  `client/src/components/GraphPanel.tsx`,
  `client/src/components/ChatPanel.tsx`,
  `client/src/components/NodeDetailDrawer.tsx`,
  `client/src/components/MessageBubble.tsx`.

### Frontend behavior implemented

- The app now renders the planned split experience:
  graph on the left,
  grounded chat on the right,
  stacked responsively on narrower screens.
- The graph panel loads `GET /api/graph`, adapts the backend `{ nodes, edges }` contract into the `react-force-graph-2d` `{ nodes, links }` shape, and renders:
  typed node colors,
  hover labels,
  highlighted answer nodes,
  a node detail drawer powered by `GET /api/graph/node/:id`.
- The chat panel:
  creates or restores a backend chat session,
  hydrates chat history from `GET /api/query/history/:sessionId`,
  sends new questions to `POST /api/query/chat`,
  shows generated SQL and execution time on assistant replies,
  and updates graph highlights from `nodesReferenced`.
- Added a `New Session` action that clears the local UI state and provisions a fresh backend session.

### Design and accessibility decisions

- Used a custom CSS token system instead of Tailwind so the UI could have a more deliberate visual language from the start:
  layered atmospheric background,
  editorial serif headline,
  mono SQL surfaces,
  glass-like data panels.
- Added accessibility and guideline-driven polish:
  skip link,
  semantic `main` / `section` / `aside` / `header` / `form`,
  visible `:focus-visible` styles,
  `aria-live` regions for async updates,
  `prefers-reduced-motion` handling,
  long-text overflow protection,
  tabular numerals for counts,
  `autocomplete="off"` and meaningful `name` on the chat input,
  and `color-scheme: dark` theming support.

### Verification completed

- Installed the frontend dependency set successfully with:
  `npm install`
- Fixed the initial graph-library integration mismatch where `react-force-graph-2d` expected `links` rather than the backend's `edges`.
- Tightened the client build script from `tsc -b && vite build` to `tsc --noEmit -p tsconfig.app.json && vite build` so routine builds do not emit TypeScript artifacts into the source tree.
- Built the client successfully with:
  `npm run build`
- The final production build completed and emitted the Vite `dist/` bundle.

### Known limitation after this step

- I did not perform a real browser smoke test inside this terminal session, so the client is build-verified but not visually click-tested in a browser window from here.
