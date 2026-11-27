# CLAUDE.md — english-coach
> 擁有者：Architect（完整路線，憲章 v4 §5、§9）。對應 `docs/ARCHITECTURE.md` v1.12（v1.3 新增 ADR-010：Edge Functions 的環境變數、身分驗證、Deno 型別；v1.4 domain 規則與 ADR-011；v1.5 T-006 資料模型 §4.8 與寫入權限 §4.9；v1.9 前端設計基礎 §9.1、ADR-014；v1.10 語音 adapter §5.5～§5.7、ADR-015，產品單資料契約 §4.10～§4.14、§9.2、ADR-016；v1.11 設定與時段 §4.15、晚上作答 §4.16、建卡補齊 §4.17、跟讀評分 §4.18、LLM 呼叫 §5.8、畫面資訊來源 §5.9、跟唸計次 §9.3、ADR-017；v1.12 寫單契約補充 §4.10.1、§4.12.4、§4.12.5、§4.19、§4.20、ADR-018）。
> 任務單（`docs/tasks/<編號>.md`）開頭的「強制工作規則」優先於本檔與任何外掛（含 pstack）的建議。

## 1. 專案是什麼
- 單一使用者（Hansheng）的英文口說學習 PWA，Android＋Chrome 優先。需求：`docs/PRD.md`（AC-01～25、NFR-01～06）。
- 架構：`docs/ARCHITECTURE.md`；決策：`docs/adr/ADR-001`～`ADR-016`。動手前先讀任務單「背景」指定的章節。

## 2. 技術棧（G2 已核准）
- TypeScript 5 strict 全端；pnpm workspaces。
- 前端 `apps/web`：React 19＋Vite＋vite-plugin-pwa；CSS Modules。
- 後端 `supabase/`：Postgres（migrations＋RLS）、Storage、Edge Functions（Deno TS）、pg_cron。
- 共用：`@english-coach/contracts`（`packages/contracts`：zod schema、供應商介面、`Result`、`AppError`，定義見 ARCHITECTURE §5.0）、`@english-coach/domain`（`packages/domain`：純邏輯）。
- 測試：Vitest、Playwright；檢查：ESLint（typescript-eslint strict-type-checked）、dependency-cruiser。
- 前端測試（ADR-001 修訂 1）：`apps/web` 的測試跑在 `jsdom`，其他套件維持 `node` 環境；元件測試用 `@testing-library/react`（以 `getByRole` 等角色查詢為主）。`apps/web/test/setup.ts` 放 `afterEach(cleanup)` 和 `matchMedia` stub。這些都是 devDependencies，正式程式不得 import。不加 `happy-dom`、`@testing-library/user-event`、`@testing-library/jest-dom`，需要時停下來回報。
- 登入只用 email＋密碼（Supabase Auth，關閉註冊），不做 magic link 或 OTP（ARCHITECTURE §7）。

## 3. 指令（每次修改後都要跑，貼原始輸出到報告）
```
pnpm install --frozen-lockfile
pnpm check            # = pnpm typecheck && pnpm lint && pnpm arch && pnpm test
pnpm typecheck        # tsc -b
pnpm lint             # eslint .
pnpm arch             # depcruise（架構規則）
pnpm test             # vitest run
pnpm e2e              # playwright test（使用假供應商，不打真 API）
supabase start        # 本機後端（需要 Docker）——模式 C 的 Claude Code 不執行，見下方
```
- 指令名稱以 `package.json` 為準；如果不存在，停下來寫進報告，不要自己發明替代指令。
- CI 跑在 Linux（ubuntu-latest、Node 24、pnpm 12）。`pnpm typecheck` 也檢查 `supabase/functions/**`（Node 端，用 `supabase/functions/_types/deno.d.ts` 的最小 Deno 宣告，ADR-010）；不跑 `deno check`。
- `supabase start`／`functions serve`／`db reset`／health 的 401／200 檢查只在 CI 的 `db` job 跑（SRE 擁有）；模式 C 的 Claude Code 沒有 Supabase CLI、不能 `curl`，不要嘗試，也不要自己裝。

