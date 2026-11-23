# ARCHITECTURE：english-coach（英文學習 PWA）
- 版本：**v1.4**（v1.0 於 2026-11-22 18:46 G2 通過；v1.1 為 ADR-008 修訂 1；v1.2 補 contracts 型別、ADR-009、ADR-008 修訂 2；v1.2.1 補 `news_unavailable` 的 HTTP 狀態；v1.3 為 T-003 的 Supabase 補充：ADR-010、§7.1（PR #11）；v1.4 補 domain 規則 §4.3～§4.7、ADR-011）｜日期：2026-11-23｜擁有者：Architect｜派工：ARCH-001｜路線：完整
- 輸入：`docs/PRD.md` v1.0、`docs/OPEN_QUESTIONS.md` v1.0（commit `0276440`）
- 技術棧與供應商已在 G2 依建議核准（ADR-001～008 皆「已接受」；ADR-009 於 v1.2 由 Architect 新增並接受；ADR-010 於 v1.3 隨 G2 PR 送審）；Q-14～Q-20 已決定（見 `docs/OPEN_QUESTIONS.md`）。本文件自 v1.0 起凍結，之後的修改依憲章 §0、§10。
- 標記規則：「未驗證」＝有公開資料但沒有在本專案實測；「不確定」＝沒有可靠資料，不猜。

> 名詞（第一次出現時的一句話解釋）
> - **PWA**：用網頁技術做、可以「加入主畫面」像 App 一樣開的網站。
> - **Service Worker（SW）**：瀏覽器在背景執行的小程式，負責快取與攔截網路請求。
> - **Edge Function**：放在雲端、收到請求才執行的小段後端程式，不用自己管伺服器。
> - **RLS（Row Level Security）**：資料庫依「目前登入者」自動過濾每一列資料的權限規則。
> - **STT**：語音轉文字。**TTS**：文字轉語音。**LLM**：大型語言模型（這裡指 Gemini）。
> - **RPM／RPD**：每分鐘／每天可以呼叫幾次 API 的上限。
> - **TTFT**：送出請求到收到第一個字的時間。**p50／p95**：一半／95% 的請求在這個時間內完成。
> - **串流（streaming）**：AI 一邊產生一邊回傳，不用等整段寫完。
> - **架構測試**：自動檢查「哪個模組可以 import 哪個模組」的測試，違規就讓 CI 失敗。

## 1. 系統脈絡（Context）
```
 Android Chrome PWA（主要）／桌機瀏覽器（輔助）
   │  HTTPS（Supabase JWT）
   ▼
 Supabase（建議區域 ap-northeast-1 東京）
   ├─ Auth：只有 Hansheng 一個帳號，關閉註冊（Q-01）
   ├─ Postgres＋RLS：字卡、計畫、紀錄、設定
   ├─ Storage：履歷原檔、錄音（90 天自動刪，Q-06）、TTS 快取
   ├─ Edge Functions（Deno／TypeScript）：所有呼叫外部 AI 的程式都在這裡（金鑰只存在這裡）
   └─ pg_cron：每天台北 05:00 備料、每天清除過期錄音
        │
        ├─ Gemini API（免費層）：改寫新聞、生卡、出題、診斷、改寫回答、chunk 偵測
        ├─ Groq Whisper（免費層）：晚上作答 STT（含逐字時間戳記）
        ├─ Azure Speech F0（免費層）：跟讀的發音評分＋逐字辨識；預產生 TTS
        └─ 新聞 RSS：AI／軟體工程／半導體產業三類每日輪替，每類 1 主 2 備（§11、ADR-006）
```
- 單一使用者、需連網（Q-01、Q-03、NFR-06）。不做離線練習，但 SW 快取 App 外殼，斷線時顯示提示而不是白畫面。
- 「零準備」靠伺服器端排程：每天台北 05:00 由 pg_cron 觸發 `daily-prep`，App 打開時只讀結果；排程失敗時，App 第一次開啟會呼叫同一支冪等（重複呼叫結果不變）的 `POST /plan/today` 補做（AC-01）。

## 2. 技術棧（G2 已核准，依原建議）
| 層 | 採用 | 曾評估的替代方案 | 依據 |
|---|---|---|---|
| 語言 | TypeScript 5（`strict`＋`noUncheckedIndexedAccess`＋`exactOptionalPropertyTypes`），前後端同一語言 | 後端 Go（ADR-001 表） | 型別嚴格、AI 熟悉度最高、前後端共用契約型別 |
| 前端 | React 19＋Vite＋`vite-plugin-pwa`（Workbox） | SvelteKit、Vue | 主流穩定；Vite 建置快 |
| 後端 | Supabase（Auth、Postgres、Storage、Edge Functions、pg_cron） | Cloudflare Workers＋D1＋R2＋Access；Firebase（不建議） | ADR-002：免費方案不綁卡、超量只會被擋不會計費 |
| 執行期驗證 | `zod`（AI 回傳 JSON、API 請求/回應都過 schema） | 手寫型別守衛 | AI 輸出不可信，必須在邊界驗證 |
| 測試 | Vitest（單元、契約）、Playwright（E2E，Android Chrome 模擬） | Jest | 與 Vite 同生態、速度快 |
| Lint／架構 | ESLint＋typescript-eslint（strict-type-checked）＋dependency-cruiser | eslint-plugin-boundaries | 讓「錯的 import」在 CI 失敗（第 3 節） |
| 套件管理 | pnpm workspaces | npm workspaces | 嚴格的依賴隔離，避免偷用未宣告套件 |
依賴總表與每個依賴的理由見 ADR-001 §依賴清單。供應商選擇見 ADR-003、ADR-004。

## 3. 模組邊界與允許的依賴
### 3.1 模組
| 模組（路徑） | 職責 | 可以依賴 | 禁止 |
|---|---|---|---|
| `packages/contracts` | API 請求/回應的 zod schema、供應商介面型別、錯誤型別 `AppError` | `zod` | 任何 I/O、任何其他模組 |
| `packages/domain` | 純邏輯：字卡狀態機（AC-19）、SRS 間隔（AC-09）、每日 25 張選卡（AC-07）、跟讀比對與語速（AC-06）、停頓/贅詞/字數統計（AC-15）、chunk 命中判斷（AC-18、AC-20）、新聞類別輪替與跳類別（AC-01、§11.2）、台北日期計算 | `contracts` | `fetch`、`Date.now()` 直接呼叫（時間由參數傳入）、資料庫、任何供應商 |
| `supabase/functions/_shared/providers/*` | 每個外部供應商一個 adapter（gemini、groq、azure-speech、webspeech 描述檔） | `contracts`、`config` | `domain`、資料庫、其他 adapter |
| `supabase/functions/_shared/providers/registry.ts` | 依使用者設定**只回傳被選中的那一個**供應商；檢查付費同意與月上限（ADR-003） | `contracts`、各 adapter | 任何「備援清單」或自動改選 |
| `supabase/functions/_shared/news` | RSS 抓取、主題篩選、來源白名單 | `contracts`、`config` | 抓白名單以外的網址 |
| `supabase/functions/_shared/db` | 唯一可以讀寫 Postgres/Storage 的程式（repository），也負責 JWT → `user_id` | `contracts`、`@supabase/supabase-js`（後端唯一可用處，ADR-008 修訂 1） | 供應商；回傳 `SupabaseClient` 或 `{ data, error }`（只回 `Result<T, AppError>`） |
| `supabase/functions/_shared/config` | 唯一可以讀 `Deno.env` 的地方（金鑰、模型名稱） | 無 | — |
| `supabase/functions/<endpoint>` | 薄的 HTTP handler：驗證 → 呼叫 domain/db/registry → 回應 | 以上全部 | 直接 import 某個 adapter（必須經過 registry）；import `@supabase/*`（資料庫與登入者都經過 `_shared/db`） |
| `apps/web/src/features/<feature>` | 畫面與互動（morning、shadowing、noon、evening、resume、dashboard、settings） | `contracts`、`apps/web/src/{api,audio,ui,storage}` | 其他 feature（共用的東西放 `ui`）；`@supabase/supabase-js`（只有 `api` 可以） |
| `apps/web/src/api` | 前端唯一的網路層（呼叫 Edge Functions、Supabase 讀表） | `contracts`、`@supabase/supabase-js` | 外部 AI 網址 |
| `apps/web/src/audio` | 錄音、WAV 編碼、播放、VAD（聲音偵測）、TTS 播放 | 無外部依賴 | 網路 |
| `apps/web/src/storage` | IndexedDB：待上傳錄音（AC-25 保留錄音） | 無 | 網路 |
| `apps/web/src/sw` | Service Worker（快取外殼） | `workbox-*`（由 vite-plugin-pwa 產生） | 快取 API 回應中的個資 |

### 3.2 用工具擋住錯誤寫法（「錯的程式寫不出來」）
1. **dependency-cruiser 規則**（CI 必過）：上表「禁止」欄逐條寫成規則；`packages/domain` 不得 import 任何非 `contracts` 的模組；feature 之間互相 import 直接失敗。
2. **ESLint `no-restricted-globals`／`no-restricted-imports`**：`fetch` 只允許出現在 `providers/*`、`news/*`、`apps/web/src/api/*`；`Deno.env` 只允許在 `config/*`；`Date.now`／`new Date()` 在 `domain` 禁用。
3. **型別**：供應商 ID、模型 ID、卡片狀態都是字串字面值聯集（union）＋`switch` 窮舉檢查（`never`），新增狀態沒處理就編譯失敗；金額、ID、台北日期等用品牌型別避免混用（寫法以 §5.0 為準：跨網路的值用 zod `.brand<'Ntd'>()` 等，例如 `NtdSchema`；其他用 §5.0.2 的 `Brand<T, B>`）。
4. **錯誤用 `Result<T, AppError>` 回傳**，跨模組不丟例外（第 6 節）；ESLint 禁止在 `domain` 與 `_shared/{providers,db,news}` 的**正式程式**使用 `throw`；測試程式（定義見第 6 點）可以 `throw`，但正式程式不得 import 測試程式（dependency-cruiser）。
5. **`@supabase/*` 只有兩個出入口**：`apps/web/src/api/**` 與 `supabase/functions/_shared/db/**`（dependency-cruiser，regex 涵蓋 `npm:`／`jsr:` 前綴）；全 repo 禁止 `http:`／`https:`／`npm:`／`jsr:` import（ESLint `no-restricted-imports`），Deno 第三方套件經 `deno.json` `imports` 對應成裸名稱。
6. **測試檔定義**（ESLint 與 dependency-cruiser 共用；ADR-008 修訂 2）：`(^|/)test/|\.test\.tsx?$|\.test-d\.ts$`（前端 `*.test.tsx` 算測試；`test/` 資料夾內的 `.ts`／`.tsx` 都算）。完整規則表見 ADR-008 修訂 1、2。
7. **套件之間只用套件名稱引用**（ADR-009）：禁止用相對路徑跨進 `packages/*`，禁止深層引用（只允許 `@english-coach/contracts`、`@english-coach/contracts/testing`、`@english-coach/domain`）；品牌型別的 `as` 轉型只能出現在建立函式所在檔案與測試程式（ESLint，ADR-008 修訂 2）。
8. **秘密掃描**：CI 跑「建置後的前端 bundle 不得出現任何金鑰變數名稱或已知金鑰前綴」的測試（第 7 節）。

## 4. 資料模型與儲存 schema
- 所有表都有 `user_id uuid not null references auth.users`，RLS：`user_id = auth.uid()`。只有 Edge Functions 用 secret 金鑰（`SUPABASE_SECRET_KEYS.default`，舊稱 service role；後端專用、會繞過 RLS）寫入需要伺服器驗證的欄位，而且只限 `daily-prep`、`purge-audio`；`api` 一律以使用者身分（publishable 金鑰＋使用者 JWT）查表，受 RLS 限制（§7.1）。
- 日期欄位 `plan_date date` 一律是**台北日期**；時間戳記一律 `timestamptz`（存 UTC）。
- 錄音欄位都有 `audio_expires_at = created_at + 90 days`；每日 pg_cron 刪 Storage 物件並把 `audio_path` 設為 null，逐字稿與分數保留（Q-06）。

