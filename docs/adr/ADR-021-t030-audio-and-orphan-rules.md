# ADR-021：T-030 錄音驗證與孤兒清理規則（兼 T-021 工廠／SW 快取）
- 狀態：**已接受**（Architect，2026-11-28；G2 PR，Hansheng Merge 即核准；修訂 1、修訂 2、修訂 3 同日）｜日期：2026-11-28｜提出：Architect
- 相關：ARCHITECTURE v1.17 §4.18.1、§4.12.2.1、§4.12.5、§5.0.4、§5.0.5、§9、§9.1.7；ADR-020；TASKS T-021、T-030、T-046
- 來源：QA 在設計 T-030／孤兒測試案例時提出的待釐清（A1～A16、B1～B8、N1～N7、M1～M5），以及 T-021 的 AC-T21-13／AC-T21-14 與 §9.1.7 的衝突。

## 決定
1. **跟讀 WAV 依 RIFF 逐個走 chunk；時長以 `data` chunk 的宣告大小計算。** 先用 `SHADOW_AUDIO_MAX_BYTES`（1 MiB）擋整份 buffer。只接受 16 kHz、單聲道、16-bit little-endian、`audioFormat = 1` 的整數 PCM（`blockAlign = 2`、`byteRate = 32_000`）；`fmt ` 須在 `data` 之前。`dataBytes`＝`data` 的宣告大小。宣告超過剩餘位元組、或不是 `blockAlign` 的倍數 → 400 `validation`（path `audio`）。**例外：宣告為 `0xFFFFFFFF` 時，從資料區起到檔尾全部算音訊，不解析後面的 chunk**（即使後面像合法的 `LIST`，那些位元組也當成取樣，計入 `dataBytes` 與時長門檻，進入正規化後的 `data`）；剩餘位元組仍須是 `blockAlign` 的倍數，否則 400。除必備的 `fmt `／`data` 外，其他合法 chunk（無論在 `fmt ` 前、兩者之間、或——僅在 `data` 有宣告大小時——`data` 後）一律忽略。chunk id 的 4 個位元組須為可印 ASCII（`0x20`–`0x7E`），且第一個位元組不可為空白。無法解析的尾巴、或不合法的 id → 400。檔尾可省略最後 1 個奇數 chunk 的 padding 位元組。送給 Azure、寫入 Storage、以及 `Wav16kMono.bytes` 的，都是同一份正規化後的 RIFF／`fmt `／`data`（大小欄與實際 data 一致），因此少報宣告大小繞不過 30 秒上限。
2. **0 秒拒收；最短 300 ms、最長 30 s，門檻用 `dataBytes` 比較，不用四捨五入後的毫秒。** `dataBytes < 9_600` 或 `dataBytes > 960_000` → 400 `validation`，path `audio`。`durationMs = round(dataBytes / 32_000 * 1000)` 只作結果欄位。不沿用 §9.3 `minVoicedMs`（那是裝置端計次，且隨參考句變化）。`parseWav16kMono` 預設下限為 0（上限預設 30 s）；跟讀的 300 ms 下限由 T-030 handler 傳入。
3. **孤兒列出改走 `storage.objects`，不逐層 `list`。** 時間只看 `created_at`（`timestamptz`）；`created_at < now - 24h`（不含等於）；缺時間不刪；不用路徑裡的日期。列出函式是 `public.list_orphan_audio_objects(p_cutoff timestamptz, p_limit integer, p_after_created_at timestamptz default null, p_after_name text default null)`（四個參數），在 SQL 內用 `NOT EXISTS` 排除兩張表已有相同 `audio_path` 的物件後再 `ORDER BY`／`LIMIT`，只回傳孤兒候選。游標必須兩個一起給或一起為 null；只給一個 → `raise exception … errcode '22023'`。`purgeOrphans` 每次執行最多呼叫 `PURGE_ORPHAN_MAX_CALLS = 5` 次，每次的 `p_limit` 等於本次執行的 `limit`（預設 200），游標推進到每次的最後一列；列出 0 筆則不呼叫 `pathsInUse`／`removeObjects` 並停止迴圈。`pathsInUse`（RPC `public.audio_paths_in_use`）只留給刪前複查，以關閉競態。兩張表的 `audio_path` 須有部分索引。列出失敗用既有 `storage_failed`，`op` 新增 `'list'`（不是新 kind；T-046 改 contracts）；複查失敗用 `db_failed`，整批不刪。
4. **T-021 驗收不改 `login-errors.qa.test.ts`、`app.qa.test.ts`。** 以 AC-T21-14 為準劃定本單範圍；§9.1.7 的過渡改成：改 probe 延到下一張會改 `ApiClient` 並把新方法改回必填的單（指名 T-020）。
5. **`getAccessToken` 的型別是 `() => Promise<string | null>`。** 未登入回 `null`，不丟例外；需要登入的方法再回 `unauthenticated`。`makeTestApiRuntime` 的預設見 §9.1.7。
6. **SW TTS 快取上限 50 筆、保留 7 天**（§9 已寫的 `maxEntries: 50`、`maxAgeSeconds: 7 * 24 * 60 * 60`）是契約的一部分。AC-T21-13 應補上這兩個數字。

