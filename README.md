# DocuMind

DocuMind is a full-stack PDF RAG application with a React/Vite client and an Express backend. PDFs are cleaned, recursively chunked, embedded with Gemini, stored in Supabase PostgreSQL/pgvector, retrieved by cosine similarity, and answered with grounded Gemini citations.

## Structure

- `client/` — React/Vite frontend
- `server/` — Express API, ingestion, retrieval, answer generation, and database pool
- `qa-e2e.mjs` — live API/database integration test

## Configuration

Copy `.env.example` to `.env` at the repository root and set `GEMINI_API_KEY`, `DATABASE_URL`, and `PORT` (local default: `5000`). Keep `.env` private; the frontend receives no secrets.

## Local development

From the repository root:

```bash
npm run install:all
npm run dev
```

Run the Vite client in a second terminal:

```bash
cd client
npm run dev
```

Vite runs on port `5173` and proxies `/api` to the backend `PORT`. For a production-style local run:

```bash
npm run build
npm start
```

Express serves `client/dist` and keeps all API routes under `/api`.

## API

- `POST /api/documents/upload` — multipart/form-data field `file`; PDF uploads up to 10 MB with SHA-256 duplicate detection.
- `GET /api/documents` — lists document IDs, filenames, and creation dates.
- `POST /api/rag/ask` — JSON `{ question, documentId?, topK?, minSimilarity?, pageNumber? }`; returns a grounded answer and source metadata.
- `DELETE /api/documents/:id` — deletes a document and its cascaded chunks.

Run the live integration test when Gemini and PostgreSQL are available:

```bash
npm run test:e2e
```

## Render

Build command:

```bash
npm ci --prefix server && npm ci --prefix client && npm run build --prefix client
```

Start command:

```bash
node server/server.js
```

Configure `GEMINI_API_KEY`, `DATABASE_URL`, and `PORT` as Render environment variables. The existing PostgreSQL schema and pgvector extension must already be provisioned.

## Vercel services

`vercel.json` defines two services in this repository:

- `app` — the internal Express service rooted at `server/`; only `/api/*` is public.
- `client` — the public Vite frontend rooted at `client/`; all non-API paths are routed here.

The browser uses relative `/api` URLs, so no service binding is required: the frontend does not call a private hostname, and Vercel routes those requests through the public rewrite to `app`. Set `GEMINI_API_KEY`, `DATABASE_URL`, and `PORT` on the `app` service only. Client builds do not receive backend secrets.
