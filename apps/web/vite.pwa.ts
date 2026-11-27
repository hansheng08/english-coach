import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import type { VitePWAOptions } from 'vite-plugin-pwa';

/** 圖示來源只有一份（docs/design/assets/icons/）；建置時原樣輸出到產物的 icons/，不 commit PNG。 */
export const DEFAULT_ICON_SOURCE = fileURLToPath(new URL('../../docs/design/assets/icons/', import.meta.url));
export const DEFAULT_TOKENS_PATH = fileURLToPath(new URL('../../docs/design/tokens.json', import.meta.url));

type IconSpec = { readonly file: string; readonly sizes: '192x192' | '512x512'; readonly purpose: 'any' | 'maskable' };

/** pwa.md §1：四張，purpose 不合併寫。 */
export const ICONS: readonly IconSpec[] = [
  { file: 'icon-192.png', sizes: '192x192', purpose: 'any' },
  { file: 'icon-512.png', sizes: '512x512', purpose: 'any' },
  { file: 'icon-maskable-192.png', sizes: '192x192', purpose: 'maskable' },
  { file: 'icon-maskable-512.png', sizes: '512x512', purpose: 'maskable' },
];

export type IconFile = { readonly fileName: string; readonly source: Uint8Array };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 從 tokens.json（已解析）取 color.hero.light；格式不對就丟錯，不另寫一份色碼。 */
export function heroLightColor(tokens: unknown): string {
  const color = isRecord(tokens) ? tokens['color'] : undefined;
  const hero = isRecord(color) ? color['hero'] : undefined;
  const light = isRecord(hero) ? hero['light'] : undefined;
  if (typeof light !== 'string') throw new Error('tokens.json 找不到 color.hero.light');
  return light;
}

export function readTokens(path: string = DEFAULT_TOKENS_PATH): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return parsed;
}

/** pwa.md §1。不設 orientation。 */
export function createManifest(tokens: unknown) {
  const hero = heroLightColor(tokens);
  return {
    name: 'english-coach',
    short_name: 'EN Coach',
    description: '每天 80 分鐘，把英文講得像 Senior。',
    lang: 'zh-Hant-TW',
    dir: 'ltr' as const,
    start_url: '/',
    scope: '/',
    display: 'standalone' as const,
    theme_color: hero,
    background_color: hero,
    icons: ICONS.map((icon) => ({
      src: `/icons/${icon.file}`,
      sizes: icon.sizes,
      type: 'image/png',
      purpose: icon.purpose,
    })),
  };
}

/**
 * 讀四張圖示。先檢查全部，缺的話一次丟出含每個缺少檔名的錯誤，不回傳任何一張（不略過、不改用別的圖）。
 */
export function loadIcons(sourceDir: string = DEFAULT_ICON_SOURCE): readonly IconFile[] {
  const missing = ICONS.filter((icon) => !existsSync(join(sourceDir, icon.file))).map((icon) => icon.file);
  if (missing.length > 0) throw new Error(`PWA 圖示來源缺少：${missing.join('、')}（資料夾 ${sourceDir}）`);
  return ICONS.map((icon) => ({ fileName: `icons/${icon.file}`, source: new Uint8Array(readFileSync(join(sourceDir, icon.file))) }));
}

/** 全部讀成功才開始輸出；缺檔時 emit 一次都不會被呼叫。 */
export function emitIcons(sourceDir: string, emit: (file: IconFile) => void): void {
  const files = loadIcons(sourceDir);
  for (const file of files) emit(file);
}

export function iconsPlugin(sourceDir: string = DEFAULT_ICON_SOURCE): Plugin {
  return {
    name: 'ec-pwa-icons',
    apply: 'build',
    buildStart() {
      loadIcons(sourceDir); // 缺檔就在建置一開始失敗
    },
    generateBundle() {
      emitIcons(sourceDir, (file) => {
        this.emitFile({ type: 'asset', fileName: file.fileName, source: file.source });
      });
    },
  };
}

/** §9、ADR-007：prompt、generateSW、只 precache 外殼，不設 runtime caching。 */
export function createPwaOptions(tokens: unknown): Partial<VitePWAOptions> {
  return {
    registerType: 'prompt',
    strategies: 'generateSW',
    injectRegister: false,
    includeManifestIcons: false,
    manifest: createManifest(tokens),
    workbox: {
      globPatterns: ['**/*.{html,js,css,webmanifest}', 'icons/*.png'],
      cleanupOutdatedCaches: true,
    },
  };
}