其餘可從既有 ARCH 推得、或屬於寫單文字同步的項目（MIME 大小寫、多餘 key 的 path、`planDate` 先於讀計畫、設定壞掉回 `internal`、`resolve` 失敗不寫 `provider_call` 等）寫進 §4.18.1，細節見該節與本 PR 正文。

## 後果
- T-030：把 `parseWav16kMono`（`packages/contracts/src/audio.ts`）列入範圍並改成決定 1、2；multipart 行為照 §4.18.1。`audio.test.ts` 裡「宣告大於檔案時截斷」的測試改為預期 400。`parseWav16kMono` 預設下限為 0，不必為了 300 ms 下限去改 `providers/**` 或 `azure-speech.qa.test.ts`。
- T-046：出 v1.3（或同一函式的補單）涵蓋孤兒清理；migration 建 `list_orphan_audio_objects`、`audio_paths_in_use` 與兩張表的 `audio_path` 部分索引；contracts 為 `storage_failed.op` 加上 `list`；AC-T46-7 的 log 改三組數字。T-046 的孤兒清理與 T-030 的 WAV 解析，都要等本規則合併後依新版寫單。
- T-021：AC-T21-14 維持不改那兩個 qa 檔；建議 AC-T21-13 補 50 筆／7 天；工廠與 `getAccessToken` 照 §9.1.7。
- 不改模型選擇，不改 `DEFAULT_TTS_VOICE`。

## 未採用
- 用檔頭宣告的大小當唯一時長、且把宣告之後的所有位元組都送去評估（會被少報繞過 30 秒上限）。
- 檔頭宣告與檔內剩餘不符就一律 400（會誤擋 `data` 後帶合法 `LIST`／`INFO` 的檔）。
- 把 §9.3 VAD 的 `minVoicedMs` 當成上傳下限。
- 用四捨五入後的毫秒和 300／30_000 比較（會讓 299.5 ms 與 30.0000625 s 通過）。
- 用 Storage JS `list` 逐層走使用者／日期資料夾當主路徑。
- 先列出最舊的 200 個物件再於應用層排除有列者（會讓孤兒餓死）。
- 用路徑內日期或 `updated_at`／`last_accessed_at` 當 24 小時的鐘。
- 列出失敗借用 `op: 'download'` 而不擴充 `op`。
- 用 PostgREST GET 的 `audio_path=in.(…)` 做刪前複查（查詢字串可能超過 URL 長度上限）。
- 在 T-021 驗收時改既有 login／app qa 檔。
- `getAccessToken` 在未登入時丟例外。

