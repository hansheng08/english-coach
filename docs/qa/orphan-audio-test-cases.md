# QA 測試案例設計：孤兒錄音清理（`purge-audio` 的孤兒批次）

- 擁有者：QA｜日期：2026-11-28（台北時間）｜版本：v2（依 ARCHITECTURE v1.15 與 ADR-021 決定 3、修訂 1.5～1.6 更新；v1 是 PR #116 的初稿）。
- 依據：ARCHITECTURE v1.15 §4.12.2.1、§4.12.2、§4.12.5、§4.18.1（失敗表）、§5.0.4（`storage_failed.op` 新增 `'list'`）、ADR-020 決定 2、**ADR-021**、`docs/tasks/T-046.md` v1.2、`docs/tasks/T-030.md` v1.2。**ADR-021／v1.15 在 PR #118（尚未合併），本文件以 #118 head `0b83ccd` 為準。**
- 性質：**派工前的測試案例設計**，不是驗收結論。目前沒有可執行的程式（`audio-purge.ts` 還不存在，T-046 待派工），所以沒有探針；探針與 `mutants.json` 等實作完成後由 QA 補。

## 這件事在哪一張單？——規格已定，**任務單還沒更新**
- ADR-021 決定 3 與 ARCHITECTURE v1.15 §4.12.2.1 已把孤兒清理的列出、時間、競態、統計都定案，並寫明「T-046 尚未派工 → 寫進同一張單（建議出 v1.3）」；ADR-021 後果：T-046 出 v1.3（或同一函式的補單）、migration 建 security definer 函式、contracts 為 `storage_failed.op` 加 `'list'`、AC-T46-7 的 log 改三組數字。
- 查證結果（origin/main `2984ff3`；#118 head 只改 `docs/ARCHITECTURE.md` 與新增 ADR-021）：`docs/tasks/T-046.md` 仍是 v1.2，**全文沒有「孤兒」**；TASKS v1.98 的 T-046 列也沒有；T-030 的「不在本單」仍寫「待 Architect」。所以**目前沒有任何一張任務單把孤兒清理列為 AC**。
- 結論：T-046 派工前，TechLead 必須出 v1.3（含孤兒的 AC、TC、檔案範圍：migration 的 `list_audio_objects_for_purge`、`audio-purge.ts`、contracts 的 `storage_failed.op`、`supabase/tests/` 的 pgTAP）。以下案例編號暫定 `O-n`，等 AC／TC 編號後再對應。

