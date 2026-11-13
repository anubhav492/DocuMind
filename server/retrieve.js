import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import pool from "./db.js";

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
const DEFAULT_TOP_K = 3;
const MAX_TOP_K = 100;
const DEFAULT_MIN_SIMILARITY = 0.65;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options must be an object");
  }

  const {
    topK = DEFAULT_TOP_K,
    minSimilarity = DEFAULT_MIN_SIMILARITY,
    documentId = null,
    pageNumber = null,
  } = options;

  if (!Number.isInteger(topK) || topK < 1 || topK > MAX_TOP_K) {
    throw new RangeError(`topK must be an integer between 1 and ${MAX_TOP_K}`);
  }

  if (
    typeof minSimilarity !== "number" ||
    !Number.isFinite(minSimilarity) ||
    minSimilarity < -1 ||
    minSimilarity > 1
  ) {
    throw new RangeError("minSimilarity must be a finite number between -1 and 1");
  }

  if (
    documentId !== null &&
    (typeof documentId !== "string" || !UUID_PATTERN.test(documentId))
  ) {
    throw new TypeError("documentId must be a valid UUID or null");
  }

  if (
    pageNumber !== null &&
    (!Number.isInteger(pageNumber) || pageNumber < 1)
  ) {
    throw new RangeError("pageNumber must be a positive integer or null");
  }

  return { topK, minSimilarity, documentId, pageNumber };
}

function validateQueryEmbedding(values) {
  if (
    !Array.isArray(values) ||
    values.length !== EMBEDDING_DIMENSIONS ||
    values.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new Error("Gemini returned an invalid query embedding");
  }

  return values;
}

function getGeminiClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

/**
 * Retrieve the most similar stored document chunks for a question.
 * The shared PostgreSQL pool remains open for the caller to reuse.
 */
export async function retrieveDocuments(question, options = {}) {
  if (typeof question !== "string" || question.trim().length === 0) {
    throw new TypeError("question must be a non-empty string");
  }

  const { topK, minSimilarity, documentId, pageNumber } =
    validateOptions(options);

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  let response;
  try {
    const ai = getGeminiClient();
    response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: question.trim(),
      config: {
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: EMBEDDING_DIMENSIONS,
      },
    });
  } catch (error) {
    throw new Error("Failed to generate the query embedding", { cause: error });
  }

  const queryVector = validateQueryEmbedding(response?.embeddings?.[0]?.values);
  const vectorString = `[${queryVector.join(",")}]`;

  let result;
  try {
    result = await pool.query(
      `SELECT
          c.document_id,
          c.chunk_index,
          c.content,
          c.metadata,
          d.filename,
          1 - (c.embedding <=> $1::extensions.vector) AS similarity
       FROM document_chunks c
       JOIN documents d ON c.document_id = d.id
       WHERE 1 - (c.embedding <=> $1::extensions.vector) >= $2
         AND ($4::uuid IS NULL OR c.document_id = $4::uuid)
         AND (
           $5::text IS NULL
           OR c.metadata->'loc'->>'pageNumber' = $5::text
         )
       ORDER BY c.embedding <=> $1::extensions.vector
       LIMIT $3`,
      [
        vectorString,
        minSimilarity,
        topK,
        documentId,
        pageNumber === null ? null : String(pageNumber),
      ]
    );
  } catch (error) {
    throw new Error("Failed to retrieve document chunks", { cause: error });
  }

  return result.rows.map((row) => {
    const similarity = Number(row.similarity);

    if (!Number.isFinite(similarity) || similarity < -1 || similarity > 1) {
      throw new Error("Database returned an invalid similarity score");
    }

    return {
      documentId: row.document_id,
      filename: row.filename,
      chunkIndex: row.chunk_index,
      content: row.content,
      metadata: row.metadata,
      similarity,
    };
  });
}
