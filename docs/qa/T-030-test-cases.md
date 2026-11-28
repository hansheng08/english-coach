# QA 測試案例設計：T-030 `POST /shadow/attempts`

- 擁有者：QA｜日期：2026-11-28（台北時間）｜版本：v2（依 ARCHITECTURE v1.15 與 ADR-021 修訂 1 更新；v1 是 PR #116 的初稿）。
- 依據：`docs/tasks/T-030.md` v1.2、ARCHITECTURE v1.15（§4.18、§4.18.1、§4.6、§4.12.1、§4.12.2.1、§4.19、§5.0.4、§5.0.5、§5.1.1）、ADR-018 決定 9、ADR-019、ADR-020 決定 2、**ADR-021（含修訂 1）**、TASKS v1.98。
- **ADR-021／ARCHITECTURE v1.15 在 PR #118（尚未合併）**；本文件以 #118 head `0b83ccd` 的文字為準。#118 合併前，這些規則還不是 main 上的契約；合併後若文字有變，本文件再同步。
- 性質：**派工前的測試案例設計**，不是驗收結論。T-030 的前置（T-016、T-017b、T-020、T-021、T-025a、T-046）在 TASKS v1.98 都還沒合併，且 T-030 任務單 v1.2 的檔案範圍**還沒把 `packages/contracts/src/audio.ts` 列入**（ADR-021 後果要求列入），所以 handler 探針（`shadow.qa.test.ts`）與 `docs/qa/mutants/T-030.json` 等 Claude 做完、QA 讀過程式後再寫（憲章 §1.1）。
- 圖例：**TC** ＝ 任務單已列的測試案例；**X** ＝ QA 加碼案例；**W** ＝ WAV 解析（`parseWav16kMono`）案例；**探針** ＝ 已經能寫、現在就通過的 QA 探針；**【待釐清 Nx】** ＝ ADR-021 裁定後仍沒定下來、QA 不猜的項目，列在文末。
- 寫法規則（QA-T032 規則）：之後的 handler 探針一律用 `makeTestRouteDeps`、`makeTestShadowStore`、`makeTestTtsStore` 等工廠，只傳要覆寫的部分；fake 值一律低熵、明顯是假的。**WAV 探針的「無法解析尾巴」不要用全 0 的靜音取樣**（見 N1），用非 0 的固定樣式（例如 `0x7f`）。

## WAV 規則摘要（ARCHITECTURE v1.15 §4.18.1、§5.0.5；ADR-021 決定 1、2、修訂 1.4）
1. 先檢查**整份 buffer** ≤ `SHADOW_AUDIO_MAX_BYTES`（1,048,576）；超過直接 400 `audio`，**不呼叫** `parseWav16kMono`；剛好 1 MiB 可進入解析。
2. 只接受 RIFF/WAVE、`fmt ` 在 `data` 之前、`audioFormat = 1`、16-bit LE、16 kHz、單聲道、`blockAlign = 2`、`byteRate = 32_000`；其他 → 400 `audio`。
3. 依 RIFF 逐個 chunk 走（4 位元組 id＋4 位元組 LE 大小；奇數大小後有 1 位元組 padding，不計入宣告大小）。
4. 時長 `durationMs = round(宣告的 data 大小 / 32_000 × 1000)`。宣告大小超過資料區到檔尾的剩餘、或不是 2 的倍數 → 400。宣告 `0xFFFFFFFF` ＝ 到檔尾。
5. `data` 之後的**合法** chunk（標頭完整、宣告大小加 padding 不超過檔尾，例如 `LIST`／`INFO`）忽略；無法解析的尾巴（標頭不完整、大小超出檔尾、剩餘位元組構不成 chunk）→ 400。
6. 送給評分供應商（以及 `Wav16kMono.bytes`、上傳到 Storage）的只有**正規化後**的 RIFF／`fmt `／`data`，大小欄與實際 data 一致；忽略的 chunk 不送、不存。
7. 時長須在 300 ms（含）～30,000 ms（含）；0 秒與 < 300 ms → 400 `audio`。

## 目前可執行的探針（`task/T-030` 的 commit `6642800`，對現有程式、現在就通過）與 ADR-021 之後的處置

