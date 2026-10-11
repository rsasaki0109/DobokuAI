import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

class ErrorBoundary extends React.Component<React.PropsWithChildren, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main>
        <h1>表示を再開できません</h1>
        <p>ページを再読み込みしてください。保存済みプロジェクトはSQLiteに残っています。</p>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
