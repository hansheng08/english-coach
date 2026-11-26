// 測試專用：vite 不讓 `?raw` 讀 .env* 檔，所以 static.test.ts 用 node:fs 讀 .env.example。
// 專案沒有 @types/node，這裡只宣告用到的那一個函式。
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}