| 探針 | 檔案 | 對應 | 驗證內容 | ADR-021 後 |
|---|---|---|---|---|
| QA-1 | `packages/contracts/src/audio.qa.test.ts` | AC-T30-1／TC-2 | 30.000 秒通過、30.001 秒回 `validation`、`path: 'audio'` | 不變 |
| QA-2 | 同上 | AC-T30-1 | data 大小寫 `0xFFFFFFFF` 時用實際長度量；31 秒仍被擋 | 不變（規則 4） |
| QA-3 | 同上 | AC-T30-1 | **釘住舊行為**：少報 data 大小（宣告 1 秒、後面接 30 秒靜音取樣）時 parser 回 `ok`、1000 ms | **與新規則相反，必須改**：預期 400 `audio`，且尾巴改用非 0 取樣（N1）。見下方「探針建議」 |
| QA-4 | 同上 | AC-T30-1 | data 之前有奇數大小的 chunk，連同 padding 一起跳過 | 不變（規則 3；`fmt ` 之後、`data` 之前的 chunk 仍可接受，見 N5） |
| QA-5 | 同上 | AC-T30-1 | WAV 在大 buffer 的非 0 `byteOffset` 時照樣正確解析 | 不變 |
| QA-6 | 同上 | AC-T30-1 | **釘住舊行為**：0 個取樣的 WAV 被接受為 0 ms | **與新規則相反，必須改**：預期 400 `audio` |
| QA-7 | 同上 | AC-T30-1 | data 在 fmt 前、只有檔頭、空 buffer 都回 `validation`，不丟例外 | 不變（規則 2） |
| QA-8～QA-11 | `packages/domain/src/shadowing-t030.qa.test.ts` | AC-T30-7／TC-10 | 通過門檻 0.8／0.7 邊界；發音分數不參與 | 不變（domain 規則沒動） |

## 各 AC 的測試案例

### AC-T30-1 請求解析與驗證（400 `validation`，供應商 0 次）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-1 | 錯誤 | 不是 multipart；缺 `audio`；缺 `meta`；`meta` 是 `{` | 400；`path` 依序 `body`、`audio`、`meta`、`meta`；`assess`、`transcribe`、`synthesize` 0 次 |
| TC-2 | 邊界 | `itemIndex: 5`；`planDate` 昨天；8 kHz WAV；31 秒 WAV | `meta.itemIndex`、`meta.planDate`、`audio`、`audio` |
| X-1.1 | 快樂 | 多出一個名稱不同的表單欄位（例如 `note`） | 忽略，照常成功 |
| X-1.2 | 邊界 | `itemIndex` 取 0、4 | 成功；`-1`、`4.5`、`"2"`、`null` → 400 `meta.itemIndex` |
| X-1.3 | 邊界 | `planDate`：`2026-02-30`、`2026-11-7`、空字串、`20261127` | 400 `meta.planDate` |
| X-1.4 | 邊界 | 台北日界：`now` 為 UTC 15:59:59（台北 23:59:59）與 16:00:00，`planDate` 都送「前一個台北日」 | 前者成功、後者 400 `meta.planDate`（固定 `deps.now`） |
| X-1.5 | 錯誤 | `meta` 是合法 JSON 但不是物件：`null`、`[]`、`"x"`、`1`；非 UTF-8 位元組 | 400，`path` 是 `meta` |
| X-1.6 | 錯誤 | `meta` 帶多餘 key，例如 `userId` | 400，`path` 是 `meta.userId`（`.strict()`；ARCH v1.15）；任何情況都不採用 body 的 id |
| X-1.7 | 邊界 | 整份 `audio` 剛好 1,048,576 位元組（合格 WAV＋合法 `LIST` 尾巴補到）與多 1 位元組 | 前者進入解析；後者 400 `audio`，且**不呼叫** `parseWav16kMono`（以假／spy 驗證）；另一組：30 秒合格 WAV＋合法尾巴使整份 > 1 MiB → 仍 400（先擋整份大小，與解析結果無關） |
| X-1.8 | 邊界 | `audio` 的 MIME：`audio/wav`、`audio/wave`、`audio/x-wav`、`audio/WAV`、`audio/wav; codecs=1`、沒給、`audio/mpeg`、`audio/webm` | 前六者依位元組判斷（比對 type／subtype，忽略參數與大小寫）；後兩者 400 `audio` |
| X-1.9 | 錯誤 | `audio` 欄位是字串（不是檔案）；`meta` 欄位是檔案 | 前者 400 `audio`；後者 400 `meta` |
| X-1.10 | 錯誤 | 檔名是 `.wav`、內容是 mp3／隨機位元組 | 400 `audio` |
| X-1.11 | 錯誤 | `audio` 與 `meta` 都不合格 | 一次 400，`issues` 兩個都列、順序先 `audio` 再 `meta` |
| X-1.12 | 隱私 | 任一 400 的回應 body 與 log | 不含 `meta` 原文、檔名、位元組內容 |
| X-1.13 | 錯誤 | 兩個 `audio` 欄位；兩個 `meta` 欄位 | 400，`path` 各為 `audio`、`meta`；不默默取第一個或最後一個 |