| 表 | 主要欄位 | 對應 |
|---|---|---|
| `profile` | `user_id` PK、`timezone`（固定 `Asia/Taipei`）、`slot_start`（早中晚開始時間，Q-08）、`settings jsonb`（選用的 LLM 模型、STT、發音、TTS 供應商；`paid_consent_at`；`monthly_paid_cap_ntd`；`srs`（複習間隔，§4.2）；`news`（輪替設定，§11.2））。`settings` 只能經 `POST /settings` 寫入，伺服器用 `SettingsSchema`（zod）驗證 | AC-09、AC-19、AC-24、AC-25、NFR-03、Q-18 |
| `news_source` | `id`、`name`、`feed_url`、`category`（`ai`／`software`／`semiconductor`）、`priority`（1＝主要，2、3＝備用）、`fetch_mode`（`rss_full`：RSS 內有全文／`rss_then_page`：RSS 只有摘要，正文抓原文頁面）、`include_url_pattern`（選填，例如排除某分類）、`enabled`、`terms_checked_at` | AC-01、AC-02、Q-11、Q-16 |
| `news_article` | `id`、`source_id`、`category`、`original_url`（唯一）、`title`、`published_at`、`rewritten_text`（250～300 字）、`chunks jsonb[5]`（chunk、中文、所在句）、`sentences jsonb`（含「/」斷句）、`read_at`。**不存原文全文**，只存原文的 SHA-256 以便去重 | AC-01、AC-02、AC-05 |
| `daily_plan` | `user_id`＋`plan_date` 唯一；`planned_category`（當天輪到的類別）、`actual_category`（實際用的類別）、`category_skipped text[]`（沒有新聞而跳過的類別）、`article_id`、`is_fallback_article`（三類都沒新文章、改用最近未讀）、`shadow_items jsonb[5]`、`card_ids uuid[25]`、`tonight_question_id`、`status`（pending／ready／failed）、`error` | AC-01、AC-05、AC-07、AC-13 |
| `card` | `id`、`chunk`、`meaning_zh`、`example_en`、`synonyms text[]`、`source_sentence`、`source_type`（news／manual／evening／seed／shadowing）、`state`（collected／learning／reviewing／mastered）、`correct_count`（累計答對次數，只增不減，§4.3）、`interval_step`（0＝未進間隔、1／2／3＝第幾階、4＝第 3 階之後）、`due_date`（可為 null：剛收錄還沒出現過、或 Mastered）、`priority_new`（晚上勾選）、`seed_chunk_id`（可為 null；從種子庫轉來的卡指向 `seed_chunk.id`，唯一，用來判斷種子已用過，§4.4）、`tts_path`、`generated_by`（模型名稱） | AC-03、AC-07～10、AC-16、AC-19、AC-20 |
| `card_review` | `card_id`、`reviewed_at`、`mode`（A／B）、`rating`（fast／hesitant／forgot）、`state_before`、`state_after`、`interval_days_applied`（這次排程實際用的天數，設定改了也查得到當時的值） | AC-09、AC-19、AC-22 |
| `seed_chunk` | `id`、`chunk`、`meaning_zh`、`example_en`、`tags`、`batch`（1～6）；≥ 600 列。內容由**獨立任務單**產生：分 6 批、每批 100 條；第 1 批完成後由 Hansheng 抽查 20 條，通過才做第 2～6 批；每批以 migration 匯入（匯入程式與內容產生分開） | AC-07、Q-10 |
| `resume` | `user_id` PK（一次一份）、`storage_path`、`redacted_text`、`uploaded_at` | AC-11、AC-12、Q-09 |
| `question` | `id`、`resume_id`（可為 null，刪履歷時設 null 並標 `retired=true`）、`category`（intro／behavioral／technical）、`text`、`cited_experience`、`source`（resume／bank） | AC-11～13 |
| `shadow_attempt` | `plan_date`、`item_index`、`audio_path`、`audio_expires_at`、`recognized_text`、`accuracy`、`speed_ratio`、`pron_score`（可為 null）、`stt_provider`、`pron_provider`、`passed` | AC-06、AC-22 |
| `evening_answer` | `question_id`、`kind`（first／no_script）、`status`（uploaded／transcribed／diagnosed／failed）、`failure jsonb`、`audio_path`、`audio_expires_at`、`transcript`、`word_timings jsonb`、`pause_count`、`filler_count`、`wpm`、`diagnosis jsonb`、`rewrite_text`、`upgrade_chunks jsonb`、`chunk_hits jsonb`、`llm_model`、`stt_provider` | AC-14～18、AC-20、AC-22、AC-25 |
| `slot_checkin` | `plan_date`、`slot`（morning／noon／evening）、`step`、`completed_at` | AC-04、AC-21、M1 |
| `provider_call` | `capability`、`provider`、`model`、`tier`、`status`、`error_kind`、`latency_ms`、`created_at`（不存內容） | 可觀測性、AC-24、AC-25 |
| `weekly_metric`（view） | 由上面各表彙總：每週 Mastered 數、首答停頓＋贅詞、目標 chunk 講出率 | AC-22、M2～M4 |

### 4.1 字卡狀態機（`packages/domain/card-state`，AC-09、AC-19、Q-13、Q-17、Q-18）
```
collected --中午答對--> learning --中午再答對（累計 2 次）--> reviewing（第 1 階，間隔 step1）
reviewing: 秒答 → 下一階 step1→step2→step3，之後每次用 after_last
           猶豫 → 留在同一階（間隔不變，不長於秒答，AC-09）
           忘記 → 退回 learning，forgot_days 後到期
learning/collected: 忘記 → forgot_days 後到期
reviewing --晚上首答或無稿重答自然講出--> mastered（AC-20）
```
- 「答對」＝秒答或猶豫（Q-17 已決定）。
- 天數全部從 `settings.srs` 讀，`domain` 函式以參數接收（不讀資料庫、不讀全域）。
- 每一條邊的完整規則（`correct_count`、`interval_step`、到期日怎麼算、Mastered 之後）見 §4.3。

### 4.2 可調整的複習間隔（Q-18 已決定）
`settings.srs` 預設值與驗證（`packages/contracts` 的 `SrsSettingsSchema`；前端表單與 `/settings` 用同一份 schema）：
| 欄位 | 預設 | 意義 | 驗證 |
|---|---|---|---|
| `step_days` | `[3, 7, 14]` | Reviewing 第 1～3 階的間隔 | 剛好 3 個整數；每個 1～365；嚴格遞增 |
| `after_last_days` | `14` | 第 3 階之後每次的間隔 | 整數 1～365；≥ `step_days[2]` |
| `forgot_days` | `1` | 評「忘記」後幾天再出現（AC-09 的「隔天」） | 整數 1～`step_days[0]` |
- 「嚴格遞增」與「≥ 前一階」保證 AC-09「猶豫的間隔不長於秒答」在任何設定下都成立；不合格的值由 zod 擋下，回 400 `invalid_settings`，畫面標出哪一格錯。
- 生效範圍：**只影響之後的排程**；已排定的 `due_date` 不回頭重算（避免一改設定整批卡片同天到期）。每次排程把實際天數寫進 `card_review.interval_days_applied`。
- 設定頁「複習間隔」區塊：5 個數字欄位＋「還原預設（3／7／14／14／1）」按鈕。
- PRD AC-09 寫的 3／7／14 與「隔天」是**預設值**；可調整是 G2 的決定（Q-18）。PRD 文字是否要補註由 PM 決定（我不改 PRD）。

### 4.3 字卡狀態機規則（T-009；ADR-011 決定 1～3）
**contracts（新增 `packages/contracts/src/card.ts`，`index.ts` 加 `export * from './card.ts';`）**
```ts
export const CARD_STATES = ['collected', 'learning', 'reviewing', 'mastered'] as const;
export const CardStateSchema = z.enum(CARD_STATES);
export type CardState = z.infer<typeof CardStateSchema>;

export const REVIEW_RATINGS = ['fast', 'hesitant', 'forgot'] as const;   // 秒答／猶豫／忘記（值同 card_review.rating）
export const ReviewRatingSchema = z.enum(REVIEW_RATINGS);
export type ReviewRating = z.infer<typeof ReviewRatingSchema>;

export const REVIEW_MODES = ['A', 'B'] as const;                         // AC-08 的模式 A／B
export const ReviewModeSchema = z.enum(REVIEW_MODES);
export type ReviewMode = z.infer<typeof ReviewModeSchema>;

export const CARD_SOURCE_TYPES = ['news', 'manual', 'evening', 'seed', 'shadowing'] as const;
export const CardSourceTypeSchema = z.enum(CARD_SOURCE_TYPES);
export type CardSourceType = z.infer<typeof CardSourceTypeSchema>;

/** 0＝未進間隔；1／2／3＝Reviewing 第幾階；4＝第 3 階之後（同 card.interval_step）。domain 的 SrsStep（T-008）＝Exclude<IntervalStep, 0>。 */
const ReviewingStepSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const IntervalStepSchema = z.union([z.literal(0), ReviewingStepSchema]);
export type IntervalStep = z.infer<typeof IntervalStepSchema>;

/** 排程相關欄位；用 state 區分，讓不合法的組合（例如 mastered 卻有到期日）通不過 schema。 */
export const CardScheduleSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('collected'), correctCount: z.literal(0), intervalStep: z.literal(0), dueDate: PlanDateSchema.nullable() }),
  z.object({ state: z.literal('learning'), correctCount: z.number().int().min(1), intervalStep: z.literal(0), dueDate: PlanDateSchema }),
  z.object({ state: z.literal('reviewing'), correctCount: z.number().int().min(2), intervalStep: ReviewingStepSchema, dueDate: PlanDateSchema }),
  z.object({ state: z.literal('mastered'), correctCount: z.number().int().min(2), intervalStep: ReviewingStepSchema, dueDate: z.null() }),
]);
export type CardSchedule = z.infer<typeof CardScheduleSchema>;

/** POST /reviews 的請求（T-032 使用）。 */
export const ReviewRequestSchema = z.object({ cardId: CardIdSchema, mode: ReviewModeSchema, rating: ReviewRatingSchema });
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
```
- `collected` 的 `dueDate`：`null`＝剛收錄、還沒在中午出現過（算「新卡」）；有日期＝出現過但評「忘記」（算「到期舊卡」，§4.4）。
- 完整的 `Card` 回應 schema（`chunk`、`meaningZh`…）留給第一張回傳 `Card` 的 API 單，不在 T-009。

**domain（`packages/domain/src/card-state.ts`）**
```ts
export type ReviewOutcome = { readonly before: CardState; readonly schedule: CardSchedule; readonly intervalDaysApplied: number };
export function applyReview(card: CardSchedule, rating: ReviewRating, today: PlanDate, srs: SrsSettings): Result<ReviewOutcome, ValidationError>;
export function markMastered(card: CardSchedule): { readonly schedule: CardSchedule; readonly changed: boolean };
```
**轉換表**（`today`＝這次作答的台北日期；`d`＝`intervalDaysApplied`；到期日＝`addDays(today, d)`；`correctCount` 只增不減）
| 目前 | 評分 | 新狀態 | `correctCount` | `intervalStep` | `d` |
|---|---|---|---|---|---|
| collected | fast／hesitant | learning | +1（＝1） | 0 | `forgot_days` |
| collected | forgot | collected | 不變（0） | 0 | `forgot_days` |
| learning | fast／hesitant | reviewing | +1 | 1 | `step_days[0]` |
| learning | forgot | learning | 不變 | 0 | `forgot_days` |
| reviewing 第 k 階 | fast | reviewing | +1 | `nextSrsStep(k)` | `srsIntervalDays(nextSrsStep(k))` |
| reviewing 第 k 階 | hesitant | reviewing | +1 | k | `srsIntervalDays(k)` |
| reviewing | forgot | learning | 不變 | 0 | `forgot_days` |
| mastered | 任何 | — | — | — | 回 `err`（`kind: 'validation'`，`path: 'state'`；Mastered 不排程，不應出現在中午） |
- `markMastered`：只有 reviewing → mastered（`intervalStep` 保留最後一階、`dueDate: null`、`changed: true`）；其他狀態原樣回傳、`changed: false`。
- Learning 下次出現用 `forgot_days`（預設 1＝隔天）：AC-09 的 5 個設定裡唯一的短期間隔，且 `forgot_days ≤ step_days[0]` 已由 schema 保證；不新增設定欄位。
- 回到 Reviewing 從第 1 階開始（AC-09「**連續**秒答」被忘記打斷）。
- Mastered 是終點：不再排程、不再出現在中午、狀態不再改變（ADR-011 決定 2，需要 Hansheng 確認）。
- 同一張卡同一個台北日期只能評一次：由 `POST /reviews`（T-032）檢查，domain 不管。
- 測試（T-009）：上表逐列；改設定只影響這次以後（同一張卡用兩份設定各算一次）；`addDays` 失敗時回 `err`；`CardScheduleSchema` 擋下 4 種不合法組合（collected 的 `correctCount` 不是 0、learning 的 `intervalStep` 不是 0、reviewing 沒有 `dueDate`、mastered 有 `dueDate`）。

### 4.4 每日 25 張選卡（T-010；AC-07、Q-12；ADR-011 決定 4）
`selectDailyCards(input, today)`：呼叫端傳入候選，domain 只篩選、排序、取數量。
- **到期舊卡**：`state ∈ {collected, learning, reviewing}`、`dueDate ≠ null`、`dueDate ≤ today`。Mastered 不算（不排程）。排序：`dueDate` 早的優先 → `intervalStep` 小的優先（越不穩的越先）→ `createdAt` 早的優先 → `cardId`。取前 15 張。
- **新卡**：`state = collected` 且 `dueDate = null`（還沒在中午出現過）。排序：`priorityNew = true` 優先（AC-07、AC-16）→ `createdAt` 早的優先（先收的先學，不會有卡一直輪不到）→ `cardId`。
- **種子補位**：新卡不足時，從「還沒轉成字卡」的種子補（`seed_chunk.id` 不在任何 `card.seed_chunk_id` 中）；排序：`batch` 小的優先 → `seed_chunk.id`。選中的種子由 `daily-prep` 轉成 `source_type = 'seed'`、`state = 'collected'` 的卡。
- **數量**：舊卡 `o = min(15, 到期舊卡數)`；新卡目標 `25 − o`（舊卡不足 15 張時用新卡補滿，Q-12）；新卡＋種子仍不足時，再從到期舊卡第 16 張起往後補；全部候選都用完時回傳少於 25 張，畫面註明「今天只有 N 張」（**需要 Hansheng 確認**）。
- 沒被選上的到期舊卡不改到期日，明天自然排在前面。
- 種子消耗粗估（未驗證）：每天新卡＝`25 − 舊卡數 − 自己收錄的卡`。第 1 週舊卡少、新卡接近 25 張；之後舊卡穩定 ≥ 15 時每天約 10 張新卡。若幾乎不自己收錄，600 條約第 7～8 週用完；每天自己收錄 5 張以上則約 12 週後才用完。用完後走上面的「回傳少於 25 張」。
- 測試（T-010）：舊卡 0／10／15／30 張各一組；同到期日的排序鍵逐一驗證；`priorityNew` 優先；種子「用過」不再選；全部用完時張數 < 25；輸入順序打亂結果不變。

