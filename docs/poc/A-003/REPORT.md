# PoC A-003：Gemini REST API 實測報告

- 時間：2026-11-25 08:45～08:50（台北時間，UTC+8）
- 對照文件：PR #36（head `1244a86`）的 `docs/adr/ADR-012-gemini-adapter-contract.md`、`docs/ARCHITECTURE.md` §5.4
- 端點：`https://generativelanguage.googleapis.com/v1beta`，金鑰只放在 `x-goog-api-key` 標頭；**沒有**使用 Interactions API
- 呼叫地點：box，對外 IP 判定為台灣（TW）
- **請求總數：31 次**（全部打到 Gemini，逐筆紀錄在 `requests.log`）
  - 用真金鑰：29 次。其中 2 次在 40～60 秒內完全沒有回應，被 curl 逾時中止。
  - 用假金鑰或不帶金鑰：2 次（不計入額度）
- 樣本：`samples/<名稱>.headers`（回應標頭）和 `samples/<名稱>.body`（原始回應內容，SSE 為原始位元組）；請求內容在 `req/`。所有檔案都檢查過，不含金鑰。
- 工具：`g.sh`（呼叫腳本，不會印出金鑰）

## 一、ADR-012 的 7 項「未驗證」

| # | 項目 | 結論 | 證據（samples/） |
|---|---|---|---|
| 1 | REST 請求與回應格式（`systemInstruction`、`contents`、`generationConfig.maxOutputTokens`、`responseMimeType`、`candidates[].content.parts[].text`、`usageMetadata`、`finishReason`） | **已驗證一致**。另有 3 點文件沒寫：(a) 每個 part 都多了 `thoughtSignature`（不透明字串），而且最後一段可能是 `text: ""` 加上 `thoughtSignature`；(b) flash-lite 的 `usageMetadata` **沒有** `thoughtsTokenCount` 欄位，所以 `?? 0` 是必要的；(c) 另有 `promptTokensDetails`、`serviceTier`、`modelVersion`、`responseId`。`responseMimeType: application/json` 有效，回的是純 JSON 字串。回應裡沒看到 `thought: true` 的 part。 | `02-gen-gemini-3.5-flash-lite.body`、`02-gen-gemini-3.1-flash-lite.body` |
| 2 | SSE 串流格式（`streamGenerateContent?alt=sse`） | **已驗證但有不同**（見下方「SSE 實際格式」）。重點是每一段用 **`\r\n\r\n`（CRLF）** 分隔，不是 `\n\n`；沒有 `event:` 行，也沒有 `[DONE]`；**每一段都帶 `usageMetadata`（累計值）**；`finishReason` 只出現在最後一段，而最後一段的文字是 `""`。另外，**開始前失敗時**（404、503），標頭雖然是 `content-type: text/event-stream`，內容卻是一般的 JSON `{error:{…}}`，**沒有 `data:` 前綴**。串流途中出錯的格式沒有測到。 | `03-stream-gemini-3.5-flash-lite.body`、`09-stream-maxtokens-gemini-3.5-flash-lite.body`、`06b-err-model-not-found-stream.*`、`11-stream-gemini-3.8-flash.*` |
| 3 | 429 的 `details`（`QuotaFailure.quotaId`、`RetryInfo.retryDelay`、每日額度 ID） | **仍未驗證**：對 `gemini-3.5-flash-lite` 同時送 12 次請求，全部回 200，沒有觸發 429。 | `10-burst-01..12.*` |
| 4 | 模型 ID 直接當 REST 模型名 | **已驗證一致**：`GET /models` 列出 `models/gemini-3.5-flash-lite`、`models/gemini-3.1-flash-lite`、`models/gemini-3.8-flash`，路徑直接用 `LlmModelId` 就能呼叫，回應的 `modelVersion` 跟 ID 相同。注意：`supportedGenerationMethods` 只列 `generateContent` 等，**沒有列 `streamGenerateContent`**，但串流實際可用，所以不能拿這個欄位判斷能不能串流。另外，3.8-flash **只確認存在**（模型清單有列，而且回的是 400 思考等級錯誤和 503，不是 404），**還沒成功拿到 200**。 | `01-models-list.body`、`02-gen-*.body`、`04-think-minimal-gemini-3.8-flash.body` |
| 5 | 思考等級預設值；3.8-flash 不支援 `minimal` | **一部分已驗證**：<br>・對 3.8-flash 送 `thinkingConfig.thinkingLevel: "minimal"` → **400 `INVALID_ARGUMENT`**，訊息是 `Thinking level MINIMAL is not supported for this model.`，跟 Architect 的說法一致（決定 4「不送 thinkingConfig」站得住）。<br>・兩個 flash-lite 不送 `thinkingConfig` 時：`usageMetadata` 沒有 `thoughtsTokenCount`，整段約 0.4～0.8 秒，**符合**預設很低或不思考；但 API 沒有直接回報等級，「預設就是 minimal」本身**仍未驗證**。<br>・3.8-flash 的預設（medium）和 `thoughtsTokenCount`：**仍未驗證**（5 次呼叫都沒拿到 200）。 | `04-think-minimal-gemini-3.8-flash.body`、`02-gen-gemini-3.5-flash-lite.body`、`02-gen-gemini-3.1-flash-lite.body` |
| 6 | 地區限制（`region_blocked`） | 從**台灣**呼叫：**已驗證可用**（所有正常請求都回 200）。`region_blocked` 的錯誤訊息文字：**仍未驗證**（沒有被擋的地點可測）。Supabase Edge 正式部署地區：**仍未驗證**（ADR-012 本來就排除）。 | 所有 200 樣本；`requests.log` |
| 7 | `generateContent` 的錯誤格式（`{error:{code,message,status,details}}`） | **已驗證一致**：400、403、404、503 都是這個格式；`details` 有時沒有（404、503、400 思考等級、400 JSON 壞掉都沒有），有時有 `ErrorInfo`／`LocalizedMessage`／`BadRequest`。zod 要把 `details` 設成選填。 | `05-*`、`06-*`、`07-*`、`02-gen-gemini-3.8-flash.body` |

