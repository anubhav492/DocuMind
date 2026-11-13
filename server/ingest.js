import "dotenv/config";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import pool from "./db.js";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;
const EMBEDDING_DIMENSIONS = 768;

function cleanText(text) {
  return String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

function validateEmbeddingVectors(vectors, expectedCount) {
  if (!Array.isArray(vectors)) {
    throw new Error("Embedding response was not an array");
  }

  if (vectors.length !== expectedCount) {
    throw new Error(
      `Embedding count mismatch: expected ${expectedCount}, received ${vectors.length}`
    );
  }

  return vectors.map((vector, index) => {
    const values = Array.from(vector ?? []);

    if (
      values.length !== EMBEDDING_DIMENSIONS ||
      values.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(
        `Invalid embedding at index ${index}: expected ${EMBEDDING_DIMENSIONS} finite values`
      );
    }

    return values;
  });
}

export async function ingestDocument(filePath, originalFilename) {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw new TypeError("A PDF file path is required");
  }

  if (extname(filePath).toLowerCase() !== ".pdf") {
    throw new TypeError("The input file must be a PDF");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    throw new Error(`Input path is not a file: ${filePath}`);
  }

  const fileBuffer = await readFile(filePath);
  const fileHash = createHash("sha256").update(fileBuffer).digest("hex");
  const filename = basename(
    typeof originalFilename === "string" && originalFilename.trim()
      ? originalFilename
      : filePath
  );

  const loader = new PDFLoader(filePath, { splitPages: true });
  const loadedDocuments = await loader.load();

  const documents = loadedDocuments
    .map((document) => ({
      ...document,
      pageContent: cleanText(document.pageContent),
    }))
    .filter((document) => document.pageContent.length > 0);

  if (documents.length === 0) {
    throw new Error("No readable text found in the PDF");
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });
  const chunks = await splitter.splitDocuments(documents);

  if (chunks.length === 0) {
    throw new Error("No text chunks were produced from the PDF");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const insertDocumentResult = await client.query(
      `INSERT INTO documents (filename, file_hash)
       VALUES ($1, $2)
       ON CONFLICT (file_hash) DO NOTHING
       RETURNING id`,
      [filename, fileHash]
    );

    let documentId;

    if (insertDocumentResult.rowCount === 0) {
      const existingDocumentResult = await client.query(
        `SELECT id
         FROM documents
         WHERE file_hash = $1
         FOR UPDATE`,
        [fileHash]
      );

      if (existingDocumentResult.rowCount === 0) {
        throw new Error("Duplicate document was detected but could not be loaded");
      }

      documentId = existingDocumentResult.rows[0].id;

      const chunkCountResult = await client.query(
        `SELECT COUNT(DISTINCT chunk_index)::int AS indexed_count
         FROM document_chunks
         WHERE document_id = $1
           AND chunk_index >= 0
           AND chunk_index < $2
           AND content IS NOT NULL
           AND embedding IS NOT NULL`,
        [documentId, chunks.length]
      );

      const indexedChunkCount = chunkCountResult.rows[0].indexed_count;

      if (indexedChunkCount === chunks.length) {
        await client.query("COMMIT");
        console.log("Document already indexed. Skipping.");
        return { skipped: true, documentId, chunkCount: chunks.length };
      }

      console.log(
        `Resuming partial document ${documentId}: ${indexedChunkCount}/${chunks.length} chunks already stored`
      );
    } else {
      documentId = insertDocumentResult.rows[0].id;
      console.log("Stored document ID:", documentId);
    }

    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      model: "gemini-embedding-001",
      outputDimensionality: EMBEDDING_DIMENSIONS,
      taskType: "RETRIEVAL_DOCUMENT",
    });

    const texts = chunks.map((chunk) => chunk.pageContent);
    const vectors = validateEmbeddingVectors(
      await embeddings.embedDocuments(texts),
      chunks.length
    );

    console.log("Total chunks:", chunks.length);
    console.log("Embeddings generated:", vectors.length);
    console.log("Vector dimensions:", vectors[0].length);

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const vectorString = `[${vectors[i].join(",")}]`;

      await client.query(
        `INSERT INTO document_chunks
          (document_id, chunk_index, content, embedding, metadata)
         VALUES ($1, $2, $3, $4::extensions.vector, $5::jsonb)
         ON CONFLICT (document_id, chunk_index)
         DO UPDATE SET
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding,
           metadata = EXCLUDED.metadata`,
        [
          documentId,
          i,
          chunk.pageContent,
          vectorString,
          JSON.stringify(chunk.metadata ?? {}),
        ]
      );

      console.log(`Stored chunk ${i + 1}/${chunks.length}`);
    }

    await client.query("COMMIT");
    console.log("Ingestion committed successfully.");

    return { skipped: false, documentId, chunkCount: chunks.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    const samplePdf = fileURLToPath(new URL("../data/lec3.pdf", import.meta.url));
    await ingestDocument(samplePdf);
  } catch (error) {
    process.exitCode = 1;
    console.error("Ingestion failed:", error.message);
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main();
}
