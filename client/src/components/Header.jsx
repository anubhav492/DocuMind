import React from 'react';

export default function Header() {
  return (
    <header className="header">
      <a className="brand" href="#main"><span className="brand-mark" aria-hidden="true">D</span>DocuMind</a>
      <span className="header-label">Your PDF workspace</span>
    </header>
  );
}
