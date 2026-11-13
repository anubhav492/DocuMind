import React, { useState } from 'react';
import { askQuestion } from '../services/api.js';
import SourceList from './SourceList.jsx';

export default function ChatInterface({ documentId, documentName }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [submittedQuestion, setSubmittedQuestion] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (loading || !question.trim()) return;
    const text = question.trim();
    setLoading(true);
    setError('');
    setResult(null);
    setSubmittedQuestion(text);
    try {
      const response = await askQuestion(text, { documentId, topK: 3, minSimilarity: 0.5 });
      if (typeof response.answer !== 'string' || !response.answer.trim()) throw new Error('No answer was returned. Please try again.');
      setResult(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel chat-panel" aria-labelledby="chat-title">
      <div className="eyebrow">ASK YOUR DOCUMENTS</div>
      <h1 id="chat-title">A little clarity,<br className="desktop-break" /> straight from your PDFs.</h1>
      <p className="intro">Ask a question. Get an answer grounded in your documents, with sources you can trace.</p>
      <div className="scope"><span className="scope-dot" aria-hidden="true" />Searching: <strong>{documentName || 'All documents'}</strong></div>
      <form className="question-form" onSubmit={submit} aria-busy={loading}>
        <label htmlFor="question">Your question</label>
        <textarea id="question" rows="3" maxLength="3000" value={question} disabled={loading} placeholder="What would you like to know?" onChange={event => setQuestion(event.target.value)} />
        <div className="form-footer"><small>Answers use up to 3 relevant passages.</small><button className="primary" disabled={loading || !question.trim()} type="submit">{loading ? 'Finding an answer…' : 'Ask DocuMind →'}</button></div>
      </form>
      {error && <p className="notice error" role="alert">{error}</p>}
      {loading && <div className="answer-placeholder" role="status">Reading relevant passages and preparing your answer…</div>}
      {result && (
        <article className="answer-section" aria-live="polite">
          <p className="asked-question">{submittedQuestion}</p>
          <h2>Answer</h2><div className="answer-text">{result.answer}</div>
          <SourceList sources={result.sources} />
        </article>
      )}
      {!result && !loading && !error && <div className="answer-placeholder">Your answer and its sources will appear here.<small>Select a PDF from your library to focus your search.</small></div>}
    </section>
  );
}
