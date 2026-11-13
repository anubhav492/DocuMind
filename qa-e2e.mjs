import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import pool from './server/db.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const runId = randomUUID();
const filename = `qa-cedar-${runId}.pdf`;
const proxyMode = process.env.QA_PROXY === '1';
const externalBase = process.env.QA_BASE_URL;
const backendBase = 'http://127.0.0.1:5197';
const base = externalBase || (proxyMode ? 'http://127.0.0.1:5196' : backendBase);
const children = [];
const results = [];
const secrets = [process.env.GEMINI_API_KEY, process.env.DATABASE_URL].filter(Boolean);
let secretsExposed = false;
let before;
let createdId;

// A unique, valid, one-page PDF fixture. No personal PDF or PDF package is needed.
function makePdf() {
  const lines = [
    'Cedar Service Handbook',
    'The product name is Cedar.',
    'Cedar customer support is available Monday through Friday from 9 AM to 5 PM.',
    'The support reference code is CEDAR-42.',
    `QA run: ${runId}`,
  ];
  const stream = `BT /F1 12 Tf 50 750 Td 18 TL ${lines.map((line, i) => `${i ? 'T* ' : ''}(${line}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const bytes = makePdf();
const hash = createHash('sha256').update(bytes).digest('hex');

function redact(value) {
  let text = String(value);
  for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
  return text.replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/([?&]key=)[^&\s'"<>]+/gi, '$1[REDACTED]');
}

async function snapshot() {
  const documents = (await pool.query('SELECT id, filename, file_hash, created_at FROM documents ORDER BY id')).rows;
  const chunks = (await pool.query('SELECT id, document_id, chunk_index, content, embedding::text, metadata FROM document_chunks ORDER BY id')).rows;
  return {
    documentCount: documents.length,
    chunkCount: chunks.length,
    hash: createHash('sha256').update(JSON.stringify({ documents, chunks })).digest('hex'),
  };
}

async function request(route, options = {}) {
  const response = await fetch(base + route, { ...options, signal: AbortSignal.timeout(120000) });
  const text = await response.text();
  if (secrets.some(secret => text.includes(secret))) secretsExposed = true;
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error(`Non-JSON response: ${response.status} ${route}`); }
  return { status: response.status, body };
}

const ask = body => request('/api/rag/ask', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

function upload() {
  const body = new FormData();
  body.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
  return request('/api/documents/upload', { method: 'POST', body });
}

async function test(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, result: 'PASS', ...detail });
  } catch (error) {
    results.push({ name, result: 'FAIL', error: redact(error.message) });
  }
  console.log(JSON.stringify(results.at(-1)));
}

