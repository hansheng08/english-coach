# ADR-008：模組邊界與架構測試
- 狀態：**已接受**（G2，2026-11-22 18:46 Hansheng 核准）｜日期：2026-11-22｜提出：Architect（ARCH-001）
- 相關：ARCHITECTURE §3、§6、§15；ADR-003｜修訂：修訂 1（2026-11-22，ARCHITECTURE v1.1，見文末）

## 背景
主要由 Claude Code 寫程式。要讓錯誤（例如在畫面直接呼叫 AI、在 domain 裡讀時間、在 handler 跳過 registry）在 CI 就失敗，而不是靠 Review 抓。

## 選項
| 準則 | A. dependency-cruiser＋ESLint 規則 | B. eslint-plugin-boundaries | C. 只靠 Review |
|---|---|---|---|
| 規則表達力 | 高（路徑、循環、孤兒檔案） | 中高 | — |
| 跨 Deno／Node 程式碼 | 可（只看檔案路徑） | 需 ESLint 能解析兩邊 | — |
| 速度 | 秒級 | 秒級 | 慢且不穩定 |
| AI 熟悉度 | 中高 | 中 | — |

## 決定
採用 **A**。規則（第一版）：
1. `packages/domain/**` 只能 import `packages/contracts/**`。
2. `packages/contracts/**` 只能 import `zod`。
3. `apps/web/src/features/X/**` 不得 import `apps/web/src/features/Y/**`（X≠Y）。
4. 只有 `apps/web/src/api/**` 可以 import `@supabase/supabase-js`。
5. `supabase/functions/<endpoint>/**` 不得直接 import `_shared/providers/<adapter>`，只能經過 `_shared/providers/registry.ts`。
6. 只有 `_shared/providers/registry.ts` 可以 import `_shared/config/paid.ts`。
7. 只有 `_shared/config/**` 可以出現 `Deno.env`（ESLint `no-restricted-syntax`）。
8. `fetch` 只允許在 `_shared/providers/**`、`_shared/news/**`、`apps/web/src/api/**`。
9. `packages/domain/**` 禁用 `Date.now`、`new Date()`（無參數）、`Math.random`、`throw`。
10. 禁止循環依賴。

## 後果
- 好處：AI 寫錯的 import 在 `pnpm check` 秒級失敗；TechLead Review 專注在邏輯。
- 代價：新增模組要先改規則（改規則要 Architect Review，結論只會是「符合／需修改／需要新的 ADR」）。

## 修訂 1（2026-11-22，Architect；ARCHITECTURE v1.1）
- 狀態：**已接受**（Architect 依憲章 §5「改規則要 Architect Review」決定；不改 PRD、不改技術棧，不需 G2）
- 起因：T-001（PR #2）審查時 TechLead 提出兩個問題，要在 T-002、T-003 之前決定：(1) 第 4 條是否也套用到 `supabase/functions`；(2) `domain` 的測試能不能 `throw`。
- 判斷準則：錯的程式寫不出來、寫錯立刻失敗、規則由 lint／架構測試執行而不是靠文字。

### 決定 1：第 4 條改為「兩個出入口」
- **新第 4 條**：`@supabase/*`（含 `supabase-js`、`postgrest-js`、`storage-js`、`auth-js` 等所有子套件，不論 `npm:`／`jsr:` 前綴）**只能**在兩處 import：`apps/web/src/api/**`（前端唯一網路層）與 `supabase/functions/_shared/db/**`（後端唯一讀寫 Postgres／Storage／驗 JWT 的地方）。其他地方（endpoint、`providers`、`news`、`config`、`domain`、`contracts`、前端 feature）一律禁止。
- 理由：原條文的用意是「資料庫存取只有一個出口」，當初只寫了前端那一半。`_shared/db` 本來就是 ARCHITECTURE §3.1 指定的唯一資料庫出口，用官方用戶端（RLS、Storage、Auth 都在裡面）比自寫 SQL 驅動安全，也不需要新增依賴（ADR-001 已列 `supabase-js`）。不放寬會逼人用 disable 註解或繞路；全面放寬則 endpoint 可以直接查表、跳過 repository。
- 附帶規定：
  - endpoint 取得登入者（JWT → `user_id`）也經過 `_shared/db`（例如 `_shared/db/auth.ts`），回 `Result<UserId, AppError>`。
  - `_shared/db` 的公開函式只用 `contracts` 的型別回傳 `Result<T, AppError>`，不把 `SupabaseClient` 或 `{ data, error }` 傳出去。endpoint 本身不能 import `@supabase/*`（含 `import type`，`tsPreCompilationDeps: true`），所以無法在簽名裡寫出這些型別。
  - Supabase 網址與金鑰由 `_shared/config` 讀 `Deno.env` 後以參數交給 `_shared/db`（第 7 條不變）。
- 執行方式：
  - dependency-cruiser `adr008-04`：`from.pathNot` 改為 `^(apps/web/src/api|supabase/functions/_shared/db)/`；`to.path` 改為 `^(npm:|jsr:)?@supabase/` 與 `node_modules/@supabase/`（Deno 的 `npm:`／`jsr:` 寫法在 Node 端無法解析，會以原字串出現，所以 regex 要涵蓋前綴）。
  - 新增 ESLint `no-restricted-imports`（全 repo 的 `.ts`／`.tsx`）：禁止 `http:`、`https:`、`npm:`、`jsr:` 開頭的 import。Deno 端的第三方套件一律在 `supabase/functions` 的 `deno.json` `imports` 對應成裸名稱（例如 `"@supabase/supabase-js": "npm:@supabase/supabase-js@2"`），程式只寫裸名稱。這樣 `esm.sh` 之類的網址也無法繞過第 4 條。
  - 架構測試（`tooling/arch-rules.test.ts`）新增範例：`_shared/db/x.ts` import `@supabase/supabase-js` → 合法；`api/x.ts`、`_shared/providers/gemini/x.ts` import `@supabase/supabase-js` → 違規；`api/x.ts` import `npm:@supabase/supabase-js@2` → 違規（第 4 條或 ESLint 至少一個擋下）。
