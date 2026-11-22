# CLAUDE.md — english-coach
> 擁有者：Architect（完整路線，憲章 v3 §5）。對應 `docs/ARCHITECTURE.md` v1.1（G2 已通過，2026-11-22；v1.1 修訂 ADR-008 第 4、9 條）。
> 任務單（`docs/tasks/<編號>.md`）開頭的「強制工作規則」優先於本檔與任何外掛（含 pstack）的建議。

## 1. 專案是什麼
- 單一使用者（Hansheng）的英文口說學習 PWA，Android＋Chrome 優先。需求：`docs/PRD.md`（AC-01～25、NFR-01～06）。
- 架構：`docs/ARCHITECTURE.md`；決策：`docs/adr/ADR-001`～`ADR-008`。動手前先讀任務單「背景」指定的章節。

## 2. 技術棧（G2 已核准）
- TypeScript 5 strict 全端；pnpm workspaces。
- 前端 `apps/web`：React 19＋Vite＋vite-plugin-pwa；CSS Modules。
- 後端 `supabase/`：Postgres（migrations＋RLS）、Storage、Edge Functions（Deno TS）、pg_cron。
- 共用：`packages/contracts`（zod schema、供應商介面、`Result`、`AppError`）、`packages/domain`（純邏輯）。
- 測試：Vitest、Playwright；檢查：ESLint（typescript-eslint strict-type-checked）、dependency-cruiser。

## 3. 指令（每次修改後都要跑，貼原始輸出到報告）
```
pnpm install --frozen-lockfile
pnpm check            # = pnpm typecheck && pnpm lint && pnpm arch && pnpm test
pnpm typecheck        # tsc -b
pnpm lint             # eslint .
pnpm arch             # depcruise（架構規則）
pnpm test             # vitest run
pnpm e2e              # playwright test（使用假供應商，不打真 API）
supabase start        # 本機後端（需要 Docker）
```
- 指令名稱以 `package.json` 為準；如果不存在，停下來寫進報告，不要自己發明替代指令。

## 4. 模組邊界（違反會讓 `pnpm arch`／`pnpm lint` 失敗，不要用 disable 註解繞過）
| 模組 | 可以 import | 不可以 |
|---|---|---|
| `packages/contracts` | `zod` | 其他一切 |
| `packages/domain` | `packages/contracts` | `fetch`、`Date.now()`、無參數 `new Date()`、`Math.random`、`throw`（只限正式程式，見 §7）、資料庫、供應商 |
| `supabase/functions/_shared/providers/<adapter>` | `contracts`、`config` | `domain`、`db`、其他 adapter |
| `supabase/functions/_shared/providers/registry.ts` | `contracts`、adapters、`config/paid.ts` | 備援清單、自動改選供應商 |
| `supabase/functions/_shared/config` | — | 唯一可以讀 `Deno.env` 的地方 |
| `supabase/functions/_shared/db` | `contracts`、`@supabase/supabase-js`（後端唯一可以用的地方：查表、Storage、JWT → `user_id`） | 供應商；把 `SupabaseClient` 或 `{ data, error }` 傳出去 |
| `supabase/functions/<endpoint>` | 以上（adapter 只能經 registry；資料庫與登入者只能經 `_shared/db`） | 直接 import adapter、`@supabase/*` |
| `apps/web/src/features/<X>` | `contracts`、`apps/web/src/{api,audio,ui,storage}` | 其他 feature、`@supabase/supabase-js` |
| `apps/web/src/api` | `contracts`、`@supabase/supabase-js` | 外部 AI 網址 |
- `fetch` 只能出現在 `_shared/providers/**`、`_shared/news/**`、`apps/web/src/api/**`。
- `@supabase/*` 只能在 `apps/web/src/api/**`、`supabase/functions/_shared/db/**` import（ADR-008 第 4 條修訂 1）。
- 不寫 `http:`／`https:`／`npm:`／`jsr:` 開頭的 import；Deno 的第三方套件在 `supabase/functions` 的 `deno.json` `imports` 對應成裸名稱，程式只寫裸名稱（ESLint 會擋）。
- 正式程式不得 import 測試程式（`*.test.ts`、`*.test-d.ts`、`test/` 資料夾）。

