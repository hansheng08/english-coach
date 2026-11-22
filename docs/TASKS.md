# TASKS：english-coach 任務清單
- 版本：**v0.1（隨 ARCHITECTURE v0.1 送 G2）**｜日期：2026-11-22｜擁有者：TechLead｜路線：完整（憲章 v3 §2）
- 輸入：`docs/PRD.md` v1.0（`0276440`）、`docs/ARCHITECTURE.md` v0.1＋ADR-001～008＋`CLAUDE.md`（`ee2781b`）、`docs/OPEN_QUESTIONS.md`（Q-14～Q-20 待 G2）
- **G2 通過前不派任何單**。技術棧以 ADR-001～008 的「建議」為前提（TypeScript 全端＋Supabase）；G2 若改棧，本清單整份重排。
- 本清單只排順序、範圍和驗收方式；每張單的細節在派工時才寫成 `docs/tasks/<編號>.md`（憲章 §0、§13）。

> 名詞
> - **依賴**：這張單開始前，哪些單必須已經合併進 main。
> - **關鍵路徑**：依賴鏈中最長的一條；這條上任何一張延誤，整個專案就延誤。
> - **假設（待 Q-xx）**：Hansheng 還沒決定，先照 Architect 的建議答案寫；決定不同時，標了該 Q 的單要在派工前改寫。
> - **library 層／E2E 層**：憲章 §5 的 QA 規則原本以 CLI 為例；本專案先把「只有程式庫或 API、還沒有畫面可以操作」當 library 層，「第一次能在畫面上走完該 AC」當 E2E 層（見「待釐清」第 6 點）。

## 0. 開工前置條件（不是任務單，全部完成才派 T-001）
| # | 項目 | 誰 | 確認方式 |
|---|---|---|---|
| 1 | G2 通過（技術棧、Q-14～Q-20） | Hansheng | BOARD.md 有記 |
| 2 | Cursor GitHub App 授權本 repo | Hansheng | Bot 執行 `gh run list` 不再回 403 |
| 3 | Hansheng 電腦已裝 pstack | Hansheng | `/pstack:poteto-mode` 可執行 |
| 4 | O-001 的 PR 跑出 `ci-ok` 後，立即設 main 分支保護（必須走 PR、`ci-ok` 必過、禁止 force push、禁止刪 main） | Hansheng | PR 頁顯示 `ci-ok` 為 Required |
| 5 | 真 API 的 smoke 測試前，Hansheng 自己開好帳號並用 `supabase secrets set` 存金鑰（不經過對話） | Hansheng | 待 Q-20；CI 與一般任務單只用假供應商，不受影響 |

## 1. 共通規則（每張單都適用）
- 分支：T-xxx → `task/T-xxx`；O-xxx → `task/O-xxx`；A-xxx → `poc/A-xxx`（不合併）；修正輪次沿用原分支（憲章 §5）。
- 共通驗收（每張 T 單都要，驗收方式欄只列額外項目）：`pnpm install --frozen-lockfile`、`pnpm check`（= typecheck＋lint＋arch＋test）全過，且 PR 觸發的 CI run `ci-ok` 綠燈；被略過的 job 在 G3 逐一列出。
- 外部供應商在 CI 一律用假供應商或錄好的回應樣本（CLAUDE.md §7）；時間預算（3 s／5 s／30 s／60 s）在 CI 以假供應商驗「逾時設定與流程」，真實延遲只在 A-xxx 或手動 smoke 測。
- 狀態：`待辦`／`進行中`／`Review`／`QA`／`完成`；A-xxx 另有 `G2 決定後才開`。

