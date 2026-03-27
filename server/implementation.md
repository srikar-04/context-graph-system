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

## UI, Graph, and Chat Refinement Pass

### Plan improvements applied

- Updated `plan.md` so the durable architecture now reflects:
  the streaming chat endpoint,
  the session-list endpoint and title behavior,
  the second grounded answer-generation pass after SQL execution,
  stronger node-reference extraction,
  and the refined frontend interaction model for the graph and chat panels.

### What changed in this pass

- Reworked the frontend visual system to be lighter and more minimal:
  smaller typography,
  smaller controls,
  reduced visual bloat,
  a more Vercel-like light surface treatment.
- Reworked the graph panel so it now:
  uses a restrained blue/rose palette,
  renders smaller nodes with more visible edges,
  increases graph spacing via stronger force configuration,
  recenters and slightly zooms in on the initial settled view,
  includes a compact `Collapse` reset control,
  and uses a more compact detail drawer with a sticky header and key-value rows.
- Reworked the chat panel so it now:
  removes the old explanatory clutter,
  uses a compact auto-expanding composer,
  shrinks the chrome around the message feed,
  replaces the old session button with a `+` action,
  and adds a horizontal session-history strip with human-readable titles.
- Reworked message rendering so long assistant outputs are now clamped by default with a `Show more` control instead of stretching the entire page.

### Backend changes in this pass

- Added `GET /api/query/sessions` to expose recent sessions with titles derived from the first user message.
- Added `POST /api/query/chat/stream` to stream newline-delimited JSON events back to the client.
- Upgraded the query engine so it now:
  loads conversation history before saving the new user message,
  runs a second grounded LLM pass to explain verified SQL results in business language,
  sanitizes model SQL more defensively before validation,
  and extracts node references from result rows plus SQL/message literals for stronger highlighting.
- Added text-generation and streamed text-generation helpers on top of the existing Gemini OpenAI-compatible transport.

### Verification completed

- `server`: `npm run build`
- `client`: `npm run build`
- Ran a live backend smoke test against the real database and Gemini API that verified:
  `POST /api/query/session`,
  `GET /api/query/sessions`,
  `POST /api/query/chat/stream`
  all worked together.
- Verified the streaming route emitted:
  a `meta` event with SQL, node references, and execution time,
  multiple `chunk` events,
  and a final `done` event.
- Verified the streaming happy-path query:
  `Show billing documents for customer 320000083`
  returned non-zero node references and a relational answer rather than dumping a raw row array.
- Verified session titles are now human-readable, for example:
  `Find the journal entry linked to billing document 91150...`

## Regression Fix Pass - Graph Visibility and SQL Reliability

### Plan improvements applied

- Updated `plan.md` so the LLM step now explicitly records identifier canonicalization against real schema metadata before SQL execution.
- Updated `plan.md` so the frontend step now records that graph/chat headers must not clip controls and that graph links should be drawn with enough contrast to remain visible on the initial light-theme view.

### What changed in this pass

- Tightened the frontend shell layout in `client/src/index.css` so the graph and chat cards no longer clip header controls when space gets tight:
  the page now scrolls vertically when needed,
  shell overflow is no longer hiding top controls,
  and header/session areas can wrap or scroll instead of cutting off actions.
- Reworked `client/src/components/GraphPanel.tsx` so graph rendering is easier to read:
  `SalesOrder`, `BillingDocument`, and `JournalEntry` now use clearly separated colors,
  graph spacing is increased with longer link distances and stronger repulsion,
  and links are drawn explicitly on the canvas with a stronger two-pass stroke so they remain visible on the light background.
- Strengthened `server/src/services/queryEngine.ts` so generated SQL is more reliable:
  the prompt now requires exact quoted PostgreSQL identifiers,
  semicolon handling no longer silently strips validation context,
  and the backend canonicalizes known table/column names against parsed Prisma migration metadata before execution.
