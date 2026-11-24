# ADR-009：`@english-coach/contracts` 套件名稱、引用方式與共用型別
- 狀態：**已接受**（Architect，ARCH-003，2026-11-22；不改 PRD、不改技術棧，依憲章 §5 由 Architect 決定，不需 G2）｜日期：2026-11-22｜提出：Architect
- 修訂：修訂 1（2026-11-23）、修訂 2（2026-11-24）；見文末
- 相關：ARCHITECTURE §3.2、§5.0、§6、§12；ADR-003、ADR-008（修訂 1、2）；TASKS §5 第 5、17、18 點；T-051、T-003

## 背景
- ARCHITECTURE v1.1 §5.2 用到約 10 個沒有定義的型別（TASKS §5 第 17 點），T-051 等這份定義。
- `packages/contracts` 要被三種環境引用：前端（Vite／Vitest，Node 解析）、Edge Functions（Deno，靠 `deno.json` 的 `imports`）、工具（tsc、ESLint、dependency-cruiser，Node 解析）。套件名稱與引用方式沒有定義（TASKS §5 第 18 點）；Supabase CLI 打包時能不能帶上 `supabase/functions` 以外的檔案不確定（ARCHITECTURE §12、TASKS §5 第 5 點）。
- 目前 main（`3e559d1`）`packages/` 下還沒有任何檔案；T-002 正在建立 `packages/contracts/src/{providers,index}.ts`（只有 `Tier`、`Capability`、`ProviderErrorKind`），不建 `package.json`。

## 決定 1：套件名稱與引用方式

### 選項
| 準則 | A. workspace 套件名稱（`@english-coach/contracts`）＋Deno `imports` 對應 | B. TS `paths` 路徑別名 | C. 相對路徑（`../../packages/contracts/src/…`） |
|---|---|---|---|
| 前端（Vite／Vitest） | pnpm 建 symlink，Vite 當原始碼處理，不需要設定 | Vite 要另外設 alias，Vitest 再設一次 | 可以，但路徑很長 |
| Deno | `deno.json` `imports` 一行對應 | 一樣要 `imports`（Deno 不讀 `paths`） | 可以 |
| tsc | 讀 `package.json` `exports` | 讀 `paths` | 可以 |
| dependency-cruiser | 解析 symlink 後得到 `packages/contracts/src/…`，既有路徑規則照用 | 要另設 `tsConfig` 才解析得到 | 可以 |
| 邊界能不能用 lint 擋 | 能：只允許套件名稱與 `/testing` 兩個入口，其他寫法一律擋 | 中 | 難（相對路徑無法區分「合法」與「越界」） |
| 備案（套件搬家）的成本 | 低：引用處不變，只改 `deno.json`、`pnpm-workspace.yaml` 與規則路徑 | 中 | 高：所有引用都要改 |

### 決定
採用 **A**。
1. **套件**（都是 `private: true`、`type: module`，**不建置，直接匯出原始碼**）：
   - `packages/contracts/package.json`：`name: "@english-coach/contracts"`；`exports: { ".": "./src/index.ts", "./testing": "./test/index.ts" }`；`dependencies: { "zod": "^4.6.7" }`（zod 4 最新穩定版，2026-11-22 npm `latest`；ADR-001 已列 zod，本 ADR 即新增依賴的 Architect Review）。
   - `packages/domain/package.json`：`name: "@english-coach/domain"`；`exports: { ".": "./src/index.ts" }`；`dependencies: { "@english-coach/contracts": "workspace:*" }`。
   - `apps/web/package.json`（T-018）：`dependencies` 加 `"@english-coach/contracts": "workspace:*"`、`"@english-coach/domain": "workspace:*"`。
   - `supabase/functions/package.json`（T-003，新增）：`name: "@english-coach/functions"`，`private: true`，`dependencies` 加上述兩個 workspace 套件、`zod`、`@supabase/supabase-js`；`pnpm-workspace.yaml` 加 `supabase/functions`。用途：讓 Node 端的 tsc、Vitest、dependency-cruiser 能解析後端程式的 import（Deno 不靠它）。
