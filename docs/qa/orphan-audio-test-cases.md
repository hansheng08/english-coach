# QA 測試案例設計：孤兒錄音清理（`purge-audio` 的孤兒批次）

- 擁有者：QA｜日期：2026-11-28（台北時間）｜版本：**v5**（依 ARCHITECTURE v1.18 更新；v1～v4 皆已合併。**案例編號 O-1～O-42 保持不變**，因為 T-046 v1.3 以編號引用）。
- 依據：ARCHITECTURE v1.18（§4.12.2、§4.12.2.1、§4.12.5、§4.18.1、§5.0.4、§5.0.5）、ADR-020 決定 2、**ADR-021（含修訂 1、2、3；決定 1、3 本文已於 §10 修訂改寫）**、`docs/tasks/T-046.md` v1.3、`docs/tasks/T-030.md` v1.3。
- **ARCHITECTURE v1.18 已合併（#129，merge `28e3c2a`）；本文件以 main 上的實際文字為準。**
- 性質：**派工前的測試案例設計**，不是驗收結論。目前沒有可執行的程式（`audio-purge.ts` 還不存在），所以沒有探針；探針與 `mutants.json` 等實作完成後由 QA 補。
- 標記：**【必做】**、**【盡力做】** 沿用 ARCH §4.12.2.1 對 pgTAP 的分法；【待釐清 Qn】＝ v1.17 之後仍沒定下來的項目。


## 這件事在哪一張單？——T-046 v1.3 已涵蓋，但**寫法落後於 ARCHITECTURE v1.15／v1.16／v1.17**
- 任務單：`docs/tasks/T-046.md` 在 main 上仍是 **v1.3**，已加入孤兒清除（AC-T46-13～15、TC-26～TC-33，以本文件 O-1～O-24 當驗收參考），規格以 v1.14 為準。v1.15 之後，列出方式、`op`、複查、時間欄位、游標、`PurgeRun`、log 格式、檔案分工、pgTAP 都改了，任務單**沒有同步**，衝突見文末「任務單落後」C-T46-1～C-T46-13。
- 因此 QA 的 O-n 案例以 ARCHITECTURE v1.17 為準；T-046 派工前須出 v1.4（含 migration 的兩支函式與兩個部分索引、`PurgeDeps` 兩個新方法與 `PurgeDbClient`、`PURGE_ORPHAN_MAX_CALLS`、`purgeOrphans` 游標迴圈與複查失敗路徑、`PurgeRun` 與 handler 的一行 log、contracts 的 `op: 'list'`、新檔 `supabase/tests/t046_orphan_audio_rpc_test.sql` 要列進範圍）。


## 規格摘要（ARCHITECTURE v1.18 §4.12.2、§4.12.2.1；ADR-021 決定 3、修訂 3）
- 孤兒：`audio` bucket 內，沒有任何 `shadow_attempt.audio_path` 或 `evening_answer.audio_path` 與其**完全相同**的物件；只掃跟讀 `<user_id>/shadow/<plan_date>/<檔>`（三段）與晚上 `<user_id>/evening/<檔>`（兩段）。
- **列出**：secret 金鑰呼叫 SQL 函式 `public.list_orphan_audio_objects(p_cutoff timestamptz, p_limit integer, p_after_created_at timestamptz default null, p_after_name text default null) returns table(object_name text, created_at timestamptz)`（四個參數；`plpgsql`、`stable`、`security definer`、`set search_path = ''`；`revoke all … from public, anon, authenticated`，只 `grant execute` 給 `service_role`）。函式在 SQL 內用 `NOT EXISTS` 排除兩張表已有相同 `audio_path` 的物件，再 `ORDER BY created_at, name` 與 `LIMIT p_limit`，只回孤兒候選。
  - **游標（v1.17）**：`p_after_created_at`、`p_after_name` 必須同時給或同時為 null；只給一個 → `raise exception … errcode '22023'`，不查表、不回列。給了游標就只回 `(created_at, name)` **嚴格大於**游標的列。
