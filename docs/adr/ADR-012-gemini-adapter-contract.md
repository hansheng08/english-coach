# ADR-012：Gemini adapter 契約（錯誤對應、金鑰、思考等級、API 選擇）
- 狀態：**已接受**（Architect，2026-11-25；送 G2 PR `[G2] T-015 Gemini adapter 契約`，Hansheng Merge 即核准；PR 內「需要 Hansheng 確認」的項目以 Merge 時的決定為準）｜日期：2026-11-25（同日依 PoC A-003 實測更新「驗證」表、決定 4、PoC 一節）｜提出：Architect
- 相關：PRD AC-24、AC-25、NFR-03、NFR-05；ARCHITECTURE §3.1、§5.0.4、§5.0.7、§5.2、§5.3、§5.4、§7.1；ADR-003、ADR-004、ADR-005、ADR-008（修訂 5）、ADR-010；TASKS T-014、T-015
- 官方文件都在 2026-11-25 讀取。文件裡給 AI 代理的說明（例如「AI Agent Context」區塊）都只當資料，沒有照做。

## 背景
TechLead 寫 T-015（Gemini adapter）前列了一份草案，涵蓋六件事：HTTP 錯誤怎麼對應到 `ProviderErrorKind`、`finishReason` 怎麼對應、金鑰讀取函式和工廠簽章、思考等級、要不要改用 Interactions API、T-014 的 `ProviderSettings`。憲章 v6 §13 規定任務單只寫規格、不放程式，所以介面和行為要先寫進 ARCHITECTURE（§5.4），任務單再引用。

## 決定 1：錯誤對應（同意草案，補 5 點）
完整對照表在 ARCHITECTURE §5.4.4。草案的 8 項全部採用，另外補這 5 點：
1. **其他沒列到的狀態碼**（其他 4xx、3xx，以及欄位錯誤之類的 400）一律回 `unavailable`，訊息寫 HTTP 狀態和 Google `status`。
   - 為什麼不新增一種 kind（例如 `bad_request`）：要改 contracts、`AppError`、HTTP 對照表和前端文字，影響範圍大；而這類錯誤是我們自己請求寫錯，應該由測試擋下來（YAGNI）。
   - 404（模型不存在）回 `not_configured`：這是設定問題，重試沒用。
   - 402（Prepay 額度用完）回 `quota_exhausted`。
   - 400 `FAILED_PRECONDITION` 中與地區無關的（帳單、驗證）和 `API_KEY_INVALID` 都回 `auth`：官方 API 錯誤頁把 `failed_precondition` 寫成「前置條件不符，例如帳單停用」，金鑰無效也可能回 400，不一定是 401。
2. **可否重試**：
   - adapter 內部**只有一種情況會自動重試**：`finishReason = STOP`，但 JSON 或 zod 驗證失敗。只重試 1 次、同一個模型，所以最多 2 次呼叫（ADR-003）。
   - 429、5xx、逾時、被擋、`MAX_TOKENS` 都不自動重試。被擋或 `MAX_TOKENS` 用同樣的輸入重試，結果還是一樣；429 和 5xx 由使用者手動重送，這是 §5.0.4「可重試」的意思。
   - 官方建議對 429／5xx 做指數退避，但那是給背景批次用的。本專案在使用者等待的路徑上，退避會讓 8 秒的預算失效，所以不採用。
3. **串流中途出錯**：產生一個 `err` 就結束。已經送出的 `delta` 不收回。開始前、中途、某一行格式錯、某一行是 `error`、結束時沒有 `finishReason`，各自怎麼對應寫在 §5.4.6。
4. **沒有金鑰**：空字串和**只有空白**都算沒有（`not_configured`）。`loadGeminiPaidKey` 也改成同樣的判斷。
5. **429 分類順序**：先看 `QuotaFailure.quotaId` 有沒有 `PerDay`／`Daily`，或訊息有沒有 `limit: 0`，有就是 `quota_exhausted`，`retryAfterSec: null`；其他 429 才是 `rate_limited` 並讀 `retryDelay`。
   - 原因：社群回報和 Google 自己的 gemini-cli 程式碼都顯示，每日額度用完時 `RetryInfo.retryDelay` 仍會給幾秒（例如 `34s`）。直接採用這個秒數，會讓使用者每隔幾秒重送、一直失敗。
   - 這個格式是**未驗證**的：官方文件沒有寫，根據只有論壇和 gemini-cli 的原始碼。