## 2. Q-14～Q-20 的假設（未定案，TechLead 不代為決定）
| Q | 本清單採用的假設 | 受影響的單 | 若決定不同 |
|---|---|---|---|
| Q-14 | 假設：AC-10 為「3 s 內顯示核心 chunk 並可播放；8 s（p95）內補齊例句與 ≥ 2 個同義替換」；AC-03 反白查詢 p95 不保證 3 s | T-027、T-034、A-001 | 若維持 PRD 原文（3 s 完整卡），T-034 的驗收標準要改，且可能要先做 A-001 才知道做不做得到 |
| Q-15 | 假設：接受把去個資的履歷文字與逐字稿送 Gemini 免費層；錄音不送 Gemini | T-015、T-023、T-035、T-036、T-038 | 若不接受，需付費層或改架構 → 退回 Architect，這幾張單暫停 |
| Q-16 | 假設：主要來源 IEEE Spectrum、Semiconductor Engineering、NIST News；備用 GitHub Blog、InfoQ（不啟用） | T-022、T-023 | 只改 `news_source` 種子資料與測試樣本 |
| Q-17 | 假設：秒答與猶豫都算「答對」；Reviewing 時猶豫留在同一階 | T-008、T-009、T-032 | 改狀態機規則與對應測試 |
| Q-18 | 假設：14 天後維持每 14 天出現，直到轉 Mastered | T-008、T-032 | 改 SRS 間隔規則與測試 |
| Q-19 | 假設：接受 Supabase 免費方案（7 天無活動會暫停） | T-003 起所有後端單、T-025、T-046 | 若改 Cloudflare，後端單（T-003～T-007 及所有 Edge Function 單）整批重寫，需 Architect 先改架構 |
| Q-20 | 假設：Hansheng 同意開 Supabase、Gemini（無帳單專案）、Groq、Azure F0 帳號；Whisper 贅詞保留程度待實測 | T-015～T-017、T-012、T-030、T-037、T-038、A-002 | 帳號未開只擋真 API smoke 測；若 Whisper 贅詞保留不足，AC-15 贅詞計數改用手動切換 Gemini Transcribe（不改本清單順序） |

