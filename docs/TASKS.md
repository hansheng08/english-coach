# TASKS：english-coach 任務清單
- 版本：**v1.7（O-002 完成，PR #12）**｜日期：2026-11-23｜擁有者：TechLead｜路線：完整（憲章 v4 §2；交棒模式 C）
- 輸入：`docs/PRD.md` **v1.1 定稿**（`354e489`）、`docs/ARCHITECTURE.md` **v1.2.1**（`d1816c9`）＋ADR-001～009（全部已接受；ADR-008 修訂 1、2）＋`CLAUDE.md`（`8c59a70`）、`docs/OPEN_QUESTIONS.md`（Q-14～Q-20 已於 2026-11-22 18:46 G2 決定）
- G2 已通過，可以開始派單；派單前仍要先完成第 0 節的前置條件。第一張是 O-001（`docs/tasks/O-001.md`）。
- 本清單只排順序、範圍和驗收方式；每張單的細節在派工時才寫成 `docs/tasks/<編號>.md`（憲章 §0、§13）。

> 名詞
> - **依賴**：這張單開始前，哪些單必須已經合併進 main。
> - **關鍵路徑**：依賴鏈中最長的一條；這條上任何一張延誤，整個專案就延誤。
> - **library 層／E2E 層**：G2 已核准（ARCHITECTURE §15、CLAUDE.md §7）：「第一次能在畫面上走完該 AC」的單視同憲章 §5 的 CLI PR（QA 用 Playwright 寫並執行 Q-xxx）；之前只有程式庫或 API 的單視同 library PR（QA 只驗單元層）。

## 0. 開工前置條件（不是任務單）
| # | 項目 | 誰 | 確認方式 | 擋住哪張單 |
|---|---|---|---|---|
| 1 | G2 通過 | Hansheng | 已完成（2026-11-22 18:46） | — |
| 2 | Cursor GitHub App 授權本 repo（私有 repo） | Hansheng | 已完成：2026-11-22 Bot 讀得到 Actions（`gh run list`、`gh run view`） | O-001 的 G3 審查（TechLead 要讀得到 CI） |
| 3 | Hansheng 電腦已裝 pstack、Node.js ≥ 22（建議用當下的 LTS；pushguard 用）、Claude Code ≥ v2.1.295（`onFailure` 需要） | Hansheng | `/pstack:poteto-mode` 可執行；`node --version`、`claude --version` | O-001 |
| 4 | O-001 的 PR 跑出 `ci-ok` 後，立即設 main 分支保護（必須走 PR、`ci-ok` 必過、禁止 force push、禁止刪 main） | Hansheng | **已決定維持現狀**（Hansheng，21:21）：GitHub 端實際不檢查，只靠 pushguard＋權限規則；見 §5 第 14 點 | T-001 |
| 5 | 開好 Supabase、Gemini（**沒有連結帳單**的專案）、Groq（免費）、Azure Speech F0 帳號，金鑰由 Hansheng 用 `supabase secrets set` 自己輸入（Q-20） | Hansheng | 真 API smoke 測試能跑 | A-001、A-002 與真 API smoke 測；CI 與一般任務單只用假供應商，不受影響 |

## 1. 共通規則（每張單都適用）
- 分支：T-xxx、O-xxx → `task/<編號>`；QA 修復 → `fix/Q-xxx`；A-xxx → `poc/A-xxx`（永遠不合併）；修正輪次沿用原分支（憲章 §5、CLAUDE.md §9）。
- 共通驗收（每張 T 單都要，驗收方式欄只列額外項目）：`pnpm install --frozen-lockfile`、`pnpm check`（= typecheck＋lint＋arch＋test）全過，且 PR 觸發的 CI run `ci-ok` 綠燈；被略過的 job 在 G3 逐一列出。
- 外部供應商在 CI 一律用假供應商或錄好的回應樣本（CLAUDE.md §7）；時間預算（3 s／5 s／30 s／60 s）在 CI 以假供應商驗「逾時設定與流程」，真實延遲只在 A-xxx 或手動 smoke 測。
- 複習間隔與新聞輪替不得寫死在程式裡，一律從 `settings.srs`／`settings.news` 讀，預設值只放在 `packages/contracts` 的 schema（CLAUDE.md §5 第 11 條）。
- 狀態：`待辦`／`進行中`／`Review`／`QA`／`完成`；A-xxx 另有「未決定是否開」。

## 2. G2 決定（取代 v0.1 的假設；來源：OPEN_QUESTIONS「G2 決定」、ARCHITECTURE v1.0）
| Q | 決定 | 和 v0.1 假設相比 | 受影響的單 |
|---|---|---|---|
| Q-14 | AC-03 維持 3 s（建卡不等 AI；反白查詢 p95 不保證）；AC-10 為「3 s 內顯示核心 chunk 並可播放發音；8 s 內（p95）補齊例句與 ≥ 2 個同義替換」。PRD 文字由 PM 依變更路線更新 | 相同 | T-027、T-034、A-001 |
| Q-15 | 接受把去個資的履歷文字、逐字稿送 Gemini 免費層；錄音不送 Gemini | 相同 | T-015、T-023、T-035、T-036、T-038 |
| Q-16 | **與 v0.1 假設不同**：新聞分 AI、軟體工程、半導體產業三類，每天輪到一類；該類沒新聞就換下一類，三類都沒有才用最近一篇未讀文章並註明。來源每類 1 主 2 備（ARCHITECTURE §11.1）；不用學術來源（撤下 IEEE Spectrum、NIST） | 改了 | T-005、T-020、T-022、T-023、T-025、T-026、新增 T-049 |
| Q-17 | 秒答與猶豫都算答對（累計 2 次進 Reviewing）；Reviewing 時猶豫留在同一階 | 相同 | T-008、T-009、T-032 |
| Q-18 | **與 v0.1 假設不同**：預設 3／7／14、之後 14、忘記後 1 天，但**全部可在設定頁調整**（`settings.srs`，驗證規則見 ARCHITECTURE §4.2）；改設定只影響之後的排程 | 改了 | T-004、T-008、T-009、T-020、T-032 |
| Q-19 | 接受 Supabase 免費方案（7 天無活動會暫停，回來手動恢復） | 相同 | T-003 起所有後端單、T-025、T-046 |
| Q-20 | 同意開帳號、金鑰由 Hansheng 自己存；Whisper 贅詞保留程度**在 PoC 實測**，不足時手動改用 Gemini Transcribe | 相同；PoC 已決定要做 → A-002 改為待辦 | T-012、T-015～T-017、T-030、T-037、T-038、A-002 |
| Q-10（G2 補充） | 種子庫由**獨立任務單**產生：6 批 × 100 條，第 1 批完成後 Hansheng 抽查 20 條，通過才做第 2～6 批；匯入程式與內容產生分開（ARCHITECTURE §4 `seed_chunk`） | 新增 | T-024、新增 T-050 |