## 4. 模組邊界（違反會讓 `pnpm arch`／`pnpm lint` 失敗，不要用 disable 註解繞過）
| 模組 | 可以 import | 不可以 |
|---|---|---|
| `packages/contracts` | `zod` | 其他一切 |
| `packages/domain` | `packages/contracts` | `fetch`、`Date.now()`、無參數 `new Date()`、`Math.random`、`throw`（只限正式程式，見 §7）、資料庫、供應商 |
| `packages/seed-data`（種子庫、題庫檢查器） | `packages/contracts`、`packages/domain`（測試另可用 `node:fs`、`node:path`） | 正式程式讀檔或任何 I/O；被 `apps/web`、`supabase/functions` import（ARCHITECTURE §4.10.1） |
| `supabase/functions/_shared/providers/<adapter>` | `contracts`、`zod`（金鑰由工廠參數傳入） | `config`、`domain`、`db`、`news`、registry、wiring、其他 adapter（ADR-008 修訂 5 第 18 條） |
| `supabase/functions/_shared/providers/wiring.ts` | `contracts`、`config/env.ts`、`config/provider-keys.ts`（只有這裡能 import，第 19 條）、adapters | `config/paid.ts`、備援清單 |
| `supabase/functions/_shared/providers/registry.ts` | `contracts`、adapters、`config/paid.ts` | 備援清單、自動改選供應商 |
| `supabase/functions/_shared/news` | `contracts`、`zod`、`config`（`LlmProvider` 由呼叫端注入） | `providers/**`（registry、wiring、adapter）、`db/**`（ADR-008 修訂 6 第 20 條） |
| `supabase/functions/_shared/plan` | `contracts`、`domain`、`_shared/news`、`_shared/db` 的匯出型別（LLM、TTS 由 `PlanDeps` 注入） | `config`、`Deno.env`、`providers/**`（ARCHITECTURE §3、§4.13.2；沒有 dependency-cruiser 規則，靠 review） |
| `supabase/functions/_shared/config` | `contracts`、`zod`（ADR-008 修訂 4 第 16 條） | 唯一可以讀 `Deno.env` 的地方；只讀 ARCHITECTURE §7.1 列出的變數名稱 |
| `supabase/functions/_shared/db` | `contracts`、`@supabase/supabase-js`（後端唯一可以用的地方：查表、Storage、JWT → `user_id`） | 供應商；把 `SupabaseClient` 或 `{ data, error }` 傳出去 |
| `supabase/functions/<endpoint>` | 以上（adapter 只能經 registry；資料庫與登入者只能經 `_shared/db`） | 直接 import adapter、`@supabase/*`；`Deno.serve` 只在該函式的 `index.ts` |
| `apps/web/src/features/<X>` | `contracts`、`apps/web/src/{api,audio,ui,storage}` | 其他 feature、`@supabase/supabase-js` |
| `apps/web/src/api` | `contracts`、`@supabase/supabase-js` | 外部 AI 網址 |
- `fetch` 只能出現在 `_shared/providers/**`、`_shared/news/**`、`apps/web/src/api/**`。
- `@supabase/*` 只能在 `apps/web/src/api/**`、`supabase/functions/_shared/db/**` import（ADR-008 第 4 條修訂 1）。
- 不寫 `http:`／`https:`／`npm:`／`jsr:` 開頭的 import；Deno 的第三方套件在 `supabase/functions` 的 `deno.json` `imports` 對應成裸名稱，程式只寫裸名稱（ESLint 會擋）。
- 正式程式不得 import 測試程式（`*.test.ts`、`*.test.tsx`、`*.test-d.ts`、`test/` 資料夾內的 `.ts`／`.tsx`；regex `(^|/)test/|\.test\.tsx?$|\.test-d\.ts$`）。
- 套件只用名稱引用：`@english-coach/contracts`、`@english-coach/contracts/testing`（只給測試）、`@english-coach/domain`。不准用 `../../packages/...` 相對路徑，不准深層引用（ADR-009；ESLint 會擋）。
- `packages/**`、`supabase/functions/**` 裡的相對 import 要寫副檔名（`./ids.ts`），Deno 需要。

