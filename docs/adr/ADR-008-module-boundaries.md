# ADR-008：模組邊界與架構測試
- 狀態：**已接受**（G2，2026-11-22 18:46 Hansheng 核准）｜日期：2026-11-22｜提出：Architect（ARCH-001）
- 相關：ARCHITECTURE §3、§6、§15；ADR-003｜修訂：修訂 1（ARCHITECTURE v1.1）、修訂 2（v1.2），皆 2026-11-22；修訂 3（v1.3，2026-11-23）；修訂 4（v1.5，2026-11-24）；修訂 5（v1.7，2026-11-25）；見文末

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

## 修訂 2（2026-11-22，Architect，ARCH-003；ARCHITECTURE v1.2）
- 狀態：**已接受**（Architect 依憲章 §5 決定；不改 PRD、不改技術棧）
- 起因：TASKS §5 第 20 點（前端 `*.test.tsx` 會被當成正式程式）；ADR-009 決定用套件名稱引用，需要對應的 lint 規則；ARCHITECTURE §5.0 的品牌型別需要「只能由建立函式產生」的執行方式。

### 決定 3：測試檔定義涵蓋 `.test.tsx`
- **新 regex**（ESLint 與 dependency-cruiser 共用，取代修訂 1 的版本）：`(^|/)test/|\.test\.tsx?$|\.test-d\.ts$`
  - 前端元件測試 `*.test.tsx` **算測試程式**（理由：它和 `*.test.ts` 一樣只在 Vitest 跑、不會被打包；不算的話第 11 條「正式程式不得 import 測試程式」會在它 import `test/` 輔助檔時誤判，而且 `throw` 禁令會套到它身上）。
  - `test/` 資料夾內的輔助檔**可以是 `.tsx`**（例如包住路由或 context 的 `renderWithProviders`）；regex 的 `(^|/)test/` 本來就不看副檔名。
  - 型別測試維持只用 `*.test-d.ts`（不需要 JSX）；`@ts-expect-error` 的豁免仍只給 `**/*.test-d.ts`。
- **ESLint**：測試檔的 `files` 寫成 `['**/*.test.{ts,tsx}', '**/*.test-d.ts', '**/test/**/*.{ts,tsx}']`；修訂 1 決定 2 的「正式程式／測試程式」兩組規則都改用這組 glob（`ignores` 同一組）。
- **dependency-cruiser**：`TEST` 常數改成上面的 regex；`adr008-01`、`01t`、`02`、`02t`、`11` 的寫法不變。
- 架構測試新增範例：`apps/web/src/features/noon/x.test.tsx` import `../../../test/render.tsx`（`apps/web/test/render.tsx`）→ 合法；`apps/web/src/features/noon/x.tsx`（正式程式）import 同一個輔助檔 → `adr008-11` 違規；`packages/domain/src/x.test.tsx` 裡 `throw` → 不報 #9。

### 決定 4：跨套件引用（ADR-009 決定 1 的執行方式）
- **ESLint `no-restricted-imports`**（`patterns` 用 `regex`，全 repo `.ts`／`.tsx`；和修訂 1 的 `http:`／`npm:` 禁令放同一條規則的 `patterns` 陣列，避免區塊互相覆蓋）：
  1. 禁止相對路徑跨進套件：`regex: '^\\.{1,2}/(.*/)?packages/'`，訊息「ADR-009：用 @english-coach/<套件> 引用」。
  2. 禁止深層引用：`regex: '^@english-coach/(contracts|domain)/(?!testing$)'`，以及 `^@english-coach/domain/testing$`（domain 沒有 testing 入口）。
- **ESLint**（只在 `packages/**`、`supabase/functions/**`）：相對 import 必須寫副檔名：`regex: '^\\.{1,2}/(?!.*\\.(ts|tsx|json)$)'`，訊息「ADR-009：Deno 需要 .ts 副檔名」。
- **dependency-cruiser**：不新增規則。`@english-coach/contracts/testing` 解析後是 `packages/contracts/test/index.ts`，正式程式 import 它會被既有的 `adr008-11` 擋下。
- 架構／lint 測試新增範例：`apps/web/src/api/x.ts` import `../../../../packages/contracts/src/index.ts` → error；import `@english-coach/contracts/src/ids.ts` → error；import `@english-coach/contracts` → 合法；`packages/domain/src/x.ts` import `./y` → error、`./y.ts` → 合法；`packages/domain/src/x.ts` import `@english-coach/contracts/testing` → `adr008-11` 違規；`packages/domain/src/x.test.ts` import 同一個 → 合法。