### AC-T30-1 之 WAV 解析（W 系列；對 `parseWav16kMono`，handler 層再抽查 W-1、W-4、W-6）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| W-1 | 快樂 | `data` 後接合法 `LIST`／`INFO` chunk（標頭完整、大小與 padding 都在檔內），資料時長分別 300 ms、1 s、30 s | 全部通過；`durationMs` 只算 data；`Wav16kMono.bytes` 不含 `LIST`；送給 `assess` 與上傳的位元組是正規化後的 RIFF／`fmt `／`data`，大小欄一致（斷言 `assess` 收到的長度與內容，不含 `LIST` 位元組） |
| W-2 | 錯誤 | 宣告的 data 大小超過資料區到檔尾（例如宣告 2 s、實際只有 1 s） | 400 `audio`（不截斷、不當成 1 s） |
| W-3 | 錯誤 | 宣告的 data 大小是奇數（例如 32,001） | 400 `audio` |
| W-4 | 錯誤 | 少報：宣告 1 s、後面接 30 s **非 0** 取樣的生 PCM（QA-3 改後） | 400 `audio`；供應商 0 次；不上傳 |
| W-5 | 邊界 | 少報：宣告 1 s、後面接 30 s **全 0** 取樣（目前 QA-3 的樣式） | 【待釐清 N1：全 0 尾巴會被讀成一串「大小 0 的空 chunk」】 |
| W-6 | 邊界 | 宣告 `0xFFFFFFFF`：資料 1 s → 通過、31 s → 400；資料位元組數為奇數 | 前兩者依上；奇數 → 400【待釐清 N7：規則 4 的「2 的倍數」是否也適用於 `0xFFFFFFFF`】 |
| W-7 | 錯誤 | `data` 後尾巴只有 1～7 位元組（標頭不完整） | 400 `audio` |
| W-8 | 錯誤 | `data` 後有 chunk 標頭、但宣告大小超出檔尾 | 400 `audio` |
| W-9 | 邊界 | `data` 後的合法 chunk 是奇數大小，且檔尾少最後 1 個 padding 位元組 | 依字面（「宣告大小加 padding 不超過檔尾」）→ 400【待釐清 N6：許多寫入器省略最後的 padding】 |
| W-10 | 邊界 | 時長下限：9,600 位元組（300 ms）通過；9,568 位元組（299 ms）400；0 個取樣 400；9,584 位元組（299.5 ms）、9,582 位元組（299.4375 ms） | 通過、400、400、通過（四捨五入後 300）、400【待釐清 N2：下限用「四捨五入後的毫秒」判定是否為本意】 |
| W-11 | 邊界 | 時長上限：960,000 位元組（30.000 s）通過；960,032（30.001 s）400；960,002（30.0000625 s） | 通過、400、通過（四捨五入後 30000）【N2】 |
| W-12 | 錯誤 | `fmt ` 在 `data` 之後；沒有 `fmt `；沒有 `data` | 400 `audio` |
| W-13 | 錯誤 | 格式：IEEE float、`0xFFFE` extensible、A-law、μ-law、8-bit、24-bit、8 kHz、44.1 kHz、立體聲、`blockAlign` 不是 2、`byteRate` 不是 32,000 | 全部 400 `audio` |
| W-14 | 快樂 | `fmt ` 與 `data` 之間有別的 chunk（例如 `LIST`） | 通過、正規化後不含該 chunk（探針 QA-4 的延伸）【N5：ADR 沒有明講這個位置是否允許】 |
| W-15 | 隔離 | 傳入 `maxDurationMs` 參數 | 仍生效（既有 `audio.test.ts` 的行為）；`SHADOW_AUDIO_MIN_DURATION_MS` 是否也受它影響【N3】 |

