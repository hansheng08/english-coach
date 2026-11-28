# ADR-020：PRD v1.6 對齊與寫單契約補充（三）
- 狀態：**已接受**（Architect，2026-11-28；G2 PR，Hansheng Merge 即核准）｜日期：2026-11-28｜提出：Architect
- 相關：ARCHITECTURE v1.14 §4.12.2.1、§4.15.4、§4.18.1、§4.19、§4.21、§5.0.4、§5.1、§5.9.3、§5.9.4、§9.1.7；ADR-019；PRD v1.6 Q-42～Q-44、AC-10、AC-24、AC-25、AC-26；TASKS T-021、T-030、T-036、T-046、T-035
- 來源：PRD v1.5→v1.6；TechLead 在任務單 PR「For Architect to confirm」提出的五題（ApiClient 工廠、T-030 multipart 與孤兒錄音、T-021 是否寫 `provider_call`、`storage_failed`、T-036 檔名與去個資計數）。

## 決定
1. **前端用工廠函式建立 `ApiClient`，測試不得寫死完整介面。**
   - 正式組成根（`loadApi`／`createApi`）注入 `fetch` 與 token 來源；畫面經 `useApi()` 取得。
   - 測試用 `makeTestApiClient`／`makeTestApiRuntime`（`apps/web/src/api/test/fakes.ts`，Claude 維護），沒覆寫的方法回 `internal`＋`not stubbed: <名稱>`。寫法和 §5.1.1 後端工廠一致：新方法維持必填，由加欄位的單補工廠；過渡期可暫時選填。
   - 禁止：模組載入時就連上正式後端的全域單例被 feature 直接 import；在 `features/**` 元件裡直接 `fetch` 或打產品 API；測試寫完整 `ApiClient` 字面值。
2. **跟讀上傳用 `multipart/form-data`（`audio`＋`meta`）；孤兒錄音由既有 `purge-audio` 在 24 小時後清掉。**
   - `audio`：WAV、`audio/wav`（及 `audio/wave`、`audio/x-wav`）、16 kHz mono 16-bit、≤ 30 s（`parseWav16kMono`）、≤ 1 MiB。`meta`：`{planDate, itemIndex}`（0～4），`planDate` 必須是台北今天。驗證失敗為 400 `validation`，path 為 `audio`／`meta`／`meta.<欄位>`。
   - §9.3 VAD 只在裝置端計次，不是上傳契約。
   - 供應商失敗：不上傳、不寫列。上傳失敗：502 `storage_failed`、不寫列。寫列失敗：500 `db_failed`，物件留給清孤兒。
   - 孤兒＝`audio` bucket 中 `<user_id>/shadow/` 或 `<user_id>/evening/` 底下、沒有對應 `audio_path` 列、且建立已超過 24 小時的物件。沿用 T-046 同一個函式與排程，不另開 job。有列的錄音仍 90 天到期（Q-06）。
3. **T-021 在實際呼叫 `synthesize` 時必須寫 `provider_call`。** 快取命中不呼叫供應商，不寫列。成功或失敗都寫。欄位依 ADR-019（含 `cost_ntd`；Azure F0 估算為 0）。這與 §13 及月上限加總一致，避免之後改用付費 TTS 時用量消失。`registry.resolve` 傳 `sumPaidUsageThisMonthNtd`，不要寫死 0。
4. **Storage 錯誤用既有的 `storage_failed`，不新增 kind。** 已在 `APP_ERROR_KINDS` 與 §5.0.4：HTTP 502、可重試，`op` 為 upload｜download｜delete｜sign。不要改用 `db_failed`。
5. **履歷列存清理後的原始檔名，以及 T-035 的 `PiiCounts`。** `POST /resume` 加 `originalFilename`、`piiRemoved`。檔名只存 basename（上限 200 字元，不送給 LLM）；計數是換掉的項目數（`phone`／`email`／`address`），不是字元數。為了設定頁與履歷卡跨裝置顯示（Designer 畫面稿已要求這兩項）。顯示文案與「是否改成通用檔名」留給 Designer 確認，建議採用畫面稿現有用字、並顯示清理後的原始檔名。

## 後果
- T-021：建 `makeTestApiClient`（若尚未存在）；`/tts` 快取未命中時寫 `provider_call`；Storage 錯誤用 `storage_failed`。
- T-030：multipart 契約照決定 2；供應商失敗不上傳；寫列失敗留下的物件由 `purge-audio` 清。
- T-046：若尚未合併，把孤兒清寫進同一張單；若已派工或已合併，另開一張補在同一個函式，不另排 cron。
- T-036：migration 加 `file_name`、`pii_removed`；contracts 加 `PiiCountsSchema`／`ResumeUploadSchema`（或等價名稱）。
- 不改模型選擇，不改 `DEFAULT_TTS_VOICE`（仍是 `azure:en-US-AvaNeural`）。
- CLAUDE.md §5 第 21 條同步 ApiClient 工廠規則。

## 未採用
- 為前端測試把 `ApiClient` 新方法永久改成選填。
- 為孤兒錄音另開排程或函式。
- T-021 因為 MVP TTS 是免費就不寫 `provider_call`。
- 新增 `storage_failed` 以外的 Storage 錯誤種類。
- 檔名與去個資計數只存在本機、或從畫面拿掉。