## 規格摘要（ARCHITECTURE v1.15 §4.12.2.1、ADR-021 決定 3、修訂 1.5～1.6）
- 孤兒：`audio` bucket 內，沒有任何 `shadow_attempt.audio_path` 或 `evening_answer.audio_path` 與其**完全相同**的物件；只掃跟讀 `<user_id>/shadow/<plan_date>/<檔>`（三段）與晚上 `<user_id>/evening/<檔>`（兩段）。
- 列出：secret 金鑰呼叫 SQL 函式 `public.list_audio_objects_for_purge(p_cutoff timestamptz, p_limit integer) returns table(object_name text, created_at timestamptz)`（`security definer`、`set search_path = ''`、`revoke all … from public, anon, authenticated`、只 `grant execute` 給 `service_role`）；用 `bucket_id = 'audio'` 加 `storage.foldername(name)` 逐段精確比對，不用 `like '%…%'`；排序 `created_at` 升序再 `name` 升序；`p_limit` 預設 200，指 200 個**物件**。
- 時間：只看 `storage.objects.created_at`；`created_at < p_cutoff`（`p_cutoff = deps.now() - 24 h`，**不含等於**）；缺值或無法解析 → 不刪。
- 判定：對候選路徑查兩張表（只 `select audio_path`、不帶 `user_id`，列入 §4.12.5 例外表）；**刪前再查一次**，已有列的路徑拿掉。
- 統計：在兩張表的到期清理之後跑；即使某一張表的 `listExpired` 回錯，孤兒仍跑，最後回第一個錯誤；`PurgeStats.orphan = { selected, purged, failed }`；log 三組數字；單批 `remove` 失敗 → `failed`、函式仍 `ok`、HTTP 200；**列出候選失敗 → 整段 `err`（`storage_failed`、`op: 'list'`），handler 回非 200**。
- 不碰 `tts`、`resume` bucket；刪除只針對 `audio` bucket。

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
| O-12 | 錯誤 | 孤兒候選的列出（`list_audio_objects_for_purge`）回 `err` | 兩張表的到期清理照做；整體結果是 `err`（`storage_failed`、`op: 'list'`），handler 回非 200（502）；`orphan` 沒有部分統計；不丟例外 |
| O-13 | 冪等 | 物件已不存在（兩個 purge 重疊執行、或 `remove` 重送） | `remove` 回 `ok` 就算成功（同 AC-T46-3 的規則），不報錯 |
| O-14 | 競態 | 剛上傳、尚未寫列的物件（建立時間 2 分鐘前，T-030 上傳後到 `insertAttempt` 之間，或晚上流程先上傳再呼叫 `/evening/answers`） | 不刪（24 小時保護，§4.18.1、§4.12.2.1 定義段） |
| O-15 | 競態 | 列出候選之後、`remove` 之前，其中一個物件的列剛好被寫入（假 `pathsInUse` 第二次呼叫回含該路徑） | 該路徑從本批拿掉、不刪；`removeObjects` 只收到其餘路徑；`selected` 與 `purged` 的算法照 ARCH（`selected` 是否含被拿掉的【待釐清 M4】） |
| O-16 | 回歸 | 沒有任何孤兒、也沒有過期錄音 | `removeObjects` 0 次；`PurgeStats` 全 0；HTTP 仍是 200 |
| O-17 | 回歸 | 既有的 T-046 TC-6～TC-15（有列的過期錄音） | 加入孤兒批次後行為不變：`shadow`、`evening` 統計與呼叫次數與原本相同 |
| O-18 | 回應 | `PurgeStats` 含 `orphan`；handler 回 200 且 body 與 `PurgeStats` 相同；`orphan.failed > 0` 也是 200 | 同 AC-T46-7 的規則 |
| O-19 | log | handler 的 log | 一行、以 `purge-audio` 開頭；只有數字或錯誤 kind；不含任何物件路徑、`user_id`、檔名（孤兒路徑含 `user_id` 與日期） |
| O-20 | 錯誤訊息 | 列出或刪除失敗的 `AppError.message` | 不含路徑；刪除失敗是 `storage_failed`（`op: 'delete'`）；列出失敗是 `storage_failed`（`op: 'list'`） |
| O-21 | 查詢形狀 | 「某路徑是否有列」的查詢 | 兩張表各只 select `audio_path`；不帶 `user_id` 條件（ARCH v1.15 已列入 §4.12.5 例外表）；`audio-purge.ts` 的測試要同時固定「`listExpired` 只讀三個欄位」與「孤兒查詢只讀 `audio_path`」；呼叫兩次（列出後一次、刪前一次） |
| O-22 | 端到端（T-030 ↔ purge） | T-030 的寫列失敗情境（TC-12：`uploadAudio` 成功、`insertAttempt` 回 `db_failed`）留下的物件路徑格式 | 路徑格式 `<u>/shadow/<planDate>/<itemIndex>-<uuid>.wav` 屬於上述前綴，會被 O-1 的邏輯認成孤兒；用同一個路徑字串樣本在兩邊的測試裡互相對照，避免格式不一致 |
| O-23 | 靜態 | `tooling/secret-client-scope.test.ts`（T-046 TC-24、TC-25） | 孤兒清理新增的檔案沒有讓 `createServiceClient` 出現在清單外的檔案 |
| O-24 | pgTAP／CI | bucket 對 `authenticated` 沒有 `delete` policy | 使用者身分刪不掉自己的孤兒；刪除只能由 secret 金鑰（§4.12.1 Storage RLS），T-046 的 AC-T46-9／10 已涵蓋，孤兒清理不得新增 `delete` policy |
| O-25 | 路徑形狀 | 候選函式的路徑判定（假列出需模擬 `storage.foldername`；真實判定由 pgTAP 驗證，見 O-26） | `<u>/shadow/<date>/<file>` 與 `<u>/evening/<file>` 才是候選；`<u>/shadow/<file>`（缺日期）、`<u>/shadow/<date>/<x>/<file>`（多一層）、`<u>/evening/<x>/<file>`、`<u>/shadowx/…`、`<u>/foo/shadow/<date>/<file>` 都不是 |
| O-26 | pgTAP（`db` job） | `list_audio_objects_for_purge` 的權限與行為 | 函式存在；`security definer`、`search_path` 為空；`anon`、`authenticated` 沒有 execute，`service_role` 有；在 `storage.objects` 塞入各種路徑與 `created_at`（含剛好等於 `p_cutoff`、`null`）後，只回符合路徑形狀且 `created_at < p_cutoff` 者，排序 `created_at` 再 `name`，`p_limit` 生效；函式內物件都有 schema 名 |
| O-27 | 邊界 | 候選的 `created_at` 為 `null`／無法解析 | 不刪、不計入 `selected`（fail-safe） |
| O-28 | 順序與批次 | 候選 250 個（時間相同者以 `name` 排序） | 先刪較舊者；第一批剛好 200 個物件；順序可重現 |
| O-29 | `p_cutoff` | handler／`purgeExpiredAudio` 傳給列出函式的 cutoff | 等於 `deps.now() - 24 小時`（固定 `now` 驗證），不是 `new Date()` |
| O-30 | 獨立性 | 兩張表的 `listExpired` 其中一張回 `err`，且孤兒有可刪的 | 孤兒仍然被刪；最後回第一個錯誤（`err`）；三個階段彼此不短路 |
| O-31 | **飢餓（starvation）** | 24 小時以前、**有列**的物件很多（例如 250 個，建立時間比孤兒更早），另有 3 個**較新**的孤兒（建立 25 小時前） | 3 個孤兒仍要在同一次執行被刪。若列出函式沒有先排除「有列」的物件，`p_limit = 200` 會被最舊的有列物件佔滿，較新的孤兒要等前面的物件被 90 天規則清完才輪得到【待釐清 M1：規格文字目前如此】 |

