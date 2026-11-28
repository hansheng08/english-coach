# QA 測試案例設計：孤兒錄音清理（`purge-audio` 的孤兒批次）

- 擁有者：QA｜日期：2026-11-28（台北時間）｜版本：**v3**（依 ARCHITECTURE v1.16 與 ADR-021 修訂 2 更新；v1、v2 皆已合併。**案例編號 O-1～O-31 保持不變**，因為 T-046 v1.3 以編號引用；新增案例接在 O-32 之後）。
- 依據：ARCHITECTURE v1.16 §4.12.2.1、§4.12.2、§4.12.5、§4.18.1（失敗表）、§5.0.4（`storage_failed.op` 新增 `'list'`）、ADR-020 決定 2、**ADR-021（含修訂 2）**、`docs/tasks/T-046.md` v1.3、`docs/tasks/T-030.md` v1.3。
- **ARCHITECTURE v1.16／ADR-021 修訂 2 在 PR #123（尚未合併，head `046c970`）；本文件以該 head 的文字為準。**
- 性質：**派工前的測試案例設計**，不是驗收結論。目前沒有可執行的程式（`audio-purge.ts` 還不存在），所以沒有探針；探針與 `mutants.json` 等實作完成後由 QA 補。


## 這件事在哪一張單？——T-046 v1.3 已涵蓋，但**寫法落後於 ARCHITECTURE v1.15／v1.16**
- 任務單：`docs/tasks/T-046.md` v1.3 已加入孤兒清除（AC-T46-13～15、TC-26～TC-33，以本文件 O-1～O-24 當驗收參考），規格以 v1.14 為準。v1.15（#118，已合併）與 v1.16（#123，未合併）之後，列出方式、`op`、複查、時間欄位都改了，任務單**沒有同步**，兩者衝突見文末「任務單落後」C-T46-1～C-T46-9。
- 因此 QA 的 O-n 案例以 ARCHITECTURE v1.16 為準；T-046 派工前須出 v1.4（含 migration 的兩支函式與兩個部分索引、`PurgeDeps` 新方法、contracts 的 `op: 'list'`、pgTAP）。