- Added schema metadata parsing in `server/src/constants/schema.ts` so the query layer can repair brittle model output like `salesorderheader` into `"SalesOrderHeader"` safely.
- Expanded node highlighting in `server/src/services/queryEngine.ts` to include one-hop graph neighbors after the initial matches, which makes highlighted edges much more visible after a successful answer.

### Verification completed

- `server`: `npm run build`
- `client`: `npm run build`
- Started the built backend against the real environment and verified `GET /api/health` responded successfully.
- Verified `GET /api/graph` still returns `1441` nodes and `2957` edges.
- Ran a real streamed query for:
  `Show billing documents for customer 320000083`
  and confirmed the response executed valid SQL, returned `50` highlighted nodes, and streamed a successful answer.
- Re-ran the previously failing sales-order linkage style query:
  `How is sales order 740565 linked?`
  and confirmed it now produced valid quoted SQL against `"SalesOrderHeader"` instead of failing on lowercase relation names, while also returning a non-zero `nodesReferenced` payload.

## Client Stability Pass - Chat Containment, Graph Layout, and Session Restore

### Plan improvements applied

- Updated `plan.md` so the frontend architecture now explicitly records that long chat/session content must not widen the chat card outside its border.
- Updated `plan.md` so session bootstrapping now restores the latest existing conversation before creating a fresh one.
- Updated `plan.md` so the graph strategy now reflects a deterministic type-clustered initial layout instead of relying only on the default force simulation, which had been collapsing the dataset into an unreadable central cluster.

### What changed in this pass

- Tightened `client/src/index.css` so the chat shell contains its own content correctly:
  the shell clips internal overflow again,
  the session strip scrolls inside the card instead of pushing past it,
  and long SQL/details content now wraps inside the message surface instead of stretching the whole panel.
- Reworked `client/src/components/GraphPanel.tsx` so the graph starts from a deliberate separated layout:
  nodes are pre-positioned by entity family,
  cross-entity links render through the library's default link path on first load,
  and the initial `Collapse` view now fits and centers that wider transactional map instead of a collapsed hairball.
- Updated `client/src/hooks/useChat.ts` so startup no longer creates a new chat session every time.
  The client now:
  restores the previously stored session from browser storage when possible,
  otherwise loads the latest session from the backend,
  and only creates a new session when no historical session exists.

### Verification completed

- `client`: `npm run build`

## Query Reliability Pass - Hard-Case Planning, Item Normalization, and Scoped Highlighting

### Plan improvements applied

- Updated `plan.md` so broad exception-style O2C questions and compact `document/item` identifiers are now explicitly treated as query-planning problems rather than pure free-form text-to-SQL tasks.
- Updated `plan.md` so graph highlighting is now documented as SQL-scope-aware instead of globally matching every node that happens to share a scalar value.

### What changed in this pass

- Reworked `server/src/services/queryEngine.ts` to add a lightweight query-planning layer before SQL generation.
  The backend now identifies hard-case questions, adds reasoning hints for the model, and can bypass free-form SQL generation when a deterministic query is safer.
- Added a deterministic SQL path for broad broken-flow questions such as:
  delivered but not billed,
  billed without complete delivery,
  and incomplete O2C flow detection.
  This avoids relying only on status-code guessing by the model.
- Added explicit normalization logic for compact sales-order-item references like `S40604/40`.
  The query layer now understands that short item numbers should usually target `salesOrderItemNormalized` instead of the raw zero-padded `salesOrderItem` field.
- Added a deterministic SQL path for the concrete sales-order-item material-group lookup pattern shown during testing.
  This prevents the model from missing obvious item-detail queries when the item identifier is written in compact human format.
- Tightened `server/src/services/queryEngine.ts` highlighting behavior.
  Highlight extraction now:
  scopes candidate nodes to the node types implied by the executed SQL tables,
  stops using raw message literals as generic graph matches,
  and only expands to neighboring nodes for clearly relational questions.
  This specifically reduces the previous issue where a simple business-partner key lookup could highlight unrelated schedule lines, sales orders, and deliveries just because they shared the same customer id.