## 上一版待釐清的處理（ADR-021 決定 3、ARCHITECTURE v1.15）

| 上一版 | 狀態 | 依據 |
|---|---|---|
| B1 孤兒沒有任務單涵蓋 | **規格已定、任務單未更新**：T-046 仍是 v1.2，沒有孤兒；待 TechLead 出 v1.3 | ADR-021 後果 |
| B2 怎麼列出 | 已裁定：SQL 函式 `public.list_audio_objects_for_purge`，不用 Storage JS `list`；每批 200 個物件 | §4.12.2.1 |
| B3 例外表 | 已裁定：孤兒查詢列入 §4.12.5 例外表；只 `select audio_path` | §4.12.2.1 |
| B4 建立時間欄位 | 已裁定：只看 `storage.objects.created_at`；缺值不刪；不含等於 | §4.12.2.1 |
| B5 `PurgeStats.orphan` | 已裁定：`{ selected, purged, failed }`；log 三組數字 | §4.12.2.1 |
| B6 階段獨立與失敗 | 已裁定：孤兒不因 `listExpired` 失敗而跳過；列出失敗整段回 `err`、非 200；`remove` 失敗只算 `failed`、HTTP 200 | §4.12.2.1 |
| B7 競態 | 已裁定：刪前再查一次 `audio_path` | §4.12.2.1 |
| B8 `op` | 已裁定：`storage_failed.op` 新增 `'list'`（T-046 改 contracts） | ADR-021 決定 3、§5.0.4 |

## 待釐清（仍未定或新出現；QA 不猜，請 TechLead／Architect 決定）

| # | 問題 | 影響 |
|---|---|---|
| M1 | **列出函式沒有先排除「有列」的物件，可能讓孤兒餓死。** SQL 先對 `storage.objects` 依 `created_at` 升序取前 `p_limit`（200）個，之後才在應用層查「有沒有列」並拿掉。一般情況下 24 小時以前的物件幾乎都有列（約每天 17 個、保留 90 天，約 1,500 個），所以前 200 個候選永遠是最舊的有列錄音，全被拿掉；較新的孤兒要等前面的有列物件被 90 天規則清掉、輪到自己變成最舊才會被刪（接近 90 天，而不是 24 小時）。建議：函式內直接用 `not exists`／`left join` 排除兩張表已有的 `audio_path`，再 `limit`；或分頁走完所有候選 | O-31；直接影響「孤兒 24 小時後清」是否成立；個資檔會多留近 90 天 |
| M2 | 函式 `security definer` 直接讀 `storage.objects`，T-046 的 pgTAP 要驗證權限（O-26）；`p_cutoff` 的時區（`timestamptz`）沒問題，但呼叫端要傳 ISO 字串／`Date`，PostgREST `rpc` 的參數型別轉換要有測試 | O-26、O-29 |
| M3 | `audio_path in (…)` 一次帶 200 個路徑（路徑含 `user_id` 與日期，約 80～100 字元）→ GET 查詢字串約 20 KB，可能超過 PostgREST／網關的 URL 長度限制（**不確定**，沒有實測）；是否改用 POST（`rpc`）或分批 | O-21 的查詢形狀；G4 前需實測 |
| M4 | 刪前複查拿掉的路徑，要不要計入 `orphan.selected`（`selected` 是「選出」還是「準備刪」）；AC 要把 `selected = purged + failed + 被拿掉` 或 `selected = purged + failed` 寫清楚 | O-15 的統計預期 |
| M5 | 剛好 24 小時（`created_at = p_cutoff`）的物件這輪不刪，下一輪（隔天 03:30）才刪；與 T-030「寫列失敗」留下的物件實際保留約 24～48 小時一致，是否接受 | O-2 的預期已依字面寫（不刪） |
