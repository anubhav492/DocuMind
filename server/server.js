import "dotenv/config";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { generateAnswer } from "./answer.js";
import { ingestDocument } from "./ingest.js";
import pool, { logError } from "./db.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
if (!process.env.GEMINI_API_KEY?.trim()) {
  throw new Error("GEMINI_API_KEY is not configured in the backend .env");
}
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

app.use(express.json({ limit: "16kb" }));

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const clientDistDirectory = resolve(serverDirectory, "../client/dist");

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => {
      callback(null, tmpdir());
    },
    filename: (_request, _file, callback) => {
      callback(null, `${randomUUID()}.pdf`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (_request, file, callback) => {
    const isPdf =
      file.mimetype === "application/pdf" &&
      extname(file.originalname).toLowerCase() === ".pdf";

    if (!isPdf) {
      const error = new Error("Only PDF files are allowed");
      error.statusCode = 400;
      callback(error);
      return;
    }

    callback(null, true);
  },
});

// POST /api/rag/ask
app.post("/api/rag/ask", async (req, res, next) => {
  try {
    const {
      question,
      documentId = null,
      topK = 3,
      minSimilarity = 0.65,
      pageNumber = null,
    } = req.body ?? {};

    if (typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "A valid question is required" });
    }

    const result = await generateAnswer(question, {
      documentId,
      topK,
      minSimilarity,
      pageNumber,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

// POST /api/documents/upload
app.post("/api/documents/upload", upload.single("file"), async (req, res, next) => {
  const temporaryPath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "A PDF file is required in the file field" });
    }

    const result = await ingestDocument(temporaryPath, req.file.originalname);

    if (result.skipped) {
      return res.status(200).json({
        message: "Document already indexed",
        skipped: true,
        documentId: result.documentId,
        filename: req.file.originalname,
        chunkCount: result.chunkCount,
      });
    }

    return res.status(201).json({
      message: "Document ingested successfully",
      skipped: false,
      documentId: result.documentId,
      filename: req.file.originalname,
      chunkCount: result.chunkCount,
    });
  } catch (error) {
    return next(error);
  } finally {
    if (temporaryPath) {
      await rm(temporaryPath, { force: true }).catch((cleanupError) => {
        logError("Temporary upload cleanup failed:", cleanupError);
      });
    }
  }
});

// GET /api/documents
app.get("/api/documents", async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, filename, created_at
       FROM documents
       ORDER BY created_at DESC NULLS LAST, id DESC`
    );

    return res.status(200).json({ documents: result.rows });
  } catch (error) {
    return next(error);
  }
});

// DELETE /api/documents/:id
app.delete("/api/documents/:id", async (req, res, next) => {
  const { id } = req.params;

  if (!UUID_PATTERN.test(id)) {
    return res.status(400).json({ error: "A valid document ID is required" });
  }

  try {
    const result = await pool.query(
      `DELETE FROM documents
       WHERE id = $1
       RETURNING id, filename`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Document not found" });
    }

    return res.status(200).json({
      message: "Document deleted successfully",
      document: result.rows[0],
    });
  } catch (error) {
    return next(error);
  }
});

// Keep unknown API requests JSON-shaped, while serving the React app for browser routes.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

app.use(express.static(clientDistDirectory));
app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  return res.sendFile(resolve(clientDistDirectory, "index.html"), error => {
    if (error) return next(error);
  });
});

app.use((error, req, res, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "PDF exceeds the 10 MB size limit" });
    }

    return res.status(400).json({ error: "Invalid file upload" });
  }

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must contain valid JSON" });
  }

  if (error.statusCode || error.status) {
    const status = error.statusCode ?? error.status;
    if (status >= 400 && status < 500) {
      return res.status(status).json({ error: error.message });
    }
  }

  if (error instanceof TypeError || error instanceof RangeError) {
    return res.status(400).json({ error: error.message });
  }

  logError(`API error: ${req.method} ${req.path}`, error);
  const connectionCodes = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "57P01", "57P03", "08006"]);
  if (connectionCodes.has(error.code) || connectionCodes.has(error.cause?.code)) {
    return res.status(503).json({ error: "A required service is unavailable. Please try again shortly." });
  }
  if (["Failed to generate the query embedding", "Gemini answer generation failed"].includes(error.message)) {
    return res.status(502).json({ error: "The AI service could not complete this request. Please try again." });
  }
  return res.status(500).json({ error: "Internal server error" });
});

export { app };
export default app;

const isDirectExecution =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  const server = app.listen(PORT);
  server.on("listening", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  server.on("error", async error => {
    logError("Server startup failed:", error);
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Stop the old backend or set PORT to a free port and restart Vite with the same PORT.`);
    }
    process.exitCode = 1;
    await pool.end();
  });
}
