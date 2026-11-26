import './ui/tokens.css';
import './ui/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.tsx';
import { ApiProvider, loadApi } from './api/index.ts';

async function start(): Promise<void> {
  const root = document.getElementById('root');
  if (root === null) return;
  const api = await loadApi(window.location.search);
  createRoot(root).render(
    <StrictMode>
      <ApiProvider value={api}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ApiProvider>
    </StrictMode>,
  );
}

void start();
