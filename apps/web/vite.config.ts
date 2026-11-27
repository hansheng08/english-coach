import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { dataModeOrThrow } from './vite.data-mode.ts';

export default defineConfig(({ mode }) => {
  // .env* 與程序環境裡所有 VITE_ 變數；沒有 VITE_DATA_MODE（或值不對）時建置失敗。
  dataModeOrThrow(loadEnv(mode, '.', 'VITE_'));
  return {
    plugins: [react()],
    build: { outDir: 'dist' },
  };
});