- **應用層不得再初篩**：不再對列出結果做「有列就拿掉」。
- 時間：只看 `storage.objects.created_at`；`created_at < p_cutoff`（`p_cutoff = deps.now() - 24 h`，**不含等於**）；缺值 → 不進結果（不刪）。
- **迴圈（`purgeOrphans`，v1.17）**：同一次執行最多呼叫 `PURGE_ORPHAN_MAX_CALLS = 5` 次列出（每次執行最多 5 × `limit` 個候選，預設 1,000）；**每次呼叫的 `p_limit` 都等於本次執行的 `limit`**（`purgeExpiredAudio(deps, now, limit?)`，預設 `PURGE_BATCH_LIMIT = 200`，到期與孤兒階段共用）。第一次 `after = null`；之後游標＝**上一次回傳的最後一列**（`createdAt` 是 RPC 回的 ISO 字串**原樣**傳回，不經 `Date`；`name` 是該列的 `path`），**不論那批刪成功、`remove` 失敗、或被複查拿掉**。停止條件：**列出回 0 筆**（不呼叫 `pathsInUse`、不呼叫 `removeObjects`，游標不推進，立即結束）；回傳筆數 > 0 但 < `limit`（處理完這批後結束）；已呼叫 5 次；複查或列出失敗。**剛好回 `limit` 筆時，若尚未達 `MAX_CALLS`，一定再呼叫一次**以確認下一頁；若回 0 筆則停止。**這次空呼叫仍計入 `PURGE_ORPHAN_MAX_CALLS`**（例如剛好 200 個會列出 2 次：200＋0；合計仍 ≤ 5）。第 5 次已滿批則**不再**呼叫第 6 次。游標不存狀態，隔天從頭。
- **刪前複查**：列出回 **1 筆以上**才對**該次回傳的全部路徑**呼叫一次 `pathsInUse`（RPC `public.audio_paths_in_use(p_paths text[])`，POST 帶陣列；同樣 `security definer`、只給 `service_role`；**不用** PostgREST GET 的 `audio_path=in.(…)`）；已有列的路徑從本批拿掉；**剩下才送 `removeObjects`，剩 0 個不呼叫**（游標照推進）。`pathsInUse` 回 `err`（RPC 失敗、逾時、回傳格式錯誤）：**這一批一個都不刪**（不呼叫 `removeObjects`），不假設「沒回傳＝沒有列」；錯誤種類 `db_failed`（500、可重試）；孤兒階段**立刻停止**；該批已計入 `selected`、**不計入** `purged` 或 `failed`。
- **索引**：兩張表的 `audio_path` 各一個部分索引（`where audio_path is not null`），名稱 `shadow_attempt_audio_path_idx`、`evening_answer_audio_path_idx`。
- **統計與回傳**：`PurgeStats.orphan = { selected, purged, failed }`；**`selected` ＝整次執行所有列出呼叫回傳筆數的總和，複查拿掉的仍計入，所以 `selected >= purged + failed`**；`failed` 只指 `remove` 失敗。`purgeExpiredAudio` 回 **`PurgeRun = { stats, error }`**（`stats` 永遠有，沒跑到的階段全 0；`error` 是第一個錯誤或 null；不丟例外、不寫 log）；`purgeOrphans` 匯出，回 `{ stats, error }`（`error` 非 null 時 `stats` 是失敗當下為止的累計）。三個階段（shadow 表、evening 表、孤兒）彼此獨立。單批 `remove` 失敗只算 `failed`，`error` 為 null；列出失敗（含第 2～5 次）→ `storage_failed`、`op: 'list'`，已刪的不回復。
- **HTTP 與 log（由 handler 負責）**：`error` 為 null → 200＋`PurgeStats`（`failed > 0` 也是 200）；非 null → HTTP 狀態與 body **一律**依 `toApiErrorBody(error)`（`ApiErrorBody`，**不含統計**；不寫死 500）：列出失敗 `storage_failed` → 502，複查失敗 `db_failed` → 500，到期階段依該錯誤的 kind。**每次執行只寫一行 log**：`purge-audio shadow=<s>/<p>/<f> evening=<s>/<p>/<f> orphan=<s>/<p>/<f>`，出錯時尾端加 ` error=<AppError.kind> phase=<shadow|evening|orphan>`（`phase` 指第一個錯誤發生的階段）；不含路徑、id、金鑰、錯誤 `message`；孤兒複查失敗不另寫第二行。
- **檔案分工（§10 修訂）**：`purge-audio/index.ts` 只做組裝（讀 env、`createServiceClient`、交給 `purgeDepsFrom`、接上 `createPurgeHandler`）；`handler.ts` 呼叫 `requireServiceKey` 與 `purge`、寫 log、決定狀態碼，不建立 secret client；`audio-purge.ts` 不寫 log，只對 `service-db.ts` 做 `PurgeDbClient` 的 type import。
- 不碰 `tts`、`resume` bucket；刪除只針對 `audio` bucket；孤兒刪除重用 `removeObjects`。