### 4.5 今晚題目與晚上提示 chunk（T-010；AC-13、M5）
- `selectTonightQuestion(candidates, today)`：候選＝`retired = false` 的題目。有任何 `source = 'resume'` 的題目時只從履歷題選（AC-13），否則從 `source = 'bank'` 選。排序：被問過的次數（`evening_answer` 中 `kind = 'first'` 的筆數）少的優先 → 最後一次被問的日期早的優先（沒問過的最前）→ `category` 依 `intro → behavioral → technical` → `questionId`。理由：M5 要求 ≥ 20 題履歷題各完成至少 1 次，「最少被問」優先能最快涵蓋全部題目（**需要 Hansheng 確認**）。選出後寫進 `daily_plan.tonight_question_id`，中午預覽與晚上讀同一個 id（AC-13）。
- **面試題庫（`source = 'bank'`）的內容目前沒有任務單**：建議比照種子庫，由獨立任務單用 AI 產生 ≥ 30 題（自我介紹／行為題／技術題各 ≥ 10，技術題涵蓋半導體設備系統軟體與 AI 開發應用），以 migration 匯入，Hansheng 抽查 5 題（**需要 Hansheng 確認**；TechLead 開單）。
- `selectEveningHintChunks(reviewedToday, reviewingFallback)`（AC-13 的 3 個提示 chunk，晚上開啟時計算，不在 `daily-prep`）：候選＝今天中午評過的卡（評分後的狀態），排序：Reviewing 優先 → `intervalStep` 大的優先 → 評分時間早的優先 → `cardId`，取 3 個。今天中午沒複習或不足 3 個時，用「最近一次評分日期最晚的 Reviewing 卡」補（同樣排序）；仍不足就顯示實際數量。

### 4.6 跟讀 5 句與遮字（T-010、T-011；AC-05、AC-06）
- `selectShadowSentences(newsSentences, rewriteSentences)`：前一晚有改寫版回答（`evening_answer.kind = 'first'` 的 `rewrite_text`，台北日期為前一天）時 **新聞 3 句＋改寫 2 句**，沒有時新聞 5 句（AC-05）。比例為**需要 Hansheng 確認**的預設：新聞是當天主素材、改寫句是個人化練習，3：2 讓兩者都有且以新聞為主。
  - 只選 6～25 個字的句子（太短沒有練習價值；太長錄音會超過 30 秒上限，§5.0.5）。
  - 新聞句排序：含當天 5 個語塊之一的句子優先 → 文章中的順序。改寫句排序：含升級語塊的句子優先 → 回答中的順序。
  - 一方不足時由另一方補；合計仍不足 5 句就回傳實際句數。順序：先新聞句、後改寫句。
- **遮字**（`maskWords`）：以空白切字，「字」的定義同 T-011 的正規化（去掉頭尾標點後非空才算字；「/」與單獨標點不算字、永遠顯示）。第 1、3、5…個字顯示，第 2、4、6…個字遮住（從 0 起算的奇數位置），所以 n 個字遮 ⌊n/2⌋ 個，第一個字一定看得到。理由：可重現、不需要詞性判斷或字典、每隔一字留下節奏線索（**需要 Hansheng 確認**；另一個選項是「只遮實詞」，要有停用詞表）。回傳每個 token 的原文與 `masked`，畫面怎麼畫（底線、字長提示）由前端決定。
- **確認 T-011 的計算定義**（照 ADR-004）：正規化（空白切字、轉小寫、去掉頭尾非字母數字撇號字元）、正確率＝詞級 Levenshtein 對齊中相同的詞數 ÷ 原句詞數（多講的字不扣分，因為 AC-06 比的是「原句講對多少」）、語速比＝原音長度 ÷ 使用者有聲長度（第一個字 `startMs` 到最後一個字 `endMs`）、解鎖＝正確率 ≥ 0.8 且語速比 ≥ 0.7。語速比可以大於 1（講得比原音快），畫面照實顯示百分比。
- 已知限制（不確定）：辨識結果把數字寫成阿拉伯數字（`3`）而原句是英文（`three`），或反過來時，會被算成錯字；Azure scripted 模式通常會照參考文字輸出，但沒有實測。先不處理，PoC（A-002）或實際使用後再決定。

### 4.7 chunk 命中判斷與計分（T-013；AC-18、AC-20、M4；ADR-011 決定 5）
`detectChunkHits(transcriptText, targets)` 回每個目標 `{ target, level: 'full' | 'partial' | 'none', matchedText }`；`scoreChunkHits(hits)` 回分數。
- **正規化**（逐字稿與 chunk 都做）：轉小寫；連字號換成空白（`buy-in` 與 `buy in` 視為相同）；去掉每個字頭尾的標點；以空白切字。比對以「整個字」為單位（`um` 不會命中 `umbrella`）。
- **佔位詞**（只出現在 chunk 裡）：`sb`、`someone`、`somebody`、`sth`、`something` 比對逐字稿中連續 1～4 個任意字；`one's`、`sb's`、`someone's` 比對 1 個所有格字（`my`、`your`、`his`、`her`、`its`、`our`、`their`，或以 `'s` 結尾的字）。
- **詞形**：chunk 裡每個非佔位詞 `w`，逐字稿中的字 `t` 符合下列任一就算相同：`t = w`；規則變化（`w+s`、`w+es`、子音＋`y` → `ies`／`ied`、`w+ed`、`w+d`、`w+ing`、去 `e` 加 `ing`、重複字尾子音＋`ed`／`ing`）；或 domain 常數表中的不規則形（約 100 個常見不規則動詞的過去式與過去分詞，含 `be` → `am/is/are/was/were/been/being`）。對所有詞都套用（名詞複數也適用）；誤判風險小，接受。
- **完整命中（`full`）**：所有非佔位詞依序、連續出現（佔位詞的位置可以夾 1～4 個字或 1 個所有格字）。
- **部分命中（`partial`）**：不是完整命中，但 chunk 有 ≥ 2 個非佔位詞，而且逐字稿中有一段長度 ≤（非佔位詞數＋2）的範圍，依序出現其中 ≥ ⌈非佔位詞數 ÷ 2⌉ 個。單字 chunk 只有 `full`／`none`。
- **計分**：`full` 每個 1 分，`partial` 0 分；`scoreChunkHits` ＝完整命中數。講出率＝完整命中數 ÷ 目標數，`weekly_metric` 用同一個定義（M4）。部分命中只在畫面顯示「差一點」（**需要 Hansheng 確認**）。
- **Mastered（AC-20）**：只有 `full` 才能讓 Reviewing 卡轉 Mastered（呼叫 `markMastered`）；首答時目標＝該使用者所有 Reviewing 卡的 chunk，無稿重答時目標＝勾選的升級語塊加上所有 Reviewing 卡的 chunk（Q-13：兩種作答都算）。
- **chunk 文字格式**（資料端保證，由 contracts 的 schema 檢查，T-024 種子匯入與 AI 產生字卡都要用）：只含英文字母、撇號、連字號、空白與上述佔位詞；不含括號、斜線、`…`。
- 測試（T-013）：大小寫與標點；`um`／`umbrella`；`buy-in`／`buy in`；規則變化每一種各一筆；不規則（`take`→`took`／`taken`、`be`→`was`）；佔位詞（`get buy-in from sb` 命中 `get buy-in from the whole team`）；部分命中門檻邊界；計分＝完整命中數。

## 5. API 與供應商契約
### 5.0 共用型別（`@english-coach/contracts`，ARCH-003；決策見 ADR-009）
- **擁有者**：本節所有型別、zod schema 與純函式都在 `packages/contracts`（套件名稱 `@english-coach/contracts`，引用方式見 ADR-009 決定 1）。例外會在註解寫明（例如 `PaidConsent` 的建立函式在 registry，錯誤訊息文字在前端）。
- **原則**：
  1. 能用 discriminated union（用一個字面值欄位區分各種形狀）就用；`switch` 的 `default` 一律寫 `const unreachable: never = x; return unreachable;`。
  2. 跨網路的資料（HTTP 請求／回應、外部 API 回傳）都要有 zod schema，型別用 `z.infer` 從 schema 推出來，不手寫第二份。
  3. 只在「混用會出錯」的地方用品牌型別（branded type）：資料庫 ID、台北日期、金額、已驗證的音訊、付費同意。品牌值只能由 schema 的 `parse`／`safeParse` 或指定的建立函式產生；`as <品牌型別>` 只允許出現在該型別的建立函式所在檔案與測試程式（ESLint，ADR-008 修訂 2）。
  4. 正式程式不 `throw`；contracts 不提供會丟例外的 `unwrap`。測試用的 `expectOk`／`expectErr` 放在 `packages/contracts/test/`，以 `@english-coach/contracts/testing` 匯出，正式程式 import 它會被 `adr008-11` 擋下。
  5. contracts 只 import `zod`；裡面的函式都是純函式（不讀時間、不連網路）。

#### 5.0.1 檔案配置
| 檔案（依 import 順序，箭頭右邊只能 import 左邊；`adr008-10` 禁止循環） | 內容 |
|---|---|
| 1. `src/brand.ts`、`src/result.ts`、`src/validation.ts` | `Brand<T, B>`；`Result`、`Ok`、`Err` 與 helper；`ValidationIssue`、`ValidationError`（三個檔案都不 import 任何東西） |
| 2. `src/ids.ts` | 品牌 ID、`PlanDate`、`Ntd`、`NewsCategory`、`ProviderId`、`LlmModelId`、`SttModelId`、`VoiceId` 與 schema |
| 3. `src/audio.ts`、`src/speech.ts` | `Wav16kMono`、`AudioPayload`、`parseWav16kMono`；`WordTiming`、`Transcript`、`PronunciationResult` 與 schema |
| 3. `src/settings.ts`、`src/card.ts`（與上一列同層） | `profile.settings` 的 schema：`SrsSettingsSchema`／`SrsSettings`（T-008，預設 3／7／14、14、1 只寫在這裡，§4.2）、`NewsSettingsSchema`（T-049 加在同檔，§11.2）；字卡狀態、評分、排程 schema（T-009，§4.3）。只 import `zod` 與 `ids.ts`（`PlanDate`、`NewsCategory`、`CardId` 的 schema） |
| 4. `src/providers.ts` | `Tier`、`Capability`、`ProviderErrorKind`（T-002 已建，內容不變）、`CapabilitySchema`、`ProviderError`、`ProviderInfo`、`StreamChunk`、四種供應商介面與參數／結果型別、`PaidConsent` |
| 5. `src/errors.ts` | `AppError`、`APP_ERROR_KINDS`、`httpStatusOf`、`isRetryable`、`toApiErrorBody`、`ApiErrorBodySchema` |
| 6. `src/api.ts` | 跨網路的 API schema：`CardStreamEvent`（`/cards/generate` 的 NDJSON）；之後各端點的請求／回應 schema 也放這裡或依功能拆檔 |
| `src/index.ts` | 重新匯出以上全部（相對路徑寫 `.ts` 副檔名，ADR-009） |
| `test/index.ts` | `expectOk`、`expectErr`（只給測試程式用，`@english-coach/contracts/testing`） |

#### 5.0.2 `Brand` 與 `Result`
```ts
// src/brand.ts
declare const brand: unique symbol;
/** 品牌型別：結構相同但不能互相指定。只能由建立函式或 zod `.brand()` 產生。 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

// src/result.ts
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
/** E 一律寫明（不設預設值，避免 result.ts 依賴 errors.ts 造成循環）：一般寫 Result<T, AppError>；供應商介面用 Result<T, ProviderError>（ProviderError 是 AppError 的子集合，可以直接往上傳）。 */
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T>;
export function err<E>(error: E): Err<E>;
export function isOk<T, E>(r: Result<T, E>): r is Ok<T>;
export function isErr<T, E>(r: Result<T, E>): r is Err<E>;
export function map<T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E>;
export function mapErr<T, E, F>(r: Result<T, E>, f: (error: E) => F): Result<T, F>;
export function andThen<T, U, E>(r: Result<T, E>, f: (value: T) => Result<U, E>): Result<U, E>;
export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T;
/** 把多個 Result 合成一個：全部成功回 ok(陣列)，否則回第一個 err。 */
export function all<T, E>(rs: readonly Result<T, E>[]): Result<T[], E>;
/** 只給 I/O 模組（providers、db、news、api）包住會丟例外的呼叫；onThrow 必須把 unknown 轉成具體錯誤。 */
export function tryCatch<T, E>(f: () => T, onThrow: (cause: unknown) => E): Result<T, E>;
export function tryCatchAsync<T, E>(f: () => Promise<T>, onThrow: (cause: unknown) => E): Promise<Result<T, E>>;
// 刻意不提供：unwrap()、expect()（會丟例外）。測試請用 @english-coach/contracts/testing 的 expectOk／expectErr。
```
- `tryCatch`／`tryCatchAsync` 內部用 `try/catch`，不 `throw`；`domain` 不應該需要它們（domain 不呼叫會丟例外的 API）。

