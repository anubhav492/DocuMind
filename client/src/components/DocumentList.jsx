import React, { useState } from 'react';

function formatDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unavailable';
}

export default function DocumentList({ documents, selectedId, onSelect, loading, error, onRefresh, onDelete, deletingId }) {
  const [search, setSearch] = useState('');
  const visible = documents.filter(doc => doc.filename.toLowerCase().includes(search.toLowerCase()));
  return (
    <section className="panel" aria-labelledby="documents-title">
      <div className="section-heading"><h2 id="documents-title">Documents <span className="count">{documents.length}</span></h2>
        <button type="button" className="text-button" onClick={onRefresh} disabled={loading}>Refresh</button>
      </div>
      <label className="sr-only" htmlFor="document-search">Find a document</label>
      <input id="document-search" type="search" placeholder="Find a document…" value={search} onChange={event => setSearch(event.target.value)} />
      <button type="button" className={`all-documents ${!selectedId ? 'selected' : ''}`} aria-pressed={!selectedId} onClick={() => onSelect(null)}>
        <span>All documents</span><small>Search your entire library</small>
      </button>
      {loading && <p className="muted" role="status">Loading documents…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {!loading && !error && documents.length === 0 && <p className="empty-note">Your library is empty. Upload your first PDF above.</p>}
      {documents.length > 0 && visible.length === 0 && <p className="empty-note">No filenames match your search.</p>}
      <ul className="document-list">
        {visible.map(doc => (
          <li key={doc.id} className={selectedId === doc.id ? 'selected' : ''}>
            <button type="button" className="document-select" aria-pressed={selectedId === doc.id} disabled={deletingId === doc.id} onClick={() => onSelect(doc.id)}>
              <span className="pdf-badge">PDF</span>
              <span className="document-info"><strong>{doc.filename}</strong><small>{formatDate(doc.created_at)}</small></span>
            </button>
            <button type="button" className="delete-button" disabled={Boolean(deletingId)} aria-label={`Delete ${doc.filename}`}
              onClick={() => { if (window.confirm(`Delete "${doc.filename}" and its indexed contents? This cannot be undone.`)) onDelete(doc); }}>
              {deletingId === doc.id ? 'Deleting…' : 'Delete'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
