# QA 測試案例設計：T-030 `POST /shadow/attempts`

- 擁有者：QA｜日期：2026-11-28（台北時間）｜版本：**v3**（依 ARCHITECTURE v1.16／ADR-021 修訂 2 更新；v1 為 PR #116 初稿、v2 依 v1.15 更新，皆已合併）。
- 依據：`docs/tasks/T-030.md` v1.3、ARCHITECTURE v1.16（§4.18、§4.18.1、§4.6、§4.12.1、§4.12.2.1、§4.19、§5.0.4、§5.0.5、§5.1.1）、ADR-018 決定 9、ADR-019、ADR-020 決定 2、**ADR-021（含修訂 1、修訂 2）**、TASKS v1.114。
- **ARCHITECTURE v1.16／ADR-021 修訂 2 在 PR #123（尚未合併，head `046c970`）；本文件以該 head 的文字為準。** #123 合併前，這些規則還不是 main 上的契約；合併後若文字有變，本文件再同步。
- 性質：**派工前的測試案例設計**，不是驗收結論。T-030 的前置在 TASKS 中尚未全部合併；handler 探針（`shadow.qa.test.ts`）與 `docs/qa/mutants/T-030.json` 等 Claude 做完、QA 讀過程式後再寫（憲章 §1.1）。
- 圖例：**TC** ＝ 任務單 v1.3 已列的測試案例；**X** ＝ QA 加碼案例；**W** ＝ WAV 解析（`parseWav16kMono`）案例；**探針** ＝ 已經能寫、現在就通過的 QA 探針；**【待釐清 Pn】** ＝ v1.16 之後仍沒定下來、QA 不猜的項目；**【任務單落後 Cn】** ＝ 任務單 v1.3 與 ARCHITECTURE v1.16 衝突，案例以 ARCHITECTURE 為準（任務單自己寫「和本單不一致時以 ARCHITECTURE 為準」）。清單在文末。
- 寫法規則（QA-T032 規則）：之後的 handler 探針一律用 `makeTestRouteDeps`、`makeTestShadowStore`、`makeTestTtsStore` 等工廠，只傳要覆寫的部分；fake 值一律低熵、明顯是假的。

## 與任務單 v1.3 的編號對照（任務單 AC-T30-1～11、TC-1～21）
| 本文件 | 任務單 v1.3 |
|---|---|
| X-1.1、X-1.5、X-1.6、X-1.9、X-1.11、X-1.13 | TC-15（多餘欄位與 meta；其中三項任務單標「暫定」，以 ARCH v1.16 為準，見 C3～C5） |
| X-1.7、X-1.8、W-10、W-11、W-13、W-1 | TC-16～TC-18（AC-T30-11）；W 系列的 chunk／id／門檻規則任務單**完全沒有**，見 C1、C2 |
| X-1.4、X-2.4 | TC-19 |
| X-6.1、X-6.2 | TC-20 |
| X-3.2、X-3.3、X-6.5、X-9.3 | TC-21 |
| 其餘 TC-1～TC-14 | 同編號 |


