import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig, loadEnv } from 'vite';
import { dataModeOrThrow } from './vite.data-mode.ts';
import { createPwaOptions, iconsPlugin, readTokens } from './vite.pwa.ts';

export default defineConfig(({ mode }) => {
  // .env* 與程序環境裡所有 VITE_ 變數；沒有 VITE_DATA_MODE（或值不對）時建置失敗。
  dataModeOrThrow(loadEnv(mode, '.', 'VITE_'));
  return {
    plugins: [react(), iconsPlugin(), VitePWA(createPwaOptions(readTokens()))],
    build: { outDir: 'dist' },
  };
});
