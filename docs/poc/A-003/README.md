# A-003 樣本索引（Gemini REST，T-015 契約測試用）

- **來源**：Hansheng 在 2026-11-25 08:45～08:50（台北時間，UTC+8）用自己的免費金鑰（沒有連結帳單的專案），從 box 手動呼叫，共 31 次。對外 IP 判定為台灣。**這不是 GitHub workflow run**，所以沒有 run 連結；證據就是這個資料夾裡的原始回應和 `requests.log`。
- **完整報告**：`REPORT.md`（原樣複製）。報告引用的 `samples/` 檔名和這裡相同。
- **只放了每種情況最小的一組**，所以 31 次呼叫的檔案沒有全部放進來。沒放的是 `10-burst-01..12`（12 次並發都回 200，內容跟 `08` 同型）、`02b`（同 `02-gen-gemini-3.8-flash` 的 503）、`02d`（同 `02c`）、`11b`（同 `11`），還有呼叫腳本 `g.sh`。腳本裡有一個 `AIza` 開頭的假金鑰字串，會被金鑰掃描當成金鑰。
- **格式**：`*.headers` 是 curl `-D` 存的回應標頭（CRLF），`*.body` 是原始回應內容（SSE 保留 CRLF）。`.gitattributes` 把 `samples/**`、`req/**` 設為 `-text`，讓 git 不轉換換行。
- **金鑰**：請求只用 `x-goog-api-key` 標頭帶金鑰。所有檔案 commit 前都掃描過，不含金鑰；`05-err-fake-key` 用的是假金鑰，回應裡也沒有回顯。
- 請求內容放在 `req/`。標「推定」的對應是從回應內容（`promptTokenCount`、輸出文字）推斷的，`requests.log` 沒有記錄請求檔名。

| 樣本（`samples/`） | 情況 | HTTP | 請求（`req/`） | ARCHITECTURE |
|---|---|---|---|---|
| `01-models-list.*` | `GET /models`：三個 `LlmModelId` 都在清單裡（`supportedGenerationMethods` 沒有列 `streamGenerateContent`） | 200 | — | §5.4.3 |
| `02-gen-gemini-3.5-flash-lite.*` | `generateContent` 成功：JSON 模式、part 帶 `thoughtSignature`、`usageMetadata` 沒有 `thoughtsTokenCount` | 200 | `gen-json.json`（推定） | §5.4.3 |
| `02-gen-gemini-3.1-flash-lite.*` | 同上，另一個模型 | 200 | `gen-json.json`（推定） | §5.4.3 |
| `03-stream-gemini-3.5-flash-lite.*` | SSE 成功：CRLF 分段、`usageMetadata` 累計、最後一段 `text: ""` 加 `finishReason: STOP` | 200 | `stream-text.json`（推定） | §5.4.6 |
| `08-maxtokens-gemini-3.5-flash-lite.*` | `generate` 回 `MAX_TOKENS`，有部分文字 | 200 | `maxtok.json`（推定） | §5.4.5 |
| `09-stream-maxtokens-gemini-3.5-flash-lite.*` | SSE 回 `MAX_TOKENS` | 200 | `maxtok.json`（推定） | §5.4.5、§5.4.6 |
| `05-err-fake-key.*` | 錯誤金鑰：`INVALID_ARGUMENT`＋`ErrorInfo.reason: API_KEY_INVALID` → `auth` | 400 | 未記錄 | §5.4.4 |
| `05b-err-no-key.*` | 沒帶金鑰標頭：`PERMISSION_DENIED`／`ACCESS_DENIED` → `auth` | 403 | 未記錄 | §5.4.4 |
| `06-err-model-not-found.*` | 模型不存在 → `not_configured`（沒有 `details`） | 404 | 未記錄 | §5.4.4 |
| `06b-err-model-not-found-stream.*` | 串流端點的 404：標頭是 `text/event-stream`，內容是一般 JSON `{error}`，沒有 `data:` | 404 | 未記錄 | §5.4.6 |
| `07-err-malformed-json.*` | 請求 JSON 壞掉 → 其他 400 → `unavailable`（沒有 `details`） | 400 | `malformed.json` | §5.4.4 |
| `07b-err-bad-field.*` | 欄位型別錯：`BadRequest.fieldViolations` → 其他 400 → `unavailable` | 400 | `badfield.json` | §5.4.4 |
| `04-think-minimal-gemini-3.8-flash.*` | 對 3.8-flash 送 `thinkingLevel: minimal`：`INVALID_ARGUMENT`（ADR-012 決定 4 的根據） | 400 | `min-think.json` | §5.4.3 |
| `02-gen-gemini-3.8-flash.*` | `generate` 回 503 `UNAVAILABLE`（high demand），20.9 秒才回，沒有 `Retry-After` → `unavailable` | 503 | 未記錄 | §5.4.4 |
| `11-stream-gemini-3.8-flash.*` | 串流端點的 503：標頭是 `text/event-stream`，內容是一般 JSON | 503 | 未記錄 | §5.4.6 |
| `02c-gen-gemini-3.8-flash.headers` | 60 秒內完全沒回應，被 curl 中止，所以標頭檔是空的（`requests.log` 第 15 行；第 29 行是同樣情況、40 秒） | — | 未記錄 | §5.4.3 逾時 |

`req/hi.json` 是 `10-burst-*` 的請求（推定：`promptTokenCount: 2`、上限 8）。`10-burst-*` 沒放，留下這個請求是為了之後重做 429 測試。

**仍未驗證**（這裡沒有樣本）：429 與 `details`、`region_blocked` 訊息、3.8-flash 的成功回應和思考預設值、`SAFETY`／`promptFeedback.blockReason`、401、408／504、500／502、串流途中出錯、網路錯誤。