## WAV 規則摘要（ARCHITECTURE v1.16 §4.18.1、§5.0.5；ADR-021 決定 1、2）
1. 先檢查**整份 buffer** ≤ `SHADOW_AUDIO_MAX_BYTES`（1,048,576）；超過直接 400 `audio`，**不呼叫** `parseWav16kMono`；剛好 1 MiB 可進入解析。
2. 只接受 RIFF/WAVE、`fmt ` 在 `data` 之前、`audioFormat = 1`、16-bit LE、16 kHz、單聲道、`blockAlign = 2`、`byteRate = 32_000`；其他 → 400 `audio`。
3. 依 RIFF 逐個 chunk 走（4 位元組 id＋4 位元組 LE 大小；奇數大小後有 1 位元組 padding，不計入宣告大小）。除 `fmt `、`data` 外，其他合法 chunk（例如 `LIST`、`JUNK`、`INFO`）**無論在 `fmt ` 之前、兩者之間或 `data` 之後**一律忽略（不計入時長、不進入正規化輸出）。
4. **chunk id** 4 個位元組都必須是可印 ASCII（`0x20`–`0x7E`），且**第一個位元組不可為空白**（`0x21`–`0x7E`）；`\0\0\0\0`、四個空白不合格 → 400。
5. `dataBytes`＝宣告的 data 大小；超過資料區到檔尾的剩餘位元組、或不是 2 的倍數 → 400。宣告 `0xFFFFFFFF` ＝ 到檔尾，剩餘位元組仍須是 2 的倍數（奇數 → 400）。
6. 其他 chunk 必須標頭完整、宣告大小加 padding 不超過檔尾；**例外**：最後一個奇數大小 chunk 可省略最後 1 個 padding 位元組（檔案剛好在資料結束）。padding 缺失且後面還有位元組、標頭不完整、大小超出檔尾、id 不合法 → 400。
7. 送給評分供應商、上傳到 Storage、`Wav16kMono.bytes` 的是**同一份正規化後**的 RIFF／`fmt `／`data`（大小欄與實際 data 一致）；被忽略的 chunk 不送、不存。
8. **門檻用 `dataBytes` 比較**，不用四捨五入後的毫秒：`SHADOW_AUDIO_MIN_DATA_BYTES = 9_600`、`SHADOW_AUDIO_MAX_DATA_BYTES = 960_000`；`dataBytes < 9_600`（含 0）或 `> 960_000` → 400；剛好 9,600／960,000 通過。`durationMs = round(dataBytes / 32_000 × 1000)` 只是結果欄位。
9. `parseWav16kMono(bytes, maxDurationMs = 30_000, minDurationMs = 0)`：**預設下限 0**（例如 10 ms 的測試 WAV 仍可解析）；跟讀的 300 ms 下限由 T-030 handler 傳入 `minDurationMs: SHADOW_AUDIO_MIN_DURATION_MS`（並傳入對應的上限）。


## 目前可執行的探針（`task/T-030` 的 commit `6642800`，對現有程式、現在就通過）與 v1.16 之後的處置

| 探針 | 檔案 | 對應 | 驗證內容（現況） | v1.16 後 |
|---|---|---|---|---|
| QA-1 | `packages/contracts/src/audio.qa.test.ts` | AC-T30-11／TC-18 | 30.000 秒通過、30.001 秒回 `validation`、`path: 'audio'` | 不變（規則 8：960,032 位元組 > 960,000） |
| QA-2 | 同上 | AC-T30-11 | data 大小寫 `0xFFFFFFFF` 時用實際長度量；31 秒仍被擋 | 不變（規則 5：剩餘 992,000 位元組為偶數但 > 960,000 → 400；1 秒偶數 → 通過） |
| QA-3 | 同上 | AC-T30-11 | **釘住舊行為**：少報 data 大小（宣告 1 秒、後面接 30 秒**全 0**取樣）時 parser 回 `ok`、1000 ms | **與 v1.16 相反，必須改**：預期 `validation`、`path: 'audio'`。全 0 的尾巴現在就會 400（id `\0\0\0\0` 不合格，規則 4），所以**原本的全 0 fixture 可以沿用**；另補一個非 0 變體（例如填 `0x7f`，id 不是可印 ASCII）與一個「id 可印但大小超出檔尾」的變體 |
| QA-4 | 同上 | AC-T30-11 | data 之前有奇數大小的 chunk（`LIST`），連同 padding 一起跳過 | 不變（規則 3、6） |
| QA-5 | 同上 | AC-T30-11 | WAV 在大 buffer 的非 0 `byteOffset` 時照樣正確解析 | 不變 |
| QA-6 | 同上 | AC-T30-11 | 0 個取樣的 WAV 被接受為 0 ms（`UNDECIDED`） | **不再與規格衝突**：parser 預設下限是 0（規則 9），所以「預設參數下 0 取樣回 `ok`、0 ms」依舊成立。改名拿掉 `UNDECIDED`、註明「預設 `minDurationMs = 0`」即可；「0 秒要 400」是 **handler 層**（傳入 300 ms 下限）的新案例，見 W-10、W-15，不是 QA-6 |
| QA-7 | 同上 | AC-T30-11 | data 在 fmt 前、只有檔頭、空 buffer 都回 `validation`，不丟例外 | 不變（規則 2） |
| QA-8～QA-11 | `packages/domain/src/shadowing-t030.qa.test.ts` | AC-T30-7／TC-10 | 通過門檻 0.8／0.7 邊界；發音分數不參與 | 不變 |