### AC-T30-2 計畫沒好（503 `plan_not_ready`）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-3 | 錯誤 | `readShadowItem` 回 null（計畫不存在、非 `ready`、那一句不存在，各一次） | 503 `plan_not_ready`；供應商 0 次；`uploadAudio`、`insertAttempt` 0 次 |
| X-2.1 | 邊界 | 計畫只有 3 句時 `itemIndex` 3、4 | 503 `plan_not_ready` |
| X-2.2 | 錯誤 | `readShadowItem` 自己回 `db_failed` | 500 `db_failed`，**不是** 503 |
| X-2.3 | 隔離 | `readShadowItem` 的呼叫參數 | `userId` 取自 `AuthContext`，`planDate`、`itemIndex` 取自驗證後的 `meta` |
| X-2.4 | 順序 | `planDate` 不是今天**而且**計畫也沒好 | 400 `meta.planDate`（先比對日期，再 `readShadowItem`，ARCH v1.15）；`readShadowItem` 0 次、供應商 0 次 |

### AC-T30-3 參考時長（TTS 快取）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-4 | 快樂 | 快取有，`find` 回 30000 位元組 | `scoreShadowAttempt` 收到 `durationMs` 5000；`synthesize` 0 次 |
| TC-5 | 錯誤 | 快取沒有 → 合成成功並上傳後評分；另一次 `synthesize` 回 `timeout` | 前者評分；後者 504 `timeout`、`assess` 0 次 |
| X-3.1 | 邊界 | 位元組數 30001、30003 | 5000、5001（`Math.round(bytes*8/48)`） |
| X-3.2 | 邊界 | 快取物件存在但 0 位元組（或算不出 > 0 的時長） | 視為損壞的快取＝未命中：重新合成一次、成功後覆寫該物件；**不**把 `scoreShadowAttempt` 的 `validation` 回給前端（ARCH v1.15 §4.18.1 處理順序 3） |
| X-3.3 | 錯誤 | `find` 回 Storage 讀取錯誤（不是「不存在」） | 502 `storage_failed`（`op: 'download'`）；`synthesize` 0 次（不偷偷重新合成） |
| X-3.4 | 錯誤 | 合成成功但快取上傳失敗 | 502 `storage_failed`（`op: 'upload'`）；不評分 |
| X-3.5 | 一致 | 快取路徑 | `ttsObjectPath(userId, voice, normalizeTtsText(item.text))`；帶「/」與不帶「/」同一路徑；`voice` 取自設定 |
| X-3.6 | 回歸 | `postTts` 改用 `ensureTtsAudio` 後 | T-021 的既有測試與 QA 探針照樣通過 |

### AC-T30-4 一般模式（Azure）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-6 | 快樂 | `scoring: true`；`assess` 回 82、文字完全相同、時長相同 | 200：`scoring: 'azure'`、`pronScore: 82`、`passed: true`；`assess` 收到不含「/」的參考文字與 `timeoutMs` 8000；STT 0 次 |
| X-4.1 | 邊界 | 參考句含多個「/」、連續「/」 | `assess` 收到的文字不含「/」，其他字元不變 |
| X-4.2 | 邊界 | `pronScore` 0 與 100 | 都成功；回應通過 `ShadowResultSchema` |
| X-4.3 | 邊界 | Azure 沒聽到聲音（`ok`、分數 0、`recognizedText` 空） | 200，`accuracy: 0`、`passed: false`；照樣上傳、寫列 |
| X-4.4 | 錯誤 | `resolve` 回 `paid_not_allowed` | 403；`assess` 0 次、STT 0 次；**不寫 `provider_call`**（沒有對外呼叫，ARCH v1.15 處理順序 6） |
| X-4.5 | 一致 | 一般模式的 `meta.sttProvider`、`meta.pronProvider`、`shadow_attempt.stt_provider` | 三者都是**這次發音評估的供應商 id**（預設 `azure-speech`），不是 `settings.stt` |
| X-4.6 | 一致 | `resolve` 呼叫 | 恰好 1 次，能力 `'pronunciation'`；第三個參數等於假 `sumPaidUsageThisMonthNtd` 的回傳，不是字面 0 |