## 修訂
1. **2026-11-28（本關卡第 1 次修改，憲章 §10）**：回覆 TechLead 對照任務單後的 7 題。ARCHITECTURE 版本仍為 v1.15。
   1. 確認不新增 `GET /resume`。讀取由 `apps/web/src/api/supabase/` 以使用者身分讀表（§5.1 讀取類既有慣例，§3.1 只允許 `api` 用 supabase-js），RLS 限本人。§4.21 一併改寫。
   2. `recordCall` 本身失敗不改變回應；只 log 一行，格式為 `tts recordCall kind=<AppErrorKind>`，不含文字與路徑。
   3. `review_date` 不加 `default`，必由呼叫端以台北日期傳入；T-032 改 `t004_rls_test.sql` 的 fixture。
   4. 改依 RIFF 逐個走 chunk。時長改用 `data` chunk 的**宣告大小**（`0xFFFFFFFF`＝到檔尾）。`data` 之後的合法 chunk（如 `LIST`／`INFO`）忽略且不送 Azure；無法解析的尾巴、或宣告超過檔尾／不是 `blockAlign` 倍數，回 400。送給 Azure 的只有正規化後的 `fmt`＋`data`，因此少報大小繞不過 30 秒上限。1 MiB 仍先擋整檔。此點當時用來修正決定 1 舊文「檔頭與實際不符一律 400」；該舊文已由修訂 2 直接改寫，本點保留為紀錄。
   5. 孤兒列出函式當時定名 `public.list_audio_objects_for_purge(p_cutoff timestamptz, p_limit integer) returns table(object_name text, created_at timestamptz)`。`security definer`、`set search_path = ''`、物件寫完整 schema 名；`revoke all` from `public, anon, authenticated`，只 `grant execute` 給 `service_role`。此名稱已由修訂 2 改為 `list_orphan_audio_objects`。
   6. 路徑不用 `like '%…%'`，改用 `bucket_id` 加上 `storage.foldername(name)` 精確比對每一段（跟讀三段、晚上兩段，格式見 §4.12.1）。
   7. §9.1.7 收尾指名 **T-020**（把 T-021 暫時選填的方法改回必填、拿掉 `??`、QA 改兩個 probe）。T-020 尚未派工。若 T-020 比 T-021 先合併，改由 T-021 之後第一張會改到 `ApiClient` 的單做。
2. **2026-11-28（新分支 `docs/g2-t030-fixes`，升 v1.16）**：回覆 QA 對 #118 的問題。直接改寫決定 1、2、3 本文，消除與修訂 1.4 的矛盾，並納入下列補充（細節見 ARCHITECTURE v1.16）：
   1. **M1**：列出函式更名為 `public.list_orphan_audio_objects`，在 SQL 內用 `NOT EXISTS` 排除有列物件後再 `LIMIT`。`pathsInUse` 不再做初篩，只留給刪前複查。兩張表的 `audio_path` 建部分索引。
   2. **N1**：chunk id 須為可印 ASCII，且首字元不可為空白；全 0 靜音尾巴回 400。
   3. **N2**：時長門檻改用 `dataBytes` 與 9_600／960_000 比較。
   4. **N5**：`fmt `／`data` 以外的合法 chunk，無論位置都允許並忽略。
   5. **N6**：檔尾可省略最後 1 個奇數 chunk 的 padding。
   6. **N7**：`0xFFFFFFFF` 的剩餘位元組仍須是 2 的倍數。
   7. **M3**：刪前複查走 RPC `public.audio_paths_in_use`，不用 GET `in=(…)`。
   8. **N3**（一併裁定）：`parseWav16kMono` 預設下限為 0；300 ms 由 T-030 handler 傳入，以免短測試 WAV 失敗。
   9. **M4**（一併裁定）：`selected` 含因競態拿掉的路徑，`selected >= purged + failed`。