> 現有 `packages/contracts/src/audio.test.ts`（非 QA 檔）有一個「`UNDECIDED`：宣告大於檔案時截斷為 500 ms」的測試，與 v1.16 相反（宣告超出檔尾 → 400）。ADR-021 後果要求 T-030 把它改成預期 400；任務單 v1.3 的檔案範圍沒有 `audio.ts`、`audio.test.ts`（見 C1）。


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
| X-1.6 | 錯誤 | `meta` 帶多餘 key，例如 `userId` | 400，`path` 是 `meta.userId`（`.strict()`；ARCH v1.16 §4.18.1）；任何情況都不採用 body 的 id。任務單 TC-15 寫 `path` 是 `meta`，以 ARCH 為準【任務單落後 C5】 |
| X-1.7 | 邊界 | 整份 `audio` 剛好 1,048,576 位元組（合格 WAV＋合法 `LIST` 尾巴補到）與多 1 位元組 | 前者進入解析；後者 400 `audio`，且**不呼叫** `parseWav16kMono`（以假／spy 驗證）；另一組：30 秒合格 WAV＋合法尾巴使整份 > 1 MiB → 仍 400（先擋整份大小，與解析結果無關） |
| X-1.8 | 邊界 | `audio` 的 MIME：`audio/wav`、`audio/wave`、`audio/x-wav`、`audio/WAV`、`audio/wav; codecs=1`、沒給、`audio/mpeg`、`audio/webm` | 前六者依位元組判斷（比對 type／subtype，忽略參數與大小寫）；後兩者 400 `audio` |
| X-1.9 | 錯誤 | `audio` 欄位是字串（不是檔案）；`meta` 欄位是檔案 | 前者 400 `audio`；後者 400 `meta` |
| X-1.10 | 錯誤 | 檔名是 `.wav`、內容是 mp3／隨機位元組 | 400 `audio` |
| X-1.11 | 錯誤 | `audio` 與 `meta` 都不合格 | 一次 400，`issues` 兩個都列、順序先 `audio` 再 `meta` |
| X-1.12 | 隱私 | 任一 400 的回應 body 與 log | 不含 `meta` 原文、檔名、位元組內容 |
| X-1.13 | 錯誤 | 兩個 `audio` 欄位；兩個 `meta` 欄位 | 400，`path` 各為 `audio`、`meta`；不默默取第一個或最後一個。任務單 Q-T30-d 寫「重複取第一個」，以 ARCH 為準【任務單落後 C5】 |

