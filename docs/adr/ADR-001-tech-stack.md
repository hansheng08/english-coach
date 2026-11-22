# ADR-001：語言、前端與工具鏈
- 狀態：**已接受**（G2，2026-11-22 18:46 Hansheng 核准）｜日期：2026-11-22｜提出：Architect（ARCH-001）
- 相關：PRD NFR-01、NFR-03、NFR-05；ADR-002

## 背景
english-coach 是 Android Chrome 優先的 PWA（NFR-01），所以前端一定是網頁技術。選型準則：型別嚴格、主流穩定且 AI 熟悉度高、CLI 建置／測試／lint 快、能用型別與模組邊界讓錯的程式寫不出來、依賴少且每個有理由、可部署可觀測。

## 選項
| 準則 | A. TypeScript 全端（React＋Vite；後端 TS） | B. 前端 TS＋後端 Go | C. Flutter Web（Dart） |
|---|---|---|---|
| 型別嚴格 | 高（`strict` 全開＋typescript-eslint strict-type-checked） | 高（Go 型別）＋前端 TS | 高 |
| AI 熟悉度 | 最高（React/TS 範例最多） | 高 | 中（Flutter Web＋錄音/Web Audio 範例少） |
| 前後端共用契約 | 可（同一份 zod schema） | 不行（需 OpenAPI 產生程式碼，多一套工具） | 不行 |
| CLI 回饋速度 | Vite／Vitest 秒級 | Go 快，但兩套工具鏈 | 較慢 |
| 免費託管後端 | Supabase Edge Functions（Deno TS）、Cloudflare Workers 都原生支援 | Go 需要容器主機；Cloud Run 需綁帳單、Render 免費方案會休眠（冷啟動破壞時間預算） | 同 B |
| PWA／Web Audio 支援 | 原生 | 原生（前端） | 間接，AudioWorklet 要寫 JS interop |
| 依賴數 | 少（見下） | 多一套語言 | Flutter SDK 本身很大 |

## 決定
採用 **A：TypeScript 全端**（G2 依建議核准）。
- 前端：React 19＋Vite＋`vite-plugin-pwa`。CSS 用 Vite 內建 CSS Modules，不加 UI 框架。
- 後端：TypeScript on Supabase Edge Functions（Deno），見 ADR-002。
- 工具：pnpm workspaces、TypeScript 5（`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`）、ESLint＋typescript-eslint（strict-type-checked）、dependency-cruiser、Vitest、Playwright。
- 一個指令檢查全部：`pnpm check` = `tsc -b` → `eslint` → `depcruise` → `vitest run`。

### 依賴清單（每個都要有理由；新增依賴要經過 Architect Review）
| 套件 | 用在 | 理由 | 不用它的代價 |
|---|---|---|---|
| `react`、`react-dom` | 前端 | 主流、AI 熟悉度最高 | 自己寫 UI 狀態管理 |
| `react-router` | 前端 | 7 個畫面＋Android 返回鍵要正確 | 自寫路由易錯 |
| `@supabase/supabase-js` | 前端 `api/` | 登入、讀表、上傳 Storage 的官方用戶端 | 自寫 auth token 刷新 |
| `zod` | contracts（前後端） | AI 回傳與 API 邊界的執行期驗證，型別由 schema 推導 | 型別與驗證兩份會不一致 |
| `pdfjs-dist` | 前端 `features/resume` | 在瀏覽器把 PDF 轉文字，才能先去個資再送 AI（NFR-04） | 原檔直接送 AI 會帶出電話、Email |
| `mammoth` | 前端 `features/resume` | DOCX 轉文字，理由同上 | 同上 |
| `vite`、`@vitejs/plugin-react`、`vite-plugin-pwa` | 建置 | 快速建置、產生 SW 與 manifest | 手寫 SW 快取邏輯易出錯 |
| `typescript`、`eslint`、`typescript-eslint`、`dependency-cruiser` | 檢查 | 型別與架構規則 | 錯誤 import 只能靠人審 |
| `vitest`、`@playwright/test` | 測試 | 單元＋E2E（Android 尺寸模擬） | — |
| Supabase CLI | 本機後端、migration、部署 | 官方工具 | — |
- 刻意**不用**：供應商 SDK（Gemini、Groq、Azure 都直接 `fetch` REST，見 ADR-003）、狀態管理庫、UI 元件庫、ORM（SQL migration＋型別產生 `supabase gen types`）。

## 後果
- 好處：前後端一種語言，契約型別共用；AI 寫錯欄位名稱會在編譯期失敗。
- 代價：前端在 Node、後端在 Deno，兩種執行環境；`packages/*` 給 Deno 引用的方式「不確定」（見 ARCHITECTURE §12），第一張開發單先驗證。
- 未採用 B（Go 後端）：找不到能跑容器又不綁卡的免費主機。
