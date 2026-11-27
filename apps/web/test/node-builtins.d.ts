// 不安裝 @types/node（CLAUDE.md §5 第 5 條）；vite.pwa.ts 與它的測試只宣告用到的 Node 內建函式。
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(path: string, data: Uint8Array | string): void;
  export function rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: URL): string;
}