## 決定 2：`finishReason` 對應（同意草案，補 4 類）
完整表在 ARCHITECTURE §5.4.5。官方 `FinishReason` 列舉比草案多。補上的 4 類：
- `LANGUAGE`、`ESCALATION` 歸到 `safety`：都是內容過濾。
- `CONTINUATION` 歸到 `max_tokens`：達到單次請求的 token 上限。本專案不做續寫。
- `PUP_LIMITED_DISABLED` 回 `auth`：帳號被限制，重試沒用。如果照草案歸到「其他 → `invalid_response`」，畫面會顯示「可重試」，會誤導使用者。
- `generate` 遇到 `MAX_TOKENS` 或 safety 類，回 `invalid_response`、不重試。`stream` 不重試（同草案）。

## 決定 3：金鑰讀取與工廠（大致同意草案，改 3 點）
介面和檔案在 ARCHITECTURE §5.4.1～§5.4.2。
1. **名稱**：同意用 `loadGeminiKey(get: EnvGetter)`。**位置**：`_shared/config/provider-keys.ts`，之後 Groq、Azure 的金鑰讀取也放這裡。**只有 `_shared/providers/wiring.ts` 可以 import 它**（ADR-008 修訂 5 第 19 條）。
2. **工廠**：改成 `createGeminiProvider({ id, apiKey, fetch })`，多一個 `id: 'gemini' | 'gemini-paid'`。
   - 原因：付費版是不同的 `ProviderId`。只靠 `{ apiKey, fetch }` 做不出 `gemini-paid`，`tier` 也沒地方決定。
   - adapter **不 import `_shared/config/**`**（ADR-008 修訂 5 第 18 條）。金鑰只從參數傳入，adapter 不可能自己讀環境變數，測試也不需要假的 env。
3. **`GEMINI_PAID_API_KEY` 不走同一個函式**：維持 `config/paid.ts` 的 `loadGeminiPaidKey`，而且只有 registry 可以讀（ADR-003 第 1 層、ADR-008 第 6 條）。
   - 原因：如果共用一個「依名稱讀金鑰」的函式，任何能 import 它的程式都能讀到付費金鑰，第 6 條就失效了。
   - 付費 adapter 改由 registry 在 `resolvePaid` 時用工廠建立（`paidFactories`）。**MVP 不設定付費金鑰，這項等需要付費時再做**。
   - 目前 T-014 的 registry 只從事先建好的清單找 adapter。正式環境沒有程式能在不讀付費金鑰的情況下建立 `gemini-paid`，所以付費路徑現在只有測試（假 adapter）走得通。這是已知的限制，不影響 MVP。
- **金鑰不能出現在 log**：只放在 `x-goog-api-key` 標頭（官方 REST 範例也這樣寫），不放網址。所有錯誤訊息回傳前，都把金鑰字串換成 `[redacted]`，要有測試。

## 決定 4：思考等級（不同意「一律送 minimal」，改成不送）
- adapter **不送 `thinkingConfig`**，用模型預設值。`LlmRequest` **不加欄位**。
- 理由（官方 thinking 頁；A-003 實測結果標在各點後面）：
  - 預設模型 `gemini-3.5-flash-lite` 和 `gemini-3.1-flash-lite` 的預設值本來就是 `minimal`。A-003：不送 `thinkingConfig` 時，回應沒有 `thoughtsTokenCount`，整段約 0.4～0.8 秒，**符合**這個說法。但 API 不會回報實際用的等級，所以「預設就是 minimal」本身仍**未驗證**。
  - 可以選的 `gemini-3.8-flash`（診斷用）**不支援 `minimal`**，預設是 `medium`。A-003 **已實測**：送 `minimal` 回 400 `INVALID_ARGUMENT`，訊息是「Thinking level MINIMAL is not supported for this model.」（`docs/poc/A-003/samples/04-think-minimal-gemini-3.8-flash.body`）。預設 `medium` 仍**未驗證**。
  - 官方 `thinkingConfig` 說明寫「對不支援的模型設定這個欄位會回錯誤」。