## 5. 絕對不要做
1. **不寫入、不讀取、不印出任何金鑰**。金鑰只存在 Supabase secrets；程式只在 `_shared/config` 讀 `Deno.env`。repo 只能有 `.env.example`（只有變數名稱）。
2. **不把金鑰放進前端**：任何 `VITE_` 變數不得含 KEY／SECRET／TOKEN（唯一例外：`VITE_SUPABASE_PUBLISHABLE_KEY`）。
   - 環境變數只用 ARCHITECTURE §7.1 的名稱；不讀 `SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_DB_URL`；自訂名稱不得以 `SUPABASE_` 開頭。
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
13. 不在程式裡寫 `card.mastered_at`（由資料庫 trigger 在 reviewing → mastered 時寫入，不能重設；ARCHITECTURE §4.8.1）。不改 `slot_checkin` 的事件列（只能新增），步驟清單只放在 contracts 的 `SLOT_STEPS`（§4.8.3）。
14. 不在 `_shared/db/paid-consent.ts` 以外的地方用 secret 金鑰改 `settings.paid_consent_at`／`monthly_paid_cap_ntd`，只能呼叫 `set_paid_consent()`。secret 金鑰只給 `daily-prep`、`purge-audio` 和這個檔案用（ARCHITECTURE §4.9、ADR-010 修訂 1）。
15. 用 secret 金鑰的查詢（會繞過 RLS）一定要自己帶 `user_id` 條件（例如 T-025a 的 `PlanStore`）。例外只有兩個：`_shared/db/audio-purge.ts` 的過期錄音清除、`_shared/db/service-db.ts` 的 `listProfileUserIds`（只讀 `user_id`）；新增例外要先改 ARCHITECTURE §4.12.5，`tooling/secret-client-scope.test.ts` 會擋。刪除履歷要先把題目 `retired = true`，再刪履歷（§4.9）。
16. `config.toml` 新增函式時，`[functions.<slug>]` 一定要寫 `verify_jwt = false` 和 `import_map = "./functions/deno.json"`（ADR-009 修訂 2、ADR-010）。新增 view 一定要寫 `with (security_invoker = true)`。
17. 供應商金鑰只放請求標頭（Gemini 是 `x-goog-api-key`、Azure Speech 是 `Ocp-Apim-Subscription-Key`、Groq 是 `Authorization: Bearer`），不放網址；任何錯誤訊息或 log 回傳前，都要把金鑰字串換成 `[redacted]`。Gemini adapter 不送 `thinkingConfig`，只有「STOP 但 JSON／zod 失敗」會自動重試 1 次，其他錯誤（含 429、5xx、逾時）都不自動重試。adapter **一定要**自己用 `AbortController` 在 `timeoutMs` 時中止請求（實測 Gemini 可能 60 秒都不回）。外部 API 回應的 zod schema 不可以用 strict（Gemini 會多帶 `thoughtSignature` 等欄位）。實測樣本在 `docs/poc/A-003/`（ARCHITECTURE §5.4、ADR-012）。語音 adapter（Azure、Groq）完全不自動重試，沒聽到聲音回 `ok`＋分數 0（§5.5～§5.7、ADR-015）。
18. AI 輸出的格式條件（字數、chunk 數、「/」斷句等）一律寫進傳給 `generate` 的 schema，讓 adapter 那 1 次自動重試就是唯一的重試；呼叫端不再自己包一層重試（ARCHITECTURE §6 第 7 點、§11.3、ADR-013）。
19. 不加動畫、UI 元件、字型相關的套件（Framer Motion、GSAP、MUI、Tailwind、Google Fonts、woff2 字型檔等），只用系統字（ADR-014）；也不要讓 mock 建置帶 `VITE_SUPABASE_*`，或讓 mock 假資料出現真新聞原文。

