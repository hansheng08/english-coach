# QA 測試案例設計：T-030 `POST /shadow/attempts`

- 擁有者：QA｜日期：2026-11-28（台北時間）｜依據：`docs/tasks/T-030.md` v1.2、ARCHITECTURE v1.14（§4.18、§4.18.1、§4.6、§4.12.1、§4.19、§5.0.4、§5.0.5、§5.1.1）、ADR-018 決定 9、ADR-019、ADR-020 決定 2、TASKS v1.98。
- 性質：**派工前的測試案例設計**，不是驗收結論。T-030 的前置（T-016、T-017b、T-020、T-021、T-025a、T-046）在 TASKS v1.98 都還沒合併，所以 `shadow.ts`、`shadow-store.ts`、`ensure.ts`、`makeTestShadowStore` 目前都不存在，無法寫會編譯的 handler 探針；handler 探針（`shadow.qa.test.ts`）等 Claude 做完、QA 讀過程式後再寫，並附 `docs/qa/mutants/T-030.json`（憲章 §1.1）。
- 圖例：**TC** ＝ 任務單已列的測試案例（Claude 要寫，編號出現在測試名稱）；**X** ＝ QA 加碼案例（任務單沒列，QA 驗收時用探針補）；**探針** ＝ 已經能寫、現在就通過的 QA 探針（在 `task/T-030` 的 `[QA]` commit）；**【待釐清】** ＝ 任務單與 ARCHITECTURE 沒有定下來，QA 不猜，列在文末「待釐清」。
- 寫法規則（QA-T032 規則）：之後的 handler 探針一律用 `makeTestRouteDeps`、`makeTestShadowStore`、`makeTestTtsStore` 等工廠，只傳要覆寫的部分；fake 值一律低熵、明顯是假的。

## 目前可執行的探針（已在 `task/T-030`，對現有程式、現在就通過）

| 探針 | 檔案 | 對應 | 驗證內容 |
|---|---|---|---|
| QA-1 | `packages/contracts/src/audio.qa.test.ts` | AC-T30-1／TC-2 | 30.000 秒通過、30.001 秒（多 16 個取樣）回 `validation`、`path: 'audio'` |
| QA-2 | 同上 | AC-T30-1 | 檔頭 data 大小寫 `0xFFFFFFFF`（串流錄音常見）時用實際長度量；31 秒仍被擋 |
| QA-3 | 同上 | AC-T30-1 | 【待釐清 A5】檔頭少報 data 大小時，parser 只看宣告值；超出的位元組不被量到 |
| QA-4 | 同上 | AC-T30-1 | data 之前有奇數大小的 chunk，連同補齊位元組一起跳過 |
| QA-5 | 同上 | AC-T30-1 | WAV 在大 buffer 的非 0 `byteOffset` 時照樣正確解析（`FormData` 取出的位元組可能是 view） |
| QA-6 | 同上 | AC-T30-1 | 【待釐清 A6】0 個取樣的 WAV 被接受為 0 ms |
| QA-7 | 同上 | AC-T30-1 | data 在 fmt 前、只有檔頭、空 buffer 都回 `validation`，不丟例外 |
| QA-8 | `packages/domain/src/shadowing-t030.qa.test.ts` | AC-T30-7／TC-10 | 正確率 0.80、語速比 0.70 剛好解鎖 |
| QA-9 | 同上 | AC-T30-7／TC-10 | 正確率 0.79、語速比 0.9 不解鎖 |
| QA-10 | 同上 | AC-T30-7／TC-10 | 正確率 0.90、語速比 0.69 不解鎖 |
| QA-11 | 同上 | AC-T30-7／TC-10 | 輸入帶多餘的分數欄位不影響結果（發音分數不參與 `passed`） |

## 各 AC 的測試案例

