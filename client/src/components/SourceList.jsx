import React from 'react';

export default function SourceList({ sources }) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return <p className="muted">No source citations were returned for this answer.</p>;
  }
  return (
    <section className="sources" aria-label="Answer sources">
      <h3>Sources <span className="count">{sources.length}</span></h3>
      <ol className="source-grid">
        {sources.map((source, index) => (
          <li key={`${source.documentId}-${source.chunkIndex}-${index}`}>
            <span className="source-label">{source.label || `Source ${index + 1}`}</span>
            <strong>{source.filename || 'Unknown document'}</strong>
            <small>Page {source.pageNumber ?? 'unknown'}
              {typeof source.similarity === 'number' && Number.isFinite(source.similarity) && ` · Similarity ${source.similarity.toFixed(3)}`}
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}
