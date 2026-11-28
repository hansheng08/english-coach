# QA 測試案例設計：孤兒錄音清理（`purge-audio` 的孤兒批次）

- 擁有者：QA｜日期：2026-11-28（台北時間）｜依據：ARCHITECTURE v1.14 §4.12.2.1、§4.12.2、§4.12.5、§4.18.1（失敗表）、ADR-020 決定 2、`docs/tasks/T-046.md` v1.2、`docs/tasks/T-030.md` v1.2。
- 性質：**派工前的測試案例設計**，不是驗收結論。目前沒有可執行的程式（`audio-purge.ts` 還不存在，T-046 待派工），所以沒有探針；探針與 `mutants.json` 等實作完成後由 QA 補。

## 這件事在哪一張單？——目前**沒有任何一張單涵蓋**（需要決定）

- ADR-020 決定 2 與 ARCHITECTURE §4.12.2.1 都寫：沿用 `purge-audio`，**「T-046 尚未合併時，把本節寫進同一張單；若 T-046 已派工或已合併，再開一張補在同一個函式上」**。
- 查證結果（origin/main `bb8c7b7`）：
  - `docs/tasks/T-046.md`（v1.2）全文沒有「孤兒」、「orphan」、「24 小時」；AC-T46-1～12、TC-1～25 都只處理「有列且已到期」的錄音；`PurgeStats` 只有 `shadow`、`evening`；AC-T46-7 的 log 規定「只有兩張表的三個數字」。
  - `docs/TASKS.md`（v1.98）的 T-046 列沒有提到孤兒；T-046 的狀態是「待派工」（列上寫任務單 v1.1，實際檔案是 v1.2，兩者不同步）。
  - `docs/tasks/T-030.md`（v1.2）「不在本單」還寫「寫列失敗時留在 Storage 的錄音怎麼清：待 Architect」，沒有跟上 ADR-020。
  - 沒有「T-046b」之類的補單。
- 結論：依 ADR-020，T-046 還沒派工，**應由 TechLead 把孤兒清理寫進 T-046（v1.3），否則 T-046 合併後孤兒錄音沒有人清**，T-030 寫列失敗留下的檔案會永遠留在 `audio` bucket（個資）。以下案例是 QA 依 §4.12.2.1 擬的，**編號暫定 `O-n`**，等 TechLead 決定放哪張單、AC／TC 編號後再對應。

## 規格摘要（§4.12.2.1）
- 孤兒：`audio` bucket 內，`<user_id>/shadow/`、`<user_id>/evening/` 底下，沒有任何 `shadow_attempt.audio_path` 或 `evening_answer.audio_path` 等於該路徑的物件。
- 只在建立時間**早於 `now − 24 小時`**時才刪；其餘不動。有列的物件超過 24 小時也不是孤兒（由 90 天規則清）。
- 不碰 `tts`、`resume`，也不刪這兩個前綴以外的物件；每批上限 200；在有列的過期錄音之後跑；`remove` 失敗算 `failed`、隔天重試；刪成功沒有列要更新；`PurgeStats` 加 `orphan`；secret 金鑰只做表上寫的事（§4.12.5）。

## 測試案例（全部用假 Storage、假 DB；`now` 固定；不連網）