- 替代方案（不採用，YAGNI）：`LlmRequest` 加選填欄位 `thinking?: 'minimal' | 'low' | 'medium' | 'high'`，由呼叫端按模型決定。等有任務真的需要調整時再加，屬於 contracts 變更、走 G2。

## 決定 5：留在 `generateContent`／`streamGenerateContent`，不改用 Interactions API（同意草案）
官方現況：
- Interactions API 從 2026 年 6 月 GA，是「新專案建議使用」的介面，`generateContent` 被標成 legacy。
- 但官方也寫 `generateContent`「仍完整支援，並會在可預見的未來持續提供新的 mainline Gemini 模型」。只有「mainline 以外的新模型、代理與工具」會只在 Interactions 推出。

留在 `generateContent` 的理由：
1. 本專案每次呼叫都是單輪、不需要狀態的 JSON 或文字生成，用不到 Interactions 的優點（伺服器端對話、背景執行、代理）。我們用的三個模型都是 mainline Flash／Flash-Lite。
2. **隱私**：Interactions 預設 `store=true`，會在伺服器保存請求（免費層 1 天、付費層 55 天），要記得每次都送 `store=false`。我們送出的是去個資的履歷文字和逐字稿（Q-15），stateless 的 `generateContent` 少一個會出錯的地方。
3. 換介面只影響 adapter 內部：`LlmProvider` 介面、錯誤種類都不用改。之後真的需要時，可以開一張單只改 `_shared/providers/gemini/`。

風險：Google 之後可能讓 `generateContent` 不再支援新模型。每次新增 `LlmModelId` 時要先確認新模型支援 `generateContent`。

## 決定 6：T-014 的 `ProviderSettings` 與 `DEFAULT_SETTINGS`（欄位同意；位置是暫時的）
- **欄位同意**：
  - `llm{provider, model}`、`stt{provider, model}`、`pronunciation{provider}`、`tts{provider}`、`paid_consent_at`、`monthly_paid_cap_ntd`。
  - 付費兩欄用 snake_case，和 `profile.settings` jsonb 的鍵、`set_paid_consent()` 一致（§4.9）。
  - `DEFAULT_SETTINGS` 的值和 §5.3 預設欄一致。
- **位置 `registry.ts`：現在可以接受，T-020 時要搬走**。
  - 原因：CLAUDE.md §5 第 11 條和 §4.2 的原則是「預設值只放在 `packages/contracts` 的 schema」。T-020 的設定頁要做「還原預設」，前端不能 import `supabase/functions/**`。
  - 做法：T-020 在 `packages/contracts/src/settings.ts` 新增 `ProviderSettingsSchema`（預設值寫在 schema 裡），`registry.ts` 改成 import 這個型別和 `parse({})` 的結果，不再自己定義。
  - 在那之前，`DEFAULT_SETTINGS` 是唯一的預設值來源。
- **欄位缺口**（不影響 T-015）：§5.3 寫「診斷可選 `gemini-3.8-flash`」，但 `llm` 只有一個 `model`。因為 `LlmRequest.model` 是每次呼叫時傳入的，日常和診斷用不同模型要由 T-020／T-038 在 `ProviderSettingsSchema` 加欄位（例如 `llm.diagnose_model`），adapter 不用改。

## 驗證（憲章 §9）
**A-003 已完成**：
- 時間與方式：Hansheng 在 2026-11-25 08:45～08:50（台北時間，UTC+8）用自己的免費金鑰（沒有連結帳單的專案），從 box 手動呼叫 31 次，對外 IP 判定為台灣。
- **這不是 GitHub workflow run**，所以沒有 run 連結。證據是 `docs/poc/A-003/` 裡的原始回應（`samples/`）、請求（`req/`）、逐筆紀錄 `requests.log` 和報告 `REPORT.md`，樣本索引見 `README.md`。
- 下表「樣本」欄的檔名都在 `docs/poc/A-003/samples/`。官方文件都在 2026-11-25 讀取。