#### 5.0.3 ID、日期、金額、供應商與模型
```ts
// src/validation.ts
export type ValidationIssue = { path: string; message: string };
export type ValidationError = { kind: 'validation'; issues: ValidationIssue[]; message: string };

// src/ids.ts（zod 4）
export const UserIdSchema     = z.uuid().brand<'UserId'>();
export const CardIdSchema     = z.uuid().brand<'CardId'>();
export const AnswerIdSchema   = z.uuid().brand<'AnswerId'>();
export const QuestionIdSchema = z.uuid().brand<'QuestionId'>();
export const ArticleIdSchema  = z.uuid().brand<'ArticleId'>();
/** 台北日期 YYYY-MM-DD（§4 plan_date）；只能由 domain 的台北日期函式或 schema 產生。 */
export const PlanDateSchema   = z.iso.date().brand<'PlanDate'>();
/** Storage 物件路徑，格式 `<user_id>/<bucket 內路徑>`。 */
export const StoragePathSchema = z.string().regex(/^[0-9a-f-]{36}\/[\w./-]+$/).brand<'StoragePath'>();
/** 新台幣整數元（付費月上限、用量）。 */
export const NtdSchema        = z.number().int().nonnegative().brand<'Ntd'>();
export type UserId = z.infer<typeof UserIdSchema>;      // 其他 ID 同樣寫法：CardId、AnswerId、QuestionId、ArticleId、PlanDate、StoragePath、Ntd
/** 金額運算後要回到 Ntd 只能經過這兩個函式（本檔是唯一可以 `as Ntd` 的地方）。 */
export function addNtd(a: Ntd, b: Ntd): Ntd;
export function subNtdFloor0(a: Ntd, b: Ntd): Ntd;   // 結果小於 0 時回 0
// PlanDate 由 domain 的台北日期函式（packages/domain/src/taipei-date.ts，唯一可以 `as PlanDate` 的正式程式檔）或 PlanDateSchema 產生。
// db 讀出的列一律先用 zod 的列 schema 驗證，ID 因此自然帶品牌，不需要 `as`。

/** 新聞類別（§11）；T-049 的 NewsSettingsSchema 用它。 */
export const NEWS_CATEGORIES = ['ai', 'software', 'semiconductor'] as const;
export const NewsCategorySchema = z.enum(NEWS_CATEGORIES);
export type NewsCategory = z.infer<typeof NewsCategorySchema>;

/** 供應商（不是品牌型別：字面值聯集就夠，新增時 switch 會編譯失敗）。付費版是不同的 id，因為金鑰不同（ADR-003 第 1 層）。 */
export const PROVIDER_IDS = ['gemini', 'gemini-paid', 'groq', 'azure-speech', 'azure-speech-paid', 'webspeech'] as const;
export const ProviderIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof ProviderIdSchema>;
// 'webspeech' 是瀏覽器內建 TTS，只出現在 meta 與設定，後端沒有它的 adapter。

/** 模型 ID 以 §5.3 為準；新增模型＝改這裡＋設定頁選項（AC-24），不改其他程式。 */
export const LLM_MODEL_IDS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'] as const;
export const LlmModelIdSchema = z.enum(LLM_MODEL_IDS);
export type LlmModelId = z.infer<typeof LlmModelIdSchema>;

export const STT_MODEL_IDS = ['whisper-large-v3-turbo', 'gemini-3.5-transcribe', 'azure-stt-short'] as const;
export const SttModelIdSchema = z.enum(STT_MODEL_IDS);
export type SttModelId = z.infer<typeof SttModelIdSchema>;

/** 語音 ID 帶供應商前綴，adapter 可以用 Extract<VoiceId, `azure:${string}`> 只接受自家語音。語音名稱未驗證，由 TTS adapter 單驗證後才能改。 */
export const VOICE_IDS = ['azure:en-US-AvaNeural', 'azure:en-US-AndrewNeural', 'gemini:Kore', 'gemini:Puck'] as const;
export const VoiceIdSchema = z.enum(VOICE_IDS);
export type VoiceId = z.infer<typeof VoiceIdSchema>;
```

#### 5.0.4 錯誤：`ProviderError`、`AppError`
```ts
// src/providers.ts（前三個型別 T-002 已建，逐字不變）
export type Tier = 'free' | 'paid';
export type Capability = 'llm' | 'stt' | 'pronunciation' | 'tts';
export type ProviderErrorKind =
  | 'quota_exhausted' | 'rate_limited' | 'unavailable' | 'timeout'
  | 'auth' | 'region_blocked' | 'invalid_response' | 'not_configured' | 'paid_not_allowed';

// （以下仍在 src/providers.ts）
export const CapabilitySchema = z.enum(['llm', 'stt', 'pronunciation', 'tts']);   // 型別測試：z.infer 等於 Capability
type ProviderErrorBase = { provider: ProviderId; capability: Capability; message: string };
/** 供應商層的錯誤（registry 與 adapter 只會回這些）。 */
export type ProviderError =
  | (ProviderErrorBase & { kind: 'quota_exhausted' | 'rate_limited'; retryAfterSec: number | null })
  | (ProviderErrorBase & { kind: 'paid_not_allowed'; reason: 'no_consent' | 'monthly_cap_reached' })
  | (ProviderErrorBase & { kind: 'unavailable' | 'timeout' | 'auth' | 'region_blocked' | 'invalid_response' | 'not_configured' });

// src/errors.ts
export type Entity = 'card' | 'answer' | 'question' | 'plan' | 'resume' | 'article' | 'audio';

/** 全系統唯一的錯誤型別（以 kind 區分）。message 只給開發者看（英文、不含使用者文字或逐字稿，CLAUDE.md §5 第 9 點）；畫面文字由前端依 kind 產生。 */
export type AppError =
  | ProviderError
  | ValidationError
  | { kind: 'unauthenticated'; message: string }
  | { kind: 'not_found'; entity: Entity; message: string }
  | { kind: 'conflict'; entity: Entity; message: string }
  | { kind: 'storage_failed'; op: 'upload' | 'download' | 'delete' | 'sign'; message: string }
  | { kind: 'db_failed'; message: string }
  | { kind: 'news_unavailable'; category: NewsCategory; message: string }   // 正常只在 daily-prep 內部流通；httpStatusOf 仍回 503（見對照表）
  | { kind: 'plan_not_ready'; message: string }
  | { kind: 'internal'; message: string };                                // handler 最外層兜底

export const APP_ERROR_KINDS = [
  'quota_exhausted', 'rate_limited', 'unavailable', 'timeout', 'auth', 'region_blocked',
  'invalid_response', 'not_configured', 'paid_not_allowed',
  'validation', 'unauthenticated', 'not_found', 'conflict', 'storage_failed', 'db_failed',
  'news_unavailable', 'plan_not_ready', 'internal',
] as const;
export type AppErrorKind = (typeof APP_ERROR_KINDS)[number];   // 型別測試：AppErrorKind 等於 AppError['kind']

export type HttpErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503 | 504;
export function httpStatusOf(e: AppError): HttpErrorStatus;     // 依下表，switch＋never 窮舉
export function isRetryable(e: AppError): boolean;              // 依下表
export function toApiErrorBody(e: AppError): ApiErrorBody;      // 只有 HTTP handler 呼叫

/** §6 第 2 點的錯誤回應（跨網路，有 zod）。 */
export const ApiErrorBodySchema = z.object({
  error: z.object({
    kind: z.enum(APP_ERROR_KINDS),
    message: z.string(),
    retryable: z.boolean(),
    provider: ProviderIdSchema.optional(),
    capability: CapabilitySchema.optional(),
    retryAfterSec: z.number().int().nonnegative().optional(),
    reason: z.enum(['no_consent', 'monthly_cap_reached']).optional(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
```

**錯誤碼對照表**（`httpStatusOf`、`isRetryable` 照這張表實作；前端 `apps/web/src/ui/error-messages.ts` 依 `kind` 用 `switch`＋`never` 產生畫面文字，新增 kind 沒處理就編譯失敗）
| kind | HTTP | 可重試 | 畫面文字（範本，前端擁有） | 降級／按鈕（§6） |
|---|---|---|---|---|
| `quota_exhausted` | 429 | 是 | 「{供應商}的免費額度用完了（{能力}），約 {n} 分鐘後可重送。不會自動改用其他或付費供應商。」 | 錄音保留；「稍後重送」「到設定改用其他供應商」（手動，AC-25）；發音評分 → 「不評分」模式；`daily-prep` → 舊文章 |
| `rate_limited` | 429 | 是 | 「{供應商}暫時太忙（每分鐘次數上限），約 {n} 秒後可重送。」 | 同上 |
| `unavailable` | 502 | 是 | 「{供應商}暫時無法使用。」 | 同上 |
| `timeout` | 504 | 是 | 「{供應商}超過 {秒} 秒沒有回應。」 | 同上；生卡串流 → 已收到的欄位保留，其餘背景補齊 |
| `invalid_response` | 502 | 是 | 「AI 回傳的內容格式不對（已重試 1 次）。」 | 同上（同模型重試 1 次後才回這個錯） |
| `auth` | 502 | 否 | 「{供應商}的金鑰無效或沒有權限，請 Hansheng 檢查 Supabase secrets。」 | 只能手動改供應商 |
| `region_blocked` | 502 | 否 | 「{供應商}不支援目前的伺服器地區。」 | 只能手動改供應商 |
| `not_configured` | 503 | 否 | 「{供應商}還沒設定金鑰。」 | 只能手動改供應商 |
| `paid_not_allowed` | 403 | 否 | `no_consent`：「付費供應商要先在設定頁同意並設定每月上限。」；`monthly_cap_reached`：「本月付費上限 NT${上限} 已用完。」 | 不呼叫付費 adapter（AC-25）；「到設定」 |
| `validation` | 400 | 否 | 「送出的資料不正確：{第一個 issue}」 | 停在原畫面，錄音保留 |
| `unauthenticated` | 401 | 否 | （不顯示，直接導向登入頁） | 登入後回原頁 |
| `not_found` | 404 | 否 | 「找不到這筆{項目}（可能已刪除）。」 | 回列表 |
| `conflict` | 409 | 否 | 「這筆{項目}已經被更新，已重新載入。」 | 重新讀取 |
| `storage_failed` | 502 | 是 | 「錄音或檔案上傳失敗，已保留在手機上。」 | 錄音留在 IndexedDB；「稍後重送」 |
| `db_failed` | 500 | 是 | 「伺服器暫時存不了資料。」 | 「重試」 |
| `news_unavailable` | 503 | 是 | 「今天的 {類別} 新聞暫時抓不到。」（正常不會出現在畫面：`daily-prep` 會先換類別或改用舊文章；只有程式錯誤讓它漏到 handler 時才顯示） | `daily-prep` 內部：換下一類 → 三類都沒有就改用舊文章（§11.2）；漏到前端時同 `plan_not_ready`：「重試」，字卡複習照常 |
| `plan_not_ready` | 503 | 是 | 「今天的素材沒備好。」 | 「重試」；字卡複習照常（§6 第 5 點） |
| `internal` | 500 | 是 | 「發生未預期的錯誤。」 | 「重試」 |
- `httpStatusOf`、`isRetryable` 對全部 18 種 kind 都有值（沒有「不適用」），型別測試逐一檢查。`news_unavailable` 取 503／可重試的理由：它表示「新聞來源暫時沒有可用文章」，是暫時性、隔天或稍後重抓就可能恢復的狀況，和 `plan_not_ready`（503／可重試）同類；不用 502，因為「類別在 48 小時內沒有新文章」不是上游故障。
- 這張表沒有任何一列會讓系統自己換供應商或改用付費（AC-25）；「可重試」只表示畫面可以出現重送按鈕，重送也只打同一個供應商。