3. **2026-11-28（新分支 `docs/g2-t030-qa-v3`，ARCHITECTURE 升 v1.17；#123 已合併）**：回覆 QA 在 #125（v3 案例）末尾提出的 P2、Q1、Q2、Q3。決定 1、3 的現行文字在實作上以本修訂為準：
   1. **P2**：宣告 `0xFFFFFFFF` 時，從資料區到檔尾全部是音訊，不解析成 chunk；後面接合法 `LIST` 也當取樣（計入長度與門檻、進入正規化輸出）。不回 400，因為沒有宣告長度就分不出音訊與 chunk。仍受 9_600／960_000 位元組與偶數限制，繞不過 30 秒上限。與修訂 2 的 N1、N5～N7 不衝突：那些規則只適用有宣告大小的 `data`。
   2. **Q1**：列出函式加 keyset 游標 `(p_after_created_at, p_after_name)`，每次執行最多呼叫 5 次、游標推進到每次的最後一列，使永遠刪不掉的最舊孤兒只在該次執行被試一次。不存黑名單狀態；超過 1,000 個永遠刪不掉的孤兒時仍會擋住更新的孤兒，列為已知上限，靠 `failed` log 發現。M1（SQL 內排除有列）、M4（`selected` 含複查拿掉的）、M5（不含等於）不變。
   3. **Q3**：刪前複查失敗 → 整批不刪、孤兒階段停止、回 `db_failed`（不新增種類）、不計入 `failed`；log 只含種類與三組數字。
   4. **Q2**：T-046 以 pgTAP 驗證兩支 RPC 的 `anon`／`authenticated`／PUBLIC 無 `EXECUTE`、`service_role` 可執行、`security definer`、`search_path`；檔案 `supabase/tests/t046_orphan_audio_rpc_test.sql`，指令 `pnpm db:test`。
   5. **TechLead 審查後的補充（同修訂，已作為 PR #126 的首個 commit）**：①`purgeExpiredAudio` 回 `PurgeRun = { stats, error }`，stats 永遠有，log 只由 handler 寫、每次執行一行（出錯時尾端加 `error=<kind> phase=<shadow|evening|orphan>`），取代先前草稿的專用 recheck log；②`PurgeDeps` 補 `listOrphanCandidates`、`pathsInUse`，孤兒刪除重用 `removeObjects`，`purgeOrphans` 匯出，`PurgeDbClient` 明確定義；③游標只給一個 → SQL `22023`（函式改 `plpgsql`）；④每次呼叫 `p_limit` 等於本次執行的 `limit`；複查後 0 筆不呼叫 `remove`；⑤pgTAP 權限與行為測試放新檔 `t046_orphan_audio_rpc_test.sql`，並列出未驗證項；⑥`0xFFFFFFFF` 例外寫進 §4.18.1 與 §5.0.5；⑦`parseWav16kMono` 的毫秒參數須為非負整數，否則回 `err`；⑧`fake-fetch.ts`／azure-speech 測試允許但不要求改。
   - 未採用：複查失敗時假設「沒回傳＝沒有列」而照刪（會誤刪剛寫入的錄音）；每天隨機或輪流改排序（結果不可重現、測試難寫）；在資料庫存「刪失敗次數」黑名單表（為少見情況新增狀態與 migration）；`0xFFFFFFFF` 後面猜 chunk 並回 400（會誤擋合法錄音）。
4. **2026-11-28（本關卡第 1 次修改，憲章 §10；PR #126）**：直接改寫決定 1、3 的本文，與現行 ARCHITECTURE v1.17 對齊（先前只寫在修訂註裡，本文仍是舊規則）。決定 1 寫明 `0xFFFFFFFF` 例外（後面不解析成 chunk）。決定 3 寫明四參數游標 RPC、只給一個回 `22023`、`PURGE_ORPHAN_MAX_CALLS`、列出 0 筆即停且不呼叫 `pathsInUse`。其餘本次文字修訂（`index.ts`／handler 分工、`createServiceClient` 只在 `index.ts` 建立、到期步驟的 500 指引、`audio.test.ts` 實為 1 個截斷測試）見 ARCHITECTURE 變更紀錄。