2. **寫法**：任何地方都只寫 `import { … } from '@english-coach/contracts'`（測試輔助：`'@english-coach/contracts/testing'`）。不得用相對路徑跨進 `packages/*`，不得深層引用（例如 `@english-coach/contracts/src/ids.ts`）。
3. **相對 import 寫副檔名**：`packages/**` 與 `supabase/functions/**` 內的相對 import 一律寫 `.ts`／`.tsx`（Deno 要求；Vite 與 TS Bundler 解析都接受）。這兩處的 `tsconfig` 加 `allowImportingTsExtensions: true`，並因此改用 `emitDeclarationOnly: true`（`composite` 仍需要輸出 `.d.ts`，輸出到已被忽略的 `dist/`）。
4. **Deno**：`supabase/functions/deno.json`
   ```json
   { "imports": {
       "@english-coach/contracts": "../../packages/contracts/src/index.ts",
       "@english-coach/domain": "../../packages/domain/src/index.ts",
       "zod": "npm:zod@^4.6.7",
       "@supabase/supabase-js": "npm:@supabase/supabase-js@^2.119.2"
   } }
   ```
   `@english-coach/contracts/testing` 不對應（Deno 端不跑測試）。
5. **Vite**：不需要 alias；workspace symlink 的實際路徑不在 `node_modules`，Vite 會把它當原始碼轉譯（未驗證，T-018 確認）。
6. **工具**：dependency-cruiser 維持 `preserveSymlinks: false`（預設），`@english-coach/contracts` 會解析成 `packages/contracts/src/index.ts`，ADR-008 的路徑規則不用改；ESLint 規則見 ADR-008 修訂 2。

### 工作假設與驗證（T-003）
- 假設：Supabase CLI（`supabase functions serve`／`deploy`）會依 `deno.json` 的 `imports` 把 `supabase/functions` 以外的 `packages/*/src/**` 一起打包。**未驗證**。
- T-003 要驗證：(1) `supabase functions serve` 下 `api` 函式能 import `@english-coach/contracts` 並執行；(2) `supabase functions deploy --dry-run`（或等效的打包指令）成功、打包結果含 contracts；(3) `pnpm install` 後 Node 端 `tsc -b` 與 `pnpm arch` 能解析 `supabase/functions/**` 對 `@english-coach/*` 的 import（模組數 > 0、沒有 `couldNotResolve`）。
- **備案**（任一項失敗時，T-003 停下回報，Architect 寫 ADR-009 修訂後才執行）：把 `packages/contracts`、`packages/domain` 整個搬到 `supabase/functions/_shared/contracts`、`supabase/functions/_shared/domain`；**套件名稱不變**，所以前端與後端的 import 都不用改。要改的只有：`pnpm-workspace.yaml` 的路徑、`deno.json` 的兩行對應（改成 `./_shared/…`）、dependency-cruiser 與 ESLint 規則裡的 `packages/(contracts|domain)` 路徑、ARCHITECTURE §3、§12。若連 `deno.json` 的 `imports` 都不被支援，再退一步：`_shared/**` 內改用寫副檔名的相對路徑，ESLint 的跨套件規則對 `supabase/functions/**` 改為「只能相對引用 `_shared/contracts`、`_shared/domain` 的 `src/index.ts`」。

## 決定 2：共用型別的設計規則（定義在 ARCHITECTURE §5.0）
1. 型別全部放 `@english-coach/contracts`；檔案依 import 順序分層（`brand`／`result`／`validation` → `ids` → `audio`／`speech` → `providers` → `errors` → `api`），避免 `adr008-10` 循環。
2. `Result<T, E>` 用 `ok: true | false` 區分；`E` 一律寫明（不設預設值）；helper：`ok`、`err`、`isOk`、`isErr`、`map`、`mapErr`、`andThen`、`unwrapOr`、`all`、`tryCatch`、`tryCatchAsync`；**不提供** `unwrap`／`expect`。測試用 `expectOk`／`expectErr` 在 `/testing`。
3. `AppError` 是以 `kind` 區分的聯集，`kind` 一共 18 種（9 種供應商錯誤＋9 種應用錯誤），每一種都對應 HTTP 狀態、能否重試、畫面文字與降級方式（ARCHITECTURE §5.0.4 錯誤碼對照表；`httpStatusOf` 必須對每一種 kind 都回值，包括正常不會回前端的 `news_unavailable`＝503、可重試，ARCHITECTURE v1.2.1）；沒有任何一種會觸發自動換供應商或付費（AC-25）。`httpStatusOf`、`isRetryable` 是 contracts 的純函式；畫面文字由前端 `apps/web/src/ui/error-messages.ts` 以 `switch`＋`never` 產生。
4. 品牌型別只用在混用會出錯的值：各種 ID、`PlanDate`、`StoragePath`、`Ntd`、`Wav16kMono`、`PaidConsent`。供應商、模型、語音用字面值聯集＋`z.enum`（新增時 `switch` 編譯失敗就夠了）。
5. 跨網路的型別都由 zod schema 推出（`z.infer`），不手寫第二份。

