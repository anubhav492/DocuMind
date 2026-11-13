
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Resolve configuration relative to this module, regardless of the launch directory.
config({ path: fileURLToPath(new URL("./.env", import.meta.url)), quiet: true });

export function logError(context, error) {
  const secrets = Object.entries(process.env)
    .filter(([key, value]) => /KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL/i.test(key) && value?.length > 3)
    .map(([, value]) => value);
  if (process.env.DATABASE_URL) {
    try {
      const password = new URL(process.env.DATABASE_URL).password;
      if (password) secrets.push(password, decodeURIComponent(password));
    } catch { /* Configuration validation reports malformed URLs separately. */ }
  }
  const redact = value => {
    let text = String(value);
    for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
    return text.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]")
      .replace(/([?&]key=)[^&\s"']+/gi, "$1[REDACTED]");
  };
  const describe = (value, depth = 0) => ({
    name: value?.name,
    code: value?.code,
    stack: redact(value?.stack || value?.message || value),
    ...(depth < 4 && value?.cause ? { cause: describe(value.cause, depth + 1) } : {}),
    ...(depth < 4 && Array.isArray(value?.errors)
      ? { errors: value.errors.map(item => describe(item, depth + 1)) } : {}),
  });
  console.error(context, JSON.stringify(describe(error)));
}

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL is not configured in the backend .env");
}

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 3,
  connectionTimeoutMillis: 10000
});

pool.on("error", error => logError("PostgreSQL idle connection error:", error));

export default pool;