| # | 項目 | 官方文件 | A-003 結果 | 樣本 |
|---|---|---|---|---|
| 1 | REST 欄位格式（`systemInstruction`、`contents`、`generationConfig.maxOutputTokens`、`responseMimeType`、`candidates[].content.parts[].text`、`usageMetadata`、`finishReason`） | https://ai.google.dev/api/generate-content | **已實測，一致**。文件沒寫的部分：<br>• 每個 part 都帶 `thoughtSignature`，所以 zod 不可以用 strict<br>• flash-lite 沒有 `thoughtsTokenCount`，所以設成可省略<br>• 多出 `promptTokensDetails`、`serviceTier`、`modelVersion`、`responseId`<br>• JSON 模式回純 JSON 字串<br>• 沒看到 `thought: true` 的 part<br>`promptFeedback.blockReason` 和 `SAFETY` 類 `finishReason`：**未驗證**（沒有刻意送有害內容） | `02-gen-gemini-3.5-flash-lite.body`、`02-gen-gemini-3.1-flash-lite.body`、`08-maxtokens-gemini-3.5-flash-lite.body` |
| 2 | 串流 `streamGenerateContent?alt=sse`、`x-goog-api-key` 標頭 | https://ai.google.dev/gemini-api/docs/text-generation?generate-content=true | **已實測**，細節和原本的假設不同，已寫進 ARCHITECTURE §5.4.6：<br>• CRLF 分段<br>• 沒有 `event:` 和 `[DONE]`<br>• `usageMetadata` 是累計值<br>• `finishReason` 只在最後一段，而且那段文字是空字串<br>• 非 2xx 時 `content-type` 雖然是 `text/event-stream`，內容卻是一般 JSON<br>串流途中出錯：**未驗證** | `03-stream-gemini-3.5-flash-lite.body`、`09-stream-maxtokens-gemini-3.5-flash-lite.body`、`06b-err-model-not-found-stream.*`、`11-stream-gemini-3.8-flash.*` |
| 3 | 429 的 `details`（`QuotaFailure.quotaId`、`RetryInfo.retryDelay`、每日額度 ID） | https://ai.google.dev/gemini-api/docs/rate-limits （格式本身只有社群和 gemini-cli 原始碼） | **仍未驗證**：對 flash-lite 同時送 12 次都回 200，沒有觸發 429 | — （`requests.log` 第 17～28 行） |
| 4 | 錯誤內容格式與狀態碼 | https://ai.google.dev/gemini-api/docs/api-errors 、https://ai.google.dev/gemini-api/docs/troubleshooting | **已實測**：<br>• 格式是 `{error:{code,message,status,details?}}`，`details` 可能沒有<br>• 金鑰錯誤 → 400 `API_KEY_INVALID`；沒帶金鑰 → 403；模型不存在 → 404；欄位錯誤或壞 JSON → 400 `INVALID_ARGUMENT`；high demand → 503（沒有 `Retry-After`）<br>**未驗證**：401（沒出現）、402、408、500、502、504 | `05-err-fake-key.body`、`05b-err-no-key.body`、`06-err-model-not-found.body`、`07-err-malformed-json.body`、`07b-err-bad-field.body`、`02-gen-gemini-3.8-flash.body` |
| 5 | 模型 ID 直接當 REST 模型名 | https://ai.google.dev/gemini-api/docs/models | **已實測**：三個 ID 都在 `GET /models` 清單；兩個 flash-lite 直接用 ID 都回 200<br>**未驗證**：`gemini-3.8-flash` 只確認存在，5 次呼叫都沒拿到 200（見「後果」的風險）<br>`supportedGenerationMethods` 沒列 `streamGenerateContent`，但串流可用 | `01-models-list.body`、`02-gen-*.body` |
| 6 | 思考等級預設值；3.8-flash 不支援 `minimal` | https://ai.google.dev/gemini-api/docs/thinking | **已實測**：3.8-flash 送 `minimal` 回 400<br>flash-lite 不送 `thinkingConfig` 時沒有思考 token，**符合**預設 minimal 的說法，但「預設就是 minimal」**仍未驗證**<br>**未驗證**：3.8-flash 的成功回應、預設思考等級、`thoughtsTokenCount` | `04-think-minimal-gemini-3.8-flash.body`、`02-gen-*.body` |
| 7 | 地區限制（`region_blocked`） | https://ai.google.dev/gemini-api/docs/available-regions | **已實測**：從台灣呼叫可用<br>**未驗證**：`region_blocked` 的訊息文字（沒有被擋的地點可測）；Supabase Edge 正式部署地區（ADR-009 (2)） | 所有 200 樣本、`requests.log` |
| — | Interactions 的定位與保存期限 | https://ai.google.dev/gemini-api/docs/interactions-overview 、https://blog.google/innovation-and-ai/technology/developers-tools/interactions-api-general-availability/ （2026-06-22） | 政策說明，不需要實測 | — |