### AC-T30-1 請求解析與驗證（400 `validation`，供應商 0 次）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-1 | 錯誤 | 不是 multipart；缺 `audio`；缺 `meta`；`meta` 是 `{` | 400；`path` 依序 `body`、`audio`、`meta`、`meta`；`assess`、`transcribe`、`synthesize` 0 次 |
| TC-2 | 邊界 | `itemIndex: 5`；`planDate` 昨天；8 kHz WAV；31 秒 WAV | `meta.itemIndex`、`meta.planDate`、`audio`、`audio` |
| X-1.1 | 快樂 | 多出一個表單欄位（例如 `note`） | 忽略，照常成功（§4.18.1 「多出來的欄位忽略」） |
| X-1.2 | 邊界 | `itemIndex` 取 0、4 | 成功；`-1`、`4.5`、`"2"`（字串）、`null` → 400 `meta.itemIndex` |
| X-1.3 | 邊界 | `planDate`：`2026-02-30`、`2026-11-7`、空字串、`20261127` | 400 `meta.planDate` |
| X-1.4 | 邊界 | 台北日界：`now` 為 UTC 15:59:59（台北 23:59:59）與 16:00:00（台北隔天 00:00:00），`planDate` 都送「前一個台北日」 | 前者成功、後者 400 `meta.planDate`（用固定的 `deps.now`，不用真時間） |
| X-1.5 | 錯誤 | `meta` 是合法 JSON 但不是物件：`null`、`[]`、`"x"`、`1` | 400，`path` 是 `meta` |
| X-1.6 | 錯誤 | `meta` 帶多餘的 key，例如 `{"planDate":…,"itemIndex":1,"userId":"…"}` | `ShadowAttemptMetaSchema` 是 `.strict()`，預期 400；**且**絕不採用 body 的 id（限制第 3 條）【待釐清 A4：`path` 寫法】 |
| X-1.7 | 邊界 | `audio` 剛好 1,048,576 位元組（用合格 WAV 加尾端 chunk 補到）與多 1 位元組 | 前者進入解析；後者 400 `audio`，且**不呼叫 `parseWav16kMono`**（§4.18.1 「先檢查大小再解析」）【待釐清 A1：任務單未列】 |
| X-1.8 | 邊界 | `audio` 的 MIME：`audio/wav`、`audio/wave`、`audio/x-wav`、沒給、`audio/mpeg`、`audio/webm` | 前四者依位元組判斷；後兩者 400 `audio`【待釐清 A1、A2（大小寫、帶參數）】 |
| X-1.9 | 錯誤 | `audio` 欄位是字串（不是檔案）；`meta` 欄位是檔案 | `audio` → 400 `audio`；`meta` 的處理【待釐清 A3】 |
| X-1.10 | 錯誤 | 檔名是 `.wav`、內容是 mp3／隨機位元組 | 400 `audio`（不信任副檔名） |
| X-1.11 | 錯誤 | `audio` 與 `meta` 都不合格 | 一律 400；先報哪一個【待釐清 A7】 |
| X-1.12 | 隱私 | 任一 400 的回應 body 與 log | 不含 `meta` 原文、檔名、位元組內容 |

### AC-T30-2 計畫沒好（503 `plan_not_ready`）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-3 | 錯誤 | `readShadowItem` 回 null（計畫不存在、非 `ready`、那一句不存在，各一次） | 503 `plan_not_ready`；供應商 0 次；`uploadAudio`、`insertAttempt` 0 次 |
| X-2.1 | 邊界 | 計畫只有 3 句時 `itemIndex` 3、4（§4.6 「不足 5 句就回傳實際句數」） | 503 `plan_not_ready` |
| X-2.2 | 錯誤 | `readShadowItem` 自己回 `db_failed` | 500 `db_failed`，**不是** 503 |
| X-2.3 | 隔離 | `readShadowItem` 的呼叫參數 | `userId` 取自 `AuthContext`，`planDate`、`itemIndex` 取自驗證後的 `meta`；不會讀到別人的計畫 |
| X-2.4 | 順序 | `planDate` 不是今天**而且**計畫也沒好 | 【待釐清 A8：400 還是 503】 |

### AC-T30-3 參考時長（TTS 快取）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-4 | 快樂 | 快取有，`find` 回 30000 位元組 | `scoreShadowAttempt` 收到 `durationMs` 5000；`synthesize` 0 次 |
| TC-5 | 錯誤 | 快取沒有 → 合成成功並上傳後評分；另一次 `synthesize` 回 `timeout` | 前者評分；後者 504 `timeout`、`assess` 0 次 |
| X-3.1 | 邊界 | 位元組數 30001、30003（`Math.round(bytes*8/48)`：5000.17、5000.5） | 5000、5001（四捨五入的邊界，ARCHITECTURE §5.6.3） |
| X-3.2 | 邊界 | 快取物件 0 位元組 | 參考時長 0 → `scoreShadowAttempt` 回 validation【待釐清 A9：回什麼錯誤】 |
| X-3.3 | 錯誤 | `find` 自己失敗（Storage download 錯） | 【待釐清 A10：重新合成還是回 `storage_failed`】 |
| X-3.4 | 錯誤 | 合成成功但快取上傳失敗 | 502 `storage_failed`（`op: 'upload'`）；不評分 |
| X-3.5 | 一致 | 快取路徑 | 用 `ttsObjectPath(userId, voice, normalizeTtsText(item.text))`；`item.text` 帶「/」與不帶「/」得到同一路徑；`voice` 取自設定 |
| X-3.6 | 回歸 | `postTts` 改用 `ensureTtsAudio` 後 | T-021 的既有測試與 QA 探針照樣通過（本單範圍只改呼叫，不改行為） |

