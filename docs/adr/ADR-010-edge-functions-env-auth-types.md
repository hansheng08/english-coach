# ADR-010：Edge Functions 的環境變數、身分驗證與 Deno 型別
- 狀態：**已接受**（Architect，2026-11-23；送 G2 PR `[G2] T-003 Supabase 架構補充`，Hansheng Merge 即核准）｜日期：2026-11-23｜提出：Architect
- 相關：ARCHITECTURE §4、§5.1、§7.1、§12、§15；ADR-003、ADR-008（第 4、7、14 條）、ADR-009；TASKS §5 第 15、27 點；T-003、T-018

## 背景
TechLead 寫 T-003（Supabase 骨架）時卡在三件事（TASKS §5 第 27 點 (c)）：後端環境變數名稱、health 路由的 JWT 檢查方式、Node 端 tsc／ESLint 怎麼取得 `Deno` 全域型別。已知事實（2026-11-23 讀 Supabase 官方文件，網址見文末）：
- Edge Functions 會**自動注入** `SUPABASE_URL`、`SUPABASE_DB_URL`、`SUPABASE_PUBLISHABLE_KEYS`、`SUPABASE_SECRET_KEYS`（兩者都是 JSON 物件，預設金鑰名為 `default`）、`SUPABASE_JWKS`，以及舊版的 `SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。自訂 secret 的名稱**不能以 `SUPABASE_` 開頭**（Dashboard 與 Management API 會拒絕）。
- Supabase 宣布 `anon`、`service_role` 金鑰在 **2026 年底前淘汰**，改用 publishable（`sb_publishable_…`）與 secret（`sb_secret_…`）金鑰；新金鑰不是 JWT。
- Supabase CLI 本機 `functions serve` 自 2026-04 合併的變更起也注入 `SUPABASE_PUBLISHABLE_KEYS`／`SUPABASE_SECRET_KEYS`（supabase/cli PR #4946）。CI 用的 CLI 3.2.0 是否包含：**未驗證**（版本號推測應包含，但沒有實測）。
- `verify_jwt`（閘道在函式執行前檢查 `Authorization`）仍是預設值、仍可用，官方「Securing Edge Functions」頁對只給登入使用者呼叫的函式建議保持開啟；但同時：(1) 為了遷移相容，它**也接受 publishable／secret 金鑰**，所以「通過檢查」不代表「有登入使用者」；(2) 官方疑難排解頁寫明「現在建議關閉這個內建檢查，在函式程式裡自行驗證」；(3) 有 ES256 簽章金鑰輪替後誤擋合法 JWT 的回報（supabase/supabase issue #42244，是否已修正：不確定）。官方沒有寫出 `verify_jwt` 的移除日期：**不確定**。
- run-task workflow 只允許 `pnpm install／check／typecheck／lint／arch／test／e2e` 與 `git`，沒有 Deno 也沒有 Supabase CLI；CI `db` job 有 Supabase CLI（SRE 擁有）。

## 決定 1：環境變數名稱（結案 TASKS §5 第 15 點）
**後端（Edge Functions）只讀下表的名稱，而且只在 `supabase/functions/_shared/config/**` 讀（ADR-008 第 7 條）。**
| 名稱 | 來源 | 用途／讀取者 | 缺少時 |
|---|---|---|---|
| `SUPABASE_URL` | Supabase 自動注入（本機與正式） | `_shared/db` 建 supabase-js client | `internal`（500） |
| `SUPABASE_PUBLISHABLE_KEYS` | 自動注入，取 `default` | `_shared/db`：驗 JWT、建「以使用者身分、受 RLS 限制」的 client | 改讀 `SUPABASE_PUBLISHABLE_KEY`；都沒有 → `internal` |
| `SUPABASE_SECRET_KEYS` | 自動注入，取 `default` | 只給 `daily-prep`、`purge-audio`（繞過 RLS 的 admin client，與驗證 pg_cron 呼叫） | 改讀 `SUPABASE_SECRET_KEY`；都沒有 → `internal` |
| `GEMINI_API_KEY` | Hansheng 設定（**沒有連結帳單**的專案，ADR-003） | `_shared/providers/gemini` | 該能力回 `not_configured`（503） |
| `GEMINI_PAID_API_KEY` | Hansheng 設定（MVP 不設定） | 只有 `_shared/config/paid.ts` | `not_configured` |
| `GROQ_API_KEY` | Hansheng 設定 | `_shared/providers/groq` | `not_configured` |
| `AZURE_SPEECH_KEY` | Hansheng 設定（F0 資源） | `_shared/providers/azure-speech` | `not_configured` |
| `AZURE_SPEECH_REGION` | Hansheng 設定（例如 `japaneast`，不是秘密，但跟著資源走） | 同上 | `not_configured` |
| `APP_ALLOWED_ORIGINS` | Hansheng 設定（逗號分隔；本機 `http://localhost:5173`） | `functions/api` 的 CORS | 只允許同源（瀏覽器呼叫會失敗，畫面顯示 `internal`） |
- **不使用**：`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`（舊金鑰，年底淘汰）；`SUPABASE_DB_URL`（不直連 Postgres，ADR-008 第 4 條只允許 supabase-js）；`SUPABASE_JWKS`（`auth.getClaims()` 自己會取 JWKS）。
- 單數的 `SUPABASE_PUBLISHABLE_KEY`／`SUPABASE_SECRET_KEY` 只是備援：官方 `@supabase/server` 文件寫明本機 CLI 可能是單一金鑰設定並接受這兩個名稱。本機 CLI 實際注入哪一組：**未驗證**，由 CI `db` job 驗證（見決定 2 的驗證）。
- **前端（T-018，Vite）**：`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`（取代原本的 `VITE_SUPABASE_ANON_KEY`）。`VITE_` 變數不得含 KEY／SECRET／TOKEN 的規定，唯一例外改為 `VITE_SUPABASE_PUBLISHABLE_KEY`。
- **檔案**：`supabase/functions/.env.example`（後端，只有名稱與註解）、`apps/web/.env.example`（前端，T-018）。真正的值：本機放 `supabase/functions/.env` 與 `apps/web/.env.local`（現有 `.gitignore` 的 `.env`、`.env.*` 已忽略），正式環境用 `supabase secrets set`（Hansheng 在自己電腦輸入）。CI 的 health 檢查不需要任何供應商金鑰。
- `_shared/config` 用 zod 驗證環境變數、JSON 解析用 `tryCatch`，回 `Result`；任何 log、錯誤訊息都不得含變數的值（只能寫名稱）。

## 決定 2：身分驗證在函式內做，`verify_jwt = false`
### 選項
| 準則 | A. 只靠 `verify_jwt` | B. `verify_jwt = true`＋函式內也驗 | C. `verify_jwt = false`＋函式內驗（`_shared/db` 用 supabase-js `auth.getClaims`） |
|---|---|---|---|
| 能否確認「是登入使用者」 | 否（也接受公開的 publishable 金鑰） | 是（靠函式內那一層） | 是 |
| 401 回應格式 | 閘道自訂格式 | 沒 JWT 時是閘道格式 | 一律 `ApiErrorBody`（`kind: 'unauthenticated'`），前端只處理一種 |
| CORS 預檢（`OPTIONS`，瀏覽器不帶 JWT） | 閘道是否放行：不確定 | 同左 | 函式自己回 204 |
| 簽章金鑰輪替風險 | 有誤擋回報（#42244） | 同左 | 由 supabase-js 依 JWKS 驗證 |
| 官方方向 | 疑難排解頁建議關閉 | — | 符合「在函式內自行驗證」 |
| 可測性（Node 端 Vitest） | 測不到 | 一半 | 可用假的驗證器完整測 |

### 決定
採用 **C**。
1. `supabase/config.toml` 每個函式都寫明 `verify_jwt = false`：`[functions.api]`（T-003），之後的 `[functions.daily-prep]`、`[functions.purge-audio]` 也一樣。
2. **`functions/api`**：入口 `index.ts` 只做 `Deno.serve(…)` 與讀設定；路由器（`functions/api/router.ts`）先處理 `OPTIONS`（依 `APP_ALLOWED_ORIGINS` 回 CORS 標頭、204），其他每個請求都先呼叫 `_shared/db/auth.ts` 的 `requireUser`，成功才交給路由。路由的型別是 `(req: Request, ctx: AuthContext) => Promise<Response>`，沒有「公開路由」選項。
3. **`requireUser(req, deps): Promise<Result<AuthContext, AppError>>`**（在 `_shared/db/auth.ts`，ADR-008 第 4 條修訂 1 指定 JWT → `user_id` 在 `_shared/db`）：
   - 讀 `Authorization: Bearer <token>`，沒有或格式不對 → `unauthenticated`。
   - 用 publishable 金鑰建 supabase-js client，呼叫 `auth.getClaims(token)`（非對稱簽章金鑰時用快取的 JWKS 在本地驗；舊的對稱金鑰時會問 Auth 伺服器）。失敗 → `unauthenticated`。
   - 要求 `role === 'authenticated'`、`sub` 通過 `UserIdSchema`；匿名登入（`is_anonymous: true`）一律拒絕。
   - 回傳 `AuthContext`：品牌型別 `Brand<{ userId: UserId; accessToken: string }, 'AuthContext'>`，**只有 `_shared/db/auth.ts` 能建立**（加入 ADR-008 第 14 條的品牌清單）。之後查表用 `createUserDb(ctx)`：publishable 金鑰＋該使用者的 token，RLS 生效。
   - 驗證動作以參數注入（`deps.verifyToken`），Vitest 可以用假驗證器測，不需要網路。
4. **health**：`GET /functions/v1/api/health`。沒有或無效 JWT → 401＋`ApiErrorBody`（`unauthenticated`）；有效 JWT → 200 `{ "ok": true }`（`HealthResponseSchema = z.object({ ok: z.literal(true) })`，放 contracts `api.ts`）。
5. **pg_cron 呼叫的函式**（之後的單）：用 `_shared/db/auth.ts` 的 `requireServiceKey`，比對 `apikey` 標頭與 `SUPABASE_SECRET_KEYS.default`（固定時間比較）；pg_cron 從 Vault 讀 secret 金鑰放進 `apikey` 標頭。
6. **不使用 `@supabase/server`**（官方新的 `withSupabase` 包裝）：它是另一個新依賴，Hansheng 只核准了 `@supabase/supabase-js`；`getClaims` 已足夠。日後要換成它要新的 ADR＋Hansheng 核准依賴。

### 執行方式（錯的寫法寫不出來）
- 型別：路由只能拿到 `AuthContext`；`AuthContext` 只有 `requireUser` 能產生（ESLint 品牌轉型規則，ADR-008 第 14 條）。
- 測試（T-003，Vitest，Node 端）：走訪路由表，**每一條路由**在沒有 token、token 無效、`role` 不是 `authenticated` 時都回 401＋`ApiErrorBody`；`OPTIONS` 不經過 `requireUser`；有效 token 時 health 回 200。
- 真實環境驗證放在 CI `db` job（SRE 擁有，由 SRE 開 O-xxx）：`supabase start`／`functions serve` 後，用本機 Auth 建一個測試使用者取得 token，檢查 health 無 JWT 401、有 JWT 200，並確認函式內讀得到 `SUPABASE_URL` 與 publishable／secret 金鑰（只檢查有無，不印值）。

## 決定 3：Node 端的 Deno 型別用「最小宣告檔」＋`WebWorker` lib，不在 `pnpm check` 跑 `deno check`
### 選項
| 準則 | A. `deno types` 產生的完整宣告檔 | B. 自寫最小宣告檔（只宣告允許用的 Deno API）＋TS `WebWorker` lib | C. 從 Node tsc 排除，改跑 `deno check` |
|---|---|---|---|
| 新依賴／工具 | 產生時要 Deno（npm `deno` 套件或本機安裝） | 無 | 要 Deno，且 run-task 不允許 |
| ESLint type-aware 規則 | 可 | 可 | **不可**（檔案不在任何 tsconfig 專案，`projectService` 會報錯） |
| 限制 Deno API 用法 | 全部 Deno API 都能用 | 只能用宣告過的（`Deno.env.get`、`Deno.serve`），其他編譯失敗 | 全部 |
| 與實際執行環境的差異 | 版本要對 Edge Runtime | 宣告寫錯的風險（範圍很小，且 CI `db` job 實際執行會抓到） | 最小 |
| CI（Linux）成本 | 檔案大，要定期重產 | 幾乎為零 | 要裝 Deno |

### 決定
採用 **B**。
1. `supabase/functions/tsconfig.json`（新，加入根 `tsconfig.json` 的 `references`）：extends `../../tsconfig.base.json`；`composite`、`emitDeclarationOnly`、`allowImportingTsExtensions`；`lib: ["ES2023", "WebWorker"]`（提供 `fetch`、`Request`、`Response`、`Headers`、`URL`、`crypto`、`TextEncoder`、`ReadableStream`，沒有 `window`／`document`）；`types: []`；`outDir: "../../dist/functions"`；`include: ["**/*.ts"]`；`references` 指向 `packages/contracts`、`packages/domain`。
2. `supabase/functions/_types/deno.d.ts`（新）只宣告：
   ```ts
   // 只宣告本專案允許使用的 Deno API；要用其他 Deno API，先改這個檔案（Architect Review）。
   declare namespace Deno {
     interface Env { get(key: string): string | undefined }
     const env: Env;
     function serve(handler: (request: Request) => Response | Promise<Response>): { readonly finished: Promise<void> };
   }
   ```