**另外實測到**：adapter 自己的逾時中止是**必要的**。`gemini-3.8-flash` 一次 20.9 秒才回 503，另外兩次在 40 秒和 60 秒內完全沒有回應（`requests.log` 第 4、15、29 行，`02c-gen-gemini-3.8-flash.headers` 是空的）。ARCHITECTURE §5.4.3 已改成必要條件。

**PoC A-003（已完成）**：
- 原本建議「派 T-015 前先做 A-003」，這一項**已完成**（Hansheng 手動實測，不是原本規劃的 `poc/A-003` 分支加 workflow）。
- 原規劃的 7 個驗證項目的結果：
  - 1～6 都有結果：模型 ID、SSE 格式、JSON 模式、錯誤金鑰狀態碼、`thoughtsTokenCount`、`MAX_TOKENS`
  - 7（429 `details`）沒有觸發
- 仍未驗證的項目建議這樣補（不另開 PoC）：
  - 429 的 `details`：之後正式環境或開發時真的遇到，就把回應去掉金鑰存成樣本，補進 `docs/poc/`
  - `region_blocked`：等正式 Supabase 專案部署後再測
  - 3.8-flash：等需要它的單（T-038 診斷）前再測一次

## 後果
- 好處：
  - T-015 的任務單只要引用 §5.4，就有完整的介面和行為表，不用寫程式。
  - 錯誤分類是純函式，每一列都能用樣本測試。
  - adapter 讀不到環境變數，金鑰只走一條路。
- 代價：
  - 仍未驗證的列（429、`region_blocked`、`SAFETY`／`blockReason`、3.8-flash 成功回應）只能用依文件做的樣本測試，實際格式不同時要開修正單。
  - `loadGeminiPaidKey` 要多一個判斷。
  - 付費 adapter 的建立方式（`paidFactories`）留到需要付費時再做。
- 風險：**拿 `gemini-3.8-flash` 當診斷模型有風險**。
  - A-003 實測 5 次、成功 0 次：3 次 503 high demand（其中一次 20.9 秒才回），2 次在 40～60 秒內沒有回應。成功回應的格式和思考預設也還沒驗證。
  - 診斷的預算是 25 秒（§6 第 6 點），所以 3.8-flash 只會回 `unavailable` 或 `timeout`，使用者只能手動重送。
  - 建議（**不改任何模型設定**，由 Hansheng 決定）：
    - 維持 §5.3 的「診斷**可選**」，不要把 3.8-flash 設成任何預設。
    - T-038（診斷）派單前，再用免費金鑰對 3.8-flash 實測幾次，確認能回 200 並存一份成功樣本。如果仍然多半是 503 或沒有回應，就在 T-020 設定頁的 3.8-flash 選項旁註明「尖峰時段可能無法使用」。
    - 是否從 `LLM_MODEL_IDS` 拿掉 3.8-flash，留給 Hansheng 決定。
- 對其他文件：
  - ADR-010 決定 1 表中 `GEMINI_API_KEY` 的「讀取位置」改為 `_shared/config/provider-keys.ts`（只有 `wiring.ts` 呼叫）。
  - ARCHITECTURE §3.1 adapter 列不再允許依賴 `config`。
  - CLAUDE.md §4、§5 同步更新。
