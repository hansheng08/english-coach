// 不安裝 @types/node（CLAUDE.md §5 第 5 條）；只宣告 drift 測試實際用到的 Node 內建函式（ARCHITECTURE §4.10.1）。
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}

interface ImportMeta {
  url: string;
}