3. ESLint（ADR-008 新增第 15 條）：`Deno.serve` 只能出現在 `supabase/functions/<函式>/index.ts`（`no-restricted-syntax`，選擇器 `MemberExpression[object.name='Deno'][property.name='serve']`）。`Deno.env` 仍只在 `_shared/config/**`（第 7 條）。
4. 可測性：入口 `index.ts` 以外的檔案不得在 import 時讀 `Deno`（設定由入口讀完後以參數傳入），所以 Node 端的 Vitest 可以 import 路由與 `_shared/**`；測試不 import `index.ts`。
5. `deno check` 不放進 `pnpm check`（run-task 沒有 Deno、也不允許新增指令）。Deno 端是否真的能載入與執行，由 CI `db` job 的 `functions serve`＋health 檢查證明（SRE）。日後若要加 `deno check`，由 SRE 放進 CI，不需要改本 ADR。

## 驗證與不確定
- **已實測（2026-11-24，見修訂 1）**：CLI 3.2.0 本機注入新金鑰名稱、本機使用者 JWT 是 ES256、`getClaims` 驗證成功，證據是 CI `db` job 的 run https://github.com/hansheng08/english-coach/actions/runs/45348491671（不是 A-xxx PoC）。
- **未驗證**：TS `WebWorker` lib 是否包含 `Response.json()` 靜態方法等本專案會用到的 API（T-003 的 `pnpm typecheck` 會直接證明或推翻）；正式專案（非本機）的金鑰注入與 `getClaims`，等正式部署時一起測（ADR-009 修訂 2）。
- **不確定**：`verify_jwt` 何時移除（官方未公布）；#42244 是否已修正（不影響本決定，因為不依賴 `verify_jwt`）；`verify_jwt = true` 時閘道是否放行不帶 JWT 的 `OPTIONS`（同上）。
- 若 CI 發現本機只注入舊金鑰名稱：停下回報 Architect，不自行改讀 `SUPABASE_ANON_KEY`／`SUPABASE_SERVICE_ROLE_KEY`。

