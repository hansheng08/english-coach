# ADR-021：T-030 錄音驗證與孤兒清理規則（兼 T-021 工廠／SW 快取）
- 狀態：**已接受**（Architect，2026-11-28；G2 PR，Hansheng Merge 即核准；修訂 1 同日）｜日期：2026-11-28｜提出：Architect
- 相關：ARCHITECTURE v1.15 §4.18.1、§4.12.2.1、§4.12.5、§5.0.4、§5.0.5、§9、§9.1.7；ADR-020；TASKS T-021、T-030、T-046
- 來源：QA 在設計 T-030／孤兒測試案例時提出的待釐清（A1～A16、B1～B8），以及 T-021 的 AC-T21-13／AC-T21-14 與 §9.1.7 的衝突。

## 決定
1. **跟讀 WAV 的時長以實際收到的 `data` 位元組計算。** `durationMs = round(actualDataBytes / 32_000 * 1000)`。檔頭少報或多報（宣告為 `0xFFFFFFFF` 除外）回 400 `validation`（path `audio`），不截斷、不多餘位元組送出。`0xFFFFFFFF` 以實際剩餘計算。先用 `SHADOW_AUDIO_MAX_BYTES`（1 MiB）擋整份 buffer。只接受 16 kHz、單聲道、16-bit little-endian、`audioFormat = 1` 的整數 PCM（`blockAlign = 2`、`byteRate = 32_000`）；`fmt ` 須在 `data` 之前。
2. **0 秒拒收；最短時長 300 ms。** `durationMs < 300` → 400 `validation`，path `audio`。不沿用 §9.3 `minVoicedMs`（那是裝置端計次，且隨參考句變化）。
3. **孤兒列出改走 `storage.objects`，不逐層 `list`。** 時間只看 `created_at`（`timestamptz`）；`created_at < now - 24h`（不含等於）；缺時間不刪；不用路徑裡的日期。沒有對應列＝兩張表都沒有相同 `audio_path`（只 select 該欄）。刪前再查一次以關閉競態。每批最多 200 個物件。列出失敗用既有 `storage_failed`，`op` 新增 `'list'`（不是新 kind；T-046 改 contracts）。
4. **T-021 驗收不改 `login-errors.qa.test.ts`、`app.qa.test.ts`。** 以 AC-T21-14 為準劃定本單範圍；§9.1.7 的過渡改成：改 probe 延到下一張會改 `ApiClient` 並把新方法改回必填的單。
5. **`getAccessToken` 的型別是 `() => Promise<string | null>`。** 未登入回 `null`，不丟例外；需要登入的方法再回 `unauthenticated`。`makeTestApiRuntime` 的預設見 §9.1.7。
6. **SW TTS 快取上限 50 筆、保留 7 天**（§9 已寫的 `maxEntries: 50`、`maxAgeSeconds: 7 * 24 * 60 * 60`）是契約的一部分。AC-T21-13 應補上這兩個數字。

其餘可從既有 ARCH 推得、或屬於寫單文字同步的項目（MIME 大小寫、多餘 key 的 path、`planDate` 先於讀計畫、設定壞掉回 `internal`、`resolve` 失敗不寫 `provider_call` 等）寫進 §4.18.1，細節見該節與本 PR 正文。

## 後果
- T-030：把 `parseWav16kMono`（`packages/contracts/src/audio.ts`）列入範圍並改成決定 1、2；multipart 行為照 §4.18.1。
- T-046：出 v1.3（或同一函式的補單）涵蓋孤兒清理；migration 建 security definer 函式；contracts 為 `storage_failed.op` 加上 `list`；AC-T46-7 的 log 改三組數字。
- T-021：AC-T21-14 維持不改那兩個 qa 檔；建議 AC-T21-13 補 50 筆／7 天；工廠與 `getAccessToken` 照 §9.1.7。
- 不改模型選擇，不改 `DEFAULT_TTS_VOICE`。

## 未採用
- 用檔頭宣告的大小當唯一時長（會被少報繞過 30 秒上限）。
- 把 §9.3 VAD 的 `minVoicedMs` 當成上傳下限。
- 用 Storage JS `list` 逐層走使用者／日期資料夾當主路徑。
- 用路徑內日期或 `updated_at`／`last_accessed_at` 當 24 小時的鐘。
- 列出失敗借用 `op: 'download'` 而不擴充 `op`。
- 在 T-021 驗收時改既有 login／app qa 檔。
- `getAccessToken` 在未登入時丟例外。

## 修訂
1. **2026-11-28（本關卡第 1 次修改，憲章 §10）**：回覆 TechLead 對照任務單後的 7 題。ARCHITECTURE 版本仍為 v1.15。
   1. 確認不新增 `GET /resume`。讀取由 `apps/web/src/api/supabase/` 以使用者身分讀表（§5.1 讀取類既有慣例，§3.1 只允許 `api` 用 supabase-js），RLS 限本人。§4.21 一併改寫。
   2. `recordCall` 本身失敗不改變回應；只 log 一行，格式為 `tts recordCall kind=<AppErrorKind>`，不含文字與路徑。
   3. `review_date` 不加 `default`，必由呼叫端以台北日期傳入；T-032 改 `t004_rls_test.sql` 的 fixture。
   4. 改依 RIFF 逐個走 chunk。時長改用 `data` chunk 的**宣告大小**（`0xFFFFFFFF`＝到檔尾）。`data` 之後的合法 chunk（如 `LIST`／`INFO`）忽略且不送 Azure；無法解析的尾巴、或宣告超過檔尾／不是 `blockAlign` 倍數，回 400。送給 Azure 的只有正規化後的 `fmt`＋`data`，因此少報大小繞不過 30 秒上限。1 MiB 仍先擋整檔。此點修正決定 1 裡「檔頭與實際不符一律 400」的寫法（合法的後續 chunk 不再因此被拒）。
   5. 孤兒列出函式定名 `public.list_audio_objects_for_purge(p_cutoff timestamptz, p_limit integer) returns table(object_name text, created_at timestamptz)`。`security definer`、`set search_path = ''`、物件寫完整 schema 名；`revoke all` from `public, anon, authenticated`，只 `grant execute` 給 `service_role`。
   6. 路徑不用 `like '%…%'`，改用 `bucket_id` 加上 `storage.foldername(name)` 精確比對每一段（跟讀三段、晚上兩段，格式見 §4.12.1）。
   7. §9.1.7 收尾指名 **T-020**（把 T-021 暫時選填的方法改回必填、拿掉 `??`、QA 改兩個 probe）。T-020 尚未派工。若 T-020 比 T-021 先合併，改由 T-021 之後第一張會改到 `ApiClient` 的單做。