### AC-T30-5 Azure 失敗（不降級）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-7 | 錯誤 | `assess` 依序回 `rate_limited`、`unavailable`、`timeout`、`not_configured`、`invalid_response` | 429、502、504、503、502；STT 0 次；`uploadAudio`、`insertAttempt` 0 次 |
| X-5.1 | 錯誤 | `quota_exhausted`（帶 `retryAfterSec`）、`auth`、`region_blocked` | 429／502／502；`retryAfterSec` 原樣出現在 body |
| X-5.2 | 錯誤 | 缺 `PronScore` 的 `invalid_response` 再重送 | 每次獨立處理，不會自動改走 STT |
| X-5.3 | 不降級 | 上述每種失敗後檢查假 registry 的 `resolve` | 只有 `'pronunciation'`，從不出現 `'stt'` |
| X-5.4 | 隱私 | 失敗的 body 與 log | 不含辨識文字、參考句、路徑 |

### AC-T30-6 「不評分」模式（STT）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-8 | 快樂 | `scoring: false`；`transcribe` 回 `timing: 'words'` | 200：`scoring: 'off'`、`pronScore: null`、`meta.pronProvider: null`；`assess` 0 次；`transcribe` 收到 `wordTimestamps: true`、`language: 'en'`、`timeoutMs` 25000 |
| TC-9 | 錯誤 | `transcribe` 回 `quota_exhausted` | 429；不上傳、不寫列 |
| X-6.1 | 錯誤 | `transcribe` 回的 `timing` 不是 `'words'`，或辨識文字非空卻沒有逐字時間 | 502 `invalid_response`；不上傳、不寫列（ARCH v1.15 處理順序 5） |
| X-6.2 | 邊界 | 辨識文字為空**且**沒有逐字時間 | 200，`accuracy: 0`、`speedRatio: 0`、`passed: false`；照樣上傳、寫列 |
| X-6.3 | 一致 | `shadow_attempt` 的 `pron_score`、`pron_provider` | 兩者為 null；`stt_provider` 是設定的 STT 供應商 |
| X-6.4 | 錯誤 | `settings.stt` 指到付費供應商但未同意 | 403 `paid_not_allowed`；`transcribe` 0 次；不寫 `provider_call` |
| X-6.5 | 錯誤 | `profile.settings` 無法被 `SettingsSchema` 解析 | 500 `internal`；不默默改用預設值；供應商 0 次 |

### AC-T30-7 通過門檻（TC-10 已由探針 QA-8～QA-11 在 domain 層固定）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-10 | 邊界 | 0.8／0.7；0.79／0.9；0.9／0.69；分數 10 但兩者都過 | true、false、false、true |
| X-7.1 | 端到端 | handler 層用同一組數字走完整請求 | `accuracy`、`speedRatio` 與 `scoreShadowAttempt` 輸出逐位相同；`passed` 即 `unlocked` |
| X-7.2 | 邊界 | 語速比大於 1 | 允許（`ShadowResultSchema.speedRatio` 沒有上限） |
| X-7.3 | 邊界 | 一般模式 `pronScore` 100 但正確率 0.5 | `passed: false` |

### AC-T30-8 上傳與寫列
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-11 | 快樂 | 成功一次；`crypto.randomUUID` 用假的固定值 | 路徑 `<user>/shadow/2026-11-27/2-<uuid>.wav`；`insertAttempt` 欄位與值正確、沒有多的欄位 |
| TC-12 | 錯誤 | `uploadAudio` 回錯；`insertAttempt` 回錯 | 502 `storage_failed`、`insertAttempt` 0 次；500 `db_failed` |
| X-8.1 | 欄位 | `insertAttempt` 的欄位集合 | 恰為 T-006 的 `grant insert` 清單：`user_id, plan_date, item_index, audio_path, recognized_text, accuracy, speed_ratio, pron_score, stt_provider, pron_provider, passed`；不含 `id`、`created_at`、`audio_expires_at` |
| X-8.2 | 欄位 | `audio_path` | 等於剛上傳的路徑，並以 `<user_id>/` 開頭；`user_id` 取自 `AuthContext` |
| X-8.3 | 順序 | 呼叫順序 | 供應商成功 → `uploadAudio` → `insertAttempt`；任一步失敗，後面的步驟 0 次 |
| X-8.4 | 唯一 | 同一段錄音連送兩次 | 兩個不同路徑；上傳不覆蓋 |
| X-8.5 | 內容 | 上傳的位元組與 `contentType` | 位元組＝**正規化後**的 WAV（ARCH v1.15）：請求是 44 位元組標準檔頭＋data 時與請求逐位元組相同；請求帶 `LIST` 尾巴時，上傳的**不含**該 chunk；`contentType` 為 `audio/wav` |
| X-8.6 | 錯誤 | 寫列失敗時 | 不重試、不刪除剛上傳的物件；孤兒由 `purge-audio` 清（見 `orphan-audio-test-cases.md`） |
| X-8.7 | 錯誤 | 上傳失敗的 `op` | `'upload'`，kind 是 `storage_failed`，不是 `db_failed` |

