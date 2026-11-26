import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 只給在 apps/web 裡直接執行 vitest 時使用；`pnpm test` 用根目錄的 vitest.config.ts。
// 根目錄沒有 projects：apps/** 的測試以檔頭 `// @vitest-environment jsdom` 取得 jsdom（ADR-001 修訂 1），並自己 import test/setup.ts。
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom' },
});