| 編號 | 類型 | 情境 | 預期 |
|---|---|---|---|
| O-1 | 快樂 | 假 Storage 有 3 個物件：`<u>/shadow/2026-11-26/0-<uuid>.wav`、`<u>/shadow/2026-11-26/1-<uuid>.wav`、`<u>/evening/<id>.webm`，建立時間都比 `now` 早 25 小時，兩張表都沒有對應的 `audio_path` | 3 個都被刪；`removeObjects` 收到這 3 個路徑；`orphan` 統計 `selected: 3, purged: 3, failed: 0` |
| O-2 | 邊界 | 建立時間為 `now − 23 h 59 m 59 s`、剛好 `now − 24 h`、`now − 24 h − 1 s` | 只有最後一個被刪（「早於」是嚴格小於）；前兩個不動 |
| O-3 | 邊界 | 物件超過 24 小時，但 `shadow_attempt.audio_path` 有同一路徑 | 不當孤兒、不刪；由到期規則（90 天）處理 |
| O-4 | 邊界 | 同上，但對應的是 `evening_answer.audio_path` | 同 O-3 |
| O-5 | 邊界 | 路徑只有「前綴相同」：列的 `audio_path` 是 `<u>/shadow/2026-11-26/1-aaa.wav`，物件是 `<u>/shadow/2026-11-26/1-aaa.wav.bak`、`<u>/shadow/2026-11-26/1-aaa2.wav` | 兩個物件都是孤兒（逐字全等比對，不用 `startsWith`、不分大小寫） |
| O-6 | 安全 | 物件在 `audio` bucket 但前綴不是 `shadow/`、`evening/`：`<u>/tts/x.mp3`、`<u>/resume/x.pdf`、`<u>/other/x.wav`、`<u>/shadow-old/x.wav`、`<u>/shadowx.wav`、根目錄的 `x.wav`，都超過 24 小時 | 一個都不刪；`removeObjects` 0 次 |
| O-7 | 安全 | 刪除只針對 `audio` bucket | 假 Storage 記錄 `from('audio')`；`from('tts')`、`from('resume')` 0 次 |
| O-8 | 安全 | 兩位使用者：A 的孤兒、B 的有列物件與未滿 24 小時物件 | 只刪 A 的孤兒；B 的物件不動（沒有 `user_id` 條件的例外只做表上寫的事，§4.12.5） |
| O-9 | 批次 | 250 個孤兒 | 第一次只選／刪 200 個；`selected: 200`；再跑一次剩下 50 個（每批上限 200，與有列的批次各自獨立） |
| O-10 | 順序 | 同時有過期的有列錄音與孤兒 | 先處理有列的過期錄音，再處理孤兒（呼叫順序可由假 deps 的記錄驗證） |
| O-11 | 錯誤 | 孤兒的 `removeObjects` 回 `err` | `orphan.failed` 等於該批數量、`purged` 0；其餘（有列的兩張表）統計不受影響；不丟例外；隔天重跑會再選到同一批（冪等） |
| O-12 | 錯誤 | 孤兒物件的「列出」回 `err`（Storage list 失敗） | 有列的兩張表照做；整體結果的處理方式【待釐清 B6】 |
| O-13 | 冪等 | 物件已不存在（兩個 purge 重疊執行、或 `remove` 重送） | `remove` 回 `ok` 就算成功（同 AC-T46-3 的規則），不報錯 |
| O-14 | 競態 | 剛上傳、尚未寫列的物件（建立時間 2 分鐘前，T-030 上傳後到 `insertAttempt` 之間，或晚上流程先上傳再呼叫 `/evening/answers`） | 不刪（24 小時保護，§4.18.1、§4.12.2.1 定義段） |
| O-15 | 競態 | 列出孤兒候選之後、`remove` 之前，那個物件的列剛好被寫入 | 【待釐清 B7：是否在刪除前再查一次】；至少要有「列出時間早於 24 小時」這層保護 |
| O-16 | 回歸 | 沒有任何孤兒、也沒有過期錄音 | `removeObjects` 0 次；`PurgeStats` 全 0；HTTP 仍是 200 |
| O-17 | 回歸 | 既有的 T-046 TC-6～TC-15（有列的過期錄音） | 加入孤兒批次後行為不變：`shadow`、`evening` 統計與呼叫次數與原本相同 |
| O-18 | 回應 | `PurgeStats` 含 `orphan`；handler 回 200 且 body 與 `PurgeStats` 相同；`orphan.failed > 0` 也是 200 | 同 AC-T46-7 的規則 |
| O-19 | log | handler 的 log | 一行、以 `purge-audio` 開頭；只有數字或錯誤 kind；不含任何物件路徑、`user_id`、檔名（孤兒路徑含 `user_id` 與日期） |
| O-20 | 錯誤訊息 | 列出或刪除失敗的 `AppError.message` | 不含路徑；刪除失敗是 `storage_failed`（`op: 'delete'`）；列出失敗是 `storage_failed`（`op` 為 `download` 還是別的【待釐清 B8】） |
| O-21 | 查詢形狀 | 「某路徑是否有列」的查詢 | 只 select `audio_path`（最少欄位）、用 `in(...)` 或等值比對；不 select 逐字稿、分數、`user_id` 以外的個資欄位（§4.12.5 第 3 點的精神；目前例外表沒列這個查詢，見 B3） |
| O-22 | 端到端（T-030 ↔ purge） | T-030 的寫列失敗情境（TC-12：`uploadAudio` 成功、`insertAttempt` 回 `db_failed`）留下的物件路徑格式 | 路徑格式 `<u>/shadow/<planDate>/<itemIndex>-<uuid>.wav` 屬於上述前綴，會被 O-1 的邏輯認成孤兒；用同一個路徑字串樣本在兩邊的測試裡互相對照，避免格式不一致 |
| O-23 | 靜態 | `tooling/secret-client-scope.test.ts`（T-046 TC-24、TC-25） | 孤兒清理新增的檔案沒有讓 `createServiceClient` 出現在清單外的檔案 |
| O-24 | pgTAP／CI | bucket 對 `authenticated` 沒有 `delete` policy | 使用者身分刪不掉自己的孤兒；刪除只能由 secret 金鑰（§4.12.1 Storage RLS），T-046 的 AC-T46-9／10 已涵蓋，孤兒清理不得新增 `delete` policy |

