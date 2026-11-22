# ARCHITECTURE：english-coach（英文學習 PWA）
- 版本：**v0.1（送 G2 審查）**｜日期：2026-11-22｜擁有者：Architect｜派工：ARCH-001｜路線：完整
- 輸入：`docs/PRD.md` v1.0、`docs/OPEN_QUESTIONS.md` v1.0（commit `0276440`）
- 技術棧由 Hansheng 在 G2 決定；本文件給出建議與替代方案（ADR-001、ADR-002）。G2 通過後本文件凍結，之後的修改依憲章 §0、§10。
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
        └─ 新聞 RSS：IEEE Spectrum、Semiconductor Engineering、NIST（ADR-006）
```
- 單一使用者、需連網（Q-01、Q-03、NFR-06）。不做離線練習，但 SW 快取 App 外殼，斷線時顯示提示而不是白畫面。
- 「零準備」靠伺服器端排程：每天台北 05:00 由 pg_cron 觸發 `daily-prep`，App 打開時只讀結果；排程失敗時，App 第一次開啟會呼叫同一支冪等（重複呼叫結果不變）的 `POST /plan/today` 補做（AC-01）。

## 2. 技術棧建議（Hansheng 於 G2 決定）
| 層 | 建議 | 主要替代方案 | 依據 |
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
| `packages/domain` | 純邏輯：字卡狀態機（AC-19）、SRS 間隔（AC-09）、每日 25 張選卡（AC-07）、跟讀比對與語速（AC-06）、停頓/贅詞/字數統計（AC-15）、chunk 命中判斷（AC-18、AC-20）、台北日期計算 | `contracts` | `fetch`、`Date.now()` 直接呼叫（時間由參數傳入）、資料庫、任何供應商 |
| `supabase/functions/_shared/providers/*` | 每個外部供應商一個 adapter（gemini、groq、azure-speech、webspeech 描述檔） | `contracts`、`config` | `domain`、資料庫、其他 adapter |
| `supabase/functions/_shared/providers/registry.ts` | 依使用者設定**只回傳被選中的那一個**供應商；檢查付費同意與月上限（ADR-003） | `contracts`、各 adapter | 任何「備援清單」或自動改選 |
| `supabase/functions/_shared/news` | RSS 抓取、主題篩選、來源白名單 | `contracts`、`config` | 抓白名單以外的網址 |
| `supabase/functions/_shared/db` | 唯一可以讀寫 Postgres/Storage 的程式（repository） | `contracts` | 供應商 |
| `supabase/functions/_shared/config` | 唯一可以讀 `Deno.env` 的地方（金鑰、模型名稱） | 無 | — |
| `supabase/functions/<endpoint>` | 薄的 HTTP handler：驗證 → 呼叫 domain/db/registry → 回應 | 以上全部 | 直接 import 某個 adapter（必須經過 registry） |
| `apps/web/src/features/<feature>` | 畫面與互動（morning、shadowing、noon、evening、resume、dashboard、settings） | `contracts`、`apps/web/src/{api,audio,ui,storage}` | 其他 feature（共用的東西放 `ui`）；`@supabase/supabase-js`（只有 `api` 可以） |
| `apps/web/src/api` | 前端唯一的網路層（呼叫 Edge Functions、Supabase 讀表） | `contracts`、`@supabase/supabase-js` | 外部 AI 網址 |
| `apps/web/src/audio` | 錄音、WAV 編碼、播放、VAD（聲音偵測）、TTS 播放 | 無外部依賴 | 網路 |
| `apps/web/src/storage` | IndexedDB：待上傳錄音（AC-25 保留錄音） | 無 | 網路 |
| `apps/web/src/sw` | Service Worker（快取外殼） | `workbox-*`（由 vite-plugin-pwa 產生） | 快取 API 回應中的個資 |

### 3.2 用工具擋住錯誤寫法（「錯的程式寫不出來」）
1. **dependency-cruiser 規則**（CI 必過）：上表「禁止」欄逐條寫成規則；`packages/domain` 不得 import 任何非 `contracts` 的模組；feature 之間互相 import 直接失敗。
2. **ESLint `no-restricted-globals`／`no-restricted-imports`**：`fetch` 只允許出現在 `providers/*`、`news/*`、`apps/web/src/api/*`；`Deno.env` 只允許在 `config/*`；`Date.now`／`new Date()` 在 `domain` 禁用。
3. **型別**：供應商 ID、模型 ID、卡片狀態都是字串字面值聯集（union）＋`switch` 窮舉檢查（`never`），新增狀態沒處理就編譯失敗；金額用 `type Ntd = number & { __brand: 'Ntd' }` 之類的品牌型別，避免單位混用。
4. **錯誤用 `Result<T, AppError>` 回傳**，跨模組不丟例外（第 6 節）；ESLint 規則禁止在 `domain` 使用 `throw`。
5. **秘密掃描**：CI 跑「建置後的前端 bundle 不得出現任何金鑰變數名稱或已知金鑰前綴」的測試（第 7 節）。

## 4. 資料模型與儲存 schema
- 所有表都有 `user_id uuid not null references auth.users`，RLS：`user_id = auth.uid()`。只有 Edge Functions 用 service role（後端專用的高權限金鑰）寫入需要伺服器驗證的欄位。
- 日期欄位 `plan_date date` 一律是**台北日期**；時間戳記一律 `timestamptz`（存 UTC）。
- 錄音欄位都有 `audio_expires_at = created_at + 90 days`；每日 pg_cron 刪 Storage 物件並把 `audio_path` 設為 null，逐字稿與分數保留（Q-06）。

| 表 | 主要欄位 | 對應 |
|---|---|---|
| `profile` | `user_id` PK、`timezone`（固定 `Asia/Taipei`）、`slot_start`（早中晚開始時間，Q-08）、`settings jsonb`（選用的 LLM 模型、STT、發音、TTS 供應商；`paid_consent_at`；`monthly_paid_cap_ntd`）。`settings` 只能經 `POST /settings` 寫入 | AC-24、AC-25、NFR-03 |
| `news_source` | `id`、`name`、`feed_url`、`topic`（semiconductor／software／ai）、`enabled` | AC-02、Q-11 |
| `news_article` | `id`、`source_id`、`original_url`（唯一）、`title`、`published_at`、`rewritten_text`（250～300 字）、`chunks jsonb[5]`（chunk、中文、所在句）、`sentences jsonb`（含「/」斷句）、`read_at`。**不存原文全文**，只存原文的 SHA-256 以便去重 | AC-01、AC-02、AC-05 |
| `daily_plan` | `user_id`＋`plan_date` 唯一；`article_id`、`is_fallback_article`、`shadow_items jsonb[5]`、`card_ids uuid[25]`、`tonight_question_id`、`status`（pending／ready／failed）、`error` | AC-01、AC-05、AC-07、AC-13 |
| `card` | `id`、`chunk`、`meaning_zh`、`example_en`、`synonyms text[]`、`source_sentence`、`source_type`（news／manual／evening／seed／shadowing）、`state`（collected／learning／reviewing／mastered）、`correct_count`、`interval_step`（0／3／7／14）、`due_date`、`priority_new`（晚上勾選）、`tts_path`、`generated_by`（模型名稱） | AC-03、AC-07～10、AC-16、AC-19、AC-20 |
| `card_review` | `card_id`、`reviewed_at`、`mode`（A／B）、`rating`（fast／hesitant／forgot）、`state_before`、`state_after` | AC-09、AC-19、AC-22 |
| `seed_chunk` | `id`、`chunk`、`meaning_zh`、`example_en`、`tags`；≥ 600 列，種子資料由任務單以 migration 匯入 | AC-07、Q-10 |
| `resume` | `user_id` PK（一次一份）、`storage_path`、`redacted_text`、`uploaded_at` | AC-11、AC-12、Q-09 |
| `question` | `id`、`resume_id`（可為 null，刪履歷時設 null 並標 `retired=true`）、`category`（intro／behavioral／technical）、`text`、`cited_experience`、`source`（resume／bank） | AC-11～13 |
| `shadow_attempt` | `plan_date`、`item_index`、`audio_path`、`audio_expires_at`、`recognized_text`、`accuracy`、`speed_ratio`、`pron_score`（可為 null）、`stt_provider`、`pron_provider`、`passed` | AC-06、AC-22 |
| `evening_answer` | `question_id`、`kind`（first／no_script）、`status`（uploaded／transcribed／diagnosed／failed）、`failure jsonb`、`audio_path`、`audio_expires_at`、`transcript`、`word_timings jsonb`、`pause_count`、`filler_count`、`wpm`、`diagnosis jsonb`、`rewrite_text`、`upgrade_chunks jsonb`、`chunk_hits jsonb`、`llm_model`、`stt_provider` | AC-14～18、AC-20、AC-22、AC-25 |
| `slot_checkin` | `plan_date`、`slot`（morning／noon／evening）、`step`、`completed_at` | AC-04、AC-21、M1 |
| `provider_call` | `capability`、`provider`、`model`、`tier`、`status`、`error_kind`、`latency_ms`、`created_at`（不存內容） | 可觀測性、AC-24、AC-25 |
| `weekly_metric`（view） | 由上面各表彙總：每週 Mastered 數、首答停頓＋贅詞、目標 chunk 講出率 | AC-22、M2～M4 |

字卡狀態機（`packages/domain`，AC-09、AC-19、Q-13）：
```
collected --中午答對--> learning --中午再答對（累計 2 次）--> reviewing(3d)
reviewing: 秒答 → 下一階 3→7→14（14 後維持 14，見 Q-18）；猶豫 → 留在同一階；忘記 → learning、隔天到期
learning/collected: 忘記 → 隔天到期
reviewing --晚上首答或無稿重答自然講出--> mastered（AC-20）
```
「答對」是否包含「猶豫」：PRD 沒寫明，列為 Q-17，建議答案「秒答與猶豫都算答對」。

## 5. API 與供應商契約
### 5.1 HTTP API（Edge Functions，全部要 Supabase JWT；請求與回應都用 `packages/contracts` 的 zod schema 驗證）
| 端點 | 輸入 → 輸出 | 時間預算 | AC |
|---|---|---|---|
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
| `POST /settings` | `SettingsPatch` → `Settings`（伺服器驗證付費同意，ADR-003） | ≤ 1 s | AC-24、AC-25 |
| `POST /retry/:answerId` | 重送失敗的錄音處理 | 同原端點 | AC-25 |
- 讀取類（儀表板、成長曲線、紀錄、字卡列表）直接用 supabase-js 讀表（受 RLS 保護），不另寫 API（AC-21～23）。
- 所有 AI 結果回應都帶 `meta: { llmModel?, sttProvider?, pronProvider?, ttsProvider? }`，結果頁顯示（AC-24）。

### 5.2 供應商介面（`packages/contracts/src/providers.ts`）
```ts
export type Tier = 'free' | 'paid';
export type Capability = 'llm' | 'stt' | 'pronunciation' | 'tts';
export interface ProviderInfo { id: ProviderId; capability: Capability; tier: Tier; displayName: string }

export type ProviderErrorKind =
  | 'quota_exhausted' | 'rate_limited' | 'unavailable' | 'timeout'
  | 'auth' | 'region_blocked' | 'invalid_response' | 'not_configured' | 'paid_not_allowed';
export interface ProviderError { kind: ProviderErrorKind; provider: ProviderId; retryAfterSec?: number; message: string }

export interface LlmProvider extends ProviderInfo {
  generate<T>(req: { model: LlmModelId; system: string; prompt: string; schema: ZodType<T>; maxOutputTokens: number; timeoutMs: number }): Promise<Result<T, ProviderError>>;
  stream(req: /* 同上 */): AsyncIterable<Result<StreamChunk, ProviderError>>;
}
export interface SttProvider extends ProviderInfo {
  transcribe(audio: AudioPayload, opts: { language: 'en'; wordTimestamps: boolean; prompt?: string }): Promise<Result<Transcript, ProviderError>>;
}
export interface PronunciationProvider extends ProviderInfo {
  assess(audio: Wav16kMono, referenceText: string): Promise<Result<{ score0to100: number; recognizedText: string; words: WordTiming[] }, ProviderError>>;
}
export interface TtsProvider extends ProviderInfo {
  synthesize(text: string, voice: VoiceId): Promise<Result<{ audio: Uint8Array; mime: string; durationMs: number }, ProviderError>>;
}
```
- 所有 adapter 只用 `fetch` 呼叫 REST，**不使用供應商 SDK**（少依賴、可完全掌握呼叫哪個端點；ADR-003）。
- AI 回傳一律要求 JSON 並用 zod 驗證；驗證失敗回 `invalid_response`，最多重試 1 次（同一供應商同一模型）。

### 5.3 預設供應商（ADR-004）
| 能力 | 預設（免費） | 可手動切換的其他免費選項 | 付費選項（只有手動選＋同意後才可用） |
|---|---|---|---|
| LLM | Gemini `gemini-3.5-flash-lite`（日常）；診斷可選 `gemini-3.8-flash`（免費層每天約 20 次） | `gemini-3.1-flash-lite` | Gemini 付費層（另一個有綁帳單的專案金鑰） |
| STT（晚上） | Groq `whisper-large-v3-turbo` | Gemini `gemini-3.5-transcribe`、Azure STT F0 | 不確定（G2 後再定） |
| 發音評分＋跟讀辨識 | Azure Pronunciation Assessment（F0） | 「不評分」模式（只用 STT 算正確率與語速；發音分數顯示「無」） | Azure S0 |
| TTS | 備料時預產生：Azure Neural TTS（F0）；即時：瀏覽器 Web Speech `speechSynthesis` | Gemini `gemini-3.8-flash-lite-tts` | — |

## 6. 錯誤處理
1. **不丟例外跨模組**：`domain`、`providers`、`db` 一律回 `Result<T, AppError>`；HTTP handler 是唯一把錯誤轉成回應的地方。
2. **錯誤回應格式**：`{ error: { kind, provider?, message, retryable, retryAfterSec? } }`；HTTP 狀態：驗證失敗 400、未登入 401、額度用完 429、供應商失敗 502、逾時 504。
3. **錄音先存再處理**（AC-25）：前端錄完先寫進 IndexedDB，再上傳 Storage，成功後才呼叫 STT；任何一步失敗，錄音仍在 IndexedDB 或 Storage，`evening_answer.status=failed`＋`failure`，畫面顯示原因（例如「Groq 免費額度今天用完，約 X 分鐘後可重送」）與兩個按鈕：「稍後重送」「改用其他供應商」（手動）。
4. **絕不自動改用其他供應商或付費**：registry 沒有備援清單（ADR-003）；`quota_exhausted` 直接回給使用者。
5. **降級模式**（不花錢、不換供應商）：發音評分失敗 → 仍顯示正確率與語速、發音分數「無」，不擋關（AC-06 允許）；當天新聞抓不到 → 用最近一篇未讀文章並在頁面註明（AC-01）；`daily-prep` 整體失敗 → 開 App 時重試一次，再失敗就顯示「今天的素材沒備好」＋重試按鈕，字卡複習（不需 AI）照常可用。
6. **逾時**：每次外部呼叫都設 `timeoutMs`（生卡 8 s、STT 25 s、診斷 25 s），逾時回 `timeout`，不自動重試到別家。
7. **AI 輸出不合格**：zod 驗證失敗、字數不在 250～300、chunk 不是 5 個 → 同模型重試 1 次，再失敗記錄 `failed` 並走降級。

## 7. 安全
- **金鑰不進 repo、不進前端**（NFR-05）：Gemini、Groq、Azure 金鑰只存在 Supabase Edge Function secrets（用 `supabase secrets set` 由 Hansheng 本人在自己電腦輸入），程式只在 `config/` 讀 `Deno.env`。`.env*` 全部列在 `.gitignore`；repo 只放 `.env.example`（只有變數名稱）。
- **前端只拿得到公開金鑰**：Supabase 的 publishable/anon key 設計上可以公開，安全靠 RLS；Vite 只會把 `VITE_` 開頭的變數打包進前端，所以規定：任何 `VITE_` 變數名稱不得含 `KEY`、`SECRET`、`TOKEN`（`VITE_SUPABASE_ANON_KEY` 例外，寫死在白名單），由 CI 測試檢查。
- **Azure 金鑰不下發**：跟讀錄音由前端上傳到 Edge Function，再由伺服器呼叫 Azure（金鑰不出伺服器）。
- **CI 秘密掃描**：建置後掃 `dist/` 與 repo，命中已知金鑰格式（例如 `AIza`、`gsk_` 前綴）即失敗。工具選擇（gitleaks 或自寫腳本）由 O-001 決定。
- **登入**：Supabase Auth email＋密碼（或 magic link），**關閉註冊**；只有 Hansheng 一個帳號（Q-01）。
- **個資（NFR-04、Q-06）**：
  - 履歷在**瀏覽器端**解析成文字（PDF 用 `pdfjs-dist`、DOCX 用 `mammoth`），用規則移除電話、Email、地址後，只把 `redacted_text` 送後端與 AI；原檔存在私有 Storage bucket（AC-12 可刪）。
  - 錄音只送 STT／發音供應商，不送 Gemini；送 Gemini 的是逐字稿。
  - Storage bucket 全部 private，只用短效 signed URL 讀取。傳輸全程 HTTPS。
  - **風險**：Gemini、Azure、Groq 的免費層可能把送出的內容用於改善產品（Gemini 定價頁免費層標示「Used to improve our products: Yes」；Groq、Azure F0 的資料使用條款「未驗證」）。列為 Q-15，需要 Hansheng 在 G2 決定是否接受。
- **新聞來源白名單**：`news` 模組只抓 `news_source` 裡的網址，避免被當成任意網址的代理。

## 8. 效能預算
| 項目 | PRD 上限 | 設計目標 | 怎麼做到 | 狀態 |
|---|---|---|---|---|
| AC-03 點已標出語塊 → 中文意思 | —（含在 3 s 內） | 立即（0 次網路） | 備料時 5 個語塊的中文已算好、存在 `news_article.chunks` | 設計可達成 |
| AC-03 按「＋」→ Collected 字卡 | 3 s | p95 ≤ 1 s（未驗證） | `POST /cards` 不呼叫 AI，只寫入 chunk＋原句；例句等由 `/enrich` 背景補 | 設計可達成 |
| AC-03 反白任意詞句 → 中文意思 | 3 s | p50 ≤ 2.5 s、p95 ≤ 5 s（未驗證） | Gemini Flash-Lite、思考等級 minimal、輸出 ≤ 60 tokens | **p95 不保證**（Q-14） |
| AC-10 手動新增 → 完整字卡 | 3 s | 首段 ≤ 3 s、完整 ≤ 8 s（p95，未驗證） | 串流＋發音用 Web Speech 即時播放（ADR-005） | **建議放寬**（Q-14） |
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
  - AC-10 **免費層無法「可靠」做到 3 秒內完整卡片**。建議改成：「3 秒內出現核心 chunk（串流第一段），8 秒內完整卡片（含 ≥ 2 個同義替換、例句與可播放發音）」；列為 **Q-14**，由幕僚長轉 PM／Hansheng 決定。G2 後如需實測，建議開 A-001 PoC 量 50 次 p50／p95。
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
| Supabase Free | DB 500 MB、Storage 1 GB、egress 5 GB、Edge Function 每月 50 萬次；**7 天沒活動會暫停** | 錄音 90 天約 0.2 GB（估算） | 足夠；暫停風險見 Q-19 |

## 11. 新聞來源（Q-11，Hansheng 於 G2 確認）
Q-11 決定用 2～3 個來源；本文件提名 **3 個主要＋2 個備用**（備用不啟用，主要來源失效時才由 Hansheng 決定換上）。詳細理由、條款與取得方式見 **ADR-006**。
| # | 來源 | 主題 | 取得方式 | 條款摘要 |
|---|---|---|---|---|
| 主 1 | IEEE Spectrum | 半導體、AI、運算 | 官方 RSS：`/feeds/topic/semiconductors.rss`、`/feeds/topic/artificial-intelligence.rss`（全文在 RSS 內） | 私人使用可影印；其他重製需聯絡編輯（未驗證，網站條款頁 403 讀不到） |
| 主 2 | Semiconductor Engineering | 半導體製程、設備、EDA | 官方 RSS `https://semiengineering.com/feed/`（`content:encoded` 全文） | 只授權「個人、非商業瀏覽」，不得複製網站內容 |
| 主 3 | NIST News | 半導體（CHIPS）、AI 標準、資安 | 官方 RSS `https://www.nist.gov/news-events/news/rss.xml`（只有摘要，正文抓官方頁面） | 美國政府公開資訊，可散布、複製（標示出處）— 授權最清楚 |
| 備 1 | The GitHub Blog | 軟體工程、AI 開發工具 | 官方 RSS `https://github.blog/feed/`（全文） | 未驗證（沒找到部落格內容的明確授權條款） |
| 備 2 | InfoQ | 軟體架構、AI 工程 | 官方 RSS `https://feed.infoq.com/`（只有摘要） | 未驗證 |
- **不建議**：MIT Technology Review — 條款明文禁止把內容用於「建立、訓練、改善任何 AI 系統」，而 Gemini 免費層會把輸入用於改善產品，衝突風險高。
- **共通做法**：只存改寫稿（250～300 字）＋原文連結＋原文雜湊，不存、不顯示全文（AC-02）；每來源每天最多抓 1 次 RSS；遵守 robots.txt；送 Gemini 改寫的原文只在記憶體中。法律判斷：個人、非公開、非商業的學習用途，風險較低，但**是否構成條款允許的使用「不確定」**（不是法律意見），需要 Hansheng 接受（Q-16）。

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
│  ├─ contracts/src/             # zod schema、供應商介面、AppError、Result
│  └─ domain/src/                # 純邏輯＋單元測試
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/                # schema、RLS、pg_cron、seed_chunk 匯入
│  └─ functions/
│     ├─ _shared/{config,db,providers,news}/
│     ├─ api/                    # 單一路由函式（減少冷啟動次數）
│     ├─ daily-prep/             # 05:00 備料（pg_cron 觸發）
│     └─ purge-audio/            # 90 天清錄音（pg_cron 觸發）
├─ test/e2e/                     # Playwright（假供應商）
└─ docs/
```
- `supabase/functions` 如何引用 `packages/*`（Deno import map 指到 workspace 路徑）**不確定**是否被 Supabase CLI 打包支援；第一張開發單先驗證，不行就改為把 `contracts`、`domain` 放在 `supabase/functions/_shared/` 並由前端以路徑別名引用。

## 13. 部署與可觀測性
- **環境**：本機用 `supabase start`（Docker）跑完整後端；正式環境一個 Supabase Free 專案＋前端靜態檔（Supabase 不提供前端 HTML 託管，前端放 Cloudflare Pages 或 GitHub Pages 免費方案，G4 由 SRE 決定）。
- **部署**：CI 綠燈後由 Hansheng 觸發 `supabase db push`、`supabase functions deploy`、前端上傳；細節由 SRE 在 G4 寫發佈清單。
- **可觀測性**：每次外部呼叫寫 `provider_call`（不含內容）；設定頁顯示今天各供應商已用次數與最近錯誤；Edge Function logs 用結構化 JSON（`{fn, capability, provider, kind, latencyMs}`），不寫入使用者文字與錄音內容。
- **健康檢查**：`daily-prep` 結果寫 `daily_plan.status`；失敗時 App 首頁顯示。

## 14. AC／NFR 對應表
| 編號 | 主要模組 | 備註 |
|---|---|---|
| AC-01 | `daily-prep`、`/plan/today`、`domain/plan`、`news` | 冪等；抓不到新文章用最近未讀並註明 |
| AC-02 | `news`、`providers/gemini`、`features/morning` | 250～300 字由 zod＋字數驗證；附原文連結 |
| AC-03 | `features/morning`、`/cards`、`/cards/lookup`、`/cards/:id/enrich` | 見 §8.1 |
| AC-04 | `features/morning`、`audio/player`、`audio/vad`、`slot_checkin` | 計次用 VAD，失敗時可手動 +1（未驗證 VAD 準確度） |
| AC-05 | `domain/plan`（選句）、`features/shadowing`、`/tts` | 「/」斷句由備料時 LLM 產生 |
| AC-06 | `features/shadowing`、`audio/wav-encoder`、`/shadow/attempts`、`providers/azure-speech`、`domain/shadowing` | 解鎖只看正確率 ≥ 80%、語速 ≥ 70% |
| AC-07 | `domain/plan`（25 張選卡）、`seed_chunk` | 15 舊＋10 新；不足時補齊（Q-12） |
| AC-08 | `features/noon` | 不使用麥克風 |
| AC-09 | `domain/srs`、`/reviews` | 3／7／14 |
| AC-10 | `features/noon`、`/cards/generate`、`audio/speech-synthesis` | 見 Q-14 |
| AC-11 | `features/resume`（瀏覽器解析＋去個資）、`/resume`、`providers/gemini` | ≥ 15 題、三類各 ≥ 3 |
| AC-12 | `DELETE /resume`、`db` | 刪原檔與解析文字 |
| AC-13 | `domain/plan`（今晚題目）、`features/evening`、`features/noon` | 同一題 id |
| AC-14 | `features/evening`、`audio/recorder`、`/evening/answers`、`providers/groq` | 3 分鐘自動停 |
| AC-15 | `/evening/answers/:id/diagnose`、`domain/speech-metrics`、`providers/gemini` | 3 種標記；停頓 > 2 s 由時間戳記算 |
| AC-16 | `/evening/upgrade`、`domain/plan` | 隔天新卡優先 |
| AC-17 | `features/evening`、`/tts`、`/evening/answers`（kind=no_script） | 跟讀 3 遍後才可切換 |
| AC-18 | `/evening/answers/:id/chunks`、`domain/chunk-hit` | 結果進 `weekly_metric` |
| AC-19 | `domain/card-state` | 狀態機見第 4 節 |
| AC-20 | `domain/chunk-hit`、`domain/card-state` | 首答與無稿重答都算（Q-13） |
| AC-21 | `features/dashboard`、`slot_checkin`、`card` | Mastered 最大字級 |
| AC-22 | `features/dashboard`、`weekly_metric`、`evening_answer` | 錄音 90 天後只剩文字 |
| AC-23 | `api`（直接寫 Postgres） | 無本機延遲同步 |
| AC-24 | `features/settings`、`/settings`、`providers/registry`、結果頁 `meta` | 下一次請求即生效 |
| AC-25 | `providers/registry`、`storage`（IndexedDB）、`/retry`、錯誤畫面 | ADR-003 |
| NFR-01 | `apps/web`（PWA、版面）、`sw` | 第 9 節 |
| NFR-02 | 同 AC-23 | |
| NFR-03 | `providers/registry`、`/settings` | 不需改程式即可切換 |
| NFR-04 | `features/resume`（去個資）、Storage private、`purge-audio` | Q-15 |
| NFR-05 | `config`、CI 秘密掃描、Edge Function secrets | 第 7 節 |
| NFR-06 | `sw`（斷線提示） | 不做離線練習 |

## 15. 測試策略（給 TechLead／QA 參考，細節等寫程式時再定）
- `domain`：Vitest 單元測試，時間由參數注入，100% 分支涵蓋狀態機與 SRS。
- `providers`：契約測試用錄好的回應樣本（不打真 API）；真 API 只在手動的 smoke 測試跑。
- **AC-25 專用測試**（ADR-003）：registry 遇到每一種 `ProviderErrorKind` 都只呼叫被選中的那一個 adapter 一次（假 adapter 計數）；所有預設值的 `tier` 都是 `free`；沒有 `paid_consent_at` 時選付費會回 `paid_not_allowed`；E2E 用假 STT 回 429，畫面顯示原因且錄音仍在 IndexedDB。
- 架構測試：dependency-cruiser＋ESLint 規則在 CI 必過。

## 16. 給幕僚長／PM 的未決事項
新增題目已依憲章 §1 寫進 `docs/OPEN_QUESTIONS.md`（Q-14～Q-20，提出者 Architect，含建議答案），G2 一次決定：
- Q-14 AC-10（與 AC-03 反白查詢）3 秒上限放寬
- Q-15 免費層資料可能被用於改善產品，是否接受
- Q-16 新聞來源確認與條款風險接受
- Q-17 「答對」是否包含「猶豫」
- Q-18 Reviewing 到 14 天間隔後的下一步
- Q-19 Supabase 免費專案 7 天無活動會暫停
- Q-20 需要 Hansheng 開的帳號（Supabase、Groq、Azure、Gemini 無帳單專案）與 Whisper 可能刪掉贅詞的風險

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
- 新聞來源條款：見 ADR-006

## 18. 變更紀錄
| 版本 | 日期 | 變更 |
|---|---|---|
| v0.1 | 2026-11-22 | 初稿（ARCH-001），送 G2 |