#### 5.0.5 音訊與語音結果
```ts
// src/audio.ts
/** 已確認是 RIFF/WAVE、PCM 16-bit、16 kHz、單聲道、≤ 30 s 的音訊。只能由 parseWav16kMono 產生（本檔是唯一可以 `as Wav16kMono` 的地方）。 */
export type Wav16kMono = Brand<{ readonly bytes: Uint8Array; readonly durationMs: number }, 'Wav16kMono'>;
export function parseWav16kMono(bytes: Uint8Array, maxDurationMs?: number /* 預設 30_000 */): Result<Wav16kMono, ValidationError>;

/** STT 的輸入。晚上的回答是瀏覽器錄的 WebM/Opus；跟讀是 WAV。 */
export type AudioPayload =
  | { readonly format: 'wav-pcm16-16k-mono'; readonly wav: Wav16kMono }
  | { readonly format: 'webm-opus'; readonly bytes: Uint8Array };   // 大小上限由 endpoint 的 schema 檢查

// src/speech.ts（會回給前端，所以有 zod）
export const WordTimingSchema = z.object({
  word: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1).nullable(),               // 供應商沒給就是 null
}).refine((w) => w.endMs >= w.startMs);
export type WordTiming = z.infer<typeof WordTimingSchema>;

const TranscriptBase = z.object({
  text: z.string(),
  language: z.literal('en'),
  durationMs: z.number().int().nonnegative(),
  provider: ProviderIdSchema,
  model: SttModelIdSchema,
});
/** 有沒有逐字時間戳記用 timing 區分（AC-15 的停頓與語速需要 'words'）。 */
export const TranscriptSchema = z.discriminatedUnion('timing', [
  TranscriptBase.extend({ timing: z.literal('words'), words: z.array(WordTimingSchema) }),
  TranscriptBase.extend({ timing: z.literal('none') }),
]);
export type Transcript = z.infer<typeof TranscriptSchema>;

export const PronunciationResultSchema = z.object({
  score0to100: z.number().min(0).max(100),
  recognizedText: z.string(),
  words: z.array(WordTimingSchema),
  provider: ProviderIdSchema,
});
export type PronunciationResult = z.infer<typeof PronunciationResultSchema>;
```

#### 5.0.6 串流
```ts
// src/providers.ts
/** 供應商層的串流片段：只有文字增量與結束；解析 JSON 是呼叫端的事。 */
export type StreamChunk =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'done'; readonly finishReason: 'stop' | 'max_tokens' | 'safety'; readonly usage: { inputTokens: number; outputTokens: number } | null };

// src/api.ts
/** /cards/generate 回給前端的 NDJSON，每行一個事件（跨網路，有 zod）。順序：chunk → example → synonyms → done；中途失敗送 error 後結束。 */
export const CardStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chunk'), chunk: z.string().min(1), meaningZh: z.string() }),
  z.object({ type: z.literal('example'), en: z.string(), zh: z.string() }),
  z.object({ type: z.literal('synonyms'), items: z.array(z.string()).min(2) }),
  z.object({ type: z.literal('done'), cardId: CardIdSchema, meta: z.object({ llmModel: LlmModelIdSchema }) }),
  z.object({ type: z.literal('error'), error: ApiErrorBodySchema.shape.error }),
]);
export type CardStreamEvent = z.infer<typeof CardStreamEventSchema>;
```

#### 5.0.7 供應商介面（取代 v1.1 §5.2 的程式碼）
```ts
// src/providers.ts（續）
export interface ProviderInfo { readonly id: ProviderId; readonly capability: Capability; readonly tier: Tier; readonly displayName: string }

export type LlmRequest<T> = {
  model: LlmModelId; system: string; prompt: string;
  schema: z.ZodType<T>;               // 回傳先 JSON.parse（tryCatch）再 safeParse；失敗回 invalid_response
  maxOutputTokens: number; timeoutMs: number;
};
export type LlmStreamRequest = Omit<LlmRequest<unknown>, 'schema'>;   // 串流不帶 schema，呼叫端逐行用 CardStreamEventSchema 等驗證

export type SttOptions = { language: 'en'; wordTimestamps: boolean; prompt?: string; timeoutMs: number };
export type TtsResult = { audio: Uint8Array; mime: 'audio/mpeg' | 'audio/wav' | 'audio/ogg'; durationMs: number };

export interface LlmProvider extends ProviderInfo {
  readonly capability: 'llm';
  generate<T>(req: LlmRequest<T>): Promise<Result<T, ProviderError>>;
  stream(req: LlmStreamRequest): AsyncIterable<Result<StreamChunk, ProviderError>>;   // 出現 err 後不再產生
}
export interface SttProvider extends ProviderInfo {
  readonly capability: 'stt';
  transcribe(audio: AudioPayload, opts: SttOptions): Promise<Result<Transcript, ProviderError>>;  // wordTimestamps=true 時保證 timing='words'，否則回 invalid_response
}
export interface PronunciationProvider extends ProviderInfo {
  readonly capability: 'pronunciation';
  assess(audio: Wav16kMono, referenceText: string, opts: { timeoutMs: number }): Promise<Result<PronunciationResult, ProviderError>>;
}
export interface TtsProvider extends ProviderInfo {
  readonly capability: 'tts';
  synthesize(text: string, voice: VoiceId, opts: { timeoutMs: number }): Promise<Result<TtsResult, ProviderError>>;
}

/** ADR-003 第 2 層：只有 _shared/providers/registry.ts 的 grantPaidConsent(settings, usage) 能建立（唯一可以 `as PaidConsent` 的檔案）。 */
export type PaidConsent = Brand<{ readonly grantedAt: string; readonly monthlyCapNtd: Ntd; readonly usedThisMonthNtd: Ntd }, 'PaidConsent'>;
```
- 與 v1.1 的差異：`stream()` 的參數有了名字（`LlmStreamRequest`）；STT／發音／TTS 補上 `timeoutMs`（§6 第 6 點本來就要求每次外部呼叫設逾時）；`assess` 回傳改用具名的 `PronunciationResult`；`TtsResult.mime` 收斂成三種；介面各自固定 `capability`，registry 回傳型別因此能依能力縮小。
- **型別測試（T-051）**：每個聯集用 `expectTypeOf` 比對完整成員；`AppErrorKind` 等於 `AppError['kind']`；`CardId` 不能指定給 `AnswerId`、`string` 不能指定給 `PlanDate`（`@ts-expect-error`）；`httpStatusOf` 對 `APP_ERROR_KINDS` 每一項都有值且符合上表；`Transcript` 用 `timing` 縮小後才能讀 `words`；`parseWav16kMono` 對 8 kHz、雙聲道、> 30 s、非 RIFF 都回 `validation`。

### 5.1 HTTP API（Edge Functions，全部要 Supabase JWT，由函式內 `requireUser` 驗證、`verify_jwt = false`，見 §7.1；請求與回應都用 `packages/contracts` 的 zod schema 驗證）
| 端點 | 輸入 → 輸出 | 時間預算 | AC |
|---|---|---|---|
| `GET /health` | — → `{ ok: true }`（`HealthResponseSchema`）；沒有或無效 JWT → 401 `unauthenticated` | ≤ 1 s | NFR-05、AC-23（基礎） |
| `POST /plan/today` | — → `DailyPlan`（冪等；已存在就直接回傳） | ≤ 2 s（已備好時） | AC-01、AC-05、AC-07、AC-13 |
| `POST /cards` | `{chunk, sourceSentence, sourceType, meaningZh?}` → `Card`（**不呼叫 AI**） | ≤ 1 s p95（未驗證） | AC-03、AC-06、AC-16 |
| `POST /cards/lookup` | `{selection, sentence}` → `{meaningZh}`（反白任意詞句時才用） | 見 §8 | AC-03 |
| `POST /cards/generate` | `{input}` → 串流 NDJSON（每行一個欄位：chunk → example → synonyms） | 見 §8、ADR-005 | AC-10 |
| `POST /cards/:id/enrich` | 背景補齊例句、同義詞、TTS | 非同步 | AC-03 |
| `POST /reviews` | `{cardId, mode, rating}` → `Card` | ≤ 1 s | AC-08、AC-09、AC-19 |
| `POST /shadow/attempts` | WAV 16 kHz mono（≤ 30 s）＋`{planDate, itemIndex}` → `ShadowResult` | ≤ 5 s | AC-06 |
| `POST /evening/answers` | WebM/Opus 錄音＋`{questionId, kind}` → `{answerId, transcript}` | ≤ 30 s | AC-14、AC-17 |
| `POST /evening/answers/:id/diagnose` | — → `Diagnosis`（對照表、標記、統計、改寫、3～5 升級語塊） | ≤ 30 s | AC-15、AC-16 |
| `POST /evening/answers/:id/chunks` | — → `ChunkHits`（逐一是否講出、分數；Reviewing 卡轉 Mastered） | ≤ 30 s | AC-18、AC-20 |
| `POST /evening/upgrade` | `{answerId, chunkIndexes}` → 新字卡（`priority_new=true`） | ≤ 2 s | AC-16、AC-07 |
| `POST /resume` | `{storagePath, redactedText}` → `Question[≥15]` | ≤ 60 s | AC-11 |
| `DELETE /resume` | — → `{deleted: true}`（刪 Storage 原檔、`redacted_text`；舊題標 retired） | ≤ 5 s | AC-12 |
| `POST /tts` | `{text, voice}` → `{audioUrl}`（有快取就直接回） | ≤ 3 s | AC-04、AC-05、AC-10、AC-17 |
| `POST /settings` | `SettingsPatch` → `Settings`（伺服器用 `SettingsSchema` 驗證：付費同意（ADR-003）、`srs` 間隔規則（§4.2）、`news` 輪替（§11.2）） | ≤ 1 s | AC-09、AC-24、AC-25 |
| `POST /retry/:answerId` | 重送失敗的錄音處理 | 同原端點 | AC-25 |
- 讀取類（儀表板、成長曲線、紀錄、字卡列表）直接用 supabase-js 讀表（受 RLS 保護），不另寫 API（AC-21～23）。
- 所有 AI 結果回應都帶 `meta: { llmModel?, sttProvider?, pronProvider?, ttsProvider? }`，結果頁顯示（AC-24）。

### 5.2 供應商介面（`packages/contracts/src/providers.ts`）
- 完整定義見 §5.0.4（`ProviderError`）與 §5.0.7（四種介面、`PaidConsent`）。v1.1 這裡的程式碼已由 §5.0 取代；`Tier`、`Capability`、`ProviderErrorKind` 三個型別內容不變。
- 所有 adapter 只用 `fetch` 呼叫 REST，**不使用供應商 SDK**（少依賴、可完全掌握呼叫哪個端點；ADR-003）。
- AI 回傳一律要求 JSON 並用 zod 驗證；驗證失敗回 `invalid_response`，最多重試 1 次（同一供應商同一模型）。

### 5.3 預設供應商（ADR-004）
| 能力 | 預設（免費） | 可手動切換的其他免費選項 | 付費選項（只有手動選＋同意後才可用） |
|---|---|---|---|
| LLM | Gemini `gemini-3.5-flash-lite`（日常）；診斷可選 `gemini-3.8-flash`（免費層每天約 20 次） | `gemini-3.1-flash-lite` | Gemini 付費層（另一個有綁帳單的專案金鑰） |
| STT（晚上） | Groq `whisper-large-v3-turbo` | Gemini `gemini-3.5-transcribe`、Azure STT F0 | MVP 不提供（需要時走變更路線） |
| 發音評分＋跟讀辨識 | Azure Pronunciation Assessment（F0） | 「不評分」模式（只用 STT 算正確率與語速；發音分數顯示「無」） | Azure S0 |
| TTS | 備料時預產生：Azure Neural TTS（F0）；即時：瀏覽器 Web Speech `speechSynthesis` | Gemini `gemini-3.8-flash-lite-tts` | — |

## 6. 錯誤處理
1. **不丟例外跨模組**：`domain`、`providers`、`db`、`news` 一律回 `Result<T, AppError>`，正式程式不寫 `throw`（§3.2 第 4 點，lint 執行）；`fetch`、`supabase-js`、`JSON.parse` 丟出的例外在模組內 `catch` 轉成 `err`，zod 用 `safeParse`；窮舉檢查用 `const unreachable: never = x; return unreachable;`。HTTP handler 是唯一把錯誤轉成回應的地方（handler 最外層可以 `try/catch` 兜底，轉成 500 回應）。測試程式不受此限（ADR-008 修訂 1）。
2. **錯誤回應格式**：`ApiErrorBodySchema`（§5.0.4）：`{ error: { kind, message, retryable, provider?, capability?, retryAfterSec?, reason?, issues? } }`；`kind` 只能是 `APP_ERROR_KINDS` 之一，HTTP 狀態、可否重試、畫面文字與降級方式見 §5.0.4 錯誤碼對照表（驗證失敗 400、未登入 401、付費未同意 403、額度用完／太頻繁 429、供應商失敗 502、未設定金鑰或素材沒備好 503、逾時 504）。
3. **錄音先存再處理**（AC-25）：前端錄完先寫進 IndexedDB，再上傳 Storage，成功後才呼叫 STT；任何一步失敗，錄音仍在 IndexedDB 或 Storage，`evening_answer.status=failed`＋`failure`，畫面顯示原因（例如「Groq 免費額度今天用完，約 X 分鐘後可重送」）與兩個按鈕：「稍後重送」「改用其他供應商」（手動）。
4. **絕不自動改用其他供應商或付費**：registry 沒有備援清單（ADR-003）；`quota_exhausted` 直接回給使用者。
5. **降級模式**（不花錢、不換供應商）：發音評分失敗 → 仍顯示正確率與語速、發音分數「無」，不擋關（AC-06 允許）；當天新聞抓不到 → 用最近一篇未讀文章並在頁面註明（AC-01）；`daily-prep` 整體失敗 → 開 App 時重試一次，再失敗就顯示「今天的素材沒備好」＋重試按鈕，字卡複習（不需 AI）照常可用。
6. **逾時**：每次外部呼叫都設 `timeoutMs`（生卡 8 s、STT 25 s、診斷 25 s），逾時回 `timeout`，不自動重試到別家。
7. **AI 輸出不合格**：zod 驗證失敗、字數不在 250～300、chunk 不是 5 個 → 同模型重試 1 次，再失敗記錄 `failed` 並走降級。