## 測試案例（全部用假 Storage、假 DB、假 RPC 回應；`now` 固定；不連網。標註 pgTAP 的由 PR CI 的 `db` job 驗證）

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
| O-9 | 批次 | 250 個孤兒（`limit` 預設 200） | **同一次執行**清完：第 1 次呼叫（`after = null`）回 200 → 複查 → `removeObjects` 200 個 → 游標＝第 200 筆；第 2 次（帶游標）回 50（< `limit`）→ 複查 → `removeObjects` 50 個 → 結束。列出 2 次、複查 2 次、`removeObjects` 2 次；`selected` 250、`purged` 250。變體：剛好 200 個 → 第 2 次回 0 筆 → 結束（列出 2 次、複查 1 次、`removeObjects` 1 次；**空列出仍計入 `PURGE_ORPHAN_MAX_CALLS`**）；剛好 1,000 個 → 第 5 次滿批 200，**不呼叫第 6 次**空確認（已達上限） |
| O-10 | 順序 | 同時有過期的有列錄音與孤兒 | 先處理有列的過期錄音，再處理孤兒（呼叫順序可由假 deps 的記錄驗證） |
| O-11 | 錯誤 | 孤兒的 `removeObjects` 回 `err`（例如 250 個孤兒、第 1 批 200 個 `remove` 失敗） | 該批 `failed` 等於批次路徑數（200）、`purged` 不含它們；**游標仍推進到最後一列、同一次執行繼續第 2 次呼叫**（第 2 批 50 個照刪）；`purgeOrphans` 的 `error` 為 null、HTTP 200；有列的兩張表統計不受影響；不丟例外；隔天從頭，失敗的那批會再被選到並再計入 `failed`（冪等） |
| O-12 | 錯誤 | 孤兒候選的列出（`list_orphan_audio_objects`）回 `err` | 兩張表的到期清理照做；孤兒階段停止並設 `error: storage_failed`（`op: 'list'`）；**`PurgeRun.stats` 仍存在**：第 1 次就失敗 → `orphan` 為 0/0/0；**第 2～5 次才失敗 → 前面已刪的不回復，`orphan` 是失敗當下為止的累計**，之後不再呼叫列出；HTTP **502**（**一律**依 `toApiErrorBody`，不寫死 500；`storage_failed` → 502），body 是 `ApiErrorBody`、**不含統計**，統計只在那一行 log（尾端 ` error=storage_failed phase=orphan`）；若到期階段先出錯，`error` 與 `phase` 仍是第一個錯誤（`shadow` 或 `evening`），孤兒的錯誤不覆蓋；不丟例外 |
| O-13 | 冪等 | 物件已不存在（兩個 purge 重疊執行、或 `remove` 重送） | `remove` 回 `ok` 就算成功（同 AC-T46-3 的規則），不報錯 |
| O-14 | 競態 | 剛上傳、尚未寫列的物件（建立時間 2 分鐘前，T-030 上傳後到 `insertAttempt` 之間，或晚上流程先上傳再呼叫 `/evening/answers`） | 不刪（24 小時保護，§4.18.1、§4.12.2.1 定義段） |
| O-15 | 競態 | 列出之後、`remove` 之前，其中一個物件的列剛好被寫入（假 `pathsInUse` 回含該路徑） | 該路徑從本批拿掉、不刪；`removeObjects` 只收到其餘路徑；**`selected` 仍含被拿掉的路徑**，`purged`、`failed` 都不含它，故 `selected = purged + failed + 被拿掉`，`selected >= purged + failed`；**游標仍推進到那次回傳的最後一列（含被拿掉的）**；`pathsInUse` 每次**有回傳**的列出呼叫各一次，輸入就是那一次回傳的全部路徑（多批時 `selected` 為各次總和） |
| O-16 | 回歸 | 沒有任何孤兒、也沒有過期錄音 | 列出 1 次（回 0 筆 → 立即停止）；`pathsInUse` 0 次、`removeObjects` 0 次；`PurgeStats` 全 0；HTTP 仍是 200；log 仍寫一行三組 `0/0/0` |
| O-17 | 回歸 | 既有的 T-046 TC-6～TC-15（有列的過期錄音） | 加入孤兒批次後行為不變：`shadow`、`evening` 統計與呼叫次數與原本相同 |
| O-18 | 回應 | `PurgeStats` 含 `orphan`；`PurgeRun.error` 為 null 時 handler 回 200 且 body 與 `PurgeStats` 相同；`orphan.failed > 0` 也是 200；`error` 非 null 時 | 同 AC-T46-7 的規則；`error` 非 null → `toApiErrorBody` 的狀態碼（`storage_failed` 502、`db_failed` 500），body 是 `ApiErrorBody`、**不含統計**（統計只在 log）；`purge` 依賴型別是 `(env) => Promise<PurgeRun>` |
| O-19 | log | handler 寫的 log（`audio-purge.ts` 本身不寫 log、不拿 log 依賴） | **每次執行恰好一行**、以 `purge-audio` 開頭：`purge-audio shadow=s/p/f evening=s/p/f orphan=s/p/f`；出錯時尾端加 ` error=<AppError.kind> phase=<shadow\|evening\|orphan>`（到期階段出錯、孤兒列出或複查失敗都用同一格式）；只有數字與種類，不含任何物件路徑、`user_id`、檔名、錯誤 `message`；孤兒複查失敗**不**另寫第二行，也不出現舊的 `orphan recheck failed` 格式 |
| O-20 | 錯誤訊息 | 列出或刪除失敗的 `AppError.message` | 不含路徑；刪除失敗是 `storage_failed`（`op: 'delete'`）；列出失敗是 `storage_failed`（`op: 'list'`） |
| O-21 | 查詢形狀 | 應用層對資料庫與 Storage 的呼叫 | 列出只呼叫 RPC `list_orphan_audio_objects`，參數 **`p_cutoff`、`p_limit`、`p_after_created_at`、`p_after_name`**：第一次游標兩者為 null；之後兩者**同時**由上一次的最後一列取得（絕不只給一個；`p_after_created_at` 是 RPC 回傳字串**原樣**，例如測試用帶微秒的假字串 `2026-11-26T03:00:00.123456+00:00`，不經 `Date`），**不**對 `shadow_attempt`／`evening_answer` 做任何初篩查詢；刪前複查只呼叫 RPC `audio_paths_in_use`（POST 帶 `p_paths` 陣列），**不**出現 `.in('audio_path', …)` 或任何 GET 的 `audio_path=in.(…)`；RPC 回應只取 `object_name`、`created_at`／`audio_path`；`listExpired` 仍只 select `id`、`audio_path`、`audio_expires_at` 三欄；舊名 `list_audio_objects_for_purge` 不存在（靜態搜尋）；回傳不是預期形狀 → 列出失敗（`storage_failed`、`op: 'list'`）或複查失敗（`db_failed`），**不當成空集合** |
| O-22 | 端到端（T-030 ↔ purge） | T-030 的寫列失敗情境（TC-12：`uploadAudio` 成功、`insertAttempt` 回 `db_failed`）留下的物件路徑格式 | 路徑格式 `<u>/shadow/<planDate>/<itemIndex>-<uuid>.wav` 屬於上述前綴，會被 O-1 的邏輯認成孤兒；用同一個路徑字串樣本在兩邊的測試裡互相對照，避免格式不一致 |
| O-23 | 靜態 | `tooling/secret-client-scope.test.ts`（T-046 TC-24、TC-25） | 孤兒清理新增的檔案沒有讓 `createServiceClient` 出現在清單外的檔案；v1.17 補充：`purge-audio/handler.ts` 與 `audio-purge.ts` **不得**呼叫 `createServiceClient`、也不得 import `service-db.ts`（`audio-purge.ts` 只允許 `PurgeDbClient` 的 type import）；client 只在 `purge-audio/index.ts` 建立 |
| O-24 | pgTAP／CI | bucket 對 `authenticated` 沒有 `delete` policy | 使用者身分刪不掉自己的孤兒；刪除只能由 secret 金鑰（§4.12.1 Storage RLS），T-046 的 AC-T46-9／10 已涵蓋，孤兒清理不得新增 `delete` policy |
| O-25 | 路徑形狀 | 候選函式的路徑判定（假列出需模擬 `storage.foldername`；真實判定由 pgTAP 驗證，見 O-26） | `<u>/shadow/<date>/<file>` 與 `<u>/evening/<file>` 才是候選；`<u>/shadow/<file>`（缺日期）、`<u>/shadow/<date>/<x>/<file>`（多一層）、`<u>/evening/<x>/<file>`、`<u>/shadowx/…`、`<u>/foo/shadow/<date>/<file>` 都不是 |
| O-26 | pgTAP（`db` job；新檔 `supabase/tests/t046_orphan_audio_rpc_test.sql`，與既有 `t046_audio_purge_test.sql` 各自獨立、可分別失敗） | 兩支 RPC 的權限與行為（簽名：`list_orphan_audio_objects(timestamptz, integer, timestamptz, text)`、`audio_paths_in_use(text[])`） | **【必做】（不依賴 `storage.objects` 能不能寫入）** ①`function_privs_are('public', <名稱>, <參數型別陣列>, '<角色>', <權限陣列>)`：`anon`、`authenticated` 為空陣列、`service_role` 為 `{EXECUTE}`，PUBLIC 也沒有 `EXECUTE`；②`set local role anon`、`authenticated` 各呼叫兩支函式 → `throws_ok(…, '42501', …)`，`set local role service_role` 呼叫 → `lives_ok`；③兩支函式 `is_definer`，且 `proconfig` 含 `search_path=""`；④游標只給一個：以 `service_role` 呼叫 `list_orphan_audio_objects(now(), 1, now(), null)` 與 `(now(), 1, null, 'x')` → 各 `throws_ok(…, '22023', …)`，兩個都給或都不給 → `lives_ok`。**【盡力做】（需往 `storage.objects` 插測試列）**：`NOT EXISTS` 排除有列物件、`p_limit`、游標嚴格大於、`created_at < p_cutoff` 不含等於（含 `null`）、路徑形狀（跟讀三段、晚上兩段、多一段不入選）、排序 `created_at` 再 `name`；先用 `lives_ok` 插入，**插不進去時 T-046 停下、寫報告、這組改由 G4 手動檢查，必做那組照常交付**。**未驗證（不擋開發，PR CI 第一次跑才知道）**：`function_privs_are` 對 PUBLIC 的支援與 pgTAP 版本（備案：`pg_proc.proacl` 不含 `=X/…`，或 `has_function_privilege`）、pgTAP 能否寫 `storage.objects`、正式專案預設權限與本機一致、`set local role service_role` 可用；這些不可用時 QA 不自行改寫斷言，回報給 SRE／T-046 |
| O-27 | 邊界 | 候選的 `created_at` 為 `null` | 不進結果（pgTAP，函式的 `created_at < p_cutoff` 對 null 不成立）；應用層收到缺 `created_at` 的回應列時也不刪（fail-safe） |
| O-28 | 順序與批次 | 候選孤兒 1,200 個（其中第 200 與第 201 筆 `created_at` 完全相同、`name` 不同；第 400／401 筆亦同） | 依 `created_at` 升序、再 `name` 升序；一次執行第 1～5 次各回滿批 200（共 1,000 個）；**第 5 次已滿批，不呼叫第 6 次空確認**（已達 `PURGE_ORPHAN_MAX_CALLS`）；游標 `(createdAt, name)` 嚴格大於 → 同一時間戳跨批邊界**不漏、不重**；剩下的 200 個（最新的）**隔天**再刪（游標從頭、前面的已刪光）；順序可重現 |
| O-29 | `p_cutoff`、`p_limit`、游標 | handler／`purgeExpiredAudio` 傳給列出函式的參數 | `p_cutoff` 等於 `deps.now() - 24 小時`（固定 `now` 驗證，ISO 字串），不是 `new Date()`；**每次呼叫的 `p_limit` 都等於傳入的 `limit`**：預設 200；`limit = 50` 時到期兩階段與孤兒每次呼叫都是 50（同一個 `limit`）；第一次呼叫游標為 null，之後取上一次最後一列 |
| O-30 | 獨立性 | 兩張表的 `listExpired` 其中一張回 `err`，且孤兒有可刪的 | 孤兒仍然被刪；最後回第一個錯誤（`err`）；三個階段彼此不短路；`PurgeRun.stats` 仍含另一張表與孤兒的數字；log 尾端 `phase=shadow` 或 `phase=evening`（第一個錯誤的階段） |
| O-31 | **不得餓死（starvation）** | 24 小時以前、**有列**的物件很多（例如 250 個，建立時間比孤兒更早），另有 3 個**較新**的孤兒（建立 25 小時前） | 3 個孤兒在**同一次執行**就被刪：(a)【盡力做】pgTAP：`list_orphan_audio_objects(cutoff, 200, null, null)` 回傳恰好這 3 個（`NOT EXISTS` 在 `LIMIT` 之前）；(b) 單元（必做）：假列出直接回這 3 個，應用層不再過濾、`removeObjects` 收到 3 個路徑；呼叫形狀同 O-21 |
| O-32 | **列出排除仍有列的物件**（新） | 物件超過 24 小時，且 `shadow_attempt.audio_path` 或 `evening_answer.audio_path`（兩張表各測一次）有**逐字相同**路徑；另有一個只差一個字元的路徑（孤兒） | 有列者**不出現在**列出結果（SQL 內排除，不靠應用層）；只差一個字元者出現；【盡力做】pgTAP 驗證（插不進 `storage.objects` 時改由 G4 手動檢查；單元層以假列出對照），並確認 `NOT EXISTS` 發生在 `LIMIT` 之前（250 個有列＋3 個孤兒，`p_limit = 200`、`after = null` 仍回 3 個；帶游標時仍排除有列者） |
| O-33 | pgTAP（同 O-26 的新檔） | `audio_paths_in_use(p_paths text[])` | **【必做】**權限與 `security definer`／`search_path`、`anon`／`authenticated`／`service_role` 的呼叫結果見 O-26。**行為（QA 建議放同檔；需要插 `shadow_attempt`／`evening_answer` 的列，ARCH 的「盡力做」清單只明列列出函式，插不進去同樣停下回報）**：傳入 5 個路徑（2 個在 `shadow_attempt`、1 個在 `evening_answer`、2 個沒有列）→ 只回那 3 個；重複的輸入路徑只回一次（`distinct`）；空陣列 → 空結果；`null` 元素不造成錯誤；`audio_path` 為 null 的列不會被誤匹配 |
| O-34 | pgTAP | 索引 | 兩個部分索引存在，名稱 `shadow_attempt_audio_path_idx`、`evening_answer_audio_path_idx`，欄位 `audio_path`，述詞 `audio_path is not null`；T-046 migration 不改 T-006 以前的 migration 檔 |
| O-35 | 回歸 | 舊名稱與 GET 查詢不得出現 | 程式與 migration 中沒有 `list_audio_objects_for_purge`；複查沒有 PostgREST GET `in=(…)`（O-21 的靜態版，放在 `tooling` 靜態測試或 `audio-purge.test.ts`） |
| O-36 | 邊界 | 刪前複查的輸入與空批 | (a) 列出 ≥ 1 筆時，該次回傳的全部路徑（例如 200 個）**一次**送一次 RPC，不拆成 200 次；(b) **列出 0 筆**：`pathsInUse` 0 次、`removeObjects` 0 次、迴圈立即結束（游標不推進、不再呼叫列出）；(c) 複查回傳全部路徑（全都已有列）時，`removeObjects` 0 次、`purged` 0、`failed` 0、`selected` 為該次回傳筆數、**游標照推進**，若該次回傳筆數 = `limit` 就繼續下一次呼叫，否則結束 |
| O-37 | 錯誤 | 刪前複查（`audio_paths_in_use`）回 `err`（RPC 失敗、逾時、回傳格式錯誤皆測） | **`removeObjects` 一次都不被呼叫**（不當成已刪，也不假設「沒回傳＝沒有列」）；孤兒階段**立即停止**，不再呼叫列出；`purgeOrphans` 回 `error: db_failed`、`stats` 為失敗當下的累計（該批已計入 `selected`，**`failed` 不增加**、`purged` 不含它）；兩張表的到期階段照常，`PurgeRun.error` 是第一個錯誤；handler 只寫**一行** log，尾端 ` error=db_failed phase=orphan`、不含路徑，HTTP **500**（**一律**依 `toApiErrorBody`，不寫死狀態碼；此例 `db_failed` → 500）；不在函式內重試；物件仍在 Storage。若是**第 2 次**呼叫的複查才失敗：第 1 批已刪的不回復，累計含第 1 批 |
| O-38 | 隔離 | 列出函式只回孤兒的「名稱與建立時間」，不回 `user_id` 以外的個資；`audio_paths_in_use` 只回 `audio_path` | 沒有逐字稿、分數、`id`；符合 §4.12.5 的「只做表上寫的事」 |
| O-39 | **毒丸（poison pill）** | 最舊的 200 個孤兒 `removeObjects` 一律回 `err`，另有較新的孤兒（例如 30 個） | **同一次執行**：第 1 次呼叫的 200 個 `remove` 失敗（`failed` 200）；游標推進到那批最後一列；**第 2 次呼叫帶游標略過它們**，較新的 30 個被刪（`purged` 30）；第 2 次回傳 < `limit` → 結束，`selected` 230。補充：(a) 游標推進到最後一列，**含被複查拿掉的**；(b) 一次執行最多 5 次呼叫；(c) **已知上限（pin 規格，不是缺陷）**：最舊的 1,000 個孤兒全都刪不掉、另有 3 個較新 → 該次執行 5 次呼叫都耗在失敗的批上，較新的 3 個**這次輪不到**（`failed` 1,000，log 可見），隔天仍同樣——規格明寫「超過 5 × `limit` 個永遠刪不掉的孤兒才會擋住更新的，由 `failed` log 發現，不加黑名單表」；(d) 隔天（游標從頭）仍刪不掉的舊孤兒會再被試一次並再計入 `failed`（刻意）【原待釐清 Q1，v1.17 已解決】 |
| O-40 | 邊界 | 兩個前綴共用同一個額度 | 每次列出呼叫是**單一 RPC、不分前綴**，`p_limit` 為 `limit`（200）個孤兒；shadow 與 evening 混合，依 `created_at` 再 `name` 決定誰先；單次執行最多 5 次呼叫（1,000 個）；與任務單 v1.3「每個前綴各 200、最多 400」不同【任務單落後 C-T46-4】 |
| O-41 | 契約 | `purgeOrphans` 匯出、可單獨呼叫；`purgeExpiredAudio` 回 `PurgeRun` | `purgeOrphans(deps, now, limit?)` 回 `{ stats, error }`；`error` 非 null 時 `stats` 是失敗當下為止的累計；`purgeExpiredAudio` 永遠回 `{ stats, error }`（沒跑到的階段全 0）、不丟例外、不寫 log；`PurgeDeps.listOrphanCandidates(cutoff, limit, after)`、`pathsInUse(paths)` 的簽名與 §4.12.2 一致（`tsc` 層）；孤兒刪除只用 `removeObjects`，沒有 `clearAudioPath` 呼叫 |
| O-42 | 邊界 | 游標字串原樣傳回 | 假列出第 1 次回的 `created_at` 為 `2026-11-26T03:00:00.123456+00:00`（微秒）；第 2 次呼叫收到的 `p_after_created_at` **逐字相同**（不是 `…123Z` 之類經 `Date` 截斷後的字串）；`p_after_name` ＝ 該列 `object_name` |