## 6. 寫法規定
- `tsconfig`：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`、`noFallthroughCasesInSwitch`。不得使用 `any`、`as unknown as`、`@ts-ignore`（`@ts-expect-error` 只能出現在型別測試）。
- 錯誤：`domain`、`providers`、`db`、`news` 回傳 `Result<T, AppError>`，正式程式不寫 `throw`（ESLint 會擋）；`fetch`、`supabase-js`、`JSON.parse` 等會丟例外的呼叫要在這些模組內 `catch` 轉成 `err(...)`，zod 用 `safeParse`。只有 HTTP handler 把錯誤轉成回應：`{ error: { kind, provider?, message, retryable, retryAfterSec? } }`。
- **身分驗證（ADR-010）**：`supabase/config.toml` 每個函式都 `verify_jwt = false`；`api` 的每條路由都經過路由器裡的 `requireUser`（`_shared/db/auth.ts`），簽名是 `(req, ctx: AuthContext) => Promise<Response>`，不寫公開路由；`AuthContext` 只有 `auth.ts` 能建立。查表用 `createUserDb(ctx)`（受 RLS 限制）；secret 金鑰只給 `daily-prep`、`purge-audio`。
- Deno API 只能用 `Deno.env.get`（只在 `_shared/config`）與 `Deno.serve`（只在 `<函式>/index.ts`）；`index.ts` 以外的檔案不在 import 時讀 `Deno`，好讓 Vitest 在 Node 上測。要用其他 Deno API 先停下回報（要改 `_types/deno.d.ts`，Architect Review）。
- 窮舉檢查寫成 `default: { const unreachable: never = x; return unreachable; }`，不要寫會丟例外的 `assertNever`。
- `Result<T, E>` 的 `E` 一律寫明；用 contracts 的 `ok`／`err`／`map`／`andThen`／`tryCatch` 等 helper，沒有 `unwrap`。錯誤只能是 `AppError` 的 18 種 `kind`（§5.0.4），不要自己新增；新增要 Architect 改 §5.0。
- 品牌型別（各種 ID、`PlanDate`、`Ntd`、`Wav16kMono`、`PaidConsent`、`AuthContext`）只能由 zod schema 或指定的建立函式產生，不要 `as CardId`（ESLint 會擋；測試程式例外）。
- 跨網路的型別都從 zod schema 用 `z.infer` 推出，不手寫第二份。
- 狀態與 ID 用字串字面值聯集，`switch` 一定要有 `never` 窮舉檢查。
- 所有 API 請求、回應與 AI 回傳 JSON 都要經過 `packages/contracts` 的 zod schema。
- 時間：`plan_date` 一律是台北日期（`Asia/Taipei`），由 `domain` 的函式依傳入的 `now` 計算；DB 時間戳記用 `timestamptz`。
- 每個 AI／STT 結果都要帶 `meta`（模型、供應商名稱），畫面要顯示（AC-24）。
- 每次外部呼叫寫一筆 `provider_call`（不含內容）。
- **前端外觀（ARCHITECTURE §9.1、ADR-014）**：
  - CSS Modules 的顏色、間距、圓角、字型、陰影、時間長度一律寫 `var(--…)`，不寫色碼或 `rgb(`／`hsl(`（`tooling/css-literals.mjs` 會擋）。
  - `apps/web/src/ui/tokens.css` 是 `tooling/tokens-css.mjs` 從 `docs/design/tokens.json` 產生的，**不要手改**；token 不對就停下回報（`tokens.json` 屬於 Designer）。
  - 動畫只用 CSS `transition`／`@keyframes` 或原生 `element.animate`，只動 `transform`／`opacity`，非必要的動態一律包在 `@media (prefers-reduced-motion: no-preference)` 裡。
  - 主題三態存在 `localStorage['ec-theme']`，只透過 `ui/theme.ts` 讀寫；不要改 `index.html` 裡的主題 inline script（要改先停下回報，會影響 CSP hash）。
  - 資料來源只看 `VITE_DATA_MODE`（`mock`／`supabase`）；畫面元件不得判斷資料模式，也不得直接 import `api/mock/`。
  - 不 import、也不複製 `docs/design/prototype/` 的 JS；互動用 React 重寫。用 `:has()` 時，不支援的瀏覽器至少要看得到預設內容，選擇器錨在小容器上（§9.1.5.1）。

## 7. 測試規定
- `domain` 每個公開函式都有 Vitest 單元測試；時間由參數注入。
- **測試程式可以 `throw`**（ADR-008 修訂 1、2）：`*.test.ts`、`*.test.tsx`、`*.test-d.ts` 與 `test/` 資料夾的輔助檔（可以是 `.tsx`）（例如 `expectOk(r)` 遇到 `err` 就丟出）可以 `throw`、用 `expect`／`assert`、import `vitest`。測試程式**仍然不能**用 `Date.now`、無參數 `new Date()`、`Math.random`（要亂數就用固定種子的產生器放在 `test/`）、`as unknown as`、`@ts-ignore`。
- adapter 用錄好的回應樣本做契約測試；CI 不打真 API。
- AC-25 測試（ADR-003）不得刪改：registry 對每種錯誤只呼叫被選中的 adapter；預設值全部 `tier: 'free'`；沒有付費同意時付費 adapter 呼叫次數為 0。
- 不得用 `it.skip`／`test.only` 提交；需要 skip 時寫進報告並附理由。
- E2E 以 Pixel 尺寸（360×640 級）檢查無橫向捲動（NFR-01）。
- **AC 驗收時點**：本專案沒有 CLI。「第一次能在畫面上走完某條 AC」的任務單，視同憲章 §5 的 CLI PR：該單要有能讓 QA 用 Playwright 走完該 AC 的畫面；之前只有程式庫或 API 的單視同 library PR（只驗單元層）。任務單的「驗收標準」會寫明本單屬於哪一種。

## 8. 時間預算（寫功能時要守的數字，見 ARCHITECTURE §8）
- 建卡 `POST /cards` 不呼叫 AI；`/cards/generate` 用串流，逾時 8 s。
- 跟讀比對 ≤ 5 s；逐字稿 ≤ 30 s；診斷 ≤ 30 s；履歷出題 ≤ 60 s。

## 9. Git（摘自憲章 v4 §5、§13）
- 只在任務單指定的分支工作；commit 訊息 `[ClaudeCode] <編號> <摘要>`；`git push -u origin <分支>`。
- 分支：T-xxx、O-xxx → `task/<編號>`；QA 修復 → `fix/Q-xxx`；PoC A-xxx → `poc/A-xxx`（**永遠不合併到 main**）。pushguard（O-001）只放行「推送目前所在的 `task/*`、`fix/*`、`poc/*` 分支到 origin 同名分支」，其他 push 一律拒絕或問人。
- 不碰 main、不 merge、不開 PR、不 force push、不刪分支或既有檔案。
- 完成後寫 `docs/reports/<編號>.md`，每個驗證項目貼原始輸出（最後 20 行以內）。