### AC-T30-9 `provider_call`
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-13 | 快樂＋錯誤 | 成功一次、`assess` 失敗一次、TC-5 的合成一次；`insertProviderCall` 回錯一次 | 每次外部呼叫一筆、`errorKind` 正確；寫入失敗時回應照常 |
| X-9.1 | 邊界 | 快取命中 | 沒有 `synthesize` 就沒有對應的 `provider_call` |
| X-9.2 | 邊界 | 一般模式與不評分模式 | 各只有一筆（`pronunciation`／`stt`） |
| X-9.3 | 邊界 | `resolve` 本身失敗（`paid_not_allowed`、`not_configured`） | **不寫** `provider_call`（沒有對外呼叫） |
| X-9.4 | 隱私 | `provider_call` 的欄位 | 沒有辨識文字、參考句、路徑 |

### AC-T30-10 工廠、`resolve` 參數、log
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-14 | 工廠與 log | `makeTestRouteDeps().shadowStore(ctx).insertAttempt(…)`；假 registry 記錄 `resolve` 參數；全部情境的 log | 回 `not stubbed:`；第三個參數等於假 `sumPaidUsageThisMonthNtd` 的回傳；log 不含假文字、假路徑 |
| X-10.1 | 工廠 | `makeTestShadowStore` 的每個方法 | 沒覆寫時都回 `not stubbed: <名稱>`；`RouteDeps.shadowStore` 必填（型別測試） |
| X-10.2 | 工廠 | 既有的 route 測試與 QA 探針 | 補預設值後照樣通過；沒有測試寫完整 `RouteDeps` 字面值 |
| X-10.3 | log | log 的內容 | 不含辨識文字、參考句、檔案路徑、`meta` 原文 |

## ADR-021 對上一版待釐清的處理

| 上一版 | 狀態 | 依據 |
|---|---|---|
| A1 1 MiB、MIME | **已裁定**；任務單 v1.2 的 AC／TC 仍沒列 → 待 T-030 v1.3 同步（已列為 N3 的一部分） | §4.18.1 |
| A2 MIME 大小寫與參數 | 已裁定：忽略參數、大小寫不敏感 | §4.18.1 |
| A3 欄位型別、重複欄位 | 已裁定：`audio` 非檔案→`audio`；`meta` 非字串→`meta`；重複→該欄位名 | §4.18.1 |
| A4 多餘 key 的 path | 已裁定：`meta.<key>` | §4.18.1 |
| A5 少報 data 大小 | 已裁定（修訂 1.4）：宣告大小為準；無法解析的尾巴 400；只送正規化後 WAV。**衍生 N1** | ADR-021 修訂 1.4、§4.18.1 |
| A6 0 秒 WAV | 已裁定：< 300 ms 一律 400 | ADR-021 決定 2 |
| A7 多重錯誤 | 已裁定：兩個都列，先 `audio` 後 `meta` | §4.18.1 |
| A8 `planDate` 與計畫順序 | 已裁定：先驗日期（400），再讀計畫 | §4.18.1 |
| A9 參考時長 0 | 已裁定：視為損壞快取，重新合成並覆寫 | §4.18.1 |
| A10 `find` 失敗 | 已裁定：502 `storage_failed`（`download`），不重新合成 | §4.18.1 |
| A11 一般模式 `sttProvider` | 已裁定：此次發音評估的供應商 id | §4.18.1 |
| A12 STT 沒逐字時間 | 已裁定：502 `invalid_response`；空文字且無逐字時間→200（`accuracy: 0`） | §4.18.1 |
| A13 設定壞掉 | 已裁定：500 `internal` | §4.18.1 |
| A14 `resolve` 失敗要不要寫 `provider_call` | 已裁定：不寫 | §4.18.1 |
| A15 任務單過時文字 | 仍待 TechLead 同步 T-030 v1.3（「不在本單」那句、檔案範圍加 `audio.ts`） | ADR-021 後果 |
| A16 前置未合併 | 未變（TASKS v1.98 以後，main 只多了 #115 設計稿） | TASKS |