### 決定 5：品牌型別只能由建立函式產生（ARCHITECTURE §5.0 原則 3）
- **ESLint `no-restricted-syntax`**：`TSAsExpression` 與 `TSTypeAssertion` 的目標型別名稱符合 `^(UserId|CardId|AnswerId|QuestionId|ArticleId|PlanDate|StoragePath|Ntd|Wav16kMono|PaidConsent)$` → error（訊息「用 schema 或建立函式產生品牌值」）。
- **允許的檔案**（`ignores`）：`packages/contracts/src/ids.ts`（`Ntd` 運算）、`packages/contracts/src/audio.ts`（`Wav16kMono`）、`packages/domain/src/taipei-date.ts`（`PlanDate`）、`supabase/functions/_shared/providers/registry.ts`（`PaidConsent`），以及所有測試程式。各 ID 只能經 zod schema 產生（db 讀出的列先過列 schema）。
- 注意：`no-restricted-imports` 也一樣，`packages/**`、`supabase/functions/**` 的區塊要包含全部 patterns（網址前綴、跨套件、副檔名）。這條規則和既有的 `as unknown as`、`Deno.env`、`domain` 禁令都用 `no-restricted-syntax`，同一個檔案只會套用最後一個符合的設定區塊，必須照 T-001 的做法把選擇器合併在同一區塊（T-001 報告已處理過同樣問題）。

### 修訂 2 後的規則表（只列有變動的）
| # | 規則 | 執行 |
|---|---|---|
| 測試檔 | `(^\|/)test/\|\.test\.tsx?$\|\.test-d\.ts$` | ESLint glob＋depcruise `TEST` |
| 12 | 只能用套件名稱引用 `packages/*`；只允許 `@english-coach/contracts`、`@english-coach/contracts/testing`、`@english-coach/domain` 三個入口 | ESLint `no-restricted-imports` |
| 13 | `packages/**`、`supabase/functions/**` 的相對 import 要寫副檔名 | ESLint `no-restricted-imports` |
| 14 | 品牌型別的 `as` 只在建立函式所在檔案與測試程式 | ESLint `no-restricted-syntax` |

### 後果
- 這些規則由 TechLead 排進 T-051（或 T-051 之前的工具單）；第 12、13 條在有真實套件時才有意義，第 14 條在 T-051 寫出品牌型別時同時生效。
- 修訂 1 寫的 regex 由本修訂取代；T-002 照修訂 1 實作不受影響，T-051 再換成新 regex。

## 修訂 3（2026-11-23，Architect；ARCHITECTURE v1.3，隨 ADR-010）
- 狀態：**已接受**（送 G2 PR `[G2] T-003 Supabase 架構補充`）
- **第 14 條品牌清單加 `AuthContext`**：允許 `as AuthContext` 的正式程式檔只有 `supabase/functions/_shared/db/auth.ts`（測試程式仍例外）。選擇器的名稱 regex 改為 `^(UserId|CardId|AnswerId|QuestionId|ArticleId|PlanDate|StoragePath|Ntd|Wav16kMono|PaidConsent|AuthContext)$`。
- **新增第 15 條**：`Deno.serve` 只能出現在 `supabase/functions/<函式>/index.ts`（ESLint `no-restricted-syntax`，`MemberExpression[object.name='Deno'][property.name='serve']`；和同區塊其他選擇器合併，避免覆蓋）。其他 Deno API 由 `supabase/functions/_types/deno.d.ts` 的最小宣告限制（沒宣告就編譯失敗，ADR-010 決定 3）。
- lint 測試新增範例：`supabase/functions/api/router.ts` 寫 `Deno.serve(h)` → error；`supabase/functions/api/index.ts` → 合法；`supabase/functions/api/router.ts` 寫 `x as AuthContext` → error；`supabase/functions/_shared/db/auth.ts` → 合法。