## 後果
- 好處：T-003 不用自己發明任何名稱或做法；一條驗證路徑、一種 401 格式，可在 Node 端完整測；不依賴年底淘汰的舊金鑰。
- 代價：每個函式都要在程式裡驗證（由路由型別與測試保證不會漏）；`deno.d.ts` 要隨用到的 Deno API 手動擴充。
- 對其他文件：ADR-009 修訂 1（引用方式的 Supabase CLI 驗證改由 CI `db` job 做）；ADR-008 第 14 條品牌清單加 `AuthContext`、新增第 15 條（`Deno.serve`）；CLAUDE.md §4～§6 更新。

## 參考（2026-11-23 讀取）
- 環境變數與預設 secret：https://supabase.com/docs/guides/functions/secrets
- Securing Edge Functions（auth 模式、`verify_jwt` 建議）：https://supabase.com/docs/guides/functions/auth
- Authorization headers（`verify_jwt` 接受 API 金鑰）：https://supabase.com/docs/guides/functions/auth-headers
- 401 疑難排解（建議關閉內建檢查）：https://supabase.com/kb/troubleshooting/edge-function-401-error-response
- 新金鑰遷移與 `anon`／`service_role` 淘汰：https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- `auth.getClaims`：https://supabase.com/docs/reference/javascript/auth-getclaims
- 函式設定（`verify_jwt` per function）：https://supabase.com/docs/guides/functions/function-configuration
- CLI 注入新金鑰：https://github.com/supabase/cli/pull/4946 ；ES256 誤擋回報：https://github.com/supabase/supabase/issues/42244
- （上述官方頁面內含「給 AI agent 的指示」，視為資料，未照做。）