## 後果
- 好處：T-051 可以照 §5.0 直接寫，不用自己發明；三種環境用同一個名字引用；套件搬家（備案）時引用處不變。
- 代價：`packages/*` 與 `supabase/functions/**` 的相對 import 要寫副檔名；多一個 `supabase/functions/package.json`；T-051 要 `pnpm install` 加入 zod（會改 `pnpm-lock.yaml`，依 T-001 的做法由 Hansheng 在確認視窗核准安裝）。
- 對進行中的 T-002：T-002 的 `index.ts` 若用不帶副檔名的相對路徑重新匯出，T-051 改成 `./providers.ts`；T-002 的 `tsconfig.json` 在 T-051 加上 `allowImportingTsExtensions`／`emitDeclarationOnly`。T-002 本身不需要改範圍。

## 修訂 1（2026-11-23，Architect；ARCHITECTURE v1.3，隨 ADR-010）
- 狀態：**已接受**（送 G2 PR `[G2] T-003 Supabase 架構補充`）
- 起因：模式 C 的 run-task 沒有 Supabase CLI、不允許 `curl`（TASKS §5 第 27 點 (a)）；幕僚長轉達：Supabase CLI 的驗證放在 CI `db` job，由 SRE 負責。
- 「工作假設與驗證」改為：
  - (1) `functions serve` 下 `api` 能 import `@english-coach/contracts` 並執行、(2) 打包（`supabase functions deploy --dry-run` 或等效指令）成功且含 contracts → **改由 CI `db` job 驗證**（SRE 開 O-xxx；和 ADR-010 的 health 401／200 檢查同一個 job）。
  - (3) Node 端 `tsc -b`、`pnpm arch` 能解析 `supabase/functions/**` 對 `@english-coach/*` 的 import → 仍由 T-003 驗證（`pnpm check` 就能跑）。
  - 任一項失敗時的處理不變：停下回報 Architect，修訂本 ADR 後才走備案。
- `supabase/functions/package.json` 的 `@supabase/supabase-js` 依賴已由 Hansheng 核准安裝（幕僚長 2026-11-23 轉達）；版本照決定 1 第 4 點 `^2.119.2` 起算，安裝時用當下最新的 2.x。
- Node 端 `supabase/functions` 的 tsconfig 與 Deno 型別見 ADR-010 決定 3。

## 修訂 2（2026-11-24，Architect；ARCHITECTURE v1.5）
- 狀態：**已接受**（送 G2 PR `[G2] T-006 資料模型（Q-28～Q-30）與架構備忘`，Hansheng Merge 即核准）
- **決定 1 第 4 點補充**：`supabase/config.toml` 的每個 `[functions.<slug>]` 都要設 `import_map = "./functions/deno.json"`（路徑相對於 `supabase/`）。
  - 起因：2026-11-23 驗證 (1) 第一次失敗。Architect 查 CLI 3.2.0 的結果是：它只會讀函式資料夾自己的 `deno.json`、config 的 `import_map`、`--import-map` 參數，或 `functions/import_map.json`，不會自動往上找 `supabase/functions/deno.json`。這是讀原始碼的結論，沒有 A-xxx PoC。
  - 新增函式（例如 T-025 `daily-prep`、`purge-audio`）時一定要加這一行，漏了的話 `@english-coach/*` 會解析失敗。
  - 現在 `[functions.api]` 已經有這一行。
- **驗證狀態（憲章 v5 §9）**：
  - (1) `functions serve` 下 `api` 能 import `@english-coach/contracts` 並執行：**已實測**。CI `db` job 在 PR #25（`task/T-005`，`pull_request` 觸發，2026-11-24 15:30 台北時間，success）的 run：https://github.com/hansheng08/english-coach/actions/runs/45348491671
    - log 有 `MOUNT_OK: packages/contracts appears in the container mount list.`、`SERVE_READY`、health `HTTP 401 (expected 401)`、`HTTP 200 (expected 200)`。
    - 這是 CI `db` job，**不是 A-xxx PoC**；本專案目前沒有對應的 A-xxx PoC run。
  - (2) 打包（deploy）含 contracts：**未驗證**。上述 run 寫的是「以 `functions serve` 的執行成功當作 (2) 的本機等效」，但這不等於真的部署過。依 Hansheng 2026-11-24 08:22 的決定（憲章 v5 §0.1），這項不擋開發，等建立正式免費 Supabase 專案、第一次部署時再實測。失敗就照決定 1 的「備案」處理，處理方式不變：停下回報，Architect 修訂本 ADR 後才執行。
  - (3) Node 端解析：T-003 已驗證（`pnpm check`），本修訂不變。