## v1.16～v1.18 對上一版待釐清（M1～M5、Q1～Q6）的處理

| 項目 | 是否解決 | 依據與 QA 的判斷 |
|---|---|---|
| **M1** 列出函式先 `LIMIT` 再於應用層排除有列物件，孤兒約 90 天才清 | **解決（規格層）**（v1.16） | 函式更名 `list_orphan_audio_objects`，SQL 內 `NOT EXISTS` 再 `ORDER BY`／`LIMIT`；應用層不得初篩（O-21、O-31、O-32）。實際效果須由 pgTAP 驗證，但 pgTAP 行為組是【盡力做】，插不進 `storage.objects` 時改 G4 手動檢查 |
| **M2** security definer 與 `rpc` 型別轉換 | **部分解決** | 權限由 O-26 的必做組驗證；`p_cutoff` 以 ISO 字串傳入的轉換仍要有測試（O-29） |
| **M3** 複查 200 個路徑的 GET 查詢字串過長 | **解決**（v1.16） | 改走 RPC `audio_paths_in_use`（POST），明禁 GET `in=(…)`（O-21、O-35、O-36） |
| **M4** `selected` 是否含複查拿掉的路徑 | **解決**（v1.16；v1.17 改為各次總和） | `selected` ＝整次執行所有列出呼叫回傳筆數的總和，含被拿掉的；`selected >= purged + failed`（O-15） |
| **M5** 剛好 24 小時邊界的保留期 | 維持 | 邊界不含等於（O-2）；保留實際約 24～48 小時，QA 接受 |
| **Q1** 毒丸：永遠刪不掉的最舊孤兒佔住整個額度 | **解決（v1.17）**，含已知上限 | keyset 游標＋每次執行最多 5 次呼叫（O-9、O-28、O-39）。殘餘：超過 5 × `limit` 個永遠刪不掉的孤兒仍會擋住更新的，規格明列為已知上限（O-39 (c) 釘住） |
| **Q2** `anon`／`authenticated` 能否呼叫兩支 RPC | **解決（v1.17）** | 新檔 `t046_orphan_audio_rpc_test.sql` 的必做組：`function_privs_are`、`throws_ok(…, '42501')`、`is_definer`、`search_path`、`22023`（O-26、O-33）。工具細節（`function_privs_are` 對 PUBLIC、pgTAP 版本、能否寫 `storage.objects`）標未驗證，PR CI 第一次跑才知道，不擋開發 |
| **Q3** 刪前複查失敗 | **解決（v1.17）** | 整批不刪、孤兒階段立即停止、`db_failed`（500）、不計入 `failed`、一行 log 尾端 `error=db_failed phase=orphan`（O-37、O-19） |
| **Q4** 兩支 RPC「只讀哪些欄位」要不要用測試固定 | **解決** | §4.12.5 第 3 點已要求 `audio-purge.ts` 的測試檢查 `pathsInUse` 只經 `audio_paths_in_use` 回傳 `audio_path`、`listOrphanCandidates` 只讀 `name` 與 `created_at`（O-21、O-38） |
| 部分索引 | 已寫入規格 | O-34 |
| QA 對 #126 提出的非阻擋項（ADR 決定 1／3 本文未改寫；§4.12.2 檔案表 `index.ts`／`handler.ts` 分工與 `createServiceClient` 清單；「兩個」截斷測試；列出 0 筆是否呼叫 `pathsInUse`） | **皆已由 §10 修訂（`a22519c`）修正** | ADR 決定 1、3 已改寫；`index.ts` 只組裝、`handler.ts` 寫 log 與決定狀態碼、client 只在 `index.ts` 建立；N3 段改為「一個」截斷測試；列出 0 筆不呼叫 `pathsInUse`／`removeObjects` 並停止（O-36） |
| **Q5** HTTP 狀態被寫成「（500）」 | **解決（v1.18）** | `error` 非 null 時一律依 `toApiErrorBody`：列出失敗 502、複查失敗 500、到期階段依該錯誤的 kind。O-12／O-37 的狀態碼預期不變 |
| **Q6** 滿批後的空列出是否計入 `MAX_CALLS` | **解決（v1.18）** | 剛好回 `limit` 筆且尚未達上限時一定再呼叫一次；空呼叫仍計入 `PURGE_ORPHAN_MAX_CALLS`（O-9：200＋0 列出 2 次）。第 5 次已滿批則不呼叫第 6 次（O-28：1,200 個當天刪 1,000、剩下 200 隔天再刪） |


