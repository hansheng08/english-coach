// 不安裝 @types/node（CLAUDE.md §5 第 5 條）；TC-20 要讀 test/ 下所有檔案，只宣告用到的兩個函式。
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
  export function readdirSync(path: URL): string[];
}