async function start(args, env, marker, label) {
  const child = spawn(process.execPath, args, {
    cwd: root, env: { ...process.env, ...env }, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stderr.on('data', data => console.log(JSON.stringify({ process: label, stderr: redact(data.toString().trim()) })));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} startup timed out`)), 15000);
    child.stdout.on('data', data => {
      if (data.toString().includes(marker)) { clearTimeout(timer); resolve(); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`${label} exited: ${code}`)); });
  });
}

try {
  before = await snapshot();
  assert.equal((await pool.query('SELECT id FROM documents WHERE file_hash = $1', [hash])).rowCount, 0);
  if (!externalBase) {
    await start(['server/server.js'], { PORT: '5197' }, 'Server running', 'Express');
    if (proxyMode) {
      await start([
        'client/node_modules/vite/bin/vite.js', 'client', '--config', 'client/vite.config.js',
        '--host', '127.0.0.1', '--port', '5196', '--strictPort',
      ], { API_PROXY_TARGET: backendBase }, 'Local:', 'Vite');
    }
  }
  console.log(JSON.stringify({ mode: externalBase ? 'external' : proxyMode ? 'vite-proxy' : 'direct', base, filename }));

  await test('upload and embedded database rows', async () => {
    const response = await upload();
    const row = (await pool.query('SELECT id, filename FROM documents WHERE file_hash = $1', [hash])).rows[0];
    createdId = row?.id;
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.skipped, false);
    assert.equal(response.body.documentId, createdId);
    assert.equal(row.filename, filename);
    const chunks = (await pool.query(
      'SELECT chunk_index, content, metadata, extensions.vector_dims(embedding) AS dims FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index',
      [createdId],
    )).rows;
    assert(chunks.length > 0);
    assert.equal(chunks.length, response.body.chunkCount);
    chunks.forEach((chunk, index) => {
      assert.equal(chunk.chunk_index, index);
      assert.equal(chunk.dims, 768);
      assert.equal(chunk.metadata.loc.pageNumber, 1);
      assert(chunk.content.trim());
    });
    return { status: response.status, documentId: createdId, chunkCount: chunks.length, dimensions: 768 };
  });
  assert(createdId, 'Upload did not create a test document; remaining dependent checks cannot run');

  await test('duplicate upload', async () => {
    const response = await upload();
    assert.equal(response.status, 200);
    assert.equal(response.body.skipped, true);
    assert.equal(response.body.documentId, createdId);
    return { status: response.status };
  });
  await test('list documents', async () => {
    const response = await request('/api/documents');
    assert.equal(response.status, 200);
    assert(Array.isArray(response.body.documents));
    const doc = response.body.documents.find(doc => doc.id === createdId);
    assert.equal(doc.filename, filename);
    assert(doc.created_at);
    return { status: response.status };
  });

  for (const [question, expected] of [
    ['What is the product name in this handbook?', /Cedar/i],
    ['What is the support reference code in the Cedar handbook?', /CEDAR-42/i],
  ]) await test(question, async () => {
    const response = await ask({ question, documentId: createdId, topK: 3, minSimilarity: 0.3 });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert(expected.test(response.body.answer), response.body.answer);
    assert(response.body.sources.length > 0);
    assert(/\[Source \d+\]/.test(response.body.answer), response.body.answer);
    for (const source of response.body.sources) {
      assert.equal(source.documentId, createdId);
      assert.equal(source.filename, filename);
      assert.equal(source.pageNumber, 1);
      const stored = (await pool.query('SELECT chunk_index FROM document_chunks WHERE document_id = $1 AND chunk_index = $2', [createdId, source.chunkIndex])).rows;
      assert.equal(stored.length, 1);
    }
    return { status: response.status, answer: response.body.answer, sourceCount: response.body.sources.length };
  });

  await test('unrelated question', async () => {
    const response = await ask({ question: 'What are the exact ingredients and oven temperature for a chocolate cake?', documentId: createdId });
    assert.equal(response.status, 200);
    assert(/unavailable|not (?:contain|provided|available)|insufficient/i.test(response.body.answer));
    return { status: response.status, ...response.body };
  });
  for (const [name, fn] of [
    ['invalid delete UUID', () => request('/api/documents/not-a-uuid', { method: 'DELETE' })],
    ['invalid ask UUID', () => ask({ question: 'Test', documentId: 'bad' })],
    ['missing question', () => ask({})],
    ['missing PDF', () => request('/api/documents/upload', { method: 'POST' })],
  ]) await test(name, async () => {
    const response = await fn();
    assert.equal(response.status, 400);
    assert.equal(typeof response.body.error, 'string');
    return { status: response.status };
  });
  await test('delete test document', async () => {
    const response = await request(`/api/documents/${createdId}`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    return { status: response.status };
  });
  await test('removal and cascade', async () => {
    const response = await request('/api/documents');
    assert.equal(response.status, 200);
    assert(!response.body.documents.some(doc => doc.id === createdId));
    assert.equal((await pool.query('SELECT id FROM document_chunks WHERE document_id = $1', [createdId])).rowCount, 0);
    return { status: response.status, remainingChunks: 0 };
  });
  await test('repeat delete', async () => {
    const response = await request(`/api/documents/${createdId}`, { method: 'DELETE' });
    assert.equal(response.status, 404);
    return { status: response.status };
  });
  await test('server health and secret exposure', async () => {
    const response = await request('/api/documents');
    assert.equal(response.status, 200);
    assert.equal(secretsExposed, false);
    return { status: response.status, secretsExposed };
  });
} catch (error) {
  process.exitCode = 1;
  console.error(redact(error.stack || error.message));
} finally {
  try {
    // The unique hash was absent before this run. Only that test record is eligible for cleanup.
    const remaining = (await pool.query('SELECT id FROM documents WHERE file_hash = $1', [hash])).rows[0];
    if (remaining) {
      const response = await request(`/api/documents/${remaining.id}`, { method: 'DELETE' });
      assert.equal(response.status, 200, 'Test-only HTTP cleanup failed');
    }
    if (before) {
      const after = await snapshot();
      assert.deepEqual(after, before, 'Database state differs from baseline after test cleanup');
      console.log(JSON.stringify({ cleanup: true, existingDocuments: before.documentCount, existingChunks: before.chunkCount }));
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(redact(`Cleanup verification failed: ${error.stack || error.message}`));
  } finally {
    for (const child of children) child.kill();
    await pool.end();
  }
}
if (results.some(result => result.result === 'FAIL')) process.exitCode = 1;