## 規格摘要（ARCHITECTURE v1.16 §4.12.2.1、ADR-021 決定 3）
- 孤兒：`audio` bucket 內，沒有任何 `shadow_attempt.audio_path` 或 `evening_answer.audio_path` 與其**完全相同**的物件；只掃跟讀 `<user_id>/shadow/<plan_date>/<檔>`（三段）與晚上 `<user_id>/evening/<檔>`（兩段）。
- **列出**：secret 金鑰呼叫 SQL 函式 `public.list_orphan_audio_objects(p_cutoff timestamptz, p_limit integer) returns table(object_name text, created_at timestamptz)`（`security definer`、`set search_path = ''`、`revoke all … from public, anon, authenticated`、只 `grant execute` 給 `service_role`）。**函式在 SQL 內用 `NOT EXISTS` 排除兩張表已有相同 `audio_path` 的物件，再 `ORDER BY created_at, name` 與 `LIMIT p_limit`**，只回孤兒候選；舊名 `list_audio_objects_for_purge` 作廢。路徑用 `bucket_id = 'audio'` 加 `storage.foldername(name)` 逐段精確比對，不用 `like '%…%'`。`p_limit` 是 200（`PURGE_BATCH_LIMIT`），數的是 **200 個孤兒**。
- **應用層不得再初篩**：不再對列出結果做「有列就拿掉」。
- 時間：只看 `storage.objects.created_at`；`created_at < p_cutoff`（`p_cutoff = deps.now() - 24 h`，**不含等於**）；缺值 → 不進結果（不刪）。
- **刪前複查**：`pathsInUse` 只留給刪除前一次複查，走 RPC `public.audio_paths_in_use(p_paths text[])`（POST 帶陣列，回傳仍在使用的路徑；同樣 `security definer`、只給 `service_role`），**不用** PostgREST GET 的 `audio_path=in.(…)`；已有列的路徑從本批拿掉，不刪。
- **索引**：兩張表的 `audio_path` 各一個部分索引（`where audio_path is not null`），名稱 `shadow_attempt_audio_path_idx`、`evening_answer_audio_path_idx`。
- 統計：在兩張表的到期清理之後跑；即使某一張表的 `listExpired` 回錯，孤兒仍跑，最後回第一個錯誤；`PurgeStats.orphan = { selected, purged, failed }`，**`selected` ＝ 此次列出函式回傳的筆數；刪前複查拿掉的仍計入 `selected`，不計入 `purged` 或 `failed`，所以 `selected >= purged + failed`**；log 三組數字；單批 `remove` 失敗 → `failed`、函式仍 `ok`、HTTP 200；**列出失敗 → 整段 `err`（`storage_failed`、`op: 'list'`），handler 回非 200**。
- 不碰 `tts`、`resume` bucket；刪除只針對 `audio` bucket。


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
| O-9 | 批次 | 250 個孤兒 | 第一次只選／刪 200 個；`selected: 200`；再跑一次剩下 50 個（每批上限 200，與有列的批次各自獨立） |
| O-10 | 順序 | 同時有過期的有列錄音與孤兒 | 先處理有列的過期錄音，再處理孤兒（呼叫順序可由假 deps 的記錄驗證） |
| O-11 | 錯誤 | 孤兒的 `removeObjects` 回 `err` | `orphan.failed` 等於該批數量、`purged` 0；其餘（有列的兩張表）統計不受影響；不丟例外；隔天重跑會再選到同一批（冪等） |
| O-12 | 錯誤 | 孤兒候選的列出（`list_orphan_audio_objects`）回 `err` | 兩張表的到期清理照做；整體結果是 `err`（`storage_failed`、`op: 'list'`），handler 回非 200（502）；`orphan` 沒有部分統計；不丟例外 |
| O-13 | 冪等 | 物件已不存在（兩個 purge 重疊執行、或 `remove` 重送） | `remove` 回 `ok` 就算成功（同 AC-T46-3 的規則），不報錯 |
| O-14 | 競態 | 剛上傳、尚未寫列的物件（建立時間 2 分鐘前，T-030 上傳後到 `insertAttempt` 之間，或晚上流程先上傳再呼叫 `/evening/answers`） | 不刪（24 小時保護，§4.18.1、§4.12.2.1 定義段） |
| O-15 | 競態 | 列出候選之後、`remove` 之前，其中一個物件的列剛好被寫入（假 `pathsInUse` 回含該路徑） | 該路徑從本批拿掉、不刪；`removeObjects` 只收到其餘路徑；**`selected` 仍含被拿掉的路徑**，`purged`、`failed` 都不含它，故 `selected = purged + failed + 被拿掉`，`selected >= purged + failed`；`pathsInUse` 只在列出之後呼叫一次，輸入就是本批路徑 |
| O-16 | 回歸 | 沒有任何孤兒、也沒有過期錄音 | `removeObjects` 0 次；`PurgeStats` 全 0；HTTP 仍是 200 |
| O-17 | 回歸 | 既有的 T-046 TC-6～TC-15（有列的過期錄音） | 加入孤兒批次後行為不變：`shadow`、`evening` 統計與呼叫次數與原本相同 |
| O-18 | 回應 | `PurgeStats` 含 `orphan`；handler 回 200 且 body 與 `PurgeStats` 相同；`orphan.failed > 0` 也是 200 | 同 AC-T46-7 的規則 |
| O-19 | log | handler 的 log | 一行、以 `purge-audio` 開頭；只有數字或錯誤 kind；不含任何物件路徑、`user_id`、檔名（孤兒路徑含 `user_id` 與日期） |
| O-20 | 錯誤訊息 | 列出或刪除失敗的 `AppError.message` | 不含路徑；刪除失敗是 `storage_failed`（`op: 'delete'`）；列出失敗是 `storage_failed`（`op: 'list'`） |
| O-21 | 查詢形狀 | 應用層對資料庫與 Storage 的呼叫 | 列出只呼叫 RPC `list_orphan_audio_objects`（參數 `p_cutoff`、`p_limit`），**不**對 `shadow_attempt`／`evening_answer` 做任何初篩查詢；刪前複查只呼叫 RPC `audio_paths_in_use`（POST 帶 `p_paths` 陣列），**不**出現 `.in('audio_path', …)` 或任何 GET 的 `audio_path=in.(…)`；兩個 RPC 回應只取 `object_name`、`created_at`／`audio_path`；`listExpired` 仍只 select `id`、`audio_path`、`audio_expires_at` 三欄；舊名 `list_audio_objects_for_purge` 不存在（靜態搜尋） |
| O-22 | 端到端（T-030 ↔ purge） | T-030 的寫列失敗情境（TC-12：`uploadAudio` 成功、`insertAttempt` 回 `db_failed`）留下的物件路徑格式 | 路徑格式 `<u>/shadow/<planDate>/<itemIndex>-<uuid>.wav` 屬於上述前綴，會被 O-1 的邏輯認成孤兒；用同一個路徑字串樣本在兩邊的測試裡互相對照，避免格式不一致 |
| O-23 | 靜態 | `tooling/secret-client-scope.test.ts`（T-046 TC-24、TC-25） | 孤兒清理新增的檔案沒有讓 `createServiceClient` 出現在清單外的檔案 |
| O-24 | pgTAP／CI | bucket 對 `authenticated` 沒有 `delete` policy | 使用者身分刪不掉自己的孤兒；刪除只能由 secret 金鑰（§4.12.1 Storage RLS），T-046 的 AC-T46-9／10 已涵蓋，孤兒清理不得新增 `delete` policy |
| O-25 | 路徑形狀 | 候選函式的路徑判定（假列出需模擬 `storage.foldername`；真實判定由 pgTAP 驗證，見 O-26） | `<u>/shadow/<date>/<file>` 與 `<u>/evening/<file>` 才是候選；`<u>/shadow/<file>`（缺日期）、`<u>/shadow/<date>/<x>/<file>`（多一層）、`<u>/evening/<x>/<file>`、`<u>/shadowx/…`、`<u>/foo/shadow/<date>/<file>` 都不是 |
| O-26 | pgTAP（`db` job） | `list_orphan_audio_objects`、`audio_paths_in_use` 的權限與行為 | 兩支函式存在；`security definer`、`search_path` 為空；`anon`、`authenticated`、`public` 沒有 execute，`service_role` 有；在 `storage.objects` 塞入各種路徑與 `created_at`（含剛好等於 `p_cutoff`、`null`）後，`list_orphan_audio_objects` 只回符合路徑形狀、`created_at < p_cutoff` 且**兩張表都沒有同路徑的列**者，排序 `created_at` 再 `name`，`p_limit` 生效；函式內物件都有 schema 名 |
| O-27 | 邊界 | 候選的 `created_at` 為 `null` | 不進結果（pgTAP，函式的 `created_at < p_cutoff` 對 null 不成立）；應用層收到缺 `created_at` 的回應列時也不刪（fail-safe） |
| O-28 | 順序與批次 | 候選孤兒 250 個（時間相同者以 `name` 排序） | 先刪較舊者；第一批剛好 200 個孤兒；順序可重現；隔天接著刪剩下的 |
| O-29 | `p_cutoff` | handler／`purgeExpiredAudio` 傳給列出函式的 cutoff 與 limit | `p_cutoff` 等於 `deps.now() - 24 小時`（固定 `now` 驗證，ISO 字串），不是 `new Date()`；`p_limit` 是 200（`PURGE_BATCH_LIMIT`） |
| O-30 | 獨立性 | 兩張表的 `listExpired` 其中一張回 `err`，且孤兒有可刪的 | 孤兒仍然被刪；最後回第一個錯誤（`err`）；三個階段彼此不短路 |
| O-31 | **不得餓死（starvation）** | 24 小時以前、**有列**的物件很多（例如 250 個，建立時間比孤兒更早），另有 3 個**較新**的孤兒（建立 25 小時前） | 3 個孤兒在**同一次執行**就被刪：(a) pgTAP：`list_orphan_audio_objects(cutoff, 200)` 回傳恰好這 3 個（NOT EXISTS 在 LIMIT 之前）；(b) 單元：假列出直接回這 3 個，應用層不再過濾、`removeObjects` 收到 3 個路徑 |
| O-32 | **列出排除仍有列的物件**（新） | 物件超過 24 小時，且 `shadow_attempt.audio_path` 或 `evening_answer.audio_path`（兩張表各測一次）有**逐字相同**路徑；另有一個只差一個字元的路徑（孤兒） | 有列者**不出現在**列出結果（SQL 內排除，不靠應用層）；只差一個字元者出現；pgTAP 驗證，並確認 `NOT EXISTS` 發生在 `LIMIT` 之前（250 個有列＋3 個孤兒，`p_limit = 200` 仍回 3 個） |
| O-33 | pgTAP | `audio_paths_in_use(p_paths text[])` | 傳入 5 個路徑（2 個在 `shadow_attempt`、1 個在 `evening_answer`、2 個沒有列）→ 只回那 3 個；重複的輸入路徑只回一次（`distinct`）；空陣列 → 空結果；`null` 元素不造成錯誤；`audio_path` 為 null 的列不會被誤匹配；只有 `service_role` 能執行 |
| O-34 | pgTAP | 索引 | 兩個部分索引存在，名稱 `shadow_attempt_audio_path_idx`、`evening_answer_audio_path_idx`，欄位 `audio_path`，述詞 `audio_path is not null`；T-046 migration 不改 T-006 以前的 migration 檔 |
| O-35 | 回歸 | 舊名稱與 GET 查詢不得出現 | 程式與 migration 中沒有 `list_audio_objects_for_purge`；複查沒有 PostgREST GET `in=(…)`（O-21 的靜態版，放在 `tooling` 靜態測試或 `audio-purge.test.ts`） |
| O-36 | 邊界 | 刪前複查的輸入 | 本批 200 個路徑一次送出（單一 RPC 呼叫，不拆成 200 次）；列出 0 筆時**不呼叫** `pathsInUse` 也不呼叫 `removeObjects`；複查回傳全部路徑時，`removeObjects` 0 次、`purged` 0、`failed` 0、`selected` 為列出筆數 |
| O-37 | 錯誤 | 刪前複查（`audio_paths_in_use`）回 `err` | 預期 fail-safe：不刪這批、不當成已刪；其餘階段照常。實際回什麼錯誤（`db_failed`？）、`failed` 要不要計入、HTTP 狀態【待釐清 Q3】 |
| O-38 | 隔離 | 列出函式只回孤兒的「名稱與建立時間」，不回 `user_id` 以外的個資；`audio_paths_in_use` 只回 `audio_path` | 沒有逐字稿、分數、`id`；符合 §4.12.5 的「只做表上寫的事」 |
| O-39 | 邊界 | **毒丸（poison pill）**：最舊的 200 個孤兒反覆刪不掉（假 `removeObjects` 一律回 `err`） | 結果每天相同（最舊的 200 個）、`failed` 為 200；較新的孤兒永遠輪不到——這是 v1.16 排序（`created_at` 升序）的已知後果，**不是缺陷但要被注意**【待釐清 Q1】 |
| O-40 | 邊界 | 兩個前綴共用同一個 200 的額度（SQL 一次呼叫，不分前綴） | 200 個孤兒由 shadow 與 evening 混合決定（依 `created_at`）；與任務單 v1.3「每個前綴各 200、最多 400」不同【任務單落後 C-T46-4】 |

