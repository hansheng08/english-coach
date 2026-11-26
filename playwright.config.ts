import { defineConfig } from '@playwright/test';

// E2E 只跑 mock 模式（ADR-014 決定 1）：以 VITE_DATA_MODE=mock 建置後 preview，不連任何外部網路。
// 視窗大小由 test/e2e 的測試檔用 test.use 逐一指定（360、412、768、1280、1440）。
const PORT = 4173;

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://localhost:${String(PORT)}`, browserName: 'chromium' },
  webServer: {
    command: `VITE_DATA_MODE=mock pnpm --filter @english-coach/web build && pnpm --filter @english-coach/web exec vite preview --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