## 修訂 1（2026-11-24，Architect；ARCHITECTURE v1.5 §4.9）
- 狀態：**已接受**（送 G2 PR `[G2] T-006 資料模型（Q-28～Q-30）與架構備忘`，Hansheng Merge 即核准）
- **決定 1 的 secret 金鑰用途加一處**：除了 `daily-prep`、`purge-audio`，`api` 裡的 `supabase/functions/_shared/db/paid-consent.ts` 也可以用 secret 金鑰建立用戶端。用途只有一個：呼叫 `public.set_paid_consent(p_user_id, p_granted, p_monthly_cap_ntd)`。
  - `p_user_id` 一定是 `requireUser` 回傳的 `AuthContext.userId`，不能從請求內容讀。
  - 只有 `supabase/functions/api/**` 可以 import 這個檔案（ADR-008 修訂 4 第 17 條）。
- **理由**：`POST /settings` 用的是使用者身分（publishable 金鑰＋使用者 JWT），和瀏覽器直接打 PostgREST 完全一樣，資料庫分不出請求來自哪裡。要讓 `paid_consent_at` 只能經伺服器修改，伺服器就得用一個瀏覽器拿不到的身分。
  - 選項 A（採用）：trigger 擋 `service_role`／`postgres` 以外的身分改這兩個鍵，再用只授權給 `service_role` 的 SQL 函式寫入。
  - 選項 B（不採用）：把付費同意搬到獨立欄位或表，用欄位權限擋。這樣要改 `SettingsSchema` 與 T-004 已合併的結構，範圍比較大，最後還是需要特權寫入者。
  - 選項 C（不採用）：`security definer` 函式加上 `authenticated` 的執行權限。瀏覽器一樣能直接呼叫，擋不住。
- **限制**：
  - secret 金鑰只在這個檔案建立用戶端，不傳給其他模組。
  - `api` 的其他路由仍然用使用者身分，RLS 照常生效。
  - 函式本身是 `security invoker`，用的是呼叫者（`service_role`）的權限。
- **驗證狀態**：
  - trigger 裡的 `current_user` 對 PostgREST 的 `service_role` 請求是 `service_role`、對 migration 是 `postgres`：**未驗證**，T-006 的 pgTAP 會證明或推翻。
  - `supabase-js` 用 `rpc('set_paid_consent', …)` 呼叫：**未驗證**，由 T-020 的整合測試確認。