## 修訂 4（2026-11-24，Architect；ARCHITECTURE v1.5，隨 T-006 資料模型 PR）
- 狀態：**已接受**（送 G2 PR `[G2] T-006 資料模型（Q-28～Q-30）與架構備忘`，Hansheng Merge 即核准）
- 起因：ARCHITECTURE §3.1 與 CLAUDE.md §4 寫 `_shared/config` 「不依賴任何模組」，但 T-003 的實作（ADR-010 決定 1：用 zod 驗證、回 `Result`／`AppError`）import 了 `@english-coach/contracts` 與 `zod`，dependency-cruiser 目前也沒有限制 `_shared/config` 的規則。文件改成跟程式一致，再補上規則。
- **新增第 16 條**：`supabase/functions/_shared/config/**` 的正式程式只能 import `@english-coach/contracts`、`zod` 與同資料夾內的檔案。不得 import `_shared/db`、`_shared/providers`、`_shared/news`、`@english-coach/domain`、`@supabase/*`，也不得 import 任何 `<函式>/**`。（dependency-cruiser `forbidden`：`from.path = ^supabase/functions/_shared/config/`、`from.pathNot` 用第 3 條的測試檔 regex；`to.path` 不是 `^packages/contracts/src/`、`zod`，也不在 `^supabase/functions/_shared/config/` 底下時報 error。）
- **新增第 17 條**：`supabase/functions/_shared/db/paid-consent.ts`（唯一在 `api` 裡用 secret 金鑰的檔案，ARCHITECTURE §4.9、ADR-010 修訂 1）只能被 `supabase/functions/api/**` import（dependency-cruiser `forbidden`：`to.path = ^supabase/functions/_shared/db/paid-consent\.ts$`，`from.pathNot` 是 `^supabase/functions/(api|_shared/db)/` 或測試檔時報 error）。
- 實作：TechLead 派給 T-020，或另開工具單；在那之前規則只寫在文件，不算違反。arch 測試新增範例：
  - `_shared/config/env.ts` import `_shared/db/client.ts` → error。
  - `_shared/config/env.ts` import `@english-coach/contracts` → 合法。
  - `daily-prep/handler.ts` import `_shared/db/paid-consent.ts` → error。
## 修訂 5（2026-11-25，Architect；ARCHITECTURE v1.7，隨 ADR-012）
- 狀態：**已接受**（送 G2 PR `[G2] T-015 Gemini adapter 契約`，Hansheng Merge 即核准）
- 起因：ADR-012 決定 3。金鑰只從工廠參數傳進 adapter，免費供應商的金鑰只有一個讀取入口。
- **新增第 18 條**：`supabase/functions/_shared/providers/<adapter>/**`（`providers/` 底下的子資料夾）的正式程式只能 import `@english-coach/contracts`、`zod` 和同資料夾的檔案。
  - 不得 import `_shared/config/**`、`_shared/db/**`、`_shared/news/**`、`@english-coach/domain`、`_shared/providers/*.ts`（registry、wiring），也不得 import 其他 adapter 資料夾。
  - dependency-cruiser `forbidden` 寫法：`from.path = ^supabase/functions/_shared/providers/([^/]+)/`，`from.pathNot` 用第 3 條的測試檔 regex，`to.path` 列出上述路徑；跨 adapter 用 `to.pathNot = ^supabase/functions/_shared/providers/$1/`。
  - 這條取代 ARCHITECTURE §3.1 舊版「adapter 可依賴 `config`」。
- **新增第 19 條**：只有 `supabase/functions/_shared/providers/wiring.ts`（和測試程式）可以 import `supabase/functions/_shared/config/provider-keys.ts`。寫法和第 6 條相同（`to.path = ^supabase/functions/_shared/config/provider-keys\.ts$`，`from.pathNot = ^supabase/functions/_shared/providers/wiring\.ts$` 或測試檔）。
- 實作：
  - 第 18 條由 T-015 加進 `.dependency-cruiser.cjs`（目前沒有程式違反）。
  - 第 19 條由建立 `wiring.ts` 的單加，或 T-015 一併加。
  - arch 測試範例：
    - `providers/gemini/client.ts` import `../../config/env.ts` → error
    - `providers/gemini/client.ts` import `zod` → 合法
    - `api/router.ts` import `_shared/config/provider-keys.ts` → error
    - `providers/wiring.ts` import 同一檔 → 合法
