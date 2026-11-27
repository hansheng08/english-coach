import './ui/tokens.css';
import './ui/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ApiProvider, loadApi } from './api';

const container = document.getElementById('root');

if (container !== null) {
  const root = createRoot(container);
  loadApi(window.location.search).then(
    (runtime) => {
      root.render(
        <StrictMode>
          <ApiProvider runtime={runtime}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ApiProvider>
        </StrictMode>,
      );
    },
    () => {
      container.textContent = '載入失敗，請重新整理。';
    },
  );
}
