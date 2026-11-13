# DocuMind client

React + Vite frontend for the existing Express PDF RAG API.

## Start locally (PowerShell)

In the repository root, start the backend:

```powershell
npm.cmd start
```

In a second terminal:

```powershell
cd client
npm.cmd install
npm.cmd run dev
```

Open the Local URL printed by Vite (normally http://localhost:5173).
The client uses relative `/api` URLs. Vite reads `PORT` from the repository-root
`.env` in its Node process and forwards requests to that backend port (currently
5000); when `PORT` is absent, both servers use 3000 as the backend default.
Do not copy backend `.env` values into this directory.

If the backend reports `EADDRINUSE`, an existing process owns its port. Stop the
known old application yourself or choose a free port. Do not run against an
unrelated service just because it responds on the configured port.

To use a different backend port without editing `.env`, set the same `PORT` in
both terminals **before** starting their commands:

```powershell
$env:PORT = '5010'
```

Alternatively, set `$env:API_PROXY_TARGET = 'http://127.0.0.1:5010'` in the frontend
terminal to target an already-running backend. This setting is used only by
Vite's development proxy. Restart Vite after changing proxy settings or the
backend port. A non-JSON 500 from Vite normally means its proxy could not connect;
check the Vite terminal and verify `GET /api/documents` directly on the backend.

## Build

```powershell
npm.cmd run build
```

The static output is in `dist/`. For deployment, serve this output with `/api`
routed to the Express backend on the same origin. The development proxy is
not part of the production bundle.

## Behavior

- Upload a PDF of up to 10 MB; already indexed files are reported as duplicates.
- Select one document, or choose All documents to search across the library.
- Questions use `topK: 3` and `minSimilarity: 0.5`.
- Source labels, filenames, pages, and similarity scores come from the API.
- Delete requires confirmation and permanently removes the document's index.