### AC-T30-4 一般模式（Azure）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-6 | 快樂 | `scoring: true`；`assess` 回 82、文字完全相同、時長相同 | 200：`scoring: 'azure'`、`pronScore: 82`、`passed: true`；`assess` 收到不含「/」的參考文字與 `timeoutMs` 8000；STT 0 次 |
| X-4.1 | 邊界 | 參考句含多個「/」、連續「/」、「/」前後無空白 | `assess` 收到的文字不含「/」（`stripBreaks`），其他字元不變 |
| X-4.2 | 邊界 | `pronScore` 0 與 100 | 兩者都成功；回應通過 `ShadowResultSchema` |
| X-4.3 | 邊界 | Azure 沒聽到聲音（`ok`、分數 0、`recognizedText` 空，ADR-015 決定 4） | 200，`accuracy: 0`、`passed: false`；照樣上傳、寫列（這是成功分支，不是失敗分支） |
| X-4.4 | 錯誤 | `resolve` 回 `paid_not_allowed` | 403，`assess` 0 次，STT 0 次 |
| X-4.5 | 一致 | `meta.sttProvider`、`shadow_attempt.stt_provider`（`not null`） | 一般模式兩者都有值；值是什麼【待釐清 A11】 |
| X-4.6 | 一致 | `resolve` 呼叫 | 恰好 1 次，能力 `'pronunciation'`；第三個參數等於假 `sumPaidUsageThisMonthNtd` 的回傳，**不是**字面 0 |

### AC-T30-5 Azure 失敗（不降級）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-7 | 錯誤 | `assess` 依序回 `rate_limited`、`unavailable`、`timeout`、`not_configured`、`invalid_response` | 依 §5.0.4：429、502、504、503、502；STT 0 次；`uploadAudio`、`insertAttempt` 0 次 |
| X-5.1 | 錯誤 | 另外三種：`quota_exhausted`（帶 `retryAfterSec`）、`auth`、`region_blocked` | 429／502／502；`retryAfterSec` 原樣出現在 body |
| X-5.2 | 錯誤 | 缺 `PronScore` 的 `invalid_response` 再重送 | 每次獨立處理，不會「記住」失敗而自動改走 STT |
| X-5.3 | 不降級 | 上述每一種失敗後，檢查假 registry 的 `resolve` 呼叫 | 只有 `'pronunciation'`，從不出現 `'stt'`（AC-25、ADR-003） |
| X-5.4 | 隱私 | 失敗的 body 與 log | 不含辨識文字、參考句、路徑 |

### AC-T30-6 「不評分」模式（STT）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-8 | 快樂 | `scoring: false`；`transcribe` 回 `timing: 'words'` | 200：`scoring: 'off'`、`pronScore: null`、`meta.pronProvider: null`；`assess` 0 次；`transcribe` 收到 `wordTimestamps: true`、`language: 'en'`、`timeoutMs` 25000 |
| TC-9 | 錯誤 | `transcribe` 回 `quota_exhausted` | 429；不上傳、不寫列 |
| X-6.1 | 邊界 | `transcribe` 回的 `timing` 不是 `'words'`（沒有逐字時間） | 語速比 0、`passed: false`【待釐清 A12：這樣是否合意】 |
| X-6.2 | 邊界 | 辨識文字空字串 | 200，`accuracy: 0`、`passed: false`；照樣上傳、寫列 |
| X-6.3 | 一致 | `shadow_attempt` 的 `pron_score`、`pron_provider` | 兩者為 null；`stt_provider` 是設定的 STT 供應商 |
| X-6.4 | 錯誤 | `settings.stt` 指到付費供應商但未同意 | 403 `paid_not_allowed`，`transcribe` 0 次 |
| X-6.5 | 錯誤 | `profile.settings` 無法被 `SettingsSchema` 解析 | 【待釐清 A13】 |

### AC-T30-7 通過門檻（TC-10 已由探針 QA-8～QA-11 在 domain 層固定）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-10 | 邊界 | 0.8／0.7；0.79／0.9；0.9／0.69；分數 10 但兩者都過 | true、false、false、true |
| X-7.1 | 端到端 | handler 層用同一組數字走完整請求 | 回應 `accuracy`、`speedRatio` 與 `scoreShadowAttempt` 輸出逐位相同（不重算、不四捨五入）；`passed` 即 `unlocked` |
| X-7.2 | 邊界 | 語速比大於 1（講得比原音快） | 允許，`ShadowResultSchema.speedRatio` 沒有上限 |
| X-7.3 | 邊界 | 一般模式 `pronScore` 100 但正確率 0.5 | `passed: false` |