### AC-T30-11 之 WAV 解析（W 系列；對 `parseWav16kMono`，handler 層再抽查 W-1、W-4、W-6、W-10、W-15）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| W-1 | 快樂 | `data` 後接合法 `LIST`／`INFO` chunk（標頭完整、大小與 padding 都在檔內），資料量分別 9,600、32,000、960,000 位元組 | 全部通過；`durationMs` 只算 data（300、1000、30000）；`Wav16kMono.bytes` 不含 `LIST`；送給 `assess` 與上傳的位元組是正規化後的 RIFF／`fmt `／`data`，大小欄一致（斷言 `assess` 收到的內容，不含 `LIST` 位元組） |
| W-2 | 錯誤 | 宣告的 data 大小超過資料區到檔尾（宣告 2 s、實際 1 s） | 400 `audio`（不截斷、不當成 1 s） |
| W-3 | 錯誤 | 宣告的 data 大小是奇數（32,001） | 400 `audio` |
| W-4 | 錯誤 | 少報：宣告 1 s、後面接 30 s **非 0** 取樣的生 PCM（填 `0x7f`，id 不是可印 ASCII）；另一變體填 `0x41`（id `AAAA` 可印，但大小 `0x41414141` 超出檔尾） | 都是 400 `audio`；供應商 0 次；不上傳 |
| W-5 | 錯誤 | 少報：宣告 1 s、後面接 **全 0** 取樣——尾巴長度 960,000（8 的倍數）與 960,003（非 8 的倍數）各一 | **兩者都 400 `audio`**（id `\0\0\0\0` 不合格；v1.16 已消除「全 0 尾巴被讀成空 chunk 而回 200」的缺口） |
| W-6 | 邊界 | 宣告 `0xFFFFFFFF`：資料 1 s → 通過、31 s → 400；剩餘位元組是奇數（例如 32,001） | 通過、400、400（剩餘仍須是 2 的倍數） |
| W-7 | 錯誤 | `data` 後尾巴只有 1～7 位元組（標頭不完整） | 400 `audio` |
| W-8 | 錯誤 | `data` 後有 chunk 標頭（id 合格）、但宣告大小超出檔尾 | 400 `audio` |
| W-9 | 邊界 | `data` 後最後一個 chunk 是奇數大小：(a) 有 padding；(b) 省略最後的 padding 且檔案剛好在資料結束；(c) 省略 padding 但後面還有其他 chunk 的位元組 | (a) 通過；(b) 通過（v1.16 檔尾例外）；(c) 400 |
| W-10 | 邊界 | handler 層（傳入 300 ms 下限）的資料量：9,600 位元組；9,598；9,584（299.5 ms，四捨五入後 300）；9,568；0 個取樣 | 通過、400、400、400、400（門檻用位元組，不用四捨五入後的毫秒） |
| W-11 | 邊界 | 上限：960,000 位元組（30.000 s）；960,002（30.0000625 s，四捨五入後 30000）；960,032（30.001 s） | 通過、**400**、400 |
| W-12 | 錯誤 | `fmt ` 在 `data` 之後；沒有 `fmt `；沒有 `data` | 400 `audio` |
| W-13 | 錯誤 | 格式：IEEE float、`0xFFFE` extensible、A-law、μ-law、8-bit、24-bit、8 kHz、44.1 kHz、立體聲、`blockAlign` 不是 2、`byteRate` 不是 32,000 | 全部 400 `audio` |
| W-14 | 快樂 | 其他合法 chunk 出現在三個位置：`fmt ` 之前、`fmt ` 與 `data` 之間、`data` 之後（`LIST`、`JUNK`、`INFO`） | 三個位置都通過且被忽略、都不出現在正規化輸出 |
| W-15 | 隔離 | 參數與預設：(a) 預設參數解析 160 個取樣（10 ms）的 WAV（`azure-speech` 的 `makeWav()` 用的長度）；(b) 同一個 WAV 經 handler（`minDurationMs: 300`）；(c) 自訂 `maxDurationMs`、`minDurationMs`（例如 1000／500） | (a) 通過、`durationMs` 10；(b) 400 `audio`；(c) 參數生效，仍以位元組門檻（毫秒 × 32）比較 |
| W-16 | 靜態 | 常數一致性 | `SHADOW_AUDIO_MIN_DATA_BYTES === SHADOW_AUDIO_MIN_DURATION_MS * 32`、`SHADOW_AUDIO_MAX_DATA_BYTES === SHADOW_AUDIO_MAX_DURATION_MS * 32`、`SHADOW_AUDIO_MAX_BYTES === 1_048_576`；常數位於 `contracts/src/audio.ts`（見 C6） |
| W-17 | 錯誤 | chunk id 規則：`" abc"`（首字元空白）、`"    "`、`"ab\u0001c"`（控制字元）、`"ab\u007fc"`（DEL）、含 `0x80` 以上位元組、`\0\0\0\0`；合格對照：`"fmt "`、`"data"`、`"LIST"`、`"A  B"`（中間有空白） | 前六者 400 `audio`；對照組通過；位置在 `fmt ` 前、`fmt ` 與 `data` 之間、`data` 後都要測（id 檢查不分位置） |
| W-18 | 邊界 | 宣告 `0xFFFFFFFF`、後面又接一個合法 `LIST` chunk | 依字面規則，`LIST` 的位元組會被算進 `dataBytes`（「檔裡不應再有後續 chunk」，沒有寫成 400）【待釐清 P2】 |


### AC-T30-2 計畫沒好（503 `plan_not_ready`）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-3 | 錯誤 | `readShadowItem` 回 null（計畫不存在、非 `ready`、那一句不存在，各一次） | 503 `plan_not_ready`；供應商 0 次；`uploadAudio`、`insertAttempt` 0 次 |
| X-2.1 | 邊界 | 計畫只有 3 句時 `itemIndex` 3、4 | 503 `plan_not_ready` |
| X-2.2 | 錯誤 | `readShadowItem` 自己回 `db_failed` | 500 `db_failed`，**不是** 503 |
| X-2.3 | 隔離 | `readShadowItem` 的呼叫參數 | `userId` 取自 `AuthContext`，`planDate`、`itemIndex` 取自驗證後的 `meta` |
| X-2.4 | 順序 | `planDate` 不是今天**而且**計畫也沒好 | 400 `meta.planDate`（先比對日期，再 `readShadowItem`，ARCH v1.16）；`readShadowItem` 0 次、供應商 0 次 |