### Verification completed

- `server`: `npm run build`

### Remaining limitation

- I could not run a real end-to-end database-backed smoke test from this terminal in this pass, so the changes are code-verified and type-checked, but not live-query-verified here.

## Client and LLM Reliability Pass - Graph Canvas Ownership, Click Restoration, and Stream Error Hardening

### Plan improvements applied

- Updated `plan.md` to record that the graph canvas must be sized from measured container dimensions instead of being CSS-stretched after render.
- Updated `plan.md` to record that the staged graph should use a deterministic bounds-based initial camera rather than relying only on generic `zoomToFit` behavior.
- Updated `plan.md` to record that streamed LLM failures must be logged server-side and that transient Gemini provider failures should be retried in the OpenAI-compatible wrapper.

### What changed in this pass

- Reworked `client/src/components/GraphPanel.tsx` so the graph now waits for measured surface dimensions before mounting the force-graph canvas.
  The component now passes explicit `width` and `height` props, computes stable graph bounds from the staged node positions, and restores the initial camera by centering on those bounds and applying a controlled zoom level.
- Added a larger invisible node hit area in `client/src/components/GraphPanel.tsx` with `nodePointerAreaPaint`.
  This restores reliable node clicking and metadata opening even though the visible nodes remain intentionally small.
- Tightened `client/src/index.css` so `.graph-surface` owns the full available panel height and no longer stretches the underlying graph canvas with CSS width/height overrides.
  This addresses the repeated first-load problems where edges disappeared, only part of the graph rendered, or pointer hit-testing drifted away from the visible nodes.
- Hardened `server/src/services/genai.ts` so Gemini requests made through the OpenAI-compatible API now retry a small number of times for transient provider failures such as rate limits, connection issues, and upstream 5xx responses.
  Non-transient model failures are normalized into explicit `ApiError` instances instead of bubbling up as opaque unknown exceptions.
- Updated `server/src/routes/query.routes.ts` so `/api/query/chat/stream` now logs the original error object, session id, and message context before converting the failure into a client-facing stream error event.
  This closes the debugging gap that previously produced regular `Internal server error.` responses in the UI with no useful backend log trail.

### Verification completed

- `client`: `npm run build`
- `server`: `npm run build`

### Remaining limitation

- I still cannot do a real browser click-through from this terminal alone, so this pass is code- and build-verified rather than visually browser-smoke-tested end to end.

## UX and Deployment Prep Pass - Edge Warning, Better Explanations, and Hosted Config

### Plan improvements applied

- Updated `plan.md` so the deployment strategy now reflects the actual repo configuration for a first production launch:
  backend on Render with `render.yaml`,
  frontend on Vercel with `client/vercel.json`,
  and production migrations through `npm run db:migrate:deploy`.

### What changed in this pass

- Updated `client/src/components/GraphPanel.tsx` and `client/src/index.css` with a temporary UX safeguard for the unresolved first-load edge issue.
  The graph now shows a small warning banner with a glowing dot that tells the user to refresh once if edges are missing on first load.
- Strengthened `server/src/services/queryEngine.ts` so the answer-generation pass is more explanatory for non-technical users.
  The answer prompt now explicitly tells the model to:
  explain the SQL in plain English,
  assume the user does not know SQL or the schema,
  start with the direct answer,
  then explain how the data was found,
  and then explain what the result means in the Order-to-Cash flow.
- Started using the SQL-generation model's own `explanation` field as input to the answer-generation pass.
  This gives the second-stage response better context about what the SQL was trying to do, which improves readability and reduces cryptic answers.
- Improved the server fallback answer path in `server/src/services/queryEngine.ts`.
  If the explanatory answer model is unavailable or rate-limited, the fallback response is now more human-readable and explains the query intent instead of only dumping representative values.