### AC-T30-8 上傳與寫列
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-11 | 快樂 | 成功一次；`crypto.randomUUID` 用假的固定值 | 路徑 `<user>/shadow/2026-11-27/2-<uuid>.wav`；`insertAttempt` 欄位與值正確、沒有多的欄位 |
| TC-12 | 錯誤 | `uploadAudio` 回錯；`insertAttempt` 回錯 | 502 `storage_failed`、`insertAttempt` 0 次；500 `db_failed` |
| X-8.1 | 欄位 | `insertAttempt` 的欄位集合 | 恰為 T-006 的 `grant insert` 清單：`user_id, plan_date, item_index, audio_path, recognized_text, accuracy, speed_ratio, pron_score, stt_provider, pron_provider, passed`；不含 `id`、`created_at`、`audio_expires_at`（沒有 grant） |
| X-8.2 | 欄位 | `audio_path` | 等於剛上傳的路徑，並以 `<user_id>/` 開頭（`shadow_attempt_audio_path_check`）；`user_id` 取自 `AuthContext` |
| X-8.3 | 順序 | 呼叫順序 | 供應商成功 → `uploadAudio` → `insertAttempt`；任一步失敗，後面的步驟 0 次 |
| X-8.4 | 唯一 | 同一段錄音連送兩次 | 兩個不同路徑（各自的 uuid）；上傳不覆蓋（沒有 upsert） |
| X-8.5 | 內容 | 上傳的位元組與 `contentType` | 位元組與請求的 `audio` 逐位元組相同（不重新編碼）；`contentType` 為 `audio/wav` |
| X-8.6 | 錯誤 | 寫列失敗時 | 不重試、不刪除剛上傳的物件（刪除權限只有 `purge-audio`，§4.12.1）；孤兒由 24 小時規則清（見 `orphan-audio-test-cases.md`） |
| X-8.7 | 錯誤 | 上傳失敗的 `op` | `'upload'`，且 kind 是 `storage_failed`，不是 `db_failed` |

### AC-T30-9 `provider_call`
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-13 | 快樂＋錯誤 | 成功一次、`assess` 失敗一次、TC-5 的合成一次；`insertProviderCall` 回錯一次 | 每次外部呼叫一筆、`errorKind` 正確；寫入失敗時回應照常 |
| X-9.1 | 邊界 | 快取命中 | 沒有 `synthesize` 就**沒有**對應的 `provider_call`（ADR-020 決定 3） |
| X-9.2 | 邊界 | 一般模式與不評分模式 | 各只有一筆（`pronunciation`／`stt`），不會多出另一個能力的紀錄 |
| X-9.3 | 欄位 | 成功的 `errorKind` | `null`；失敗是該 kind（含 `paid_not_allowed` 前的 `resolve` 失敗要不要寫列【待釐清 A14】） |
| X-9.4 | 隱私 | `provider_call` 的欄位 | 沒有辨識文字、參考句、路徑 |

### AC-T30-10 工廠、`resolve` 參數、log
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-14 | 工廠與 log | `makeTestRouteDeps().shadowStore(ctx).insertAttempt(…)`；假 registry 記錄 `resolve` 參數；全部情境的 log | 回 `not stubbed:`；第三個參數等於假 `sumPaidUsageThisMonthNtd` 的回傳；log 不含假文字、假路徑 |
| X-10.1 | 工廠 | `makeTestShadowStore` 的每個方法（`readShadowItem`、`uploadAudio`、`insertAttempt`） | 沒覆寫時都回 `not stubbed: <名稱>`；`RouteDeps.shadowStore` 是必填（型別測試） |
| X-10.2 | 工廠 | 既有的 `checkins*.qa.test.ts`、其他 route 測試 | 補上預設值後照樣通過；沒有任何測試寫完整 `RouteDeps` 字面值 |
| X-10.3 | log | log 的內容 | 只有 kind、狀態碼、耗時等；不含辨識文字、參考句、檔案路徑、`meta` 原文 |

## 待釐清（QA 不猜；請 TechLead／Architect 決定，寫進任務單後 QA 才據以驗收）