### AC-T30-3 參考時長（TTS 快取）
| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| TC-4 | 快樂 | 快取有，`find` 回 30000 位元組 | `scoreShadowAttempt` 收到 `durationMs` 5000；`synthesize` 0 次 |
| TC-5 | 錯誤 | 快取沒有 → 合成成功並上傳後評分；另一次 `synthesize` 回 `timeout` | 前者評分；後者 504 `timeout`、`assess` 0 次 |
| X-3.1 | 邊界 | 位元組數 30001、30003 | 5000、5001（`Math.round(bytes*8/48)`） |
| X-3.2 | 邊界 | 快取物件存在但 0 位元組（或算不出 > 0 的時長） | 視為損壞的快取＝未命中：重新合成一次、成功後覆寫該物件；**不**把 `scoreShadowAttempt` 的 `validation` 回給前端（ARCH v1.16 §4.18.1 處理順序 3） |
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
| X-4.4 | 錯誤 | `resolve` 回 `paid_not_allowed` | 403；`assess` 0 次、STT 0 次；**不寫 `provider_call`**（沒有對外呼叫，ARCH v1.16 處理順序 6） |
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
| X-6.1 | 錯誤 | `transcribe` 回的 `timing` 不是 `'words'`，或辨識文字非空卻沒有逐字時間 | 502 `invalid_response`；不上傳、不寫列（ARCH v1.16 處理順序 5） |
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
| X-8.5 | 內容 | 上傳的位元組與 `contentType` | 位元組＝**正規化後**的 WAV（ARCH v1.16；任務單 Q-T30-c 寫「請求原本的位元組」，以 ARCH 為準【任務單落後 C4】）：請求是 44 位元組標準檔頭＋data 時與請求逐位元組相同；請求帶 `LIST` 尾巴時，上傳的**不含**該 chunk；`contentType` 為 `audio/wav` |
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

## v1.16 對 v2 待釐清（N1～N7）與其他問題的處理

| 項目 | v1.16 是否解決 | 依據與 QA 的判斷 |
|---|---|---|
| **N1** 全 0 尾巴被讀成合法空 chunk | **解決** | §4.18.1「合法 chunk 的 id」：4 個可印 ASCII、首字元非空白；`\0\0\0\0` 不合格 → 400。W-5 同時測 8 的倍數與非 8 的倍數長度，QA-3 原 fixture 即可沿用 |
| **N2** 門檻用四捨五入後毫秒 | **解決** | 門檻改用 `dataBytes`（9,600／960,000）；299.5 ms（9,584）與 30.0000625 s（960,002）都回 400（W-10、W-11） |
| **N3** 300 ms 下限讓 `makeWav()`（10 ms）、azure-speech 測試失敗 | **解決（規格層）** | `parseWav16kMono` 預設下限 0，300 ms 由 handler 傳入；`fake-fetch.ts`、`azure-speech.qa.test.ts` 不必改（ADR-021 後果）。**但任務單 v1.3 的範圍仍沒列 `audio.ts`、`audio.test.ts`，見 C1**；W-15 (a) 是回歸保護 |
| **N4** ADR 決定 1 本文與修訂 1.4 矛盾 | **解決** | 修訂 2 直接改寫決定 1、2、3；修訂 1.4 保留為紀錄並註明已被改寫。ADR 本文與 ARCH §4.18.1 現在一致 |
| **N5** `fmt `／`data` 之間的 chunk | **解決** | 其他合法 chunk 無論位置都忽略（W-14） |
| **N6** 奇數 chunk 省略最後 padding | **解決** | 檔尾例外（W-9）；padding 缺失且後面還有位元組 → 400 |
| **N7** `0xFFFFFFFF` 剩餘為奇數 | **解決** | 仍須是 2 的倍數（W-6） |
| **M1** 孤兒約 90 天才清 | **解決（規格層）** | SQL 內 `NOT EXISTS` 再 `LIMIT`；見 `orphan-audio-test-cases.md` O-31／O-32 |
| ADR-021 決定 1 與修訂 1.4 的矛盾 | **解決** | 同 N4 |
| 上一版 A1～A16 | 維持 v2 的處理 | v1.16 沒有改動 §4.18.1 其餘規則（欄位、MIME、`meta`、處理順序、`provider_call`） |

