# TASKS：english-coach 任務清單
- 版本：**v1.1（O-001 完成）**｜日期：2026-11-22｜擁有者：TechLead｜路線：完整（憲章 v3 §2）
- 輸入：`docs/PRD.md` v1.0（`0276440`；v1.1 草稿 `47d97d6` 回寫 G2 決定並新增 AC-26，待 Hansheng 確認）、`docs/ARCHITECTURE.md` **v1.0**＋ADR-001～008（全部已接受）＋`CLAUDE.md`（`8f96012`）、`docs/OPEN_QUESTIONS.md`（Q-14～Q-20 已於 2026-11-22 18:46 G2 決定）
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
| 4 | O-001 的 PR 跑出 `ci-ok` 後，立即設 main 分支保護（必須走 PR、`ci-ok` 必過、禁止 force push、禁止刪 main） | Hansheng | Hansheng 已設定（幕僚長 2026-11-22 20:49 轉達）；**是否真的生效：不確定**，見 §5 第 14 點 | T-001 |
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
| T-001 | monorepo 骨架：`package.json`（`packageManager`、`typecheck`／`lint`／`arch`／`test`／`check` 指令）、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.base.json`＋根 `tsconfig.json`、`eslint.config.js`（ADR-008 規則 7～9）、`.dependency-cruiser.cjs`（ADR-008 規則 1～6、10）、`.gitignore`；`tooling/` 下的規則測試與測試用範例 | O-001、前置 4 | NFR-05（基礎） | — | `pnpm check` 全過；`tooling/` 的單元測試證明每條架構規則真的會擋（違規範例被擋、合法範例不擋）；CI 的 `check` job 第一次實際執行並成功；見 `docs/tasks/T-001.md`（AC-T1-1～AC-T1-11） | 免 QA（無產品程式） | 待辦（任務單已就緒：`docs/tasks/T-001.md`；派單前請先看 §5 第 14 點） | task/T-001 |  |
| T-002 | `packages/contracts` 基礎：`Result`、`AppError`、`ProviderErrorKind`、`Tier`／`Capability`、四種供應商介面、ID 聯集 | T-001 | AC-24、AC-25（型別） | — | Vitest＋`expectTypeOf` 型別測試；contracts 只 import `zod`（`pnpm arch`） | library | 待辦 | task/T-002 | |
| T-003 | Supabase 骨架：`supabase/config.toml`、`functions/api` 單一路由（health＋JWT 檢查）、`_shared/config`（唯一讀 `Deno.env`）、後端用的 `.env.example`（只有變數名稱，名稱見 §5 第 15 點）；**讓 CI 的 `db` job 開始執行**；**驗證 Deno 能否引用 `packages/contracts`**（ARCH §12） | T-002 | NFR-05、AC-23（基礎） | Q-19 | `supabase start`；`supabase functions serve` 後 `curl` health：無 JWT 回 401、有 JWT 回 200；報告寫明 Deno 引用方式結果（不行就停下回報，不自行改目錄） | library | 待辦 | task/T-003 |  |
| T-004 | migration 1：`profile`（含 `settings.srs`／`settings.news` 的 jsonb 欄位）、`card`（`interval_step` 0～4）、`card_review`（含 `interval_days_applied`）、`seed_chunk`（含 `batch` 1～6）＋RLS | T-003 | AC-09、AC-19、AC-24（資料） | Q-18、Q-19 | `supabase db reset` 成功；`supabase test db`：A 使用者讀不到 B 的資料 | library | 待辦 | task/T-004 | |
| T-005 | migration 2：`news_source`（`category`、`priority`、`fetch_mode`、`include_url_pattern`、`terms_checked_at`）、`news_article`（含 `category`，不存原文全文）、`daily_plan`（含 `planned_category`、`actual_category`、`category_skipped`）、`resume`、`question`＋RLS | T-004 | AC-01、AC-02、AC-11 | Q-16、Q-19 | 同 T-004；`news_article` 沒有原文全文欄位 | library | 待辦 | task/T-005 | |
| T-006 | migration 3：`shadow_attempt`、`evening_answer`、`slot_checkin`、`provider_call`、`weekly_metric` view＋RLS；錄音欄位 `audio_expires_at` | T-005 | AC-06、AC-14、AC-21、AC-22 | Q-19 | 同 T-004；`weekly_metric` 以測試資料查出預期值 | library | 待辦 | task/T-006 | |
| T-007 | `_shared/db` repository 基礎（回 `Result`）＋`provider_call` 寫入（不含內容） | T-006 | AC-24（紀錄）、NFR-04 | Q-19 | 本機 DB 整合測試；`pnpm arch` 確認 db 不 import 供應商 | library | 待辦 | task/T-007 | |
| T-008 | `contracts` 的 `SrsSettingsSchema`（預設 3／7／14、14、1）＋`domain`：台北日期計算＋SRS 間隔（天數由參數傳入，不寫死） | T-002 | AC-09 | Q-17、Q-18 | 單元測試：schema 邊界（0、366、非遞增、`after_last_days` < `step_days[2]`、`forgot_days` > `step_days[0]` 都被擋）；任意合法設定下「猶豫的間隔 ≤ 秒答的間隔」（性質測試）；跨台北午夜邊界；程式內沒有 3／7／14 常數（只在 schema 預設） | library | 待辦 | task/T-008 | |
| T-009 | `domain`：字卡狀態機 Collected→Learning→Reviewing（第 1～3 階、之後 `after_last`）→Mastered；Reviewing 忘記退回 Learning | T-008 | AC-19、AC-20 | Q-17、Q-18 | 狀態轉換表逐列測試（含猶豫留同階）；`switch` 有 `never` 窮舉 | library | 待辦 | task/T-009 | |
| T-010 | `domain/plan`：每日 25 張選卡（15 舊＋10 新、不足補齊、升級語塊優先）、今晚題目、跟讀 5 句選句 | T-009 | AC-05、AC-07、AC-13、AC-16 | — | 單元測試：第一週舊卡不足、新卡不足用種子庫、前晚無作答全用新聞句 | library | 待辦 | task/T-010 | |
| T-011 | `domain/shadowing`：逐字比對正確率、語速比、解鎖判斷（≥ 80%／≥ 70%）、遮住約一半字詞 | T-002 | AC-05、AC-06 | — | 單元測試含門檻邊界（79.9%／80%、69.9%／70%）；發音分數不影響解鎖 | library | 待辦 | task/T-011 | |
| T-012 | `domain/speech-metrics`：停頓（> 2 s）、贅詞、每分鐘字數（依逐字時間戳記） | T-002 | AC-15 | Q-20 | 單元測試用固定時間戳記樣本 | library | 待辦 | task/T-012 | |
| T-013 | `domain/chunk-hit`：目標 chunk 是否講出與加分 | T-002 | AC-18、AC-20 | — | 單元測試含大小寫、詞形變化、部分命中案例 | library | 待辦 | task/T-013 | |
| T-049 | **（新增）** `contracts` 的 `NewsSettingsSchema`（`rotation_order`、`anchor_date`、`lookback_hours`）＋`domain/news-rotation`：今天輪到的類別、跳類別順序 | T-002 | AC-01、AC-02 | Q-16 | ARCHITECTURE §11.2 指定的測試：連續 9 天類別序列；三種跳類別；三類全空改用舊文章；`anchor_date` 之前的日期（負數取餘）；schema 擋重複類別、`lookback_hours` 超出 1～168 | library | 待辦 | task/T-049 | |
| T-014 | `providers/registry`＋`config/paid.ts`＋`DEFAULT_SETTINGS`（全部 free）＋ADR-003 指定的 AC-25 測試 | T-003 | AC-24、AC-25、NFR-03 | — | ADR-003「測試」節全部項目：假 adapter 計數、預設 tier、`paid_not_allowed`、`resolvePaid` 型別測試、只有 registry 可 import `paid.ts` | library | 待辦 | task/T-014 | |
| T-015 | Gemini adapter（`generate`／`stream`，只用 `fetch` REST）＋契約測試 | T-014 | AC-24 | Q-15、Q-20 | 錄好的回應樣本做契約測試；zod 失敗只重試 1 次同模型 | library | 待辦 | task/T-015 | |
| T-016 | Groq Whisper adapter（含逐字時間戳記） | T-014 | AC-14 | Q-20 | 契約測試；429 回 `quota_exhausted`／`rate_limited` 不換供應商 | library | 待辦 | task/T-016 | |
| T-017 | Azure Speech adapter（發音評估＋TTS） | T-014 | AC-04、AC-06 | Q-20 | 契約測試；發音評估失敗時回錯誤由上層降級 | library | 待辦 | task/T-017 | |
| T-018 | `apps/web` 骨架：Vite＋React＋router、登入閘門（Supabase Auth，關閉註冊）、`api` 網路層；根 `package.json` 加 `build`／`e2e` 指令、Playwright 設定、前端用的 `.env.example`（`VITE_SUPABASE_ANON_KEY` 等，名稱見 §5 第 15 點）；**讓 CI 的 `bundle`、`e2e` job 開始執行** | T-003 | AC-23（基礎）、NFR-01 | — | Playwright：未登入導向登入頁、登入後進首頁（本機 Supabase） | E2E（第一個畫面） | 待辦 | task/T-018 |  |
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
- **關鍵路徑**（15 張，以依賴欄用程式計算）：O-001 → T-001 → T-002 → T-003 → T-004 → T-005 → T-006 → T-007 → T-022 → T-023 → T-025 → T-033 → T-039 → T-040 → T-042。
- 次長（14 張）：同一路徑在 T-025 後改走 T-026 → T-027 → T-031（或 T-034）；以及關鍵路徑去掉最後的 T-042。T-014 → T-015 這條只有 7 張就接到 T-023，不在關鍵路徑上。
- 可平行（檔案完全不重疊才同時派）：`domain` 純邏輯單 T-008～T-013、T-049 只依賴 T-002，可在 T-003～T-007 期間進行；T-018、T-019、T-029、T-035 只依賴骨架；T-050 在 T-024 合併後可隨時進行（每批之間不擋其他單）。
- 預設仍一次派一張；是否平行由幕僚長依用量預算決定。

## 5. 待釐清、衝突與不確定（v1.0 狀態）
1. ~~G2 尚未通過~~ → **已解決**：G2 於 2026-11-22 18:46 通過，ADR-001～008 已接受。
2. ~~pushguard 與 PoC 分支衝突~~ → **已決定**：pushguard 白名單包含 `task/*`、`fix/*`、`poc/*`（G2 核准 TechLead 建議 a；ARCHITECTURE §15、CLAUDE.md §9）。已寫進 O-001。
3. pushguard 的實作語言 → **交給 O-001 並在單內決定**：Node.js 標準庫的 `.mjs`（不用 Go、不加依賴），測試用 `node --test`。
4. CI 範圍（Docker 版 `supabase start`、RLS 測試、E2E、秘密掃描工具）→ **交給 O-001 並在單內決定**：見 `docs/tasks/O-001.md`「實作限制 C～E」。
5. Deno 引用 `packages/*`：ARCHITECTURE v1.0 §12 仍標「不確定」，T-003 先驗證；不行時要 Architect 決定改目錄，T-003 之後的後端單會延後。
6. ~~QA 規則對 PWA 的對應~~ → **已決定**：「第一次能在畫面上走完該 AC」的單視同 CLI PR（G2 核准 TechLead 建議 b；ARCHITECTURE §15、CLAUDE.md §7）。
7. ~~種子庫內容來源~~ → **已決定**：獨立任務單 6 批 × 100、第 1 批後 Hansheng 抽查 20 條、匯入程式與內容產生分開（ARCHITECTURE §4 `seed_chunk`）。對應 T-050＋T-024。
8. Q-08 沒有對應 AC → **PM 已處理（待確認）**：PRD v1.1 草稿（`47d97d6`）新增 AC-26，T-047 改對應 AC-26；v1.1 經 Hansheng 確認前，以草稿文字為驗收依據。
9. 前端託管：G4 由 SRE 決定；本清單不含部署單，G4 時再開 O-xxx。
10. AC-04 VAD 計次準確度未驗證，T-028 以「可手動 +1」作為備援；這樣是否算達成 AC-04：不確定。
11. **（新）PRD 文字與 G2 決定不一致** → **PM 已處理（待確認）**：PRD v1.1 草稿已改寫 AC-01、AC-02（三類輪替）、AC-09、AC-19（間隔可調）、AC-10（3 s／8 s）。v1.1 經 Hansheng 確認前，T-020、T-025、T-026、T-032、T-034 依 G2 決定（與 v1.1 草稿一致）驗收。
12. **（新）O-001 任務單撰寫者**：憲章 §5 寫「第一張 O-001 由 SRE 撰寫」，名冊也把 `docs/tasks/O-xxx.md` 列給 SRE；這次依幕僚長交接由 TechLead 撰寫，請幕僚長確認是否需要 SRE 複核。
13. **（新）A-002 範圍**：Q-20 只決定「贅詞保留程度在 PoC 實測」；ADR-004 另建議量 Azure 短音訊延遲（AC-06 ≤ 5 s），是否一起量：不確定，由 Architect 寫單時決定。
14. **（新）main 分支保護是否生效：不確定**。2026-11-22 20:5x 用 Hansheng 的 token 查 GitHub API：`GET /branches/main` 回 `protected: false`，但同一回應的 `protection` 顯示 `enabled: true`、必過檢查 `ci-ok`、`enforcement_level: non_admins`（管理員不受限）；`GET /branches/main/protection` 與 rulesets 都回 403「Upgrade to GitHub Pro or make this repository public to enable this feature」。repo 是私有、帳號是個人 Free 方案。可能的意思是：私有 repo 在 Free 方案下分支保護不會被強制；就算生效，`non_admins` 也不擋 Hansheng 本人（Claude Code 用的就是 Hansheng 的帳號）。目前實際擋住 Claude Code 推 main 的只有 pushguard 與 deny 規則。要改成公開 repo、升級 GitHub Pro，還是接受現狀，需要 Hansheng 決定；決定前派 T-001 等於沒有最後一道防線（範本 §1 第 7 項）。
15. **（新）環境變數名稱沒有定義**：ARCHITECTURE v1.0 只寫了 `VITE_SUPABASE_ANON_KEY`、`GEMINI_PAID_API_KEY`；其他（Supabase 網址、Gemini／Groq／Azure 金鑰與區域）沒有名稱。`.env.example` 因此從 T-001 移到 T-003（後端）與 T-018（前端）；名稱由誰定（Architect 補，或 TechLead 在那兩張單提案送 Architect Review）：不確定。
16. **（新）遠端分支 `task/O-001` 還在**：2026-11-22 20:5x `git ls-remote` 仍看得到 `refs/heads/task/O-001`（`fe39d0a`，已併入 main）。與「已刪除」的轉達不符；TechLead 沒有動它，請幕僚長確認後處理（憲章 §9）。

## 6. 變更紀錄
| 版本 | 日期 | 變更 |
|---|---|---|
| v0.1 | 2026-11-22 | 初稿（依幕僚長交接、憲章 v3）：O-001、T-001～T-048、A-001～A-002；送 G2 |
| v1.0 | 2026-11-22 | G2 通過後更新：Q-14～Q-20 改為已決定；新聞改三類輪替（T-005、T-022、T-023、T-025、T-026，新增 T-049）；複習間隔與輪替可在設定調整（T-004、T-008、T-009、T-020、T-032）；種子庫拆成匯入程式 T-024＋內容產生 T-050（6 批）；A-002 改為待辦；§5 第 1、2、6、7 點已決定，第 3、4 點交 O-001，第 8 點依 PRD v1.1 草稿改對應 AC-26；新增 §5 第 11～13 點；O-001 任務單已寫好 |
| v1.1 | 2026-11-22 | O-001 完成（PR #1）；T-001 任務單就緒並補上範圍（`tooling/` 規則測試；`.env.example` 移到 T-003／T-018）；T-003、T-018 寫明讓哪些 CI job 開始執行；§4 加上被略過 job 的開始時點；前置 2 完成、前置 4 標為不確定；新增 §5 第 14～16 點 |