## 3. 任務清單（依依賴順序）
| 編號 | 標題 | 依賴 | AC／NFR | 依賴 Q（假設） | 驗收方式（共通驗收以外） | QA | 狀態 | 分支 | PR |
|---|---|---|---|---|---|---|---|---|---|
| O-001 | CI workflow（彙總 job `ci-ok`）＋`.claude/settings.json`＋pushguard hook（擋推 main、合併、開 PR）；CI 含秘密掃描 | 前置 1～3 | NFR-05 | — | PR 上看得到 `ci-ok`；pushguard 允許／拒絕對照表的測試全過（範本 §2）；`gh pr create`、`git merge`、推 main 的指令被 hook 拒絕；尚無檔案的 job 標「略過」並列名 | 免 QA（CI／`.claude/` 設定） | 待辦（任務單由 SRE 撰寫，憲章 §5） | task/O-001 | |
| T-001 | monorepo 骨架：`package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`eslint.config.js`、`.dependency-cruiser.cjs`、`.env.example`、`.gitignore` | O-001 | NFR-05（基礎） | — | `pnpm check` 在空專案通過；放一個違規 import 的暫存範例時 `pnpm arch` 失敗（報告貼輸出後移除）；`.gitignore` 含 `.env*` | 免 QA（無產品程式） | 待辦 | task/T-001 | |
| T-002 | `packages/contracts` 基礎：`Result`、`AppError`、`ProviderErrorKind`、`Tier`／`Capability`、四種供應商介面、ID 聯集 | T-001 | AC-24、AC-25（型別） | — | Vitest＋`expectTypeOf` 型別測試；contracts 只 import `zod`（`pnpm arch`） | library | 待辦 | task/T-002 | |
| T-003 | Supabase 骨架：`supabase/config.toml`、`functions/api` 單一路由（health＋JWT 檢查）、`_shared/config`（唯一讀 `Deno.env`）；**驗證 Deno 能否引用 `packages/contracts`**（ARCH §12） | T-002 | NFR-05、AC-23（基礎） | Q-19 | `supabase start`；`supabase functions serve` 後 `curl` health：無 JWT 回 401、有 JWT 回 200；報告寫明 Deno 引用方式結果（不行就停下回報，不自行改目錄） | library | 待辦 | task/T-003 | |
| T-004 | migration 1：`profile`、`card`、`card_review`、`seed_chunk`＋RLS | T-003 | AC-19、AC-24（資料） | Q-19 | `supabase db reset` 成功；`supabase test db`：A 使用者讀不到 B 的資料 | library | 待辦 | task/T-004 | |
| T-005 | migration 2：`news_source`、`news_article`（不存原文全文）、`daily_plan`、`resume`、`question`＋RLS | T-004 | AC-01、AC-02、AC-11 | Q-19 | 同 T-004；`news_article` 沒有原文全文欄位 | library | 待辦 | task/T-005 | |
| T-006 | migration 3：`shadow_attempt`、`evening_answer`、`slot_checkin`、`provider_call`、`weekly_metric` view＋RLS；錄音欄位 `audio_expires_at` | T-005 | AC-06、AC-14、AC-21、AC-22 | Q-19 | 同 T-004；`weekly_metric` 以測試資料查出預期值 | library | 待辦 | task/T-006 | |
| T-007 | `_shared/db` repository 基礎（回 `Result`）＋`provider_call` 寫入（不含內容） | T-006 | AC-24（紀錄）、NFR-04 | Q-19 | 本機 DB 整合測試；`pnpm arch` 確認 db 不 import 供應商 | library | 待辦 | task/T-007 | |
| T-008 | `domain`：台北日期計算＋SRS 間隔（3／7／14、忘記隔天、猶豫不長於秒答） | T-002 | AC-09 | Q-17、Q-18 | Vitest 單元測試，`now` 由參數注入；跨台北午夜的邊界案例 | library | 待辦 | task/T-008 | |
| T-009 | `domain`：字卡狀態機 Collected→Learning→Reviewing→Mastered（含 Reviewing 忘記退回） | T-008 | AC-19、AC-20 | Q-17 | 狀態轉換表逐列測試；`switch` 有 `never` 窮舉 | library | 待辦 | task/T-009 | |
| T-010 | `domain/plan`：每日 25 張選卡（15 舊＋10 新、不足補齊、升級語塊優先）、今晚題目、跟讀 5 句選句 | T-009 | AC-05、AC-07、AC-13、AC-16 | — | 單元測試：第一週舊卡不足、新卡不足用種子庫、前晚無作答全用新聞句 | library | 待辦 | task/T-010 | |
| T-011 | `domain/shadowing`：逐字比對正確率、語速比、解鎖判斷（≥ 80%／≥ 70%）、遮住約一半字詞 | T-002 | AC-05、AC-06 | — | 單元測試含門檻邊界（79.9%／80%、69.9%／70%）；發音分數不影響解鎖 | library | 待辦 | task/T-011 | |
| T-012 | `domain/speech-metrics`：停頓（> 2 s）、贅詞、每分鐘字數（依逐字時間戳記） | T-002 | AC-15 | Q-20（贅詞保留） | 單元測試用固定時間戳記樣本 | library | 待辦 | task/T-012 | |
| T-013 | `domain/chunk-hit`：目標 chunk 是否講出與加分 | T-002 | AC-18、AC-20 | — | 單元測試含大小寫、詞形變化、部分命中案例 | library | 待辦 | task/T-013 | |
| T-014 | `providers/registry`＋`config/paid.ts`＋`DEFAULT_SETTINGS`（全部 free）＋ADR-003 指定的 AC-25 測試 | T-003 | AC-24、AC-25、NFR-03 | — | ADR-003「測試」節全部項目：假 adapter 計數、預設 tier、`paid_not_allowed`、`resolvePaid` 型別測試、只有 registry 可 import `paid.ts` | library | 待辦 | task/T-014 | |
| T-015 | Gemini adapter（`generate`／`stream`，只用 `fetch` REST）＋契約測試 | T-014 | AC-24 | Q-15、Q-20 | 錄好的回應樣本做契約測試；zod 失敗只重試 1 次同模型 | library | 待辦 | task/T-015 | |
| T-016 | Groq Whisper adapter（含逐字時間戳記） | T-014 | AC-14 | Q-20 | 契約測試；429 回 `quota_exhausted`／`rate_limited` 不換供應商 | library | 待辦 | task/T-016 | |
| T-017 | Azure Speech adapter（發音評估＋TTS） | T-014 | AC-06、AC-04 | Q-20 | 契約測試；發音評估失敗時回錯誤由上層降級 | library | 待辦 | task/T-017 | |
| T-018 | `apps/web` 骨架：Vite＋React＋router、登入閘門（Supabase Auth，關閉註冊）、`api` 網路層 | T-003 | AC-23（基礎）、NFR-01 | — | Playwright：未登入導向登入頁、登入後進首頁（本機 Supabase） | E2E（第一個畫面） | 待辦 | task/T-018 | |
| T-019 | PWA：manifest、圖示、SW（外殼 precache、API network-only）、斷線提示、新版提示 | T-018 | NFR-01、NFR-06 | — | Playwright Pixel 360×640 無橫向捲動；離線模擬顯示「需要連網」；SW 不快取 `/functions/*` | E2E | 待辦 | task/T-019 | |
| T-020 | `POST /settings`＋設定頁（切換模型／STT／發音供應商、付費同意與月上限）＋結果頁 `meta` 顯示元件 | T-007、T-014、T-018 | AC-24、NFR-03 | — | 整合測試：切換後下一次請求用新選項；E2E：設定頁切換並顯示供應商名稱 | E2E | 待辦 | task/T-020 | |
| T-021 | `POST /tts`＋Storage 快取＋前端 `audio/player` | T-007、T-017、T-018 | AC-04、AC-05、AC-17（基礎） | — | 整合測試（假 TTS）：第二次同文字命中快取 | library | 待辦 | task/T-021 | |
| T-022 | `_shared/news`：RSS 抓取、來源白名單、主題篩選、原文 SHA-256 去重＋`news_source` 種子資料 | T-007 | AC-02 | Q-16 | 用錄好的 RSS 樣本測試；白名單外網址被拒；DB 無原文全文 | library | 待辦 | task/T-022 | |
| T-023 | 新聞改寫：Gemini prompt＋zod（250～300 字、5 個語塊含中文、「/」斷句）、不合格重試 1 次 | T-015、T-022 | AC-02、AC-05 | Q-15、Q-16 | 假 LLM 回傳合格／字數不足／chunk 數錯三種樣本 | library | 待辦 | task/T-023 | |
| T-024 | `seed_chunk` ≥ 600 條匯入 migration | T-004 | AC-07 | —（Q-10 已決定） | `select count(*) from seed_chunk` ≥ 600；欄位非空、無重複 chunk | library | 待辦 | task/T-024 | |
| T-025 | `daily-prep`＋`POST /plan/today`（冪等、抓不到新文章用最近未讀並標註）＋pg_cron 台北 05:00＋預產生 TTS | T-010、T-021、T-023、T-024 | AC-01、AC-05、AC-07、AC-13 | Q-19 | 整合測試：重複呼叫結果不變；無新文章時 `is_fallback_article=true`；`daily-prep` 失敗時 `status=failed` | library | 待辦 | task/T-025 | |
| T-026 | 首頁「今日任務」＋早上閱讀頁（改寫文、原文連結、語塊中文、備援文章註明、素材沒備好時重試） | T-019、T-025 | AC-01、AC-02 | — | E2E（假供應商）：換日後首次開啟即看到 1 篇新聞、5 句、25 張、今晚題目 | E2E | 待辦 | task/T-026 | |
| T-027 | `POST /cards`（不呼叫 AI）＋`/cards/lookup`＋`/cards/:id/enrich`＋閱讀頁「＋」收錄 | T-015、T-026 | AC-03 | Q-14 | E2E：點語塊顯示中文（0 次網路）、按「＋」後 3 s 內出現 Collected 卡（假供應商）；`/cards` 不呼叫 LLM（計數） | E2E | 待辦 | task/T-027 | |
| T-028 | 早上整句播放＋跟唸 2 遍計次（VAD，失敗可手動 +1）＋`slot_checkin` | T-021、T-026 | AC-04 | — | 單元測試 VAD 計次；E2E：5 句各計滿 2 次後早上閱讀打卡完成 | E2E | 待辦 | task/T-028 | |
| T-029 | `audio`：AudioWorklet 錄音、重新取樣成 16 kHz mono WAV、`storage` IndexedDB 待上傳錄音 | T-018 | AC-06、AC-25 | — | 單元測試 WAV 編碼與 44.1／48 kHz→16 kHz；IndexedDB 存取測試 | library | 待辦 | task/T-029 | |
| T-030 | `POST /shadow/attempts`（Azure 評分＋`domain/shadowing` 比對；評分失敗降級為「發音分數：無」） | T-007、T-011、T-017 | AC-06 | Q-20 | 整合測試（假 Azure）：回正確率、語速比、發音分數；評分失敗仍可解鎖判斷 | library | 待辦 | task/T-030 | |
| T-031 | 跟讀闖關頁：5 句、「/」斷句、原音自動播 2 遍、跟唸計 2 次、遮字錄音、解鎖、一鍵存 chunk | T-027、T-028、T-029、T-030 | AC-05、AC-06 | — | E2E（假錄音＋假 Azure）：未達門檻不能下一句、可重錄；存 chunk 產生字卡 | E2E | 待辦 | task/T-031 | |
| T-032 | `POST /reviews`（狀態機＋SRS，寫 `card_review`） | T-007、T-009 | AC-09、AC-19 | Q-17、Q-18 | 整合測試：秒答／猶豫／忘記後 `state`、`due_date` 正確 | library | 待辦 | task/T-032 | |
| T-033 | 中午複習頁：25 張、模式 A（回想／克漏字）、模式 B（排回句子）、三段評分；不載入錄音模組 | T-025、T-032 | AC-07、AC-08、AC-09、AC-19 | — | E2E：25 張依序答完；頁面沒有呼叫 `getUserMedia` | E2E | 待辦 | task/T-033 | |
| T-034 | `/cards/generate` 串流 NDJSON＋中午手動新增頁＋預取（600 ms）＋`speechSynthesis` 發音 | T-027、T-033 | AC-10 | Q-14 | E2E（假串流）：chunk 先顯示並可播放、補齊例句與 ≥ 2 個同義替換、確認後成為 Collected；8 s 逾時保留輸入可重試 | E2E | 待辦 | task/T-034 | |
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
| T-047 | 早中晚開始時間可調、可跳過單一步驟（Q-08 已決定） | T-020、T-026 | AC-01（Q-08） | — | E2E：改時段時間後首頁顯示新時間；跳過的步驟不擋打卡 | E2E | 待辦 | task/T-047 | |
| T-048 | 跨裝置同步 E2E（兩個瀏覽器 context）＋前端金鑰檢查（`VITE_` 變數白名單、建置後 bundle 掃描） | T-033、T-044 | AC-23、NFR-02、NFR-05 | — | E2E：A 裝置完成複習，B 重新整理後 60 s 內看到相同狀態；含 `KEY`／`SECRET`／`TOKEN` 的 `VITE_` 變數讓測試失敗 | E2E | 待辦 | task/T-048 | |
| A-001 | **G2 決定後才開**：AI 生卡延遲 PoC——Android Chrome 實測 `/cards/generate`（與 `/cards/lookup`）50 次，取 p50／p95 | G2 決定要開；Q-20 的 Gemini 金鑰 | AC-03、AC-10 | Q-14、Q-20 | Architect 的 PoC 報告列 50 次原始數據與 p50／p95；分支不合併 | 不適用 | G2 決定後才開（Architect 擁有） | poc/A-001 | 不開 PR |
| A-002 | **G2 決定後才開（保留編號）**：Whisper 贅詞保留程度＋Azure 短音訊延遲實測（ADR-004 建議、Q-20 提到的「PoC」） | G2 決定要開；Q-20 帳號 | AC-06、AC-15 | Q-20 | 同 A-001 | 不適用 | G2 決定後才開（是否開由 G2 決定） | poc/A-002 | 不開 PR |

## 4. 關鍵路徑與可平行的單
- **關鍵路徑**（15 張）：O-001 → T-001 → T-002 → T-003 → T-004 → T-005 → T-006 → T-007 → T-022 → T-023 → T-025 → T-033 → T-039 → T-040 → T-042。
- 可平行（檔案完全不重疊才同時派，憲章與 TechLead 規則）：`domain` 純邏輯單 T-008～T-013 只依賴 T-002，可在 T-003～T-007 期間進行；T-018、T-019、T-029、T-035 只依賴骨架，可與後端並行。
- 預設仍一次派一張；是否平行由幕僚長依用量預算決定。

## 5. 待釐清、衝突與不確定（不在本文件修正，G2 一併處理）
1. **G2 尚未通過**：ADR-001～008 都是「提議中」，本清單全部以建議方案為前提。
2. **pushguard 與 PoC 分支衝突**：範本 §2 的 pushguard 只放行 `task/*`、`fix/*`；A-001／A-002 用 `poc/A-xxx`（憲章 §5），會被拒成「問人」。是否把 `poc/*` 加入白名單由 SRE 在 O-001 決定。
3. **pushguard 的實作語言**：範本是 Go（需要本機有 `go`）；本專案是 TypeScript，CLAUDE.md 又規定「不新增依賴」。用 Go 還是 Node：不確定，由 SRE 在 O-001 決定。
4. **CI 範圍**：`supabase start` 需要 Docker；RLS 測試（`supabase test db`）與 E2E 要不要進 CI、會不會超出免費 Actions 用量：不確定，由 SRE 在 O-001 決定；不進 CI 的項目在 G3 列為略過。秘密掃描工具（gitleaks 或自寫）也由 O-001 決定（ARCH §7）。
5. **Deno 引用 `packages/*`**：ARCH §12 標「不確定」，T-003 先驗證；不行時要 Architect 決定改目錄，T-003 之後的後端單會延後。
6. **QA 規則對 PWA 的對應**：憲章 §5 以「library／CLI PR」區分；本專案沒有 CLI。本清單暫把「第一次能在畫面上走完該 AC」的單當作 CLI PR 的對應（QA 欄的 E2E），需幕僚長／QA 確認。
7. **種子庫內容來源**：Q-10 決定由 AI 產生 ≥ 600 條、「G2 前由 Hansheng 抽查 20 條」，但沒有指定由誰產生、何時產生。T-024 只負責匯入；600 條內容若要 Claude Code 在任務單內產生，一次做完的品質與長度不確定。
8. **Q-08 沒有對應 AC**：時段可調、可跳過步驟在 Q-08 已決定，但 PRD 的 AC-01～25 沒有寫成驗收標準；T-047 暫以 AC-01（Q-08）對應，驗收條件需 PM 確認。
9. **前端託管**：ARCH §13 寫 G4 由 SRE 決定（Cloudflare Pages 或 GitHub Pages）；本清單不含部署單，G4 時再開 O-xxx。
10. **AC-04 VAD 計次準確度**：ARCH §14 標「未驗證」，T-028 以「可手動 +1」作為備援，若實測不準是否算達成 AC-04：不確定。

## 6. 變更紀錄
| 版本 | 日期 | 變更 |
|---|---|---|
| v0.1 | 2026-11-22 | 初稿（依幕僚長交接、憲章 v3）：O-001、T-001～T-048、A-001～A-002；送 G2 |
