// 不安裝 @types/node（CLAUDE.md §5 第 5 條）；測試要讀 .env.example，只宣告這一個用到的函式。
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
}