## 新的矛盾與待釐清

### 任務單 T-046 v1.3 落後於 ARCHITECTURE v1.15～v1.18（QA 案例以 ARCH 為準；T-046 派工前須出 v1.4；main 上的 T-046 仍是 v1.3）
| # | T-046 v1.3 | ARCHITECTURE v1.18 | 影響的案例 |
|---|---|---|---|
| C-T46-1 | 「只用 Storage 的 list API，不查 `storage` schema」，`listOrphans` 一層一層走（根目錄→使用者→前綴→日期→檔案），每頁 100 筆 | **不要**用 Storage JS `list`；改呼叫 SQL 函式 `list_orphan_audio_objects`（migration 建） | O-21、O-25、O-26、TC-30 整個作廢 |
| C-T46-2 | `PurgeDeps` 用 `listOrphans(prefix, before, limit)`，對兩個前綴各一次 | `PurgeDeps` 加 `listOrphanCandidates(cutoff, limit, after: OrphanCursor \| null)`、`pathsInUse(paths)`；刪除重用 `removeObjects`；`purgeDepsFrom(client: PurgeDbClient)`；一次列出、不分前綴 | O-40、O-41、TC-26、TC-27 |
| C-T46-3 | 24 小時：用 `created_at`，**沒有才改用 `updated_at`**；TC-28 預期「沒有 `created_at` 但 `updated_at` 夠舊」被選為孤兒 | 只看 `created_at`；缺值**不刪**；**不用** `updated_at`、`last_accessed_at` | O-27；TC-28 的第四項與 ARCH 相反（任務單照寫會刪掉 ARCH 要保留的物件） |
| C-T46-4 | 每個前綴最多 200 個孤兒，`selected` 最多 400 | `p_limit` 200 個孤兒（一次呼叫、不分前綴） | O-9、O-28、O-40 |
| C-T46-5 | 有沒有列：對應表 `select audio_path`、帶 `eq('user_id', 路徑第一段)`、用 `in(…)`（GET） | 初篩在 SQL 的 `NOT EXISTS`（不帶 `user_id`）；複查走 RPC `audio_paths_in_use`，**明禁 GET `in=(…)`**；兩者列入 §4.12.5 例外表 | O-21、O-35、AC-T46-14「查詢帶 `user_id`」 |
| C-T46-6 | 「列出與刪除之間才被寫入的列**不再複查**」 | 刪除前**再查一次**，已有列的拿掉 | O-15、O-36 |
| C-T46-7 | list 失敗 → `storage_failed`、`op: 'download'`（暫定，Q-T46-a）；`op` 沒有 `list` | `op` 新增 `'list'`；T-046 改 contracts | O-20、TC-33 |
| C-T46-8 | 有 `err` 時 HTTP 狀態照該錯誤（暫定，Q-T46-b；ARCH 已定：非 null → `toApiErrorBody`，列出失敗 502、複查失敗 500）；「一個前綴的 `listOrphans` 回錯時另一個前綴照做」、最後回「孤兒的 shadow 前綴、evening 前綴」的順序 | 孤兒列出沒有前綴之分；三個階段（shadow 表、evening 表、孤兒）彼此獨立，最後回第一個錯誤；`remove` 失敗只算 `failed`（ARCH 明寫 `error` 為 null、HTTP 200），任務單 AC-T46-15 寫「`removeObjects` 失敗 → `storage_failed`」，**是否仍回 `err` 表述不清（以 ARCH 為準）** | O-11、O-12、O-30 |
| C-T46-9 | 範圍沒有兩支 SQL 函式、兩個部分索引、pgTAP 函式測試；`PurgeStats.orphan` 的 `selected` 只寫「路徑數」，沒有說明複查拿掉的是否計入 | `selected` ＝列出筆數且含複查拿掉的 | O-26、O-33、O-34、O-15 |
| C-T46-10 | 沒有游標、`PURGE_ORPHAN_MAX_CALLS`；每批 200 個、一次執行一批 | 游標迴圈，一次執行最多 5 次、1,000 個；列出 0 筆即停；游標推進到每次最後一列 | O-9、O-28、O-39、O-42 |
| C-T46-11 | `purgeExpiredAudio` 回 `Result<PurgeStats, AppError>`；log 格式為三組數字（AC-T46-7） | 回 `PurgeRun = { stats, error }`；log 由 handler 寫、每次一行，出錯時尾端加 ` error=<kind> phase=<…>`；`purge` 依賴型別 `(env) => Promise<PurgeRun>`；`purge-audio/handler.ts` 為獨立檔案（`index.ts` 只組裝） | O-18、O-19、O-41；檔案範圍與 AC-T46-7、TC-17 |
| C-T46-12 | 刪前複查失敗：沒有（C-T46-6 已提「不再複查」） | 複查失敗 → 整批不刪、孤兒階段停止、`db_failed` | O-37 |
| C-T46-13 | 範圍沒有 `supabase/tests/t046_orphan_audio_rpc_test.sql`；AC-T46-10 的 pgTAP 只涵蓋 bucket、policy、cron | 新增該檔：兩支 RPC 的權限、`security definer`、`search_path`、`22023`（必做）與列出函式行為（盡力做） | O-26、O-33、O-34 |


### v1.18 之後仍待釐清
目前沒有新的待釐清項（Q5、Q6 已於 v1.18 解決）。任務單落後見上一節，不擋本文件，但 T-046 派工前須出 v1.4。