## 新的矛盾與待釐清

### 任務單 v1.3 落後於 ARCHITECTURE v1.16（QA 案例以 ARCH 為準；建議 TechLead 出 T-030 v1.4）
| # | 任務單 v1.3 | ARCHITECTURE v1.16 | 影響 |
|---|---|---|---|
| C1 | 範圍外：`packages/contracts/src/` 除 `shadow.ts`／`index.ts`；Q-T30-c 還寫「`audio.ts` 不在本單範圍」 | ADR-021 後果：T-030 把 `parseWav16kMono`（`audio.ts`）列入範圍並照決定 1、2 實作；`audio.test.ts` 的截斷測試改預期 400 | Claude 照任務單無法改 parser；scope-check 會擋。範圍須加 `packages/contracts/src/audio.ts`、`audio.test.ts` |
| C2 | AC-T30-11 只有大小、MIME、內容、時長 0／≤30 s；沒有 chunk、id、`dataBytes` 門檻、300 ms、正規化輸出 | §4.18.1 全部規則 | W-1～W-18 沒有對應 AC／TC；需補 AC 與 TC（ac-coverage 要求 AC／TC 編號出現在測試名稱） |
| C3 | Q-T30-b：時長 0 由 handler 在解析後檢查 `durationMs > 0`；AC-T30-11 ④ 沒有 300 ms | 下限 300 ms（9,600 位元組），由 handler 傳入 parser 的 `minDurationMs`；`< 9,600` 一律 400 | TC-18 的「0 個取樣 → 400」仍成立，但 299 ms 之類在任務單下會通過 |
| C4 | Q-T30-c：送去供應商與上傳的是**請求原本的位元組** | 送出與上傳的是**正規化後**的 WAV；少報大小與尾巴不會被送出 | X-8.5、W-1 的預期相反 |
| C5 | Q-T30-d：同名欄位重複「取第一個」；TC-15：`meta` 多一個 `userId` 鍵 → 400 `path` 是 `meta`；`meta` 是 `null` → `meta` | 重複欄位 → 400、path 為欄位名；多餘 key 的 path 是 `meta.userId`；`meta` 非物件 → `meta` | X-1.13、X-1.6 |
| C6 | 介面把 `SHADOW_AUDIO_MAX_BYTES` 放在 `contracts/src/shadow.ts` | §4.18.1、§5.0.5：常數放在 `contracts/src/audio.ts`（連同 `*_DURATION_MS`、`*_DATA_BYTES`） | 兩處可能各定義一次；W-16 要求只有一個來源 |
| C7 | AC-T30-6／TC-20 與 ARCH 一致（`timing: 'none'` → 502 `invalid_response`；文字與 words 都空 → 200） | 一致 | 無衝突（僅註記：ARCH 另規定「文字非空卻沒有逐字時間」→ 502，任務單寫成「由 adapter 回」；X-6.1 兩者都測） |

### v1.16 本身仍待釐清
| # | 問題 | 影響 |
|---|---|---|
| P1 | 解析的錯誤種類：id 不合法、padding 缺失、宣告超出檔尾等全都是 400 `audio`，外部看不出差別；QA 只能靠不同 fixture 分別驗證（W-5、W-8、W-9），無法從回應區分是哪條規則擋的。**不是缺陷，僅提醒**：若要區分，需要 `issues[].message` 的固定字串 | 測試只斷言 `path` 與 kind，不斷言 message |
| P2 | `0xFFFFFFFF` 後面又接合法 chunk：ARCH 寫「檔裡不應再有後續 chunk」，但沒寫成 400，字面結果是後續 chunk 的位元組被當成音訊算進 `dataBytes`（長度合格時回 200，且被送去評分／存入 Storage） | W-18：期望值待定；建議明確寫「`0xFFFFFFFF` 時 data 之後不得再有 chunk，無法區分，一律當音訊」或要求 400 |
| P3 | `parseWav16kMono` 的參數是毫秒（`maxDurationMs`、`minDurationMs`），門檻卻用位元組比較：換算（毫秒 × 32）對 300、30,000 是整數，但任意毫秒值（例如 299.5）沒有定義；是否只接受整數毫秒 | W-15 (c) 只用整數 |