- Added `db:migrate:deploy` to `server/package.json` for production-safe schema migrations.
- Added `client/vercel.json` so the Vite frontend behaves correctly as a single-page app on Vercel.
- Added `render.yaml` so the backend has a concrete Render blueprint for install, Prisma generate, migration deploy, build, start, and health checks.
- Added `DEPLOYMENT_VERCEL_RENDER.md` at the repo root with a detailed step-by-step deployment guide tailored to this project.

### Verification completed

- `client`: `npm run build`
- `server`: `npm run build`

### Remaining limitation

- The first-load edge bug is not fully eliminated yet, so this pass adds a clear UI warning and refresh instruction as a temporary user-facing safeguard.

## Deployment Guide Simplification - Render Dashboard + Existing Neon Database

### Plan improvements applied

- Updated the deployment documentation so it now matches the real intended hosting flow:
  frontend on Vercel,
  backend on Render,
  existing seeded Neon PostgreSQL reused directly,
  and no `render.yaml` required for the first deployment path.

### What changed in this pass

- Replaced the previous deployment guide with a simpler [deployment.md](/c:/Users/srikar/OneDrive/desktop/code/context-graph-system/deployment.md).
- The guide now assumes:
  Neon already exists,
  data is already seeded,
  backend deployment is created manually from the Render dashboard,
  and the only production database step is supplying the existing `DATABASE_URL`.
- The new guide also keeps `npm run db:migrate:deploy` in the Render build command because it is safe when the schema is already current and protects against drift between code and database schema.

### Verification completed

- Documentation-only change; no runtime build changes were required.

## Responsive Shell Pass - Chat Loading State and Compact Chat Drawer

### What changed in this pass

- Updated `client/src/components/ChatPanel.tsx` so the chat area no longer appears blank while bootstrapping.
  It now shows a dedicated loading state while the client fetches the latest session and chat history from the backend.
- Updated `client/src/components/GraphPanel.tsx` and `client/src/index.css` so the first-load edge warning now lives inside the graph surface itself.
  This avoids the previous layout clipping issue and keeps the warning visible on desktop as well as mobile.
- Reworked `client/src/App.tsx` and `client/src/index.css` for tablet and mobile layouts.
  Instead of stacking the graph and chat vertically, the graph now remains the primary full-screen workspace and the chat opens as a right-side slide-over panel with its own scroller.
- Added a compact-layout responsive state in `client/src/App.tsx` so desktop keeps the side-by-side view while smaller screens use the overlay chat panel.
- Added a backdrop and close control for the compact chat drawer so touch interaction is more predictable and the graph no longer traps the whole page scroll in stacked mode.

### Verification completed

- `client`: `npm run build`
- Verified the client TypeScript build remains clean after the graph-panel rewrite and session bootstrap change.

### Remaining limitation

- I still cannot do a real browser click-through from this terminal alone, so this pass is code- and build-verified rather than visually browser-smoke-tested end to end.

## Client Layout Pass - Stage-Based Graph Map and Safer Chat Shell

### Plan improvements applied

- Updated `plan.md` so the frontend graph strategy now records a stage-based initial layout rather than the previous ring-style clustering.

### What changed in this pass

- Reworked `client/src/components/GraphPanel.tsx` again so the graph no longer starts as concentric clusters.
  Nodes are now placed in stable O2C lanes with fixed stage-based positions, which is intended to make links render immediately on first load and reduce the half-canvas / off-center behavior caused by the previous layout strategy.
- Reworked `client/src/components/ChatPanel.tsx` so the chat header is a simpler two-row structure:
  title plus `+` action on the first row,
  recent-session strip on the second row.
  This is more robust than the older wrapped flex session bar.
- Tightened `client/src/index.css` so the right panel layout is less brittle:
  the workspace gives the chat panel a stronger minimum width,
  the session row is isolated from the title row,
  and the chat feed now uses a straightforward flex column rather than the previous grid-based message stack.

### Verification completed

- `client`: `npm run build`