### SSE 實際格式（`03-stream-gemini-3.5-flash-lite.body`）
```
data: {"candidates":[{"content":{"parts":[{"text":"1."}],"role":"model"},"index":0}],"usageMetadata":{...累計...},"modelVersion":"gemini-3.5-flash-lite","responseId":"..."}\r\n
\r\n
data: {...第 2 段文字...}\r\n
\r\n
data: {"candidates":[{"content":{"parts":[{"text":"","thoughtSignature":"..."}],"role":"model"},"finishReason":"STOP","index":0}],"usageMetadata":{...最終值...},...}\r\n
\r\n
```
- 一段只有一行 `data:`，JSON 在同一行裡（沒有跨多行）。
- 串流觸發 `MAX_TOKENS` 時也一樣：最後一段 `text: ""` 加上 `finishReason: "MAX_TOKENS"`（`09-stream-maxtokens-...body`）。

## 二、錯誤對應表（ARCHITECTURE §5.4.4）逐列

| 情況（§5.4.4） | 實測 | 結論 | 證據 |
|---|---|---|---|
| 沒有金鑰 → `not_configured` | adapter 自己判斷，不呼叫 API。附帶紀錄：完全不帶金鑰標頭時，API 回 **403 `PERMISSION_DENIED`**，`ErrorInfo.reason: ACCESS_DENIED`，套用 §5.4.4 會是 `auth` | 不需實測（本地邏輯） | `05b-err-no-key.*` |
| 自己逾時、408、504 → `timeout` | 沒收到 408／504。但 3.8-flash 有 2 次在 60 秒和 40 秒內**完全沒有回任何位元組**，表示逾時中止一定會用到 | 408/504 **仍未驗證**；「需要自己逾時」**已驗證** | `requests.log` 第 15、29 行（`02c`、`02d`，標頭檔是空的） |
| 網路錯誤 → `unavailable` | 沒測 | **仍未驗證** | — |
| 429 每日額度 → `quota_exhausted` | 沒觸發 | **仍未驗證** | `10-burst-*` |
| 其他 429 → `rate_limited` + `retryDelay` | 沒觸發 | **仍未驗證** | `10-burst-*` |
| 402 → `quota_exhausted` | 免費專案無法觸發 | **仍未驗證** | — |
| 400 `FAILED_PRECONDITION` + 地區訊息 → `region_blocked` | 台灣沒被擋 | **仍未驗證** | — |
| 400 `API_KEY_INVALID` / `API key not valid` → `auth` | 假金鑰回 **400 `INVALID_ARGUMENT`**，`details[0]` 是 `ErrorInfo`，`reason: "API_KEY_INVALID"`，`message: "API key not valid. Please pass a valid API key."` | **已驗證一致**（兩個判斷條件都會成立） | `05-err-fake-key.body` |
| 401 → `auth` | 沒出現。錯誤金鑰回 400，沒有金鑰回 403 | **仍未驗證**（實務上可能根本不會出現） | — |
| 403 → `auth` | 不帶金鑰回 403 `PERMISSION_DENIED` | **已驗證一致**（狀態碼和格式） | `05b-err-no-key.body` |
| 404 → `not_configured` | 回 404 `NOT_FOUND`，訊息含 `models/<名稱> is not found for API version v1beta`，沒有 `details`；串流端點也一樣（內容是一般 JSON） | **已驗證一致** | `06-err-model-not-found.body`、`06b-...` |
| 500／502／503 → `unavailable` | 3.8-flash 回 **503 `UNAVAILABLE`**，`"This model is currently experiencing high demand..."`，沒有 `details`、沒有 `Retry-After` 標頭。第一次花了 **20.9 秒**才回 503。500/502 沒遇到 | 503 **已驗證一致**；500/502 **仍未驗證** | `02-gen-gemini-3.8-flash.*`、`02b-…`、`11-stream-…`、`11b-…` |
| 其他 400（欄位錯誤）→ `unavailable` | JSON 壞掉回 400 `INVALID_ARGUMENT`（沒有 `details`）；欄位型別錯回 400 `INVALID_ARGUMENT` 帶 `BadRequest.fieldViolations`；對 3.8-flash 送 minimal 也是 400 `INVALID_ARGUMENT` | **已驗證一致**（都不會撞到上面的 auth 或 region 列） | `07-err-malformed-json.body`、`07b-err-bad-field.body`、`04-…` |
| 2xx 但不是 JSON 或結構不符 → `invalid_response` | 沒遇到 | **仍未驗證**（本地邏輯） | — |
| `promptFeedback.blockReason` | 沒有刻意觸發（不送有害內容） | **仍未驗證** | — |
| `finishReason: STOP` | generate 和 stream 都看到 | **已驗證一致** | `02-gen-*`、`03-stream-*` |
| `finishReason: MAX_TOKENS` | `maxOutputTokens: 5` 或 `8` 會得到 `MAX_TOKENS`，而且**有部分文字**（例如 `"Job"`）；串流也一樣 | **已驗證一致** | `08-maxtokens-…body`、`09-stream-maxtokens-…body`、`10-burst-*.body` |
| `SAFETY` 等其他 `finishReason` | 沒遇到 | **仍未驗證** | — |