## v1.16 對上一版待釐清（M1～M5）的處理

| 項目 | v1.16 是否解決 | 依據與 QA 的判斷 |
|---|---|---|
| **M1** 列出函式先 `LIMIT` 再於應用層排除有列物件，孤兒約 90 天才清 | **解決（規格層）** | 函式更名 `list_orphan_audio_objects`，SQL 內 `NOT EXISTS` 再 `ORDER BY`／`LIMIT`；應用層不得初篩（O-21、O-31、O-32）。實際效果須由 pgTAP 驗證（O-26、O-32），單元測試的假列出無法證明 |
| **M2** security definer 與 `rpc` 型別轉換 | **部分解決** | 函式權限寫得明確（`revoke`／`grant`）；`p_cutoff` 以 ISO 字串傳入的轉換仍要有測試（O-29） |
| **M3** 複查 200 個路徑的 GET 查詢字串過長 | **解決** | 改走 RPC `audio_paths_in_use(p_paths text[])`（POST）；明禁 GET `in=(…)`（O-21、O-35、O-36） |
| **M4** `selected` 是否含複查拿掉的路徑 | **解決** | `selected` ＝列出函式回傳筆數，含被拿掉的；`selected >= purged + failed`（O-15） |
| **M5** 剛好 24 小時邊界的保留期 | 維持 | 邊界不含等於（O-2）；保留實際約 24～48 小時，與規格一致，QA 接受 |
| 部分索引（v1.16 新增） | 已寫入規格 | O-34 |

