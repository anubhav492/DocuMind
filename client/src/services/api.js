async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (typeof data?.error === 'string' && data.error) throw new Error(data.error);
    if (!data && response.status >= 500) {
      throw new Error(`The backend returned an error (${response.status}). Please try again shortly.`);
    }
    if (!data && response.status === 404) {
      throw new Error('The API route was not found. Check that the development proxy points to this application’s Express server.');
    }
    throw new Error(`Request failed (${response.status}). Please try again.`);
  }
  if (!data) throw new Error('The server returned an unexpected response. Please try again.');
  return data;
}

export async function getDocuments() {
  const data = await request('/documents');
  if (!Array.isArray(data.documents)) throw new Error('The document list could not be read.');
  return data.documents;
}

export function uploadPDF(file) {
  const body = new FormData();
  body.append('file', file);
  return request('/documents/upload', { method: 'POST', body });
}

export function deleteDocument(id) {
  return request(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function askQuestion(question, { documentId = null, topK = 3, minSimilarity = 0.5 } = {}) {
  return request('/rag/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, documentId, topK, minSimilarity }),
  });
}