## 7. 安全
- **金鑰不進 repo、不進前端**（NFR-05）：Gemini、Groq、Azure 金鑰只存在 Supabase Edge Function secrets（用 `supabase secrets set` 由 Hansheng 本人在自己電腦輸入），程式只在 `config/` 讀 `Deno.env`。`.env*` 全部列在 `.gitignore`；repo 只放 `.env.example`（只有變數名稱）。變數名稱見 §7.1。
- **前端只拿得到公開金鑰**：Supabase 的 publishable/anon key 設計上可以公開，安全靠 RLS；Vite 只會把 `VITE_` 開頭的變數打包進前端，所以規定：任何 `VITE_` 變數名稱不得含 `KEY`、`SECRET`、`TOKEN`（`VITE_SUPABASE_PUBLISHABLE_KEY` 例外，寫死在白名單；舊的 anon 金鑰 Supabase 將於 2026 年底淘汰，不使用），由 CI 測試檢查。
- **Azure 金鑰不下發**：跟讀錄音由前端上傳到 Edge Function，再由伺服器呼叫 Azure（金鑰不出伺服器）。
- **CI 秘密掃描**：建置後掃 `dist/` 與 repo，命中已知金鑰格式（例如 `AIza`、`gsk_` 前綴）即失敗。工具選擇（gitleaks 或自寫腳本）由 O-001 決定。
- **登入**：Supabase Auth email＋密碼（或 magic link），**關閉註冊**；只有 Hansheng 一個帳號（Q-01）。
- **個資（NFR-04、Q-06）**：
  - 履歷在**瀏覽器端**解析成文字（PDF 用 `pdfjs-dist`、DOCX 用 `mammoth`），用規則移除電話、Email、地址後，只把 `redacted_text` 送後端與 AI；原檔存在私有 Storage bucket（AC-12 可刪）。
  - 錄音只送 STT／發音供應商，不送 Gemini；送 Gemini 的是逐字稿。
  - Storage bucket 全部 private，只用短效 signed URL 讀取。傳輸全程 HTTPS。
  - **風險**：Gemini、Azure、Groq 的免費層可能把送出的內容用於改善產品（Gemini 定價頁免費層標示「Used to improve our products: Yes」；Groq、Azure F0 的資料使用條款「未驗證」）。Q-15 已決定：接受（錄音不送 Gemini、履歷先去個資）。
- **新聞來源白名單**：`news` 模組只抓 `news_source` 裡的網址，避免被當成任意網址的代理。

### 7.1 Edge Functions：環境變數、身分驗證、Deno 型別（ADR-010）
**環境變數**（只在 `supabase/functions/_shared/config/**` 讀；`SUPABASE_` 開頭的是 Supabase 自動注入、不能自設）
| 名稱 | 來源 | 用途 |
|---|---|---|
| `SUPABASE_URL` | 自動注入 | supabase-js client |
| `SUPABASE_PUBLISHABLE_KEYS`（JSON，取 `default`；備援 `SUPABASE_PUBLISHABLE_KEY`） | 自動注入 | 驗 JWT、以使用者身分查表（RLS） |
| `SUPABASE_SECRET_KEYS`（JSON，取 `default`；備援 `SUPABASE_SECRET_KEY`） | 自動注入 | 只給 `daily-prep`、`purge-audio` |
| `GEMINI_API_KEY` | Hansheng（沒有連結帳單的專案） | Gemini adapter |
| `GEMINI_PAID_API_KEY` | Hansheng（MVP 不設定） | 只有 `config/paid.ts` |
| `GROQ_API_KEY` | Hansheng | Groq adapter |
| `AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION` | Hansheng | Azure Speech adapter |
| `APP_ALLOWED_ORIGINS` | Hansheng（逗號分隔；本機 `http://localhost:5173`） | `api` 的 CORS |
- 不使用：`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`（年底淘汰）、`SUPABASE_DB_URL`（不直連 Postgres）、`SUPABASE_JWKS`。
- 前端（T-018）：`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`。
- 檔案：`supabase/functions/.env.example`、`apps/web/.env.example`（只有名稱）；本機值放 `supabase/functions/.env`、`apps/web/.env.local`（已被 `.gitignore` 忽略）；正式環境用 `supabase secrets set`。供應商金鑰缺少時該能力回 `not_configured`（503）；Supabase 變數缺少回 `internal`（500）。log 與錯誤訊息只能寫變數名稱，不能寫值。

**身分驗證**
- `supabase/config.toml` 每個函式都 `verify_jwt = false`；驗證一律在函式內做。理由：`verify_jwt` 也接受公開的 publishable 金鑰，不能證明有登入使用者；官方疑難排解頁建議關閉內建檢查改在程式內驗；這樣 401 一律是 `ApiErrorBody`，CORS 預檢也由我們自己回。
- `functions/api`：路由器先處理 `OPTIONS`（CORS，204），其他請求一律先過 `_shared/db/auth.ts` 的 `requireUser`（讀 `Authorization: Bearer`、supabase-js `auth.getClaims(token)`、要求 `role = authenticated`、拒絕匿名使用者），成功才得到品牌型別 `AuthContext`（只有 `auth.ts` 能建立）。路由簽名是 `(req, ctx: AuthContext) => Promise<Response>`，沒有公開路由。查表用 `createUserDb(ctx)`（publishable 金鑰＋使用者 token，RLS 生效）。
- `daily-prep`、`purge-audio`（pg_cron 呼叫）：`requireServiceKey` 比對 `apikey` 標頭與 secret 金鑰（固定時間比較）；pg_cron 從 Vault 取金鑰。
- 不使用 `@supabase/server`（未核准的新依賴）。

**Deno 型別（Node 端 tsc／ESLint）**
- `supabase/functions/tsconfig.json`：`lib: ["ES2023", "WebWorker"]`、`types: []`、`composite`、`emitDeclarationOnly`、`allowImportingTsExtensions`，加入根 `tsconfig.json` 的 `references`，所以 `pnpm typecheck`／`pnpm lint` 都會檢查後端程式。
- `supabase/functions/_types/deno.d.ts`：只宣告 `Deno.env.get` 與 `Deno.serve`；用到其他 Deno API 會編譯失敗，要先改這個檔案（Architect Review）。
- `Deno.serve` 只能在 `<函式>/index.ts`（ESLint，ADR-008 第 15 條）；`index.ts` 以外的檔案不在 import 時讀 `Deno`，所以 Vitest（Node）可以測路由與 `_shared/**`。
- 不在 `pnpm check` 跑 `deno check`；Deno 端實際能否載入、執行，由 CI `db` job（SRE）的 `functions serve`＋health 檢查證明。
- 未驗證：CLI 3.2.0 本機是否注入 `SUPABASE_PUBLISHABLE_KEYS`／`SUPABASE_SECRET_KEYS`；`WebWorker` lib 是否涵蓋會用到的所有 Web API（例如 `Response.json()`）；`getClaims` 在本機 CLI 的行為。不確定：`verify_jwt` 的移除時程（官方未公布）。

## 8. 效能預算
| 項目 | PRD 上限 | 設計目標 | 怎麼做到 | 狀態 |
|---|---|---|---|---|
| AC-03 點已標出語塊 → 中文意思 | —（含在 3 s 內） | 立即（0 次網路） | 備料時 5 個語塊的中文已算好、存在 `news_article.chunks` | 設計可達成 |
| AC-03 按「＋」→ Collected 字卡 | 3 s | p95 ≤ 1 s（未驗證） | `POST /cards` 不呼叫 AI，只寫入 chunk＋原句；例句等由 `/enrich` 背景補 | 設計可達成 |
| AC-03 反白任意詞句 → 中文意思 | 3 s | p50 ≤ 2.5 s、p95 ≤ 5 s（未驗證） | Gemini Flash-Lite、思考等級 minimal、輸出 ≤ 60 tokens | **p95 不保證**（Q-14 已接受） |
| AC-10 手動新增 → 完整字卡 | 3 s | 首段 ≤ 3 s、完整 ≤ 8 s（p95，未驗證） | 串流＋發音用 Web Speech 即時播放（ADR-005） | **已放寬**（Q-14） |
| AC-06 跟讀比對 | 5 s | p95 ≤ 5 s（未驗證） | WAV ~200 KB 上傳＋Azure 短音訊 REST 一次回辨識文字與發音分數；比對在 `domain` 本地計算 | 待 PoC |
| AC-11 履歷出題 | 60 s | ≤ 30 s | 1 次 LLM 呼叫產生 ≥ 15 題 | 可達成（未驗證） |
| AC-14 逐字稿 | 30 s | ≤ 10 s | Groq Whisper 官方標示即時倍速約 189～216 倍；3 分鐘錄音（約 1.5 MB）上傳為主要耗時 | 可達成（未驗證） |
| AC-15 診斷 | 30 s | ≤ 20 s | 1 次 LLM 呼叫；統計（停頓、贅詞、字數）由 `domain` 依時間戳記本地計算 | 可達成（未驗證） |
| AC-23 同步 | 60 s | 重新整理即見 | 所有寫入直接進 Postgres，沒有本機延遲同步 | 設計可達成 |
| App 外殼開啟 | — | 第二次開啟 ≤ 1.5 s（未驗證） | SW precache；首屏 JS ≤ 200 KB gzip | 目標 |

### 8.1 3 秒結論（AC-03、AC-10）
- **公開數據**：Artificial Analysis 測得 `gemini-3.5-flash-lite`（Google API）輸出速度約 314 tokens/s、「第一個答案 token」約 4.6～4.7 s（它的測試題目較長，含思考時間）；OpenRouter 即時資料顯示 Google AI Studio／Vertex 的第一個 token 約 0.39～1.25 s、速度約 120～200 tokens/s（benchleader 轉載，2026-11-21）。Gemini 官方速率限制頁寫明「Specified rate limits are not guaranteed and actual capacity may vary」，免費層沒有延遲保證。
- **估算（全部未驗證）**：手機 4G 往返約 0.1～0.3 s＋Edge Function 冷啟動 0～0.5 s＋TTFT 0.4～1.3 s（短 prompt、思考 minimal）＋生成約 150 tokens 約 0.8～1.3 s ≈ **p50 約 1.5～3 s，p95 很可能超過 3 s**（免費層壅塞、429／503 重試）。
- **結論**：
  - AC-03 **可以達成**：把 AI 移出關鍵路徑（預先算好語塊中文、建卡不等 AI）。只有「反白任意詞句看中文」依賴 AI，p95 不保證。
  - AC-10 **免費層無法「可靠」做到 3 秒內完整卡片**。Q-14 已決定採用：「3 秒內出現核心 chunk（串流第一段），8 秒內完整卡片（含 ≥ 2 個同義替換、例句與可播放發音）」；（Q-14，2026-11-22 G2）。PRD AC-10 文字由 PM 依變更路線更新。G2 後如需實測，建議開 A-001 PoC 量 50 次 p50／p95。
- **減少等待的設計**（ADR-005）：(1) 串流 NDJSON，chunk 一到就顯示並可播放（Web Speech `speechSynthesis` 不需網路往返）；(2) 輸入框停止打字 600 ms 後先送「預取」請求，按下送出時多半已在途中（會多耗 RPD，可在設定關閉）；(3) 5 個新聞語塊與 25 張字卡的內容在 05:00 備料時全部算好；(4) Edge Function 固定在東京區（`x-region: ap-northeast-1`），與資料庫同區。

## 9. Android＋Chrome PWA（NFR-01）
- **可安裝**：Chrome 108 起不再要求 SW 有 fetch handler；條件是 HTTPS、manifest（`name`、`short_name`、192/512 px 圖示、`start_url`、`display: standalone`）。我們仍提供 SW 以快取外殼。
- **SW 策略**（Workbox，由 `vite-plugin-pwa` 產生）：App 外殼 precache；`/functions/*` 與 Supabase 資料一律 **network-only**（不快取個資與 AI 結果）；TTS 音檔 cache-first、上限 50 個、7 天；斷線時顯示「需要連網」提示（NFR-06、Q-03 不做離線練習）。
- **新版本**：`registerType: 'prompt'`，有新版時跳出「更新」按鈕，不在練習中途自動重整。
- **麥克風**：`getUserMedia` 只在 HTTPS 可用；第一次在「開始錄音」按鈕點擊後才要求權限（不在開 App 時要）；被拒絕時顯示「到 Chrome 網站設定開啟麥克風」的說明頁；中午模式（S2）全程不碰麥克風（AC-08）。
- **錄音格式**：
  - 跟讀（短句、要評發音）：`AudioWorklet` 取 PCM，降頻到 16 kHz mono，自己編成 WAV（約 32 KB/秒，30 秒上限約 1 MB）。Azure 短音訊 REST 只收 WAV PCM 16 kHz 或 OGG Opus。
  - 晚上作答（2～3 分鐘，AC-14）：`MediaRecorder` `audio/webm;codecs=opus`（Chrome 原生支援，約 24～32 kbps，3 分鐘約 0.6 MB）；Groq 接受 webm。3 分鐘自動停止。
  - 兩種錄音都先寫 IndexedDB（AC-25）。
