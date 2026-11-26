import { defineConfig } from '@playwright/test';

// E2E 只跑 mock 模式：以 VITE_DATA_MODE=mock 建置後 preview（T-018；不連任何網路、不跑 supabase 模式）。
const PORT = 4173;
const BASE = `http://127.0.0.1:${String(PORT)}`;

// 視窗：360×640、412×915（觸控，pointer: coarse）；768×1024；1280×800、1440×900（滑鼠，pointer: fine）。
// 每個 spec 檔只在 testMatch 列出的專案執行，這樣不需要在測試裡 skip。
const COMMON = /common\.spec\.ts$/;

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: BASE },
  webServer: {
    command: `pnpm build && pnpm --filter web preview --host 127.0.0.1 --port ${String(PORT)} --strictPort`,
    url: BASE,
    env: { VITE_DATA_MODE: 'mock' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'w360',
      testMatch: [COMMON, /touch\.spec\.ts$/, /phone360\.spec\.ts$/],
      use: { viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true },
    },
    {
      name: 'w412',
      testMatch: [COMMON, /touch\.spec\.ts$/],
      use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true },
    },
    {
      name: 'w768',
      testMatch: [COMMON, /tablet768\.spec\.ts$/],
      use: { viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'w1280',
      testMatch: [COMMON, /desktop1280\.spec\.ts$/],
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'w1440',
      testMatch: [COMMON, /desktop1440\.spec\.ts$/],
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