## 三、建議修改的契約（給 Architect）
1. **§5.4.6 SSE 解析**：
   - 要用 `\r\n\r\n`／`\r\n` 切行（或統一去掉 `\r`）。只切 `\n` 會讓 JSON 後面多一個 `\r`；`JSON.parse` 會容忍尾端空白，但「以空行判斷一段結束」的寫法會出錯。
   - 「開始前失敗」不能看 `content-type`：非 2xx 時，即使標頭是 `text/event-stream`，內容也是一般 JSON `{error}`，要用一般 JSON 解析。
   - 每一段都有 `usageMetadata`（累計值），規格寫「取帶 `finishReason` 那段」是對的，但要寫清楚不能把各段相加。
2. **§5.4.3 回應文字**：part 會帶 `thoughtSignature`，zod 要允許多出來的欄位（不能用 `.strict()`）。最後一段 `text: ""` 不產生 delta，跟現行規格一致。
3. **逾時**：3.8-flash 實測有 20.9 秒才回 503，也有 40～60 秒完全沒回應。`timeoutMs` 一定要自己中止，否則會卡住，8 秒預算完全靠 adapter 的 `AbortController`。
4. **3.8-flash 的可用性**：這次 5 次呼叫有 3 次 503、2 次無回應，0 次成功。當「診斷可選」模型可以，但 3.8-flash 的成功回應格式、預設思考等級、`thoughtsTokenCount` 都還沒驗證。
5. **錯誤對應表**：目前實測到的列都跟現行規格一致，不需要改。可以補一句註記：不帶金鑰時 API 回 403 `ACCESS_DENIED`（不會發生，因為 `loadGeminiKey` 會先擋）；錯誤金鑰是 400 不是 401。
6. **`supportedGenerationMethods`**：不要用它判斷模型能不能串流（ADR-012「每次新增 LlmModelId 要確認支援 generateContent」可以用它，但串流要另外實測）。

## 四、仍未驗證、需要之後補
- 429 的 `details` 格式（每日額度 ID、`retryDelay`）：免費層同時 12 次沒觸發。建議等真的遇到時把回應存成樣本，或由 3.8-flash（每日約 20 次）自然用完時取得。
- 3.8-flash 的成功回應與思考 token。
- `region_blocked` 訊息、401、408／504、500／502、`SAFETY` 類 `finishReason`、`promptFeedback.blockReason`、串流途中的錯誤。
- Supabase Edge 正式地區。
