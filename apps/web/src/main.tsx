import './ui/tokens.css';
import './ui/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ApiProvider, loadApi } from './api';
import { registerServiceWorker } from './pwa/register';
import { previewUpdateRegister } from './pwa/update';
import { syncThemeColor } from './ui/theme';

const container = document.getElementById('root');

syncThemeColor();

if (container !== null) {
  const root = createRoot(container);
  loadApi(window.location.search).then(
    (runtime) => {
      // 預覽（mock）建置才認 ?pwa=update：不用真的換 SW 就能看到「有新版本」卡片（E2E、截圖用）。
      const previewUpdate = runtime.preview !== null && new URLSearchParams(window.location.search).get('pwa') === 'update';
      root.render(
        <StrictMode>
          <ApiProvider runtime={runtime}>
            <BrowserRouter>
              <App register={previewUpdate ? previewUpdateRegister : registerServiceWorker} />
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
