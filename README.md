# SAP Order-to-Cash — Context Graph System

An interactive graph interface and natural-language query system built on top of real SAP Order-to-Cash data. Business users can explore document relationships visually and ask plain-English questions that are answered by LLM-generated SQL against the live dataset.

---

## Table of Contents

1. [Project Overview](#1-what-this-is)
2. [System Architecture](#2-system-architecture)
3. [Database Choice & Rationale](#3-database-choice--rationale)
4. [Graph Model Design](#4-graph-model-design)
5. [LLM Prompting Strategy](#5-llm-prompting-strategy)
6. [Guardrails](#6-guardrails)
7. [Tech Stack](#7-tech-stack)
8. [How to Run Locally](#8-how-to-run-locally)
9. [Project Structure](#9-project-structure)
10. [AI Coding Sessions](#10-ai-coding-sessions)

---

## 1. Project Overview

SAP ERP data is spread across 19+ entity types — sales orders, deliveries, billing documents, journal entries, payments, and more. These entities reference each other through SAP document numbers, but there is no built-in way to see those connections or ask questions across them without deep SAP knowledge and manual SQL joins.

This system solves that in two layers:

**Visual layer.** All entities and their relationships are rendered as an interactive force-directed graph. Nodes represent business documents and master data. Edges represent the document-flow relationships between them. Clicking any node opens a metadata panel with its full field set.

**Conversational layer.** A chat interface sits alongside the graph. Users ask questions in natural language. The system translates each question into SQL using an LLM, executes that SQL against the real database, and returns a grounded natural-language answer. Entities mentioned in the answer are highlighted on the graph in real time.

The full O2C document flow the system models:

```
BusinessPartner
    │ places
    ▼
SalesOrderHeader ──── contains ────► SalesOrderItem
    │                                      │ scheduled_for
    │                                      ▼
    │                              SalesOrderScheduleLine
    │ fulfilled_by
    ▼
OutboundDeliveryHeader ──── contains ────► OutboundDeliveryItem
                                                  │ fulfills_item
                                                  ▼
                                       BillingDocumentItem
                                                  │ part_of
                                                  ▼
BillingDocumentHeader ──── records_invoice ────► JournalEntry
                                                  │ settles_entry
                                                  ▼
                                              Payment
```

---

## 2. System Architecture

```
┌──────────────────────────────────────────────┐
│              React Frontend (Vite)           │
│                                              │
│  ┌─────────────────┐  ┌────────────────────┐ │
│  │  GraphPanel     │  │  ChatPanel         │ │
│  │  react-force-   │  │  Session history   │ │
│  │  graph-2d       │  │  Streaming answers │ │
│  │  Node highlights│  │  SQL + timing      │ │
│  └────────┬────────┘  └────────┬───────────┘ │
└───────────┼────────────────────┼─────────────┘
            │ GET /api/graph     │ POST /api/query/chat/stream
            ▼                    ▼
┌──────────────────────────────────────────────┐
│           Express.js Backend (Node/TS)       │
│                                              │
│  Middleware: Logger → CORS → RateLimiter     │
│             → Zod Validator → ErrorHandler   │
│                                              │
│  ┌──────────────┐   ┌──────────────────────┐ │
│  │ Graph Routes │   │ Query Routes         │ │
│  │              │   │                      │ │
│  │ graphBuilder │   │ queryEngine          │ │
│  │ (in-memory   │   │ → prompt builder     │ │
│  │  cache)      │   │ → Gemini API call    │ │
│  │              │   │ → SQL validation     │ │
│  │              │   │ → Prisma.$queryRaw   │ │
│  │              │   │ → answer grounding   │ │
│  │              │   │ → node highlighting  │ │
│  └──────┬───────┘   └──────────┬───────────┘ │
└─────────┼────────────────────── ┼────────────┘
          │                       │
          ▼                       ▼
┌──────────────────────────────────────────────┐
│         PostgreSQL (Neon, hosted)            │
│  19 SAP entity tables + ChatSession/Message  │
└──────────────────────────────────────────────┘
                         │
                         ▼
              Google Gemini 2.5 Flash
              (OpenAI-compatible API)
```

**Key design decisions baked into this architecture:**

- The graph is built once at server startup from PostgreSQL and held in memory. Graph API responses are instant regardless of dataset size.
- The query engine runs two LLM passes: one to generate SQL, one to produce a business-language explanation of the results. This separation keeps each pass focused and improves answer quality.
- The streaming endpoint (`POST /api/query/chat/stream`) emits newline-delimited JSON events (`meta` → `chunk`s → `done`) so the UI can show the answer as it arrives rather than waiting for the full response.
- Node references extracted from SQL results are expanded by one hop in the graph before being returned, so highlighted edges are also visible — not just isolated nodes.

---

## 3. Database Choice & Rationale

**PostgreSQL with Prisma ORM.**

The SAP O2C dataset is fundamentally relational. Every entity is identified by a stable business key (a SAP document number) and relationships exist as foreign-key references between those keys — for example, a `BillingDocumentItem` carries a `referenceSdDocument` field that points to a `OutboundDeliveryHeader`. This is exactly the problem relational databases were designed for.

**Why not Neo4j?**
Neo4j is a native graph database optimised for traversing unknown-depth relationship chains (think social networks, fraud rings). The queries in this system are bounded business questions that translate directly to SQL JOINs. More importantly, LLMs are far better at generating correct SQL than Cypher — using a graph database would have made the LLM query interface significantly less reliable without any compensating benefit.

**Why not SQLite?**
SQLite works as a zero-config local alternative (just change `provider` in `schema.prisma`) and was used during early development. PostgreSQL was chosen for production because it supports concurrent connections, is available as a managed service (Neon), and is the production-standard choice for any real AMS deployment.

**Why Prisma?**
Prisma's schema file is the single source of truth for both the database structure and the TypeScript types. It generates a fully type-safe client, manages migrations, and makes the schema readable enough to inject directly into LLM prompts as a SQL `CREATE TABLE` block — which is the foundation of the prompting strategy.

**Ingestion approach:**
The 19 JSONL dataset folders were ingested using a streaming line-by-line reader (Node `readline`) to avoid loading large files into memory. Records were normalised (empty strings → `null`, ISO strings → `Date`, numeric strings → `Decimal`, nested SAP time objects → `Json`, SAP item numbers → canonicalised normalized fields) and loaded using `createMany({ skipDuplicates: true })` for performance. Row-at-a-time `upsert` was tried first but was too slow for the `product_storage_locations` folder (16,723 rows); batch insert completed the full load in under one minute.

Final seeded counts: `SalesOrderHeader` 100, `OutboundDeliveryHeader` 86, `BillingDocumentHeader` 163, `JournalEntryAccountsReceivable` 123, `PaymentAccountsReceivable` 120, `Product` 69, `BusinessPartner` 8, `ProductStorageLocation` 16,723, and the remaining 11 entity tables.

---

## 4. Graph Model Design

**Node types (12):** `BusinessPartner`, `Plant`, `Product`, `SalesOrder`, `SalesOrderItem`, `ScheduleLine`, `OutboundDelivery`, `OutboundDeliveryItem`, `BillingDocument`, `BillingDocumentItem`, `JournalEntry`, `Payment`.

Not every technical table is included — storage locations, product plants, and cancellation snapshots are queryable via the chat interface but are not rendered as graph nodes. Including them would produce an unreadable hairball with 20,000+ nodes. The graph focuses on the main transactional flow plus the master data that gives it meaning.

**Edge types (17):** `placed_by`, `part_of`, `contains_product`, `produced_at`, `scheduled_for`, `fulfills_order`, `fulfills_item`, `ships_from`, `billed_to`, `billed_from_delivery`, `billed_from_delivery_item`, `bills_product`, `records_invoice`, `posted_for_customer`, `settles_entry`, `paid_by`, `references_invoice`.

**Node ID strategy:** Nodes use typed composite IDs (`SalesOrder:740506`, `BillingDocument:91150187`) rather than raw SAP business keys. This avoids cross-entity ID collisions (a customer ID and a billing document ID could be the same number), makes the highlight flow unambiguous, and keeps the raw SAP key accessible in `node.data.businessKey` for debugging.

**Edge derivation:** Edges come from foreign-key fields in the database — they are not stored separately. The graph builder reads the relational data and creates an edge whenever a FK field is non-null. One important discovery during implementation: `OutboundDeliveryHeader` has no direct `salesOrder` FK in the raw data. The Sales Order linkage runs through `OutboundDeliveryItem.referenceSdDocument`. Similarly, `BillingDocumentHeader` links to deliveries through `BillingDocumentItem.referenceSdDocument`. The graph model reflects the real data, not the assumed schema.

**In-memory cache:** The full `{ nodes: 1441, edges: 2957 }` graph is built once at server startup and held in a module-level variable. `GET /api/graph` returns this instantly. A `POST /api/graph/rebuild` endpoint allows refreshing without a server restart.

**Frontend layout:** Rather than relying on the force simulation to organise the graph from scratch (which produced an unreadable central cluster on first load), nodes are pre-positioned by entity family into O2C pipeline stages before the simulation runs. This makes the graph readable immediately and ensures edges are visible on first paint.

---

## 5. LLM Prompting Strategy

**Model:** Google Gemini 2.5 Flash via Gemini's OpenAI-compatible API endpoint, using the standard `openai` TypeScript package. This means the integration code is familiar to any engineer who has worked with OpenAI and can be switched to any OpenAI-compatible provider by changing one environment variable.

**Why Gemini Flash?**
Free tier allows 15 RPM and 1M tokens/day — sufficient for a demo. The 1M token context window is large enough to hold the full schema plus conversation history in a single request. Flash is fast, and SQL generation does not require the most capable model.

**Two-pass architecture:**

The query engine runs two separate LLM calls per user question. This is the most important prompting decision in the system.

*Pass 1 — SQL generation.* The model receives the full database schema (as the actual Prisma migration SQL, not a prose description), conversation history, and the user's question. It is instructed to return only a JSON object with two fields:

```json
{ "sql": "SELECT ...", "explanation": "Template describing what this query finds" }
```

Or, for off-topic questions:

```json
{ "error": "out_of_scope" }
```

Forcing JSON output (`response_format: { type: "json_object" }`) makes the response machine-parseable without any regex. Injecting the schema as raw SQL `CREATE TABLE` statements — rather than as prose — is the most reliable way to get correct table and column names in generated queries.

*Pass 2 — Answer grounding.* After SQL executes successfully, a second LLM call receives the SQL, the Pass 1 explanation, the raw result rows, and an instruction to explain the result in plain business language. The prompt instructs the model to: start with the direct answer, then explain how the data was found, then explain what the result means in the Order-to-Cash flow, and to assume the user has no SQL knowledge.

This separation is deliberate: Pass 1 stays focused on producing valid SQL; Pass 2 stays focused on producing a human-readable explanation. Mixing both into one pass produces lower-quality output for both.

**Schema injection:** Rather than describing the schema in prose, the backend reads the actual Prisma migration SQL file and injects it verbatim into the system prompt. This is updated automatically whenever a new migration runs. The schema string is loaded and cached at startup (`src/constants/schema.ts`).

**Conversation history:** The last 10 message pairs from the session are prepended to each request so the model has context for follow-up questions. A sliding window is used to keep prompt size bounded.

**Identifier canonicalization:** A known failure mode for Text-to-SQL is the model generating lowercase or unquoted identifiers like `salesorderheader` instead of `"SalesOrderHeader"`. The query engine parses the Prisma migration metadata at startup and repairs model output before execution — `salesorderheader` → `"SalesOrderHeader"`, etc.

---

## 6. Guardrails

Three independent layers prevent misuse:

**Layer 1 — System prompt.** The model is instructed to return `{"error": "out_of_scope"}` for any question that cannot be answered from the dataset. This covers general knowledge, creative writing, coding help, and anything unrelated to the O2C domain. The backend detects this marker and returns a fixed response without executing any query. Verified live: `"What is the capital of France?"` → out-of-scope response, `sql: null`.

**Layer 2 — SQL validation.** Before any generated SQL is executed, the backend applies these checks in order:
- Strip and normalise the query string.
- Reject anything that does not begin with `SELECT`.
- Reject any statement containing `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, or `CREATE`.
- Reject multi-statement output (semicolon-separated queries).
- Validate that all table names in the query exist in the known schema whitelist.

This layer blocks prompt injection attacks — attempts to craft a natural-language question that tricks the model into generating destructive SQL. Even if the model were manipulated, the SQL would be rejected before touching the database.

**Layer 3 — Result grounding.** If the SQL executes successfully but returns zero rows, the response is a fixed "No data was found for this query" message rather than passing empty results to the answer-generation pass. This prevents the model from fabricating answers when it receives nothing to work with.

**Additional operational guardrails:**
- Rate limiter on `POST /api/query/chat` — 20 requests per minute per IP, enforced in-memory. Returns HTTP 429 when exceeded.
- Zod schema validation on all POST request bodies — rejects malformed requests before they reach business logic.
- `GEMINI_API_KEY` absence check at startup — fails fast with a structured `503 GEMINI_API_KEY_MISSING` error rather than throwing opaque runtime errors into query handlers.
- Transient Gemini provider failures (rate limits, upstream 5xx) are retried a fixed number of times before surfacing to the user.
- All stream errors are logged server-side with session ID and message context before being converted to client-facing error events.

---

## 7. Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Backend runtime | Node.js + TypeScript | Type safety, production-ready, strong LLM SDK ecosystem |
| Backend framework | Express.js | Explicit, minimal, full middleware control |
| ORM | Prisma | Type-safe client, single schema source of truth, migration management |
| Database | PostgreSQL (Neon) | Managed, production-grade, optimal for relational O2C data |
| LLM | Gemini 2.5 Flash | Free tier, OpenAI-compatible API, large context window |
| LLM client | `openai` npm package | Standard interface, portable across providers |
| Validation | Zod | Runtime schema validation with TypeScript inference |
| Frontend | React + TypeScript + Vite | Fast build, strong typing, component model |
| Graph rendering | `react-force-graph-2d` | Force-directed layout, handles 1000+ nodes, click/hover events |
| Styling | Custom CSS token system | More deliberate visual language than Tailwind utility classes |
| Backend deployment | Render | Native Node.js support, managed env vars, health checks |
| Frontend deployment | Vercel | Zero-config Vite deploys, SPA rewrite via `vercel.json` |

---

## 8. How to Run Locally

**Prerequisites:** Node.js 20+, PostgreSQL database (local or Neon free tier).

**1. Clone and install**

```bash
git clone <repo-url>
cd context-graph-system

cd server && npm install
cd ../client && npm install
```

**2. Configure environment**

```bash
# server/.env
DATABASE_URL="postgresql://user:password@host:5432/sap_o2c"
GEMINI_API_KEY="your_gemini_api_key"       # https://ai.google.dev
GEMINI_MODEL="gemini-2.5-flash"
GEMINI_OPENAI_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai/"
PORT=3000
DATA_PATH="./data"
FRONTEND_ORIGIN="http://localhost:5173"
NODE_ENV="development"

# client/.env
VITE_API_URL="http://localhost:3000"
```

**3. Run database migrations**

```bash
cd server
npx prisma migrate dev
```

**4. Seed the database** (place the JSONL dataset folders in `server/data/`)

```bash
npm run db:seed
# Loads all 19 entity types. Completes in under 2 minutes.
```

**5. Start backend**

```bash
npm run dev
# Server on http://localhost:3000
# Graph cache warms on startup (~1441 nodes, 2957 edges)
```

**6. Start frontend**

```bash
cd ../client && npm run dev
# App on http://localhost:5173
```

**Try these queries:**
- `Show billing documents for customer 320000083`
- `Find the journal entry linked to billing document 91150187`
- `Which sales orders have been delivered but not billed?`
- `What is the capital of France?` → triggers guardrail

---

## 9. Project Structure

```
context-graph-system/
├── server/
│   ├── prisma/
│   │   ├── schema.prisma          ← All 21 models (19 SAP entities + chat tables)
│   │   └── migrations/            ← Migration SQL (used as LLM schema prompt source)
│   ├── src/
│   │   ├── index.ts               ← Startup: env load → graph cache warm → listen
│   │   ├── app.ts                 ← Express app, middleware registration
│   │   ├── constants/
│   │   │   └── schema.ts          ← Loads migration SQL + parses table metadata
│   │   ├── graph/
│   │   │   └── cache.ts           ← In-memory graph store
│   │   ├── middleware/
│   │   │   ├── logger.ts          ← Request logging with response time
│   │   │   ├── rateLimiter.ts     ← Per-IP rate limiting
│   │   │   ├── validator.ts       ← Zod-based request body validation
│   │   │   └── errorHandler.ts    ← Global structured error boundary
│   │   ├── routes/
│   │   │   ├── graph.routes.ts    ← GET /api/graph, /api/graph/node/:id
│   │   │   └── query.routes.ts    ← POST /api/query/chat/stream, session routes
│   │   ├── services/
│   │   │   ├── graphBuilder.ts    ← Derives nodes + edges from PostgreSQL
│   │   │   ├── genai.ts           ← Gemini OpenAI-compatible wrapper + retry logic
│   │   │   ├── queryEngine.ts     ← Two-pass LLM → SQL → grounded answer pipeline
│   │   │   └── chatHistory.ts     ← Session creation, history fetch, message save
│   │   ├── scripts/
│   │   │   └── seed.ts            ← JSONL ingestion pipeline
│   │   └── lib/
│   │       └── prisma.ts          ← Prisma client singleton
│   └── data/                      ← Drop dataset folders here
│
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── GraphPanel.tsx     ← Force-graph, node highlights, detail drawer
│   │   │   ├── ChatPanel.tsx      ← Session list, message feed, streaming input
│   │   │   ├── NodeDetailDrawer.tsx
│   │   │   └── MessageBubble.tsx
│   │   ├── hooks/
│   │   │   ├── useGraph.ts        ← Fetches and caches graph data
│   │   │   └── useChat.ts         ← Session bootstrap, message send, stream parsing
│   │   ├── api/
│   │   │   └── client.ts          ← Typed API functions
│   │   └── types/index.ts
│   └── vercel.json                ← SPA rewrite config
│
├── render.yaml                    ← Render deployment blueprint
└── deployment.md                  ← Step-by-step hosting guide
```

---

## 10. AI Coding Sessions

This project was built using **OpenAI Codex** (for implementation) and **Claude** (for architectural planning and reasoning). Session logs are included in the repository submission bundle.

**What was planned with Claude:**
- Full architectural reasoning across all 7 build phases
- Database technology decision (PostgreSQL vs Neo4j vs vector DB)
- LLM provider selection and prompting strategy design
- Guardrails system design (three-layer approach)
- Data ingestion strategy (JSONL streaming, idempotent upsert, batching rationale)
- Graph construction approach (FK-derived edges, typed node IDs, in-memory cache)
- API middleware stack design and security considerations

**What was implemented and iterated with Codex:**
- Full Prisma schema design after profiling the real JSONL dataset
- Discovery of real FK relationships vs assumed ones (e.g., delivery-to-order link runs through items, not headers)
- Ingestion pipeline with batching fix (`createMany` replacing row-at-a-time `upsert` after timeout on 16,723-row table)
- Graph builder producing 1,441 nodes and 2,957 edges
- Express app, middleware, and all route handlers
- Two-pass LLM query engine with streaming, SQL canonicalization, and node-reference extraction
- React frontend with force-graph integration, stage-based initial layout, streaming chat, and session history
- Multiple UI stability passes (canvas sizing, click hit areas, graph edge visibility, session restore)
- Deployment configuration for Render + Vercel

**Iteration patterns observed:**
The most significant implementation divergences from the original plan were: (1) the FK structure of delivery and billing items required going through item tables not header tables — discovered by profiling the actual JSONL data before writing the schema; (2) ingestion required batching for performance — discovered through a real timeout on the remote database; (3) the graph initial layout required pre-positioning by entity stage because the pure force simulation collapsed into an unreadable cluster.

All three required updating `plan.md` to keep it aligned with the real implementation. The session transcripts show this evolution from plan → execution → discovery → plan update → refined execution.

---

*Built for the Dodge AI Forward Deployed Engineer assignment. Dataset: SAP Order-to-Cash synthetic ERP data across 19 entity types.*