- **播放**：TTS 音檔用 `<audio>`；即時發音用 `speechSynthesis`（en-US voice；Android 上可用的 voice 由系統 TTS 引擎決定，「未驗證」品質）。
- **版面**：360×640 無橫向捲動（NFR-01）以 Playwright 的 Pixel 模擬尺寸做 E2E 截圖檢查；≥ 1280 寬度雙欄（晚上左右對照表）。
- **桌機**：Chrome／Edge 同一套程式；Safari 不在驗收範圍（不確定是否完整支援 AudioWorklet 錄音流程）。

## 10. 免費額度與每日用量估計
| 供應商 | 免費額度（來源見 §17） | 本專案每日估計 | 餘裕 |
|---|---|---|---|
| Gemini `3.5-flash-lite` | 15 RPM、250K TPM、500 RPD（AI Studio 顯示值，Google 不保證；每天太平洋時間 0 點＝台北 15:00 或 16:00 重置） | 備料 2～3、反白查詢 ~10、手動生卡 ~5（含預取 ~10）、診斷＋改寫 1、chunk 偵測 2 ≈ **20～40 次** | 足夠 |
| Gemini `3.8-flash` | 5 RPM、20 RPD | 只在設定選它做診斷時用，每天 2～4 次 | 勉強；超過即顯示錯誤 |
| Groq Whisper | 20 RPM、2,000 RPD、7,200 音訊秒/小時、28,800 音訊秒/天；單次 <10 s 以 10 s 計 | 晚上 2 段 × 3 分 ≈ 360 秒 | 足夠 |
| Azure Speech F0 | STT（含發音評分）每月 5 小時；Neural TTS 每月 50 萬字元 | 跟讀 5 句 × ~3 次 × ~8 s ≈ 2 分/天 ≈ 1 小時/月；TTS 約 5 千字元/天 ≈ 15 萬/月 | 足夠 |
| Supabase Free | DB 500 MB、Storage 1 GB、egress 5 GB、Edge Function 每月 50 萬次；**7 天沒活動會暫停** | 錄音 90 天約 0.2 GB（估算） | 足夠；暫停風險已接受（Q-19） |

## 11. 新聞來源與每日類別輪替（Q-11、Q-16）
### 11.1 來源（G2 決定：一般新聞媒體與科技新聞媒體，不用學術來源；條款明文禁止 AI 使用的一律排除）
RSS 都在 2026-11-22 18:5x（台北時間）實測回 200；robots.txt 以 Python `robotparser` 檢查，一般讀取器可抓。條款與排除理由見 **ADR-006**。
| 類別 | 角色 | 來源 | feed（實測） | `fetch_mode` | 條款風險 |
|---|---|---|---|---|---|
| AI | 主 | The New Stack（AI 分類） | `https://thenewstack.io/ai/feed/`（26 則、全文約 600～1,350 字） | `rss_full` | 中：條款（2017 版）沒有 AI 條款，只授權非商業下載，並寫明尊重 fair use；沒有明文允許改寫 |
| AI | 備 1 | SiliconANGLE（AI 分類） | `https://siliconangle.com/category/ai/feed/`（30 則、摘要約 75 字） | `rss_then_page` | 中高：條款允許個人瀏覽／列印，禁止重製、複製；沒有 AI 條款；要抓原文頁面 |
| AI | 備 2 | MarkTechPost | `https://www.marktechpost.com/feed/`（10 則、全文） | `rss_full` | **未驗證**：條款頁是範本佔位文字；同公司其他網站條款禁止未經授權重製 |
| 軟體工程 | 主 | SD Times | `https://sdtimes.com/feed/`（10 則、全文約 340～1,100 字） | `rss_full` | 中：條款寫「禁止未經授權重製任何內容」；沒找到 AI 條款 |
| 軟體工程 | 備 1 | InfoQ | `https://feed.infoq.com/`（15 則、摘要約 30～65 字） | `rss_then_page` | **未驗證**：條款頁內容讀不到（頁面由程式載入）；robots.txt 對腳本回 406，**不確定**是否允許 |
| 軟體工程 | 備 2 | The New Stack（全站） | `https://thenewstack.io/feed/`（26 則、全文；`include_url_pattern` 排除 AI 分類，避免和 AI 主來源重複） | `rss_full` | 同 AI 主來源 |
| 半導體產業 | 主 | Semiconductor Engineering | `https://semiengineering.com/feed/`（10 則、全文約 740～2,900 字） | `rss_full` | 中：只授權個人、非商業瀏覽，「不得複製網站任何部分」；沒有 AI 條款 |
| 半導體產業 | 備 1 | eeNews Europe | `https://www.eenewseurope.com/en/feed/`（10 則、約 420～470 字） | `rss_full` | **未驗證**：沒找到條款頁 |
| 半導體產業 | 備 2 | Semiconductor Digest | `https://www.semiconductor-digest.com/feed/`（100 則、約 330～850 字） | `rss_full` | 中高：只限個人使用，明文禁止製作衍生作品；沒有 AI 條款 |
- **已排除**（理由見 ADR-006）：Ars Technica、Wired（Condé Nast 條款禁止用於生成式 AI，含 RAG）；Tom's Hardware（Future 條款禁止用於 AI，含摘要）；The Verge（網站連到的 PMC 條款禁止用 AI 工具存取或 grounding；適用哪份條款**不確定**，保守排除）；MIT Technology Review（禁止用於 AI）；The Register（robots.txt 預設拒絕所有未列名的程式）；GeekWire（禁止任何形式的 data mining）；EE Times／EE Times Asia（AspenCore 條款禁止自動抓取）；TechCrunch（RSS 只有約 20 字）；IEEE Spectrum、NIST（G2 決定不用學術／機構來源）。
- 法律判斷：所有「中」「中高」都是**個人、非公開、非商業使用**下的風險評估，**不確定**是否在條款允許範圍內（這不是法律意見）。降低風險：不存原文、只顯示改寫＋來源名稱＋原文連結、每來源每天最多抓 1 次、遵守 robots.txt。

### 11.2 每日類別輪替與備援規則（`domain/news-rotation`＋`_shared/news`）
- 設定（`settings.news`，`NewsSettingsSchema` 驗證）：`rotation_order` 預設 `["ai","software","semiconductor"]`（三類各出現一次、不可重複）；`anchor_date` 預設 `2026-11-22`（G2 通過日；固定寫在 schema 預設值，所以 `NewsSettingsSchema.parse({})` 會成功、「還原預設」有確定的值；這天＝`rotation_order[0]`，即 11-22 AI、11-23 軟體工程、11-24 半導體產業，依此類推；ADR-011 決定 6）；`lookback_hours` 預設 48（1～168）。
- **今天輪到的類別**：`planned = rotation_order[(plan_date − anchor_date 的天數) mod 3]`。只看日期，不看前一天用了哪類，所以結果可重現、可測試，某天跳類別也不影響之後的輪替。
- **備援順序**（05:00 `daily-prep`）：
  1. 在 `planned` 類別內，依 `priority` 1→2→3 試每個啟用的來源，找第一篇「`lookback_hours` 內發布、還沒用過（URL 與原文雜湊都沒出現過）、正文 ≥ 250 字、LLM 判定屬於該類別」的文章。來源抓取失敗（HTTP 錯誤、逾時、robots 不允許）視為該來源沒有新聞，換下一個來源。
  2. 整個類別都沒有（`_shared/news` 對該類別回 `err({ kind: 'news_unavailable', category })`）→ 依 `rotation_order` 換**下一個**類別（`ai → software → semiconductor → ai`），把跳過的類別記入 `category_skipped`。
  3. 三類都沒有 → 改用最近一篇未讀的已改寫文章（優先 `planned` 類別），`is_fallback_article=true`，頁面註明「今天沒有新文章，這是 <日期> 的文章」（AC-01）。
  4. 連舊文章都沒有（例如第一天）→ `daily_plan.status=failed`，首頁顯示原因與重試，其他練習照常。此時 `POST /plan/today` 回 `plan_not_ready`（503／可重試），**不是** `news_unavailable`：`news_unavailable` 只在 `daily-prep` 內部用來決定換類別，不直接回給前端（萬一漏到 handler，`httpStatusOf` 仍回 503、可重試，見 §5.0.4）。
- 頁面顯示「今天的類別：AI／軟體工程／半導體產業」；換過類別時多一行「今天的 <原類別> 沒有新文章，改用 <實際類別>」。
- 測試（`domain`，時間由參數注入）：連續 9 天的類別序列；三種跳類別情況；三類全空時改用舊文章；`anchor_date` 之前的日期（mod 負數）也正確。

## 12. 目錄結構
```
english-coach/
├─ CLAUDE.md                     # Claude Code 規則（Architect 擁有）
├─ package.json / pnpm-workspace.yaml / tsconfig.base.json
├─ .dependency-cruiser.cjs / eslint.config.js
├─ apps/web/                     # React PWA
│  ├─ index.html / vite.config.ts / public/manifest + icons
│  └─ src/
│     ├─ app/                    # 路由、版面、登入閘門
│     ├─ features/{morning,shadowing,noon,evening,resume,dashboard,settings}/
│     ├─ api/                    # 唯一網路層
│     ├─ audio/                  # recorder、wav-encoder、vad、player、speech-synthesis
│     ├─ storage/                # IndexedDB 待上傳錄音
│     ├─ ui/                     # 共用元件
│     └─ sw/                     # Service Worker 設定
├─ packages/
│  ├─ contracts/                 # @english-coach/contracts（ADR-009）
│  │  ├─ package.json            # exports: "." → src/index.ts、"./testing" → test/index.ts
│  │  ├─ src/                    # zod schema、供應商介面、AppError、Result（§5.0）
│  │  └─ test/                   # expectOk／expectErr（只給測試）
│  └─ domain/                    # @english-coach/domain：package.json＋src/（純邏輯＋單元測試）
├─ supabase/
│  ├─ config.toml                # 每個函式 verify_jwt = false（ADR-010）
│  ├─ migrations/                # schema、RLS、pg_cron、seed_chunk 匯入
│  └─ functions/
│     ├─ deno.json               # imports：@english-coach/*、zod、@supabase/supabase-js 對應（ADR-009）
│     ├─ package.json            # @english-coach/functions（Node 端解析用，ADR-009）
│     ├─ tsconfig.json           # lib ES2023＋WebWorker（ADR-010）
│     ├─ .env.example            # 只有變數名稱（§7.1）
│     ├─ _types/deno.d.ts        # 最小 Deno 宣告（ADR-010）
│     ├─ _shared/{config,db,providers,news}/
│     ├─ api/                    # 單一路由函式（減少冷啟動次數）：index.ts（Deno.serve）＋router.ts（OPTIONS、requireUser、路由表）
│     ├─ daily-prep/             # 05:00 備料（pg_cron 觸發）
│     └─ purge-audio/            # 90 天清錄音（pg_cron 觸發）
├─ test/e2e/                     # Playwright（假供應商）
└─ docs/
```
- 引用方式已決定（ADR-009 決定 1）：所有地方都用套件名稱 `@english-coach/contracts`、`@english-coach/domain`；前端與工具經 pnpm workspace，Deno 經 `supabase/functions/deno.json` 的 `imports` 指到 `packages/*/src/index.ts`。Supabase CLI 打包時能否帶上 `supabase/functions` 以外的檔案**未驗證**，由 CI `db` job 驗證（SRE，ADR-009 修訂 1），Node 端解析由 T-003 驗證；不行就照 ADR-009 的備案把兩個套件搬到 `supabase/functions/_shared/`，套件名稱不變。

## 13. 部署與可觀測性
- **環境**：本機用 `supabase start`（Docker）跑完整後端；正式環境一個 Supabase Free 專案＋前端靜態檔（Supabase 不提供前端 HTML 託管，前端放 Cloudflare Pages 或 GitHub Pages 免費方案，G4 由 SRE 決定）。
- **部署**：CI 綠燈後由 Hansheng 觸發 `supabase db push`、`supabase functions deploy`、前端上傳；細節由 SRE 在 G4 寫發佈清單。
- **可觀測性**：每次外部呼叫寫 `provider_call`（不含內容）；設定頁顯示今天各供應商已用次數與最近錯誤；Edge Function logs 用結構化 JSON（`{fn, capability, provider, kind, latencyMs}`），不寫入使用者文字與錄音內容。
- **健康檢查**：`daily-prep` 結果寫 `daily_plan.status`；失敗時 App 首頁顯示。