## 待釐清（QA 不猜；請 TechLead／Architect 決定）

| # | 問題 | 來源 | 影響 |
|---|---|---|---|
| B1 | **孤兒清理沒有任何一張單涵蓋**（見上）：T-046 v1.2 沒寫；TASKS v1.98 的 T-046 列也沒寫；ADR-020 規定尚未派工時要寫進 T-046 | ADR-020、T-046、TASKS | T-046 派工前要出 v1.3（或開補單）；QA 才能把 O-n 對上 AC／TC |
| B2 | 「列出孤兒」要怎麼列：Storage list API 是**逐層資料夾**、不遞迴、分頁；路徑是 `<user_id>/shadow/<planDate>/<file>`（多一層日期）。要列出所有使用者的 `<user_id>/`（需要 `listProfileUserIds`，§4.12.5 另一個例外在 T-025a）還是改查 `storage.objects`（secret 金鑰經 PostgREST 預設看不到 `storage` schema）？「每批 200」是 200 個物件還是 200 個資料夾 | §4.12.2.1「未驗證」 | 決定 `PurgeDeps` 的方法簽章與 O-9 的預期；T-046 的假 Storage 長什麼樣子 |
| B3 | §4.12.5 的例外表寫「`listExpired` 只讀 `id`、`audio_path`、`audio_expires_at`」，但判定孤兒必須查「這些路徑有沒有列」（對兩張表各查 `audio_path`）；這個查詢沒有 `user_id` 條件，也不在例外表 | §4.12.5 vs §4.12.2.1 | 要補進例外表與測試（O-21），否則違反 CLAUDE.md §5 第 15 條 |
| B4 | 建立時間用哪個欄位：`created_at`、`updated_at` 還是 `last_accessed_at`（§4.12.2.1 寫「或等效」）；時區與格式（ISO 字串、無時區）；缺欄位時當作多舊 | §4.12.2.1「未驗證」 | O-2 的輸入格式；缺欄位的物件必須**不刪**（fail-safe），QA 會要求這一條 |
| B5 | `PurgeStats.orphan` 的形狀：沿用 `{ selected, purged, failed }`？以及 `PurgeStats` 擴充後，AC-T46-7 的 log「只有兩張表的三個數字」要改成三組數字 | §4.12.2.1「`PurgeStats` 加 `orphan` 統計」 | O-18、O-19 |
| B6 | 有列的兩張表之一 `listExpired` 失敗時（T-046 規則：另一張照做、最後回第一個錯誤），孤兒批次還跑不跑；孤兒列出失敗時，整體回 `err`（HTTP 非 200）還是 200＋`failed` | T-046 AC-T46-5 | O-12 |
| B7 | 列出與刪除之間的競態（O-15）要不要在刪除前複查有無列；24 小時保護在現實上已蓋住絕大多數情況，是否接受這個殘餘風險 | §4.12.2.1 | O-15 |
| B8 | 列出物件失敗時錯誤的 `op`：`AppError.storage_failed` 只有 `upload｜download｜delete｜sign`，沒有 `list` | §5.0.4 | O-20；建議用 `delete` 以外的哪一個要由 Architect 決定，QA 不猜 |