- 不確定：Supabase CLI 打包時 `_shared/**` 是否套用 `deno.json` 的 `imports`（未驗證）；由 T-003 驗證，不行就停下回報 Architect，不自行改回網址 import。

### 決定 2：「不丟例外」管正式程式，不管測試程式
- **正式程式**（不是測試檔的檔案）：`packages/domain/**` 禁止 `throw`（第 9 條不變），並延伸到同樣規定回 `Result` 的 `supabase/functions/_shared/{providers,db,news}/**`（ARCHITECTURE §6 第 1 點原本只有文字）。要失敗就回 `err(AppError)`；外部 API、`fetch`、`supabase-js` 丟出的例外要在這些模組內 `catch` 轉成 `Result`。窮舉檢查用 `default: { const unreachable: never = x; return unreachable; }`，不寫會丟例外的 `assertNever`。
- **測試程式**：`**/*.test.ts`、`**/*.test-d.ts`，以及任何 `test/` 資料夾內的輔助檔（例如 `packages/domain/test/result.ts` 的 `expectOk(r)`：遇到 `err` 就丟出，讓測試失敗並把型別縮小成成功值）**可以** `throw`、可以用 Vitest 的 `expect`／`assert`，可以 import `vitest`。
- **測試程式仍禁止**：`Date.now`、無參數 `new Date()`／`Date()`、`Math.random`（測試要可重現；需要亂數的性質測試用固定種子的自寫亂數產生器，放在 `test/`）、`as unknown as`、`@ts-ignore`、`Deno.env`。
- **正式程式不能 import 測試程式**：避免「測試輔助的 throw」經由 import 混進正式程式。
- 理由：`throw` 禁令是為了讓正式程式的每種失敗都出現在回傳型別上、被呼叫端強制處理；測試裡的 `throw` 只會讓該測試失敗，不會流進正式程式，禁止它只會讓測試難寫（不能寫 `expectOk` 縮小型別）。同時 T-001 的設定會讓 `packages/domain`、`packages/contracts` 的測試檔 import `vitest` 時違反第 1、2 條，T-002 第一個測試就會卡住，必須一起修正。
- 執行方式：
  - 測試檔的定義（ESLint 與 dependency-cruiser 共用同一個 regex）：`(^|/)test/|\.test(-d)?\.ts$`。
  - ESLint：`packages/domain/**` 與 `supabase/functions/_shared/{providers,db,news}/**` 的**非測試檔**啟用 `ThrowStatement` 禁令；`packages/domain/**` 的**測試檔**保留 `Date.now`／`new Date()`／`Date()`／`Math.random` 禁令、移除 `ThrowStatement`。
  - dependency-cruiser：`adr008-01`、`adr008-02` 的 `from` 加 `pathNot: 測試檔`；新增 `adr008-01t`／`adr008-02t`：`packages/{domain,contracts}` 的測試檔只能 import 自己的套件、`packages/contracts`、`vitest`（`node_modules/(vitest|@vitest)/`）。
  - 新增 `adr008-11-no-test-code-in-production`：非測試檔不得 import 測試檔。
  - 架構測試新增範例：domain 正式檔 `throw` → error；domain 測試檔與 `test/` 輔助檔 `throw` → 合法；domain 測試檔 `Date.now()` → error；domain 正式檔 import `../test/result.ts` → 違規；domain 測試檔 import `vitest` → 合法、import `zod` → 違規；`_shared/db/x.ts` `throw` → error。

### 修訂後完整規則表（取代上方「決定」的第 4、9 條，新增第 11 條）
| # | 規則 | 執行 |
|---|---|---|
| 4 | `@supabase/*` 只能在 `apps/web/src/api/**`、`supabase/functions/_shared/db/**` import；全 repo 禁止 `http:`／`https:`／`npm:`／`jsr:` import | depcruise `adr008-04`＋ESLint `no-restricted-imports` |
| 9 | `packages/domain/**` 正式程式禁用 `Date.now`、無參數 `new Date()`／`Date()`、`Math.random`、`throw`；測試程式只放行 `throw` | ESLint `no-restricted-syntax`（依測試檔 regex 分兩組） |
| 9b | `_shared/{providers,db,news}/**` 正式程式禁用 `throw` | ESLint `no-restricted-syntax` |
| 1t／2t | domain／contracts 的測試程式只能 import 自己、`contracts`、`vitest` | depcruise |
| 11 | 正式程式不得 import 測試程式 | depcruise |

### 後果
- T-001 依舊條文的實作正確，PR #2 不需要為此修改即可合併；上列規則與範例由 TechLead 排進 T-002 之前或 T-002 內（`domain`、`contracts` 第一批測試出現前），第 4 條的 Deno 部分在 T-003 驗證。
- 已知限制：`globalThis.fetch(...)` 仍未被 `fetch` 規則擋下（T-001 報告盲點 5）；ESLint 目前只比對 `**/*.ts`，`.tsx` 要在 T-018 前納入——這兩項不在本修訂範圍，維持 TechLead 已列的後續。