## 3. 任務清單（依依賴順序）
| 編號 | 標題 | 依賴 | AC／NFR | 相關 Q | 驗收方式（共通驗收以外） | QA | 狀態 | 分支 | PR |
|---|---|---|---|---|---|---|---|---|---|
| O-001 | CI workflow（彙總 job `ci-ok`）＋`.claude/settings.json`＋pushguard hook（只放行推目前的 `task/*`、`fix/*`、`poc/*`；擋推 main、合併、開 PR）＋秘密掃描；決定 CI 範圍 | 前置 1、3 | NFR-05 | — | 見 `docs/tasks/O-001.md`（AC-O1-1～AC-O1-10） | 免 QA（CI／`.claude/` 設定） | 完成（2026-11-22 20:40 合併） | task/O-001 | [#1](https://github.com/hansheng08/english-coach/pull/1) |
| O-002 | 修正模式 C 推分支後 CI 不重跑，並上傳 Claude 執行紀錄 | O-001 | NFR-05 | — | 見 `docs/tasks/O-002.md`（AC-O2-1～AC-O2-7） | 免 QA（只改 CI workflow 與 `docs/RUNBOOK.md`） | 完成（2026-11-23 23:17 合併） | task/O-002 | [#12](https://github.com/hansheng08/english-coach/pull/12) |
| T-001 | monorepo 骨架：`package.json`（`packageManager`、`typecheck`／`lint`／`arch`／`test`／`check` 指令）、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.base.json`＋根 `tsconfig.json`、`eslint.config.js`（ADR-008 規則 7～9）、`.dependency-cruiser.cjs`（ADR-008 規則 1～6、10）、`.gitignore`；`tooling/` 下的規則測試與測試用範例 | O-001、前置 4 | NFR-05（基礎） | — | `pnpm check` 全過；`tooling/` 的單元測試證明每條架構規則真的會擋（違規範例被擋、合法範例不擋）；CI 的 `check` job 第一次實際執行並成功；見 `docs/tasks/T-001.md`（AC-T1-1～AC-T1-11） | 免 QA（無產品程式） | 完成（2026-11-22 21:29 合併） | task/T-001 | [#2](https://github.com/hansheng08/english-coach/pull/2) |
| T-002 | **（v1.2 改範圍）** ADR-008 修訂 1 的規則（ESLint、dependency-cruiser、規則測試與範例：`@supabase/*` 兩個出入口、禁 `http:`／`https:`／`npm:`／`jsr:` import、正式程式不得 `throw`／測試可以、正式程式不得 import 測試、domain／contracts 測試只能 import 自己＋`contracts`＋`vitest`）；ESLint 涵蓋 `.tsx`；`globalThis`／`window`／`self` 的 `fetch` 也擋；`engines.node` 改為 `^22.13.0 \|\| ^24.0.0 \|\| >=26.0.0`；`packages/contracts` 骨架（只含 ARCHITECTURE §5.2 已逐字定義的 `Tier`、`Capability`、`ProviderErrorKind`） | T-001 | NFR-05（ADR-008 修訂 1） | — | `pnpm check` 全過；每條新規則在 `tooling/` 測試各有違規與合法範例；突變測試；`packages/contracts` 的型別測試 import `vitest` 而 `pnpm arch` 不報錯；見 `docs/tasks/T-002.md`（AC-T2-1～AC-T2-12） | 免 QA（沒有執行期行為：工具規則＋純型別） | 完成（2026-11-22 22:01 合併） | task/T-002 | [#3](https://github.com/hansheng08/english-coach/pull/3) |
| T-051 | **（v1.3 依 ARCH-003 定案）** `@english-coach/contracts` 共用型別（ARCHITECTURE v1.2 §5.0 逐字）：`Brand`、`Result`＋helper、`ValidationError`、品牌 ID／`PlanDate`／`StoragePath`／`Ntd`、`NewsCategory`、`ProviderId`／`LlmModelId`／`SttModelId`／`VoiceId`、`ProviderError`／`AppError`（18 種 `kind`）＋`httpStatusOf`／`isRetryable`／`toApiErrorBody`／`ApiErrorBodySchema`、`Wav16kMono`＋`parseWav16kMono`、`AudioPayload`、`WordTiming`／`Transcript`／`PronunciationResult`、`StreamChunk`、`CardStreamEventSchema`、四種供應商介面、`PaidConsent`；`test/index.ts`（`expectOk`／`expectErr`，`/testing` 入口）；`packages/contracts/package.json`（ADR-009：名稱、`exports`、**`zod` `^4.6.7`**——`pnpm add` 會改 lockfile，**要 Hansheng 先核准**）；`packages/domain` 套件骨架（`package.json`、`tsconfig.json`、空的 `src/index.ts`，讓 T-008、T-011～T-013、T-049 可以平行）；contracts／domain 的 `tsconfig` 加 `allowImportingTsExtensions`＋`emitDeclarationOnly`、`rootDir` 涵蓋 `src/` 與 `test/`；相對 import 一律寫 `.ts`（含 T-002 的 `index.ts`）；ADR-008 修訂 2：新測試檔 regex `(^\|/)test/\|\.test\.tsx?$\|\.test-d\.ts$`、第 12 條（只用套件名稱、三個入口）、第 13 條（`packages/**`、`supabase/functions/**` 相對 import 寫副檔名）、第 14 條（品牌型別的 `as` 只在指定檔案與測試） | T-002（已合併）；ARCH-003（`8c59a70`）＋v1.2.1（`d1816c9`） | AC-24、AC-25（型別） | — | `pnpm check` 全過；ARCHITECTURE §5.0.7 指定的型別測試（`expectTypeOf`、`@ts-expect-error` 只在 `*.test-d.ts`）；`httpStatusOf` 對 18 種 `kind` 都照錯誤碼對照表；`parseWav16kMono` 的 4 種拒絕情況；每條新規則有違規／合法範例；突變測試；見 `docs/tasks/T-051.md`（AC-T51-1～AC-T51-14） | library（有執行期函式：`Result` helper、`httpStatusOf`、`isRetryable`、`parseWav16kMono` 等，QA 驗單元層） | 完成（2026-11-23 19:11 合併） | task/T-051 | [#4](https://github.com/hansheng08/english-coach/pull/4) |
| T-003 | Supabase 骨架：`supabase/config.toml`、`functions/api` 單一路由（health＋JWT 檢查）、`_shared/config`（唯一讀 `Deno.env`）、後端用的 `.env.example`（只有變數名稱，名稱見 §5 第 15 點）；**讓 CI 的 `db` job 開始執行**；`supabase/functions/package.json`（`@english-coach/functions`，ADR-009）＋`pnpm-workspace.yaml` 加 `supabase/functions`＋`supabase/functions/deno.json`（`imports` 照 ADR-009 決定 1 第 4 點）；**ADR-009 的三項驗證**：(1) `supabase functions serve` 下 `api` 能 import `@english-coach/contracts` 並執行；(2) `supabase functions deploy --dry-run`（或等效打包）成功且含 contracts；(3) `pnpm install` 後 `tsc -b`、`pnpm arch` 能解析 `supabase/functions/**` 對 `@english-coach/*` 的 import（模組數 > 0、沒有 `couldNotResolve`）。任一項失敗就停下回報，由 Architect 修訂 ADR-009 後才走備案，不自行搬目錄 | T-051 | NFR-05、AC-23（基礎） | Q-19 | `supabase start`；`supabase functions serve` 後 `curl` health：無 JWT 回 401、有 JWT 回 200；ADR-009 三項驗證的原始輸出（任一項失敗就停下回報，不自行搬目錄） | library | 待辦（**任務單暫緩**：模式 C 的 Claude Code 跑不了 supabase CLI／curl、要裝 `@supabase/supabase-js`、架構有 3 處不確定；見 §5 第 27 點） | task/T-003 |  |
| T-004 | migration 1：`profile`（含 `settings.srs`／`settings.news` 的 jsonb 欄位）、`card`（`interval_step` 0～4）、`card_review`（含 `interval_days_applied`）、`seed_chunk`（含 `batch` 1～6）＋RLS | T-003 | AC-09、AC-19、AC-24（資料） | Q-18、Q-19 | `supabase db reset` 成功；`supabase test db`：A 使用者讀不到 B 的資料 | library | 待辦 | task/T-004 | |
| T-005 | migration 2：`news_source`（`category`、`priority`、`fetch_mode`、`include_url_pattern`、`terms_checked_at`）、`news_article`（含 `category`，不存原文全文）、`daily_plan`（含 `planned_category`、`actual_category`、`category_skipped`）、`resume`、`question`＋RLS | T-004 | AC-01、AC-02、AC-11 | Q-16、Q-19 | 同 T-004；`news_article` 沒有原文全文欄位 | library | 待辦 | task/T-005 | |
| T-006 | migration 3：`shadow_attempt`、`evening_answer`、`slot_checkin`、`provider_call`、`weekly_metric` view＋RLS；錄音欄位 `audio_expires_at` | T-005 | AC-06、AC-14、AC-21、AC-22 | Q-19 | 同 T-004；`weekly_metric` 以測試資料查出預期值 | library | 待辦 | task/T-006 | |
| T-007 | `_shared/db` repository 基礎（回 `Result`）＋`provider_call` 寫入（不含內容） | T-006 | AC-24（紀錄）、NFR-04 | Q-19 | 本機 DB 整合測試；`pnpm arch` 確認 db 不 import 供應商 | library | 待辦 | task/T-007 | |
| T-008 | `contracts` 的 `SrsSettingsSchema`（預設 3／7／14、14、1）＋`domain`：台北日期計算（檔案固定為 `packages/domain/src/taipei-date.ts`，是唯一可以 `as PlanDate` 的正式程式檔，ADR-008 修訂 2 第 14 條）＋SRS 間隔（天數由參數傳入，不寫死） | T-051 | AC-09 | Q-17、Q-18 | 單元測試：schema 邊界（0、366、非遞增、`after_last_days` < `step_days[2]`、`forgot_days` > `step_days[0]` 都被擋）；任意合法設定下「猶豫的間隔 ≤ 秒答的間隔」（性質測試）；跨台北午夜邊界；程式內沒有 3／7／14 常數（只在 schema 預設）；見 `docs/tasks/T-008.md`（AC-T8-1～AC-T8-8） | library | 派工中（2026-11-23，模式 C） | task/T-008 |  |
| T-009 | `domain`：字卡狀態機 Collected→Learning→Reviewing（第 1～3 階、之後 `after_last`）→Mastered；Reviewing 忘記退回 Learning | T-008 | AC-19、AC-20 | Q-17、Q-18 | 狀態轉換表逐列測試（含猶豫留同階）；`switch` 有 `never` 窮舉；見 `docs/tasks/T-009.md`（AC-T9-1～5，暫定） | library | 不確定（任務單 v1.0 已寫、未派工；見 §5 第 28 點） | task/T-009 | |
| T-010 | `domain/plan`：每日 25 張選卡（15 舊＋10 新、不足補齊、升級語塊優先）、今晚題目、跟讀 5 句選句 | T-009 | AC-05、AC-07、AC-13、AC-16 | — | 單元測試：第一週舊卡不足、新卡不足用種子庫、前晚無作答全用新聞句；見 `docs/tasks/T-010.md`（AC-T10-1～6，暫定） | library | 不確定（任務單 v1.0 已寫、未派工；見 §5 第 28 點） | task/T-010 | |
| T-011 | `domain/shadowing`：逐字比對正確率、語速比、解鎖判斷（≥ 80%／≥ 70%）、遮住約一半字詞 | T-051 | AC-05、AC-06 | — | 單元測試含門檻邊界（79.9%／80%、69.9%／70%）；發音分數不影響解鎖；見 `docs/tasks/T-011.md`（AC-T11-1～6） | library | 不確定（任務單 v1.0 已寫、未派工；見 §5 第 28 點） | task/T-011 |  |
| T-012 | `domain/speech-metrics`：停頓（> 2 s）、贅詞、每分鐘字數（依逐字時間戳記） | T-051 | AC-15 | Q-20 | 單元測試用固定時間戳記樣本；見 `docs/tasks/T-012.md`（AC-T12-1～AC-T12-5） | library | 任務單已就緒（排隊中，見 §4 佇列） | task/T-012 |  |
| T-013 | `domain/chunk-hit`：目標 chunk 是否講出與加分 | T-051 | AC-18、AC-20 | — | 單元測試含大小寫、詞形變化、部分命中案例；見 `docs/tasks/T-013.md`（AC-T13-1～6，暫定） | library | 不確定（任務單 v1.0 已寫、未派工；見 §5 第 28 點） | task/T-013 |  |
| T-049 | **（新增）** `contracts` 的 `NewsSettingsSchema`（類別一律用 T-051 的 `NewsCategory`／`NewsCategorySchema`，不另定義；`rotation_order`、`anchor_date`、`lookback_hours`）＋`domain/news-rotation`：今天輪到的類別、跳類別順序 | T-051、**T-008**（v1.6：用 `daysBetween` 與 `settings.ts`） | AC-01、AC-02 | Q-16 | ARCHITECTURE §11.2 指定的測試：連續 9 天類別序列；三種跳類別；三類全空改用舊文章；`anchor_date` 之前的日期（負數取餘）；schema 擋重複類別、`lookback_hours` 超出 1～168；見 `docs/tasks/T-049.md`（AC-T49-1～5） | library | 不確定（任務單 v1.0 已寫、未派工；見 §5 第 28 點） | task/T-049 |  |
| T-014 | `providers/registry`＋`config/paid.ts`＋`DEFAULT_SETTINGS`（全部 free）＋ADR-003 指定的 AC-25 測試 | T-003 | AC-24、AC-25、NFR-03 | — | ADR-003「測試」節全部項目：假 adapter 計數、預設 tier、`paid_not_allowed`、`resolvePaid` 型別測試、只有 registry 可 import `paid.ts` | library | 待辦 | task/T-014 | |
| T-015 | Gemini adapter（`generate`／`stream`，只用 `fetch` REST）＋契約測試 | T-014 | AC-24 | Q-15、Q-20 | 錄好的回應樣本做契約測試；zod 失敗只重試 1 次同模型 | library | 待辦 | task/T-015 | |
| T-016 | Groq Whisper adapter（含逐字時間戳記） | T-014 | AC-14 | Q-20 | 契約測試；429 回 `quota_exhausted`／`rate_limited` 不換供應商 | library | 待辦 | task/T-016 | |
| T-017 | Azure Speech adapter（發音評估＋TTS） | T-014 | AC-04、AC-06 | Q-20 | 契約測試；發音評估失敗時回錯誤由上層降級 | library | 待辦 | task/T-017 | |
| T-018 | `apps/web` 骨架：Vite＋React＋router、登入閘門（Supabase Auth，關閉註冊）、`api` 網路層；根 `package.json` 加 `build`／`e2e` 指令、Playwright 設定、前端用的 `.env.example`（`VITE_SUPABASE_ANON_KEY` 等，名稱見 §5 第 15 點）；`apps/web/package.json` 的 `dependencies` 加 `@english-coach/contracts`、`@english-coach/domain`（`workspace:*`，ADR-009），並驗證 Vite 不需要 alias 就能轉譯 workspace 原始碼（ADR-009 決定 1 第 5 點，未驗證）；**讓 CI 的 `bundle`、`e2e` job 開始執行** | T-003 | AC-23（基礎）、NFR-01 | — | Playwright：未登入導向登入頁、登入後進首頁（本機 Supabase） | E2E（第一個畫面） | 待辦 | task/T-018 |  |
| T-019 | PWA：manifest、圖示、SW（外殼 precache、API network-only）、斷線提示、新版提示 | T-018 | NFR-01、NFR-06 | — | Playwright Pixel 360×640 無橫向捲動；離線模擬顯示「需要連網」；SW 不快取 `/functions/*` | E2E | 待辦 | task/T-019 | |
| T-020 | `POST /settings`（`SettingsSchema` 驗證：付費同意、`srs`、`news`）＋設定頁：模型／STT／發音供應商、付費同意與月上限、**「複習間隔」5 欄＋還原預設**、**「新聞輪替」順序／起算日／回看小時數**＋結果頁 `meta` 顯示元件 | T-007、T-008、T-014、T-018、T-049 | AC-09、AC-24、AC-25、NFR-03 | Q-18、Q-16 | 整合測試：切換供應商後下一次請求用新選項；不合格間隔回 400 `invalid_settings`；E2E：設定頁標出錯的那一格、還原預設回到 3／7／14／14／1、改輪替順序後 `/settings` 回傳新值 | E2E | 待辦 | task/T-020 | |
| T-021 | `POST /tts`＋Storage 快取＋前端 `audio/player` | T-007、T-017、T-018 | AC-04、AC-05、AC-17（基礎） | — | 整合測試（假 TTS）：第二次同文字命中快取 | library | 待辦 | task/T-021 | |
| T-022 | `_shared/news`：依類別與 `priority` 1→2→3 抓來源、`rss_full`／`rss_then_page` 兩種取得方式、`include_url_pattern`、robots.txt、白名單、`lookback_hours`（從 `settings.news` 讀）、URL＋原文 SHA-256 去重、正文 ≥ 250 字＋`news_source` 種子資料（ARCHITECTURE §11.1 的 9 個來源） | T-007、T-049 | AC-01、AC-02 | Q-16 | 用錄好的 RSS／頁面樣本測試：主來源失敗換備用、robots 不允許視為沒新聞、白名單外網址被拒、`include_url_pattern` 排除 AI 分類；DB 無原文全文 | library | 待辦 | task/T-022 | |
| T-023 | 新聞改寫：Gemini prompt＋zod（250～300 字、5 個語塊含中文、「/」斷句）＋**LLM 判定是否屬於該類別**；不合格重試 1 次 | T-015、T-022 | AC-02、AC-05 | Q-15、Q-16 | 假 LLM 回傳合格／字數不足／chunk 數錯／類別不符四種樣本 | library | 待辦 | task/T-023 | |
| T-024 | 種子庫**匯入程式**（與內容產生分開）：`SeedChunkSchema`（zod）驗證、批次 JSON → migration 產生器、重複檢查；用小型測試資料驗證 | T-004 | AC-07 | Q-10 | 單元測試：欄位缺漏、重複 chunk、`batch` 超出 1～6 都被擋；產生的 migration 經 `supabase db reset` 後筆數正確 | library | 待辦 | task/T-024 | |
| T-050 | **（新增）種子語塊內容產生，6 批 × 100 條**：每批一個新的 Claude Code 對話，寫批次 JSON 並用 T-024 的產生器做 migration；**第 1 批後停，Hansheng 抽查 20 條，通過才做第 2～6 批**；全部完成後開一個 PR | T-024 | AC-07 | Q-10 | 每批：產生器驗證通過、與前批無重複；第 1 批報告附隨機抽出的 20 條（固定亂數種子，可重現）供 Hansheng 抽查；最後 `select count(*) from seed_chunk` ≥ 600、6 個 batch 各 100 | 免 QA（資料；TechLead 驗筆數與格式，品質由 Hansheng 抽查） | 待辦 | task/T-050 | |
| T-025 | `daily-prep`＋`POST /plan/today`（冪等）＋pg_cron 台北 05:00＋預產生 TTS；**依 `domain/news-rotation` 選類別、該類沒新聞換下一類、三類都沒有用最近未讀並標註、連舊文章都沒有則 `status=failed`**；寫 `planned_category`／`actual_category`／`category_skipped` | T-010、T-021、T-023、T-024、T-049 | AC-01、AC-05、AC-07、AC-13 | Q-16、Q-19 | 整合測試（假 RSS＋假 LLM）：重複呼叫結果不變；當天類別有新聞／跳一類／三類全空用舊文章／第一天無任何文章四種情況；`anchor_date` 改了之後類別跟著變 | library | 待辦 | task/T-025 | |
| T-026 | 首頁「今日任務」＋早上閱讀頁（改寫文、來源名稱、原文連結、語塊中文、**今天的類別與跳類別說明**、備援文章註明、素材沒備好時重試） | T-019、T-025 | AC-01、AC-02 | Q-16 | E2E（假供應商）：換日後首次開啟即看到 1 篇新聞、5 句、25 張、今晚題目；跳類別時顯示「今天的 <原類別> 沒有新文章，改用 <實際類別>」 | E2E | 待辦 | task/T-026 | |
| T-027 | `POST /cards`（不呼叫 AI）＋`/cards/lookup`＋`/cards/:id/enrich`＋閱讀頁「＋」收錄 | T-015、T-026 | AC-03 | Q-14 | E2E：點語塊顯示中文（0 次網路）、按「＋」後 3 s 內出現 Collected 卡（假供應商）；`/cards` 不呼叫 LLM（計數） | E2E | 待辦 | task/T-027 | |
| T-028 | 早上整句播放＋跟唸 2 遍計次（VAD，失敗可手動 +1）＋`slot_checkin` | T-021、T-026 | AC-04 | — | 單元測試 VAD 計次；E2E：5 句各計滿 2 次後早上閱讀打卡完成 | E2E | 待辦 | task/T-028 | |
| T-029 | `audio`：AudioWorklet 錄音、重新取樣成 16 kHz mono WAV、`storage` IndexedDB 待上傳錄音 | T-018 | AC-06、AC-25 | — | 單元測試 WAV 編碼與 44.1／48 kHz→16 kHz；IndexedDB 存取測試 | library | 待辦 | task/T-029 | |
| T-030 | `POST /shadow/attempts`（Azure 評分＋`domain/shadowing` 比對；評分失敗降級為「發音分數：無」） | T-007、T-011、T-017 | AC-06 | Q-20 | 整合測試（假 Azure）：回正確率、語速比、發音分數；評分失敗仍可解鎖判斷 | library | 待辦 | task/T-030 | |
| T-031 | 跟讀闖關頁：5 句、「/」斷句、原音自動播 2 遍、跟唸計 2 次、遮字錄音、解鎖、一鍵存 chunk | T-027、T-028、T-029、T-030 | AC-05、AC-06 | — | E2E（假錄音＋假 Azure）：未達門檻不能下一句、可重錄；存 chunk 產生字卡 | E2E | 待辦 | task/T-031 | |
| T-032 | `POST /reviews`（狀態機＋SRS，**天數從 `settings.srs` 讀**，寫 `card_review.interval_days_applied`） | T-007、T-009 | AC-09、AC-19 | Q-17、Q-18 | 整合測試：秒答／猶豫／忘記後 `state`、`due_date` 正確；改 `settings.srs` 後新排程用新天數、既有 `due_date` 不變 | library | 待辦 | task/T-032 | |
| T-033 | 中午複習頁：25 張、模式 A（回想／克漏字）、模式 B（排回句子）、三段評分；不載入錄音模組 | T-025、T-032 | AC-07、AC-08、AC-09、AC-19 | — | E2E：25 張依序答完；頁面沒有呼叫 `getUserMedia` | E2E | 待辦 | task/T-033 | |
| T-034 | `/cards/generate` 串流 NDJSON＋中午手動新增頁＋預取（600 ms）＋`speechSynthesis` 發音 | T-027、T-033 | AC-10 | Q-14 | E2E（假串流）：3 s 內 chunk 先顯示並可播放、8 s 內補齊例句與 ≥ 2 個同義替換、確認後成為 Collected；8 s 逾時保留輸入可重試 | E2E | 待辦 | task/T-034 | |
| T-035 | 履歷瀏覽器解析（`pdfjs-dist`、`mammoth`）＋去電話／Email／地址（純函式） | T-018 | AC-11、NFR-04 | Q-15 | 單元測試：去個資樣本（多種電話與地址格式）；只英文履歷 | library | 待辦 | task/T-035 | |
| T-036 | `POST /resume`（出 ≥ 15 題、三類各 ≥ 3、標引用經歷、新的取代舊的）＋`DELETE /resume`＋履歷頁 | T-007、T-015、T-035 | AC-11、AC-12 | Q-15 | E2E（假 LLM）：上傳 PDF／DOCX 後出題；刪除後 Storage 與 `redacted_text` 都沒了、舊題 retired | E2E | 待辦 | task/T-036 | |
| T-037 | 晚上錄音（webm/opus、3 分鐘自動停、先存 IndexedDB）＋`POST /evening/answers`（Groq 逐字稿） | T-016、T-029 | AC-14、AC-25 | Q-20 | 整合測試（假 Groq）：回逐字稿與時間戳記；E2E：3 分鐘自動停止（假時鐘） | library | 待辦 | task/T-037 | |
| T-038 | `POST /evening/answers/:id/diagnose`：3 種標記、Senior 版改寫、3～5 升級語塊、停頓／贅詞／WPM | T-012、T-015、T-037 | AC-15 | Q-15、Q-20 | 整合測試（假 LLM）：回應過 zod；統計由 `domain` 計算 | library | 待辦 | task/T-038 | |
| T-039 | 晚上頁：今晚題目（與中午預覽同一題、履歷題優先）、提示 3 個今天複習的 chunk、作答、左右對照診斷 | T-033、T-036、T-038 | AC-13、AC-14、AC-15 | — | E2E：中午預覽與晚上同題 id；360 寬與 1280 寬版面；結果頁顯示模型與供應商 | E2E | 待辦 | task/T-039 | |
| T-040 | 升級語塊勾選＋`POST /evening/upgrade`（`priority_new=true`） | T-039 | AC-16 | — | E2E：勾選後隔天中午新卡優先出現（假時鐘＋`/plan/today`） | E2E | 待辦 | task/T-040 | |
| T-041 | `POST /evening/answers/:id/chunks`＋Reviewing 卡自然講出轉 Mastered | T-009、T-013、T-038 | AC-18、AC-20 | — | 整合測試：首答與無稿重答都會觸發 Mastered；非 Reviewing 卡不轉 | library | 待辦 | task/T-041 | |
| T-042 | 改寫版 TTS 跟讀計 3 遍→無稿提示模式（只剩 3～5 語塊）→重答→逐一顯示是否講出與分數 | T-021、T-040、T-041 | AC-17、AC-18、AC-20 | — | E2E：未滿 3 遍不能切換；重答後顯示每個 chunk 結果 | E2E | 待辦 | task/T-042 | |
| T-043 | 錯誤畫面（原因＋供應商）＋`POST /retry/:answerId`＋「改用其他供應商」（手動）＋假 429 E2E | T-020、T-037 | AC-25 | — | ADR-003 的 E2E：假 STT 回 429 → 顯示原因、IndexedDB 仍有錄音、重送成功後才刪本機錄音；付費 adapter 呼叫 0 次 | E2E | 待辦 | task/T-043 | |
| T-044 | 儀表板：早中晚三格打卡日曆、streak、四狀態卡數、Mastered 最大字級 | T-007、T-019 | AC-21 | — | 單元測試 streak（跨台北午夜）；E2E：Mastered 數字為頁面最大字級 | E2E | 待辦 | task/T-044 | |
| T-045 | 成長曲線（近 12 週 Mastered、停頓＋贅詞、講出率）＋練習紀錄（題目、逐字稿、診斷、分數、錄音） | T-041、T-044 | AC-22 | — | E2E（測試資料）：曲線 12 個點；錄音過期的紀錄只顯示文字 | E2E | 待辦 | task/T-045 | |
| T-046 | `purge-audio`＋pg_cron：錄音 90 天後刪 Storage 物件、`audio_path` 設 null | T-006、T-007 | AC-22、NFR-04 | Q-19 | 整合測試：過期錄音被刪、逐字稿與分數保留 | library | 待辦 | task/T-046 | |
| T-047 | 早中晚開始時間可調、可跳過單一步驟（Q-08） | T-020、T-026 | AC-26（PRD v1.1 草稿，待確認） | — | E2E：改時段開始時間並儲存後首頁立即顯示新時間；按「跳過」的步驟標示「已跳過」並記入學習紀錄，可直接進行同時段下一步；時段內步驟與分鐘數沒有修改入口 | E2E | 待辦 | task/T-047 | |
| T-048 | 跨裝置同步 E2E（兩個瀏覽器 context）＋`VITE_` 變數白名單測試 | T-033、T-044 | AC-23、NFR-02、NFR-05 | — | E2E：A 裝置完成複習，B 重新整理後 60 s 內看到相同狀態；含 `KEY`／`SECRET`／`TOKEN` 的 `VITE_` 變數讓測試失敗（bundle 秘密掃描已在 O-001） | E2E | 待辦 | task/T-048 | |
| A-001 | AI 生卡延遲 PoC：Android Chrome 實測 `/cards/generate`（與 `/cards/lookup`）50 次，取 p50／p95 | Hansheng 決定要開；前置 5（Gemini 金鑰）；T-034 | AC-03、AC-10 | Q-14 | Architect 的 PoC 報告列 50 次原始數據與 p50／p95；分支不合併 | 不適用 | **G2 決定後才開**：G2 沒有決定要開（ADR-005 寫「可開」），維持未決定是否開（Architect 擁有） | poc/A-001 | 不開 PR |
| A-002 | Whisper 贅詞保留程度實測（Q-20 決定要做）；Azure 短音訊延遲是否一併量測：不確定（ADR-004 只建議） | 前置 5（Groq、Azure 帳號）；T-016 | AC-06、AC-15 | Q-20 | Architect 的 PoC 報告列樣本錄音的人工逐字稿 vs Whisper 逐字稿的贅詞數；分支不合併 | 不適用 | 待辦（Architect 擁有，任務單 `docs/tasks/A-002.md` 由 Architect 寫） | poc/A-002 | 不開 PR |

- T-049、T-050 依憲章 §6「新增的任務接續清單中最大的號碼」編號，所以號碼比依賴順序後面的單大；以「依賴」欄為準。
- T-050 與 T-024 的關係：T-024 只做匯入程式與驗證（產品程式，有單元測試）；T-050 只產生內容（資料），用 T-024 的產生器把每批轉成 migration。T-025 的測試用小型測試資料，不等 T-050；但 AC-07「種子庫 ≥ 600 條」要等 T-050 合併才算真正達成，G4 前必須完成。

- **O-001 時被略過的 CI job 何時開始執行**（由 O-001 的 `detect` 依檔案決定）：`check` → **T-001**（有 `package.json`＋`pnpm-lock.yaml`）；`db` → **T-003**（有 `supabase/config.toml`，只在 PR 跑；`supabase test db` 要等 T-004 建 `supabase/tests/`）；`bundle`、`e2e` → **T-018**（有 `apps/web/package.json`、根目錄 `build` 指令、Playwright 設定；`e2e` 只在 PR 跑）。在那之前，G3 要把仍被略過的 job 逐一列名。

## 4. 關鍵路徑與可平行的單
- **關鍵路徑**（16 張，v1.2 以依賴欄用程式重算）：O-001 → T-001 → T-002 → **T-051** → T-003 → T-004 → T-005 → T-006 → T-007 → T-022 → T-023 → T-025 → T-033 → T-039 → T-040 → T-042。v1.2 把 T-002 拆成 T-002＋T-051，所以多一張；ARCH-003 已於 2026-11-22 完成（`8c59a70`，v1.2.1 `d1816c9`），T-002 已合併，T-051 可派。
- 一樣長（16 張）：同一路徑在 T-025 後改走 T-026 → T-027 → T-034 → A-001（A-001 是 PoC、`poc/` 分支不合併，且「G2 決定後才開」）。次長（15 張）：T-025 後改走 T-026 → T-027 → T-031（或 T-034），或關鍵路徑去掉最後的 T-042。T-014 → T-015 這條很短，就接到 T-023，不在關鍵路徑上。
- 可平行（檔案完全不重疊才同時派）：`domain` 純邏輯單 T-008～T-013、T-049 只依賴 T-051，可在 T-003～T-007 期間進行；T-018、T-019、T-029、T-035 只依賴骨架；T-050 在 T-024 合併後可隨時進行（每批之間不擋其他單）。
- 預設仍一次派一張；是否平行由幕僚長依用量預算決定。
- **（v1.6）domain 純邏輯單的檔案重疊與佇列**：7 張都要改 `packages/domain/src/index.ts`（domain 唯一對外入口，ADR-009 禁止深層引用，所以不能不改）；T-008 與 T-049 另外都改 `packages/contracts/src/settings.ts`、`settings.test.ts`（T-008 新增，T-049 加 `NewsSettingsSchema`）；T-009 可能加 `packages/contracts/src/{card,index}.ts`。**沒有任何兩張完全不重疊，所以一次只派一張，前一張合併後才派下一張**（新分支從最新 main 建立）。
  - 佇列：**T-008（派工中）→ T-049 → T-009 → T-010 → T-012 → T-011 → T-013**。排序理由：T-008 是 T-009／T-010／T-049 的前置（`daysBetween`、`srs.ts`、`settings.ts`）；T-049 接到關鍵路徑上的 T-022；T-009 → T-010 接到 T-025（關鍵路徑）與 T-032；T-011／T-012／T-013 只接到晚期的單。
  - 輪到的單還是「不確定」時跳過，先派下一張「任務單已就緒」的（目前只有 T-012）；不確定解決、任務單改版 v1.1 後回到原位置。

## 5. 待釐清、衝突與不確定（v1.6 狀態）
1. ~~G2 尚未通過~~ → **已解決**：G2 於 2026-11-22 18:46 通過，ADR-001～008 已接受。
2. ~~pushguard 與 PoC 分支衝突~~ → **已決定**：pushguard 白名單包含 `task/*`、`fix/*`、`poc/*`（G2 核准 TechLead 建議 a；ARCHITECTURE §15、CLAUDE.md §9）。已寫進 O-001。
3. pushguard 的實作語言 → **交給 O-001 並在單內決定**：Node.js 標準庫的 `.mjs`（不用 Go、不加依賴），測試用 `node --test`。
4. CI 範圍（Docker 版 `supabase start`、RLS 測試、E2E、秘密掃描工具）→ **交給 O-001 並在單內決定**：見 `docs/tasks/O-001.md`「實作限制 C～E」。
5. ~~Deno 引用 `packages/*`~~ → **已決定**（ADR-009 決定 1，`8c59a70`）：用套件名稱＋`supabase/functions/deno.json` 的 `imports`；T-003 做三項驗證，失敗時停下，由 Architect 修訂 ADR-009 後走備案（搬到 `supabase/functions/_shared/`，套件名稱不變）。
6. ~~QA 規則對 PWA 的對應~~ → **已決定**：「第一次能在畫面上走完該 AC」的單視同 CLI PR（G2 核准 TechLead 建議 b；ARCHITECTURE §15、CLAUDE.md §7）。
7. ~~種子庫內容來源~~ → **已決定**：獨立任務單 6 批 × 100、第 1 批後 Hansheng 抽查 20 條、匯入程式與內容產生分開（ARCHITECTURE §4 `seed_chunk`）。對應 T-050＋T-024。
8. Q-08 沒有對應 AC → **已解決（PRD v1.1 於 2026-11-22 19:45 由 Hansheng 定稿，`354e489`）**：PRD v1.1 草稿（`47d97d6`）新增 AC-26，T-047 改對應 AC-26；v1.1 經 Hansheng 確認前，以草稿文字為驗收依據。
9. 前端託管：G4 由 SRE 決定；本清單不含部署單，G4 時再開 O-xxx。
10. AC-04 VAD 計次準確度未驗證，T-028 以「可手動 +1」作為備援；這樣是否算達成 AC-04：不確定。
11. **（新）PRD 文字與 G2 決定不一致** → **已解決（PRD v1.1 於 2026-11-22 19:45 由 Hansheng 定稿，`354e489`）**：PRD v1.1 草稿已改寫 AC-01、AC-02（三類輪替）、AC-09、AC-19（間隔可調）、AC-10（3 s／8 s）。v1.1 經 Hansheng 確認前，T-020、T-025、T-026、T-032、T-034 依 G2 決定（與 v1.1 草稿一致）驗收。
12. **（新）O-001 任務單撰寫者**：憲章 §5 寫「第一張 O-001 由 SRE 撰寫」，名冊也把 `docs/tasks/O-xxx.md` 列給 SRE；這次依幕僚長交接由 TechLead 撰寫，請幕僚長確認是否需要 SRE 複核。
13. **（新）A-002 範圍**：Q-20 只決定「贅詞保留程度在 PoC 實測」；ADR-004 另建議量 Azure 短音訊延遲（AC-06 ≤ 5 s），是否一起量：不確定，由 Architect 寫單時決定。
14. **main 分支保護 → 已決定（Hansheng，幕僚長 2026-11-22 21:21 轉達）：維持現狀**，只靠 pushguard 與 `.claude/settings.json` 權限規則。佐證：2026-11-22 20:53 TechLead 的 docs 直推 main 成功且沒有「bypassed」訊息，表示 GitHub 端沒有在檢查。原紀錄：2026-11-22 20:5x 用 Hansheng 的 token 查 GitHub API：`GET /branches/main` 回 `protected: false`，但同一回應的 `protection` 顯示 `enabled: true`、必過檢查 `ci-ok`、`enforcement_level: non_admins`（管理員不受限）；`GET /branches/main/protection` 與 rulesets 都回 403「Upgrade to GitHub Pro or make this repository public to enable this feature」。repo 是私有、帳號是個人 Free 方案。可能的意思是：私有 repo 在 Free 方案下分支保護不會被強制；就算生效，`non_admins` 也不擋 Hansheng 本人（Claude Code 用的就是 Hansheng 的帳號）。目前實際擋住 Claude Code 推 main 的只有 pushguard 與 deny 規則。要改成公開 repo、升級 GitHub Pro，還是接受現狀，需要 Hansheng 決定；決定前派 T-001 等於沒有最後一道防線（範本 §1 第 7 項）。
15. **（新）環境變數名稱沒有定義**：ARCHITECTURE v1.0 只寫了 `VITE_SUPABASE_ANON_KEY`、`GEMINI_PAID_API_KEY`；其他（Supabase 網址、Gemini／Groq／Azure 金鑰與區域）沒有名稱。`.env.example` 因此從 T-001 移到 T-003（後端）與 T-018（前端）；名稱由誰定（Architect 補，或 TechLead 在那兩張單提案送 Architect Review）：不確定。
16. **（新）遠端分支 `task/O-001` 還在**：2026-11-22 20:5x `git ls-remote` 仍看得到 `refs/heads/task/O-001`（`fe39d0a`，已併入 main）。與「已刪除」的轉達不符；TechLead 沒有動它，請幕僚長確認後處理（憲章 §9）。 → **Hansheng 自己刪**（幕僚長 21:21 轉達），TechLead 不動。
17. ~~contracts 型別沒有定義~~ → **已解決**：ARCH-003（`8c59a70`）新增 ARCHITECTURE v1.2 §5.0（`Result`、`AppError` 18 種 `kind`＋錯誤碼對照表、各 ID、音訊與語音型別、四種介面）。T-051 任務單已就緒。
18. ~~`packages/contracts` 的引用方式沒有定義~~ → **已決定**（ADR-009）：`@english-coach/contracts`（`exports` 有 `.` 與 `./testing`）、`@english-coach/domain`；相對 import 寫 `.ts`；`package.json` 由 T-051 建（domain 骨架也在 T-051），`supabase/functions/package.json` 由 T-003 建。
19. **（新）T-001 審查提出的兩點 → 已決定**（Architect，ADR-008 修訂 1，`9924288`）：(a) 第 4 條擴及後端，`@supabase/*` 只能在 `apps/web/src/api/**`、`supabase/functions/_shared/db/**`；(b) 正式程式不得 `throw`，測試程式可以。規則與範例由 **T-002** 實作（Architect 指示「T-002 之前或 T-002 內」）。選擇放進 T-002、不另開單的理由：T-002 的第一個 contracts 測試一 import `vitest` 就會違反舊第 2 條，兩件事必須同一張單一起過 CI；而且都是工具規則，同一位審查者一次看完。第 4 條的 Deno 部分（`deno.json` `imports`）在 T-003 驗證。
20. ~~測試檔的定義只含 `.ts`~~ → **已決定**（ADR-008 修訂 2）：新 regex `(^|/)test/|\.test\.tsx?$|\.test-d\.ts$`（`*.test.tsx` 算測試）；T-002 仍照修訂 1，T-051 換成新 regex。
21. **（新）T-001 審查的後續已排入 T-002**：ESLint 只比對 `**/*.ts`（`.tsx` 不會被 lint）、`globalThis.fetch` 沒被擋、`engines.node` 應為 `^22.13.0 || ^24.0.0 || >=26.0.0`（Vitest 5、ESLint 10、dependency-cruiser 18 的實際需求）。
22. **（新）zod 是本專案第一個執行期依賴**：ADR-009 指定 `zod` `^4.6.7`（Architect 已依 ADR-001 審過）。T-051 的 `pnpm add`／`pnpm install` 會改 `pnpm-lock.yaml`，**執行前要 Hansheng 核准**；任務單規定 Claude Code 在這一步停下來問。
23. **（新）ARCHITECTURE v1.2 內部小不一致**（不擋任何單，請 Architect 順手修）：§3.2 第 4 點的測試檔仍寫舊定義（`*.test.ts`、`*.test-d.ts`、`test/`），第 6 點已是修訂 2 的新 regex；§5.0.1 表格有兩個表頭列；§3.2 第 3 點的 `Ntd` 範例（`number & { __brand: 'Ntd' }`）和 §5.0.2 的 `Brand<T, B>` 寫法不同。T-051 以 §5.0 與 ADR-008 修訂 2 為準。 → **v1.2.1（`d1816c9`）仍未修**（那次只改 §5.0.4、§11.2）；仍不擋任何單。
24. ~~`news_unavailable` 的 HTTP 狀態與可重試沒有定義~~ → **已解決**（Architect，ARCHITECTURE v1.2.1，`d1816c9`）：`news_unavailable` → 503、可重試，只在 `daily-prep` 內部用來換類別；前端看到的是 `plan_not_ready`（503、可重試）。T-051 任務單的停止條件已移除。
25. **（新，T-002 審查留下，靠 code review）規則擋不到的寫法**：`no-restricted-imports` 只擋靜態 `import`／`export … from`，**動態 `import('npm:…')` 與 `require(...)` 擋不到**；`throw` 規則只擋 `throw` 陳述式，**`Promise.reject(...)`、async 函式內被拒絕的 Promise、呼叫會丟例外的外部函式擋不到**。TechLead 每次審查都要人工看這幾種寫法（T-002 報告「需要人類決定的問題」第 2、3 點）；是否加規則（例如 `no-restricted-syntax` 擋 `ImportExpression`／`require`）由 Architect 決定，目前不排單。
26. **（新）main 分支保護沒有在 GitHub 端生效**（§5 第 14 點，Hansheng 決定維持現狀）：GitHub 不會因為 `ci-ok` 沒過而擋合併，所以 **每次 G3 前 TechLead 都要人工確認該 PR 的 PR-triggered run 的 `ci-ok` 是綠的**，並在審查報告附 run 網址；Hansheng 合併前也請看一眼 PR 頁的檢查狀態。
27. **（新，v1.5）T-003 任務單暫緩：模式 C 下寫不出能完整執行、又不用自己發明的單**（2026-11-23 TechLead 檢查 `.github/workflows/claude-run-task.yml`、`.claude/settings.json`、`ci.yml`）：
    - (a) **工具不允許（要 SRE／Hansheng）**：run-task workflow 的 `--allowedTools` 只有 `git *`、`pnpm install／check／typecheck／lint／arch／test／e2e`；runner 沒裝 Supabase CLI，`curl` 在 settings 是 deny。T-003 驗收方式的 `supabase start`、`supabase functions serve`＋`curl` 401／200、ADR-009 驗證 (1) `functions serve` import contracts、(2) `deploy --dry-run` 都跑不了，只有 (3) `tsc -b`／`pnpm arch` 能跑。`supabase init` 也不能跑，`config.toml` 只能手寫，要等 PR 的 `db` job（只在 PR 跑：`supabase start`＋`db reset`）才驗得到。要選：在 run-task workflow 裝 Supabase CLI 並放行指令、改由 Hansheng 本機跑 (1)(2)、或把 (1)(2) 加進 CI `db` job（O-xxx，SRE）。
    - (b) **新依賴要 Hansheng 核准**：ADR-009 規定 `supabase/functions/package.json` 依賴 `@supabase/supabase-js`（lockfile 還沒有）與 `zod`；加 workspace 套件一定改 `pnpm-lock.yaml`（不能用 `--frozen-lockfile`）。模式 C 無人值守，沒有事先核准就只能停下。
    - (c) **架構不確定（要 Architect）**：①後端環境變數名稱仍未定義（第 15 點），`.env.example` 與 `_shared/config` 要讀哪些名稱：不確定；②health 的「JWT 檢查」用 Supabase 閘道的 `verify_jwt`，還是 `_shared/db` 用 supabase-js 驗 token：不確定；③Node 端 `tsc -b`／ESLint 怎麼取得 `Deno` 全域型別（`Deno.env`、`Deno.serve`），要不要新增型別依賴或排除入口檔：不確定。
    - 在 (a)～(c) 有答案前不寫 `docs/tasks/T-003.md`、不派工。T-003 卡住也擋住關鍵路徑 T-004 之後的單；只依賴 T-051 的 `domain` 純邏輯單（T-008～T-013、T-049）不受影響。
28. **（新，v1.6）domain 純邏輯單的不確定**（2026-11-23 TechLead 寫任務單時發現；任務單都已寫好 v1.0，有不確定的標「⛔ 不確定（未派工）」，答案出來後 TechLead 改 v1.1 再派）：
    - **T-049**（要 Architect／Hansheng）：`anchor_date` 預設「專案上線日」沒有定義，schema 寫不出預設值。建議 (a) 指定一個固定日期；或 (b) 改必填、由建 `profile` 的程式填當天。
    - **T-009**（要 Architect）：①Collected／Learning 答對後多久再出現；②Reviewing 忘記退回 Learning 後 `correct_count` 怎麼算、回 Reviewing 從第幾階開始；③Mastered 後還排不排程；④卡片狀態與評分（會跨網路）要不要在 contracts 用 zod 定義（建議新增 `packages/contracts/src/card.ts`，值照 ARCHITECTURE §4）。
    - **T-010**（要 PM／Architect；也等 T-009）：到期舊卡超過 15 張選哪些、Learning 卡算舊卡或新卡、新卡與種子庫的順序、今晚題目選哪題、跟讀 5 句裡新聞句與前晚答案句各幾句、AC-13 的 3 個提示 chunk 是否也在本單。
    - **T-011**（要 Hansheng／Architect）：AC-05「約一半字詞被遮住」遮哪些字（建議遮第 2、4、6…個字）；正確率分母與語速比的 TechLead 定義（依 ADR-004）請一起確認。
    - **T-013**（要 PM／Architect）：詞形變化範圍（是否支援不規則動詞）、部分命中算不算講出（AC-18 加分、AC-20 Mastered）、每個 chunk 加幾分、`sb`／`sth`／`one's` 等佔位詞。
    - **T-012** 已就緒，但贅詞清單改由呼叫端傳入（domain 不放預設）：預設清單（例如 `like` 算不算）留給之後的晚上診斷單決定。

## 6. 變更紀錄
| 版本 | 日期 | 變更 |
|---|---|---|
| v0.1 | 2026-11-22 | 初稿（依幕僚長交接、憲章 v3）：O-001、T-001～T-048、A-001～A-002；送 G2 |
| v1.0 | 2026-11-22 | G2 通過後更新：Q-14～Q-20 改為已決定；新聞改三類輪替（T-005、T-022、T-023、T-025、T-026，新增 T-049）；複習間隔與輪替可在設定調整（T-004、T-008、T-009、T-020、T-032）；種子庫拆成匯入程式 T-024＋內容產生 T-050（6 批）；A-002 改為待辦；§5 第 1、2、6、7 點已決定，第 3、4 點交 O-001，第 8 點依 PRD v1.1 草稿改對應 AC-26；新增 §5 第 11～13 點；O-001 任務單已寫好 |
| v1.1 | 2026-11-22 | O-001 完成（PR #1）；T-001 任務單就緒並補上範圍（`tooling/` 規則測試；`.env.example` 移到 T-003／T-018）；T-003、T-018 寫明讓哪些 CI job 開始執行；§4 加上被略過 job 的開始時點；前置 2 完成、前置 4 標為不確定；新增 §5 第 14～16 點 |
| v1.2 | 2026-11-22 | T-001 完成（PR #2）；依 ADR-008 修訂 1（`9924288`）把 T-002 改為「修訂 1 的規則＋`.tsx`＋`globalThis.fetch`＋`engines.node`＋contracts 骨架」，任務單就緒；contracts 其餘型別拆成 T-051（等 ARCH-003），T-003、T-008、T-011～T-013、T-049 改依賴 T-051；關鍵路徑重算為 16 張；前置 4 依 Hansheng 決定維持現狀；輸入改為 PRD v1.1 定稿、ARCHITECTURE v1.1；新增 §5 第 17～21 點 |
| v1.3 | 2026-11-22 | ARCH-003（`8c59a70`）定案：T-051 改為 ARCHITECTURE v1.2 §5.0 全部型別＋`zod` `^4.6.7`（要 Hansheng 核准安裝）＋domain 套件骨架＋ADR-008 修訂 2（新測試檔 regex、第 12～14 條）＋`.ts` 副檔名與 `allowImportingTsExtensions`／`rootDir`，任務單就緒（T-002 合併後派）；T-003 加 ADR-009 三項驗證、`supabase/functions/package.json`、`deno.json`、`pnpm-workspace.yaml`；T-008 指定 `taipei-date.ts`；T-049 用 `NewsCategory`；T-018 加 workspace 依賴與 Vite 驗證；§5 第 5、17、18、20 點結案，新增第 22～24 點 |
| v1.4 | 2026-11-22 | T-002 完成（PR #3）；ARCHITECTURE v1.2.1（`d1816c9`）補上 `news_unavailable`＝503／可重試 → §5 第 24 點結案、T-051 任務單 v1.1 移除停止條件並補上 T-002 審查發現的修訂 2 落點（`TEST`／`testOf()`、`TEST_GLOBS`／`testGlobsUnder()`、`no-restricted-imports` 各區塊寫齊、品牌型別選擇器進 A～E′、`./providers.ts`）與「原始輸出不得刪列、不得節錄」；第 23 點註明仍未修；新增第 25、26 點 |
| v1.5 | 2026-11-23 | T-051 完成（PR #4，19:11 合併）；憲章 v4 交棒模式 C；T-003 檢查後暫緩：run-task 不允許 Supabase CLI／`curl`、要裝 `@supabase/supabase-js`、環境變數名稱／JWT 檢查方式／Deno 型別三處不確定 → 新增 §5 第 27 點（T-900 是模式 C 試跑，不列入本清單） |
| v1.6 | 2026-11-23 | 依幕僚長交接（Hansheng 核准先做 domain 純邏輯單）：寫好 T-008～T-013、T-049 任務單 v1.0；T-008 派工中；T-012 任務單已就緒；T-009、T-010、T-011、T-013、T-049 標「不確定」未派（§5 第 28 點）；T-049 依賴加 T-008（共用 `daysBetween`、`settings.ts`）；§4 加檔案重疊分析與佇列 |
| v1.7 | 2026-11-23 | O-002 完成（PR #12，23:17 合併） |