## 14. AC／NFR 對應表
| 編號 | 主要模組 | 備註 |
|---|---|---|
| AC-01 | `daily-prep`、`/plan/today`、`domain/plan`、`domain/news-rotation`、`news` | 冪等；類別輪替＋跳下一類；三類都沒有才用最近未讀並註明（§11.2） |
| AC-02 | `news`、`providers/gemini`、`features/morning` | 250～300 字由 zod＋字數驗證；附原文連結；固定來源見 §11.1（Q-16） |
| AC-03 | `features/morning`、`/cards`、`/cards/lookup`、`/cards/:id/enrich` | 見 §8.1 |
| AC-04 | `features/morning`、`audio/player`、`audio/vad`、`slot_checkin` | 計次用 VAD，失敗時可手動 +1（未驗證 VAD 準確度） |
| AC-05 | `domain/plan`（選句）、`features/shadowing`、`/tts` | 「/」斷句由備料時 LLM 產生；選句與 3＋2 規則見 §4.6 |
| AC-06 | `features/shadowing`、`audio/wav-encoder`、`/shadow/attempts`、`providers/azure-speech`、`domain/shadowing` | 解鎖只看正確率 ≥ 80%、語速 ≥ 70% |
| AC-07 | `domain/plan`（25 張選卡）、`seed_chunk` | 15 舊＋10 新；不足時補齊（Q-12）；排序與種子用完見 §4.4 |
| AC-08 | `features/noon` | 不使用麥克風 |
| AC-09 | `domain/srs`、`/reviews`、`/settings`、`features/settings` | 預設 3／7／14、之後 14、忘記 1 天；全部可在設定調整（§4.2、Q-18） |
| AC-10 | `features/noon`、`/cards/generate`、`audio/speech-synthesis` | 3 s 出 chunk＋可播放、8 s（p95）完整（Q-14） |
| AC-11 | `features/resume`（瀏覽器解析＋去個資）、`/resume`、`providers/gemini` | ≥ 15 題、三類各 ≥ 3 |
| AC-12 | `DELETE /resume`、`db` | 刪原檔與解析文字 |
| AC-13 | `domain/plan`（今晚題目）、`features/evening`、`features/noon` | 同一題 id；選題與 3 個提示 chunk 見 §4.5 |
| AC-14 | `features/evening`、`audio/recorder`、`/evening/answers`、`providers/groq` | 3 分鐘自動停 |
| AC-15 | `/evening/answers/:id/diagnose`、`domain/speech-metrics`、`providers/gemini` | 3 種標記；停頓 > 2 s 由時間戳記算 |
| AC-16 | `/evening/upgrade`、`domain/plan` | 隔天新卡優先 |
| AC-17 | `features/evening`、`/tts`、`/evening/answers`（kind=no_script） | 跟讀 3 遍後才可切換 |
| AC-18 | `/evening/answers/:id/chunks`、`domain/chunk-hit` | 結果進 `weekly_metric`；比對與計分見 §4.7 |
| AC-19 | `domain/card-state` | 狀態機見 §4.1、轉換表見 §4.3；間隔讀 `settings.srs` |
| AC-20 | `domain/chunk-hit`、`domain/card-state` | 首答與無稿重答都算（Q-13）；只有完整命中算（§4.7） |
| AC-21 | `features/dashboard`、`slot_checkin`、`card` | Mastered 最大字級 |
| AC-22 | `features/dashboard`、`weekly_metric`、`evening_answer` | 錄音 90 天後只剩文字 |
| AC-23 | `api`（直接寫 Postgres） | 無本機延遲同步 |
| AC-24 | `features/settings`、`/settings`、`providers/registry`、結果頁 `meta` | 下一次請求即生效；同一設定頁另含複習間隔（Q-18）與新聞輪替設定 |
| AC-25 | `providers/registry`、`storage`（IndexedDB）、`/retry`、錯誤畫面 | ADR-003 |
| NFR-01 | `apps/web`（PWA、版面）、`sw` | 第 9 節 |
| NFR-02 | 同 AC-23 | |
| NFR-03 | `providers/registry`、`/settings` | 不需改程式即可切換 |
| NFR-04 | `features/resume`（去個資）、Storage private、`purge-audio` | Q-15 已接受 |
| NFR-05 | `config`、CI 秘密掃描、Edge Function secrets | 第 7 節 |
| NFR-06 | `sw`（斷線提示） | 不做離線練習 |

## 15. 測試策略（給 TechLead／QA 參考，細節等寫程式時再定）
- `domain`：Vitest 單元測試，時間由參數注入，100% 分支涵蓋狀態機與 SRS。測試可以 `throw`／`expect`（例如 `@english-coach/contracts/testing` 的 `expectOk`），不能讀時鐘或用 `Math.random`；性質測試用固定種子的亂數產生器（不新增 fast-check 等依賴）。
- `providers`：契約測試用錄好的回應樣本（不打真 API）；真 API 只在手動的 smoke 測試跑。
- **AC-25 專用測試**（ADR-003）：registry 遇到每一種 `ProviderErrorKind` 都只呼叫被選中的那一個 adapter 一次（假 adapter 計數）；所有預設值的 `tier` 都是 `free`；沒有 `paid_consent_at` 時選付費會回 `paid_not_allowed`；E2E 用假 STT 回 429，畫面顯示原因且錄音仍在 IndexedDB。
- **Q-18 測試**：`SrsSettingsSchema` 的邊界（0、366、非遞增、`after_last_days` < `step_days[2]`、`forgot_days` > `step_days[0]` 都被擋）；任意合法設定下「猶豫的間隔 ≤ 秒答的間隔」（性質測試）；改設定後既有 `due_date` 不變。
- **Edge Functions 驗證（ADR-010）**：Vitest（Node）走訪 `api` 路由表，每條路由在沒有 token、token 無效、`role` 不是 `authenticated` 時都回 401＋`ApiErrorBody`，`OPTIONS` 不經過驗證（假驗證器，不連網路）；真實 Supabase 下 health 無 JWT 401／有 JWT 200 由 CI `db` job 檢查（SRE）。
- 架構測試：dependency-cruiser＋ESLint 規則在 CI 必過；ADR-008 修訂 1 的每條新規則都要在 `tooling/arch-rules.test.ts`／`lint-rules.test.ts` 各有違規與合法範例。
- **AC 在哪一張單驗收（G2 核准 TechLead 建議 b）**：本專案沒有 CLI；「第一次能在畫面上走完該 AC」的那張任務單，視同憲章 §5 的 CLI PR，QA 在那張單寫並執行 Q-xxx（Playwright，Android 尺寸、假供應商）。之前只有程式庫或 API 的單視同 library PR，QA 只驗單元層。
- **PoC 分支**：A-xxx 用 `poc/A-xxx`，不合併到 main（憲章 §5）；O-001 的 pushguard 白名單包含 `task/*`、`fix/*`、`poc/*`（G2 核准 TechLead 建議 a，由 SRE 實作）。

## 16. 未決事項（已全部決定）
Q-14～Q-20 已於 2026-11-22 G2 由 Hansheng 決定（答案見 `docs/OPEN_QUESTIONS.md`「G2 決定」一節）：Q-14、Q-15、Q-17、Q-19、Q-20 依建議；**Q-16 改為三類輪替**（§11）；**Q-18 改為間隔全部可調**（§4.2）。
需要其他文件擁有者處理（我不改）：PRD AC-10 的時間文字（Q-14）、AC-09 的間隔是否補註「預設值，可調」（Q-18）、Q-11 原答案「2～3 個來源」已被 Q-16 取代——由幕僚長轉 PM 判斷是否補註。

## 17. 參考來源（皆於 2026-11-22 讀取）
- Gemini 速率限制：https://ai.google.dev/gemini-api/docs/rate-limits
- Gemini 定價（免費層、資料使用）：https://ai.google.dev/gemini-api/docs/pricing
- Gemini 帳單與 tier：https://aistudio.google.com/docs/billing ；疑難排解：https://aistudio.google.com/docs/troubleshooting
- Gemini 可用地區（含台灣、日本；不含香港）：https://ai.google.dev/gemini-api/docs/available-regions
- Gemini 思考等級（3.5 Flash-Lite 預設 minimal）：https://ai.google.dev/gemini-api/docs/thinking
- 免費層實際數值（AI Studio 讀值，第三方整理）：https://imisofts.com/blog/gemini-api-free-tier-limits/ 、https://github.com/Laeyoung/gem-back
- 延遲：https://artificialanalysis.ai/models/gemini-3-5-flash-lite 、https://www.benchleader.com/models/gemini-3-5-flash-lite
- Groq 速率限制：https://console.groq.com/docs/rate-limits ；Groq STT：https://console.groq.com/docs/speech-to-text
- Azure Speech 定價（F0）：https://azure.microsoft.com/en-us/pricing/details/speech/ ；短音訊 REST 格式：https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short ；發音評估：https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment
- Supabase 定價：https://supabase.com/pricing ；Edge Functions 限制：https://supabase.com/docs/guides/functions/limits ；區域：https://supabase.com/docs/guides/functions/regional-invocation
- Cloudflare Workers 限制：https://developers.cloudflare.com/workers/platform/limits/
- PWA 安裝條件：https://developer.chrome.com/blog/update-install-criteria 、https://web.dev/articles/install-criteria
- 新聞來源條款與 feed：見 ADR-006（含每個條款頁網址）
- Supabase Edge Functions 環境變數、`verify_jwt`、新金鑰與 `getClaims`（2026-11-23 讀取）：見 ADR-010「參考」

## 18. 變更紀錄
| 版本 | 日期 | 變更 |
|---|---|---|
| v0.1 | 2026-11-22 | 初稿（ARCH-001），送 G2 |
| v1.0 | 2026-11-22 | G2 通過（Hansheng 18:46 核准）：技術棧與供應商依建議定案；Q-16 改為 AI／軟體工程／半導體產業三類每日輪替、每類 1 主 2 備（§11、`news_source`、`daily_plan` 欄位）；Q-18 複習間隔全部可在設定調整（§4.1、§4.2、`/settings` 驗證、AC-09／19／24 對應）；種子庫改為獨立任務單 6 批 × 100、第 1 批後抽查 20 條；補上「畫面走完 AC 的單＝CLI PR」與 `poc/*` pushguard 規則（§15）；Q-14～Q-20 標為已決定 |
| v1.1 | 2026-11-22 | ADR-008 修訂 1（T-001 審查時 TechLead 提問）：第 4 條改為 `@supabase/*` 只能在 `apps/web/src/api` 與 `supabase/functions/_shared/db` import，並禁止 `http:`／`https:`／`npm:`／`jsr:` import；`throw` 禁令只管正式程式並延伸到 `_shared/{providers,db,news}`，測試程式可以 `throw`、import `vitest`，正式程式不得 import 測試程式（§3.1、§3.2、§6、§15） |
| v1.2 | 2026-11-22 | ARCH-003：新增 §5.0 contracts 共用型別（`Result`＋helper、`Brand`、品牌 ID、`ProviderId`／`LlmModelId`／`SttModelId`／`VoiceId`、`ProviderError`／`AppError`＋錯誤碼對照表、`Wav16kMono`、`AudioPayload`、`WordTiming`、`Transcript`、`PronunciationResult`、`StreamChunk`、`CardStreamEvent`、供應商介面、`PaidConsent`），§5.2 改指向 §5.0；§6 第 2 點錯誤格式改用 `ApiErrorBodySchema`；新增 ADR-009（套件名稱 `@english-coach/contracts` 與引用方式）與 ADR-008 修訂 2（測試檔含 `.test.tsx`、跨套件引用與品牌轉型規則）；§3.2、§12 同步 |
| v1.2.1 | 2026-11-22 | T-051 審查（TechLead）：§5.0.4 錯誤碼對照表 `news_unavailable` 補齊為 503／可重試／畫面文字／降級方式，`httpStatusOf`、`isRetryable` 對 18 種 kind 都有值；§11.2 備援規則寫明 `news_unavailable` 只在 `daily-prep` 內部使用，第 4 步對前端回 `plan_not_ready` |
| v1.3 | 2026-11-23 | T-003 卡住的三點（TASKS §5 第 15、27 點）：新增 ADR-010 與 §7.1——後端環境變數名稱（用自動注入的 `SUPABASE_URL`／`SUPABASE_PUBLISHABLE_KEYS`／`SUPABASE_SECRET_KEYS`，不用年底淘汰的 anon／service_role；自訂 `GEMINI_API_KEY`、`GROQ_API_KEY`、`AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`、`APP_ALLOWED_ORIGINS`）與前端 `VITE_SUPABASE_PUBLISHABLE_KEY`；`verify_jwt = false`，函式內 `requireUser`（supabase-js `getClaims`）＋`AuthContext` 品牌型別；Node 端 Deno 型別用最小 `deno.d.ts`＋`WebWorker` lib；§5.1 加 `GET /health`；§4、§7、§12、§15 同步；ADR-008 修訂 3、ADR-009 修訂 1（CLI 驗證改在 CI `db` job）；修正 TASKS §5 第 23 點的三處小不一致（§3.2 第 3、4 點、§5.0.1 重複表頭） |
| v1.4 | 2026-11-23 | ARCH-005（TASKS §5 第 28 點）：新增 §4.3 字卡狀態轉換表與 contracts `card.ts`、§4.4 每日 25 張選卡、§4.5 今晚題目與提示 chunk、§4.6 跟讀選句與遮字、§4.7 chunk 命中與計分；§4 `card` 表補 `seed_chunk_id`、`due_date` 可為 null、`correct_count` 定義；§11.2 `anchor_date` 預設 `2026-11-22`；新增 ADR-011；§5.0.1 檔案配置補 `src/settings.ts`（T-008 審查時 TechLead 提出）與 `src/card.ts` |