| # | 問題 | 來源 | 影響 |
|---|---|---|---|
| A1 | ARCHITECTURE §4.18.1／§5.1／ADR-020 決定 2 要求 `audio` ≤ 1 MiB（`SHADOW_AUDIO_MAX_BYTES`）、MIME 檢查（`audio/wav`、`audio/wave`、`audio/x-wav`）、先檢查大小再解析；**T-030 v1.2 的 AC-T30-1 與 TC-1／TC-2 都沒列**，介面段也沒有這個常數 | 任務單 v1.2 vs ARCH v1.14 | Claude 照任務單可能不做；QA 事後用 X-1.7、X-1.8 退件並不公平。建議 v1.3 補進 AC-T30-1 與 TC |
| A2 | MIME 比對：大小寫（`audio/WAV`）、帶參數（`audio/wav; codecs=1`）算不算合格 | §4.18.1 | X-1.8 的預期值 |
| A3 | `meta` 欄位若是檔案（不是字串）怎麼處理；同名欄位重複出現（兩個 `audio`）取哪一個 | §4.18.1 沒寫 | X-1.9 |
| A4 | `meta` 帶多餘 key（`.strict()`）時 `issues[].path` 要寫 `meta` 還是 `meta.<key>` | §4.18.1 只寫「`meta` 或 `meta.<欄位>`」 | X-1.6 |
| A5 | 檔頭少報 data 大小（宣告 1 秒、實際 31 秒）：parser 只量宣告值，會通過；若 handler 把**整個 buffer**（約 992 KB，仍低於 1 MiB）送去 Azure，可能超過 Azure 的 30 秒上限，也會把多出的位元組存進 Storage。`parseWav16kMono` 在範圍外（`packages/contracts/src` 只有 `shadow.ts`），本單不能改 | 探針 QA-3 | 要由 Architect 決定：handler 只送 `bytes.subarray(0, 44 + 宣告大小)`，還是另開單讓 parser 檢查檔案長度與宣告一致 |
| A6 | 0 秒（0 個取樣）WAV 會通過 parser；是否該 400 `validation`（`audio`）？目前會一路送到 Azure／STT 才失敗或得 0 分，並且可能寫入一筆沒有內容的 `shadow_attempt` | 探針 QA-6 | 建議在 §4.18.1 加「時長需 > 0」 |
| A7 | `audio` 與 `meta` 都不合格時先報哪一個（`issues` 一個還是兩個） | AC-T30-1 | X-1.11 |
| A8 | 步驟 1 的寫法是先 `readShadowItem`、再比對 `planDate`：`planDate` 非今天且計畫沒好時回 400 還是 503；AC-T30-1 又說這類驗證「都不呼叫供應商」 | 任務單「順序」第 1 點 | X-2.4 |
| A9 | 參考時長為 0（快取物件 0 位元組）時 `scoreShadowAttempt` 回 `validation`（`referenceDurationMs`）：handler 要回 500 `internal`、還是重新合成、還是別的 | `domain/shadowing.ts` | X-3.2 |
| A10 | `ensureTtsAudio` 的 `find` 回錯（Storage download 失敗）時：視為沒有快取而重新合成，還是回 `storage_failed`（`op: 'download'`） | 任務單第 2 步 | X-3.3 |
| A11 | 一般模式時 `meta.sttProvider` 與 `shadow_attempt.stt_provider`（`not null`）要填什麼：Azure 的 id？AC-T30-4 只規定 `meta.pronProvider` | ARCH §4.18 `ShadowResultSchema` | X-4.5 |
| A12 | 不評分模式下 STT 回的逐字時間不是 `words`（或空）→ 語速比 0 → 永遠不能解鎖。是接受，還是回錯誤 | AC-T30-6 | X-6.1 |
| A13 | `SettingsSchema.parse(profile.settings)` 失敗時（設定被寫壞）回什麼；任務單只說「讀設定」 | 任務單「順序」第 3 點 | X-6.5 |
| A14 | `resolve` 本身失敗（例如 `paid_not_allowed`、`not_configured`）時，有沒有呼叫外部服務，要不要寫 `provider_call`；AC-T30-9 寫「每次外部呼叫」 | AC-T30-9 | X-9.3 |
| A15 | T-030「不在本單」仍寫「`purge-audio` 怎麼清寫列失敗的錄音：待 Architect」，但 ARCH v1.14 §4.12.2.1／ADR-020 決定 2 已經定案（24 小時、沿用 `purge-audio`）；任務單 v1.2 沒同步 | 任務單 v1.2 | 文字過時；不影響 T-030 的 AC，影響 T-046（見孤兒錄音文件） |
| A16 | 前置還有 T-016、T-017b、T-020、T-021、T-025a、T-046 未合併（TASKS v1.98）；T-030 目前不能派工，上面的 handler 案例短期內無法執行 | TASKS v1.98 | 排程 |
