import React, { useState } from 'react';
import { uploadPDF } from '../services/api.js';

export default function PDFUpload({ onUploaded }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [inputKey, setInputKey] = useState(0);

  async function submit(event) {
    event.preventDefault();
    if (uploading) return;
    setMessage('');
    setError('');
    if (!file || !/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
      setError('Choose a PDF file to upload.');
      return;
    }
    if (!file.size || file.size > 10 * 1024 * 1024) {
      setError('Choose a nonempty PDF smaller than or equal to 10 MB.');
      return;
    }
    setUploading(true);
    try {
      const result = await uploadPDF(file);
      setMessage(result.skipped
        ? `${file.name} is already indexed. You can ask questions about it.`
        : `${file.name} is ready${Number.isInteger(result.chunkCount) ? ` · ${result.chunkCount} chunks indexed` : ''}.`);
      setFile(null);
      setInputKey(key => key + 1);
      await onUploaded(result.documentId);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="panel upload-panel" aria-labelledby="upload-title">
      <h2 id="upload-title">Add a document</h2>
      <p className="muted">Upload a PDF to make its contents searchable.</p>
      <form onSubmit={submit} aria-busy={uploading}>
        <label className="file-field" htmlFor="pdf-file">PDF file <span>Up to 10 MB</span></label>
        <input key={inputKey} id="pdf-file" type="file" accept=".pdf,application/pdf" disabled={uploading}
          onChange={event => { setFile(event.target.files?.[0] || null); setError(''); setMessage(''); }} />
        <button className="primary full-width" disabled={uploading || !file} type="submit">
          {uploading ? 'Uploading & indexing…' : 'Upload PDF'}
        </button>
      </form>
      {uploading && <p className="muted" role="status">Indexing may take a moment. Please keep this page open.</p>}
      {message && <p className="notice success" role="status">{message}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
    </section>
  );
}