## 待釐清（ADR-021 裁定後新出現或仍未定；QA 不猜，請 TechLead／Architect 決定）

| # | 問題 | 來源 | 影響 |
|---|---|---|---|
| N1 | **全 0 的尾巴會被讀成合法 chunk。** 「合法 chunk」只要求標頭完整、大小加 padding 不超過檔尾，沒要求 id 是什麼。少報 data 大小、後面接靜音（全 0）取樣時，每 8 位元組剛好是一個 id 為 `\0\0\0\0`、大小 0 的空 chunk：位元組數是 8 的倍數時整段被視為合法並忽略（回 200，後面的音訊被丟掉）；不是 8 的倍數時最後剩 1～7 位元組才回 400。現有 QA-3 的樣式（30 s 靜音，960,000 位元組＝8 的倍數）正好落在前者。非 0 的生 PCM 幾乎一定回 400。建議：規定 chunk id 必須是 4 個可印 ASCII（0x20～0x7E），或「無法解析的尾巴」包含非可印 id | ADR-021 修訂 1.4、§4.18.1 | W-4／W-5；QA-3 的改法。不影響 Azure 30 秒上限（被忽略的位元組不送出），只影響「靜音尾巴回 200 還是 400」 |
| N2 | 時長用 `round(bytes/32000*1000)` 後再與 300／30,000 比：30.0000625 秒（960,002 位元組）與 299.5 ms（9,584 位元組）因四捨五入而通過；是否為本意，或下限／上限改用位元組數比較 | §5.0.5 | W-10、W-11 的預期值 |
| N3 | **新規則與現有程式／測試的衝突（範圍問題）：** (a) `parseWav16kMono` 的 300 ms 下限會讓 `supabase/functions/_shared/providers/azure-speech/test/fake-fetch.ts` 的 `makeWav()`（預設 160 個取樣＝10 ms，`expectOk(parseWav16kMono(...))`）失敗，連帶 `azure-speech.test.ts` 與 QA 擁有的 `azure-speech.qa.test.ts`；(b) `packages/contracts/src/audio.test.ts` 有兩個「UNDECIDED」測試（data 宣告大於檔案時截斷為 500 ms）與新規則相反；(c) T-030 任務單 v1.2 把 `providers/**`、`packages/contracts/src/`（除 `shadow.ts`）列為範圍外，Claude 無法改 `fake-fetch.ts` 與 `audio.test.ts`；QA 檔 Claude 也不能改。需要決定：下限只在 handler／`SHADOW_AUDIO_MIN_DURATION_MS` 檢查而 `parseWav16kMono` 本身不擋，或把 `fake-fetch.ts` 的取樣數與 `azure-speech.qa.test.ts` 一併列入範圍／由 QA 處理 | §5.0.5、任務單範圍 | T-030 v1.3 的檔案範圍；QA 對 `azure-speech.qa.test.ts` 是否要改 |
| N4 | ADR-021 決定 1 的本文（「檔頭少報或多報 … 回 400」「不多餘位元組送出」）與修訂 1.4（合法的後續 chunk 忽略）不一致；修訂 1.4 已註明「修正決定 1」，ARCHITECTURE v1.15 §4.18.1 與修訂一致。QA 以修訂 1.4＋ARCHITECTURE 為準 | ADR-021 | 僅文字一致性；建議 ADR 本文決定 1 直接改寫 |
| N5 | `fmt ` 與 `data` 之間出現其他 chunk（例如 `LIST`）是否允許：文字只說 `fmt ` 在 `data` 前、`data` 後的合法 chunk 忽略；QA-4 目前通過（現有 parser 允許） | §4.18.1 | W-14 |
| N6 | `data` 後的合法 chunk 若是奇數大小、且省略最後 1 個 padding 位元組：字面規則回 400；若寫入器常省略，會誤擋合法錄音。跟讀錄音由 §9 的 AudioWorklet 自己產生（不會有 `LIST`），風險低，但規格要明確 | §4.18.1 | W-9 |
| N7 | `0xFFFFFFFF`（到檔尾）時剩餘位元組數若是奇數，是否同樣回 400（「不是 2 的倍數」） | §4.18.1 | W-6 |