## 新的矛盾與待釐清

### 任務單 T-046 v1.3 落後於 ARCHITECTURE v1.15／v1.16（QA 案例以 ARCH 為準；T-046 派工前須出 v1.4）
| # | T-046 v1.3 | ARCHITECTURE v1.16 | 影響的案例 |
|---|---|---|---|
| C-T46-1 | 「只用 Storage 的 list API，不查 `storage` schema」，`listOrphans` 一層一層走（根目錄→使用者→前綴→日期→檔案），每頁 100 筆 | **不要**用 Storage JS `list`；改呼叫 SQL 函式 `list_orphan_audio_objects`（migration 建） | O-21、O-25、O-26、TC-30 整個作廢 |
| C-T46-2 | `PurgeDeps` 用 `listOrphans(prefix, before, limit)`，對兩個前綴各一次 | `PurgeDeps` 加 `listOrphanCandidates`、`pathsInUse`、依路徑刪除；一次列出、不分前綴 | O-40、TC-26、TC-27 |
| C-T46-3 | 24 小時：用 `created_at`，**沒有才改用 `updated_at`**；TC-28 預期「沒有 `created_at` 但 `updated_at` 夠舊」被選為孤兒 | 只看 `created_at`；缺值**不刪**；**不用** `updated_at`、`last_accessed_at` | O-27；TC-28 的第四項與 ARCH 相反（任務單照寫會刪掉 ARCH 要保留的物件） |
| C-T46-4 | 每個前綴最多 200 個孤兒，`selected` 最多 400 | `p_limit` 200 個孤兒（一次呼叫、不分前綴） | O-9、O-28、O-40 |
| C-T46-5 | 有沒有列：對應表 `select audio_path`、帶 `eq('user_id', 路徑第一段)`、用 `in(…)`（GET） | 初篩在 SQL 的 `NOT EXISTS`（不帶 `user_id`）；複查走 RPC `audio_paths_in_use`，**明禁 GET `in=(…)`**；兩者列入 §4.12.5 例外表 | O-21、O-35、AC-T46-14「查詢帶 `user_id`」 |
| C-T46-6 | 「列出與刪除之間才被寫入的列**不再複查**」 | 刪除前**再查一次**，已有列的拿掉 | O-15、O-36 |
| C-T46-7 | list 失敗 → `storage_failed`、`op: 'download'`（暫定，Q-T46-a）；`op` 沒有 `list` | `op` 新增 `'list'`；T-046 改 contracts | O-20、TC-33 |
| C-T46-8 | 有 `err` 時 HTTP 狀態照該錯誤（暫定，Q-T46-b；與 ARCH 的「列出失敗 → handler 非 200」方向一致，可定案）；「一個前綴的 `listOrphans` 回錯時另一個前綴照做」、最後回「孤兒的 shadow 前綴、evening 前綴」的順序 | 孤兒列出只有一次呼叫，沒有前綴之分；三個階段（shadow 表、evening 表、孤兒）彼此獨立，最後回第一個錯誤；`remove` 失敗只算 `failed`（ARCH 明寫函式回 `ok`、HTTP 200），任務單 AC-T46-15 寫「`removeObjects` 失敗 → `storage_failed`」，**是否仍回 `err` 表述不清** | O-11、O-12、O-30 |
| C-T46-9 | 範圍沒有兩支 SQL 函式、兩個部分索引、pgTAP 函式測試；`PurgeStats.orphan` 的 `selected` 只寫「路徑數」，沒有說明複查拿掉的是否計入 | `selected` ＝列出筆數且含複查拿掉的 | O-26、O-33、O-34、O-15 |

