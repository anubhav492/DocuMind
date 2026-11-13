import React, { useEffect, useState } from 'react';
import Header from './components/Header.jsx';
import PDFUpload from './components/PDFUpload.jsx';
import DocumentList from './components/DocumentList.jsx';
import ChatInterface from './components/ChatInterface.jsx';
import { getDocuments, deleteDocument } from './services/api.js';

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  async function refreshDocuments(selectId) {
    setLoading(true);
    setError('');
    try {
      const next = await getDocuments();
      setDocuments(next);
      setSelectedId(current => {
        const wanted = typeof selectId === 'string' ? selectId : current;
        return next.some(doc => doc.id === wanted) ? wanted : null;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refreshDocuments(); }, []);

  async function removeDocument(doc) {
    if (deletingId) return;
    setDeletingId(doc.id);
    setNotice('');
    setError('');
    try {
      await deleteDocument(doc.id);
      setDocuments(current => current.filter(item => item.id !== doc.id));
      setSelectedId(current => current === doc.id ? null : current);
      setNotice(`${doc.filename} was deleted.`);
      await refreshDocuments();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  const selected = documents.find(doc => doc.id === selectedId);
  return (
    <>
      <a className="skip-link" href="#main">Skip to workspace</a>
      <Header />
      <main id="main" className="workspace">
        <aside className="sidebar" aria-label="Document library">
          <PDFUpload onUploaded={refreshDocuments} />
          {notice && <p className="notice success" role="status">{notice}</p>}
          <DocumentList documents={documents} selectedId={selectedId} onSelect={setSelectedId} loading={loading} error={error}
            onRefresh={() => refreshDocuments()} onDelete={removeDocument} deletingId={deletingId} />
        </aside>
        <ChatInterface key={selectedId || 'all-documents'} documentId={selectedId} documentName={selected?.filename} />
      </main>
      <footer>DocuMind · Answers grounded in your documents. Always review the cited sources.</footer>
    </>
  );
}