## 5. 絕對不要做
1. **不寫入、不讀取、不印出任何金鑰**。金鑰只存在 Supabase secrets；程式只在 `_shared/config` 讀 `Deno.env`。repo 只能有 `.env.example`（只有變數名稱）。
2. **不把金鑰放進前端**：任何 `VITE_` 變數不得含 KEY／SECRET／TOKEN（唯一例外：`VITE_SUPABASE_ANON_KEY`）。
3. **不自動改用其他供應商或付費方案**（AC-25、ADR-003）：額度用完或失敗 → 回 `ProviderError` 給前端；只有 `invalid_response` 可以對同一家同一模型重試 1 次。
4. 不使用供應商 SDK（Gemini、Groq、Azure 都用 `fetch` 呼叫 REST）。
5. 不新增依賴；需要時停下來寫進報告（新增依賴要 Architect Review）。
6. 不把錄音送 Gemini；送 AI 的履歷只能是去掉電話、Email、地址後的文字。
7. 不在資料庫保存新聞原文全文（只存改寫、連結、雜湊）。
8. 不在 Service Worker 快取 API 回應。
9. 不在 log 寫使用者文字、逐字稿或錄音內容。
10. 不修改 `docs/` 裡別人擁有的文件；`docs/reports/<編號>.md` 是你唯一要寫的文件。
11. 不把複習間隔（3／7／14／14／1）或新聞輪替順序寫死在程式裡：一律從 `settings.srs`／`settings.news` 讀，預設值只放在 `packages/contracts` 的 schema（ARCHITECTURE §4.2、§11.2）。
12. 不抓 `news_source` 白名單以外的網址；不抓 robots.txt 不允許的網址。

## 6. 寫法規定
- `tsconfig`：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`、`noFallthroughCasesInSwitch`。不得使用 `any`、`as unknown as`、`@ts-ignore`（`@ts-expect-error` 只能出現在型別測試）。
- 錯誤：`domain`、`providers`、`db`、`news` 回傳 `Result<T, AppError>`，正式程式不寫 `throw`（ESLint 會擋）；`fetch`、`supabase-js`、`JSON.parse` 等會丟例外的呼叫要在這些模組內 `catch` 轉成 `err(...)`，zod 用 `safeParse`。只有 HTTP handler 把錯誤轉成回應：`{ error: { kind, provider?, message, retryable, retryAfterSec? } }`。
- 窮舉檢查寫成 `default: { const unreachable: never = x; return unreachable; }`，不要寫會丟例外的 `assertNever`。
- 狀態與 ID 用字串字面值聯集，`switch` 一定要有 `never` 窮舉檢查。
- 所有 API 請求、回應與 AI 回傳 JSON 都要經過 `packages/contracts` 的 zod schema。
- 時間：`plan_date` 一律是台北日期（`Asia/Taipei`），由 `domain` 的函式依傳入的 `now` 計算；DB 時間戳記用 `timestamptz`。
- 每個 AI／STT 結果都要帶 `meta`（模型、供應商名稱），畫面要顯示（AC-24）。
- 每次外部呼叫寫一筆 `provider_call`（不含內容）。

## 7. 測試規定
- `domain` 每個公開函式都有 Vitest 單元測試；時間由參數注入。
- **測試程式可以 `throw`**（ADR-008 修訂 1）：`*.test.ts`、`*.test-d.ts` 與 `test/` 資料夾的輔助檔（例如 `expectOk(r)` 遇到 `err` 就丟出）可以 `throw`、用 `expect`／`assert`、import `vitest`。測試程式**仍然不能**用 `Date.now`、無參數 `new Date()`、`Math.random`（要亂數就用固定種子的產生器放在 `test/`）、`as unknown as`、`@ts-ignore`。
- adapter 用錄好的回應樣本做契約測試；CI 不打真 API。
- AC-25 測試（ADR-003）不得刪改：registry 對每種錯誤只呼叫被選中的 adapter；預設值全部 `tier: 'free'`；沒有付費同意時付費 adapter 呼叫次數為 0。
- 不得用 `it.skip`／`test.only` 提交；需要 skip 時寫進報告並附理由。
- E2E 以 Pixel 尺寸（360×640 級）檢查無橫向捲動（NFR-01）。
- **AC 驗收時點**：本專案沒有 CLI。「第一次能在畫面上走完某條 AC」的任務單，視同憲章 §5 的 CLI PR：該單要有能讓 QA 用 Playwright 走完該 AC 的畫面；之前只有程式庫或 API 的單視同 library PR（只驗單元層）。任務單的「驗收標準」會寫明本單屬於哪一種。

## 8. 時間預算（寫功能時要守的數字，見 ARCHITECTURE §8）
- 建卡 `POST /cards` 不呼叫 AI；`/cards/generate` 用串流，逾時 8 s。
- 跟讀比對 ≤ 5 s；逐字稿 ≤ 30 s；診斷 ≤ 30 s；履歷出題 ≤ 60 s。

## 9. Git（摘自憲章 v3 §5、§13）
- 只在任務單指定的分支工作；commit 訊息 `[ClaudeCode] <編號> <摘要>`；`git push -u origin <分支>`。
- 分支：T-xxx、O-xxx → `task/<編號>`；QA 修復 → `fix/Q-xxx`；PoC A-xxx → `poc/A-xxx`（**永遠不合併到 main**）。pushguard（O-001）只放行「推送目前所在的 `task/*`、`fix/*`、`poc/*` 分支到 origin 同名分支」，其他 push 一律拒絕或問人。
- 不碰 main、不 merge、不開 PR、不 force push、不刪分支或既有檔案。
- 完成後寫 `docs/reports/<編號>.md`，每個驗證項目貼原始輸出（最後 20 行以內）。
