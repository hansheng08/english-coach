import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { dataModeOrThrow } from './vite.data-mode.ts';

// Vite 讀到的全部 VITE_ 變數（.env* 與程序環境）都交給 dataModeOrThrow；值不對就讓建置失敗。
export default defineConfig(({ mode }) => {
  dataModeOrThrow(loadEnv(mode, '.', 'VITE_'));
  return { plugins: [react()] };
});