### v1.16 本身仍待釐清
| # | 問題 | 影響 |
|---|---|---|
| Q1 | **永遠刪不掉的最舊孤兒會佔住整個額度**：`ORDER BY created_at asc` 加 `LIMIT 200`，若最舊的 200 個孤兒因故一直 `remove` 失敗（例如 Storage 回錯、物件名稱被拒），每天都選到同一批，較新的孤兒永遠輪不到。與 M1 同類但成因不同（失敗而非有列）；規格只說「隔天重試」 | O-39；建議至少 log 失敗數（已有）並讓 G4 實測，或失敗時換順序／略過 |
| Q2 | `audio_paths_in_use` 與 `list_orphan_audio_objects` 都是 `security definer` 且直接讀兩張表（繞過 RLS）；`revoke`／`grant` 寫得明確，但 PostgREST 預設會把 `public` schema 的函式暴露為 RPC，只有 `grant` 擋住 `anon`／`authenticated`；是否需要在 pgTAP 驗證「`anon` 呼叫得到 permission denied」 | O-26、O-33（QA 要求驗證） |
| Q3 | 刪前複查（`audio_paths_in_use`）本身失敗時怎麼辦：ARCH 沒寫。QA 要求 fail-safe（不刪該批），但錯誤種類（`db_failed`）、是否計入 `failed`、整體回 `err` 還是 200 都未定 | O-37 |
| Q4 | ARCH §4.12.5 要求 `audio-purge.ts` 的測試固定 `listExpired` 的三個欄位；新增的兩支 RPC 的「只讀哪些欄位」只寫在文字裡，是否也要用測試固定（O-21、O-38 已列） | 建議寫進 T-046 v1.4 的 AC |
