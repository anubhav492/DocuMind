# DocuMind

DocuMind is a full-stack PDF question-answering application. It ingests PDFs, creates Gemini embeddings for searchable chunks, stores them in PostgreSQL with pgvector, and generates grounded answers with source citations.

## Features

- PDF upload with SHA-256 duplicate detection
- Recursive text chunking and 768-dimensional Gemini embeddings
- Semantic retrieval with document and page filters
- Grounded Gemini answers with source citations
- Document listing and deletion
- React/Vite dashboard for upload, search, and chat

## Architecture

`PDF → text cleaning → recursive chunking → Gemini embeddings → PostgreSQL/pgvector → cosine retrieval → Gemini answer`

## Stack

Node.js, Express, React, Vite, `@google/genai`, LangChain text/PDF utilities, PostgreSQL, Supabase, pgvector, and `pg`.

## Configuration

Copy `.env.example` to `.env` and set the real values locally:

```bash
cp .env.example .env
```

Required variables:

- `GEMINI_API_KEY` — Gemini API key
- `DATABASE_URL` — PostgreSQL/Supabase connection string
- `PORT` — backend port (defaults to `3000`)

Never commit `.env` or credentials.

## Run locally

Install backend dependencies and start Express from the project root:

```bash
npm install
npm start
```

Install and start the frontend in another terminal:

```bash
cd client
npm install
npm run dev
```

The Vite proxy forwards relative `/api` requests to the backend port from the root `.env`. Set `API_PROXY_TARGET` only when the backend runs at a non-default host or port. Build the frontend with `npm run build` from `client/`.

## API

- `POST /api/documents/upload` — multipart upload with field `file`; accepts PDFs up to 10 MB. Returns the document ID and stored chunk count. Duplicate files are skipped safely.
- `GET /api/documents` — returns `{ "documents": [{ "id", "filename", "created_at" }] }`.
- `POST /api/rag/ask` — JSON body `{ "question", "documentId?", "topK?", "minSimilarity?", "pageNumber?" }`; returns a grounded `answer` and `sources`.
- `DELETE /api/documents/:id` — deletes a document; associated chunks are removed by the existing foreign-key cascade.

The PostgreSQL tables and pgvector extension are managed outside this repository. Use the existing project schema before starting ingestion.
