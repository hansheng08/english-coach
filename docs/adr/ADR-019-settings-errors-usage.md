# ADR-019：寫單契約補充（二）（設定錯誤種類、中午素材輸出上限、月上限與本月用量）
- 狀態：**已接受**（Architect，2026-11-28；G2 PR，Hansheng Merge 即核准；「待 Hansheng／PM 決定」以 Merge 時的決定為準）｜日期：2026-11-28｜提出：Architect
- 相關：ARCHITECTURE v1.13 §4.2、§4.14、§4.15.4、§4.15.5、§5.1；ADR-003、ADR-017、ADR-018；TASKS T-020、T-025b；PRD v1.5 NFR-03、Q-07；[D2] #103
- 來源：TechLead 寫 T-020／T-025b 前的契約問題；Designer 在 [D2] #103 問的 `monthly_cap_ntd` 與「本月付費用量」資料來源。

## 決定
1. **不合格的設定一律回 400 `validation`，帶 `issues` 路徑；不新增錯誤種類。**
   - contracts `APP_ERROR_KINDS`（`packages/contracts/src/errors.ts`）沒有、也不新增第三種設定錯誤。§4.2 原先寫的種類改成和 §4.15.2、§5.1.1 body 驗證同一種。
2. **`gemini-3.5-flash-lite` 的輸出上限是 65,536 tokens。** 中午素材維持一次呼叫、`maxOutputTokens: 8192`、不分批。
   - 2026-11-28 查閱官方模型頁（沒有用金鑰測試）：[Gemini API：Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) 寫 Output token limit 65,536；[Vertex AI／Agent Platform 同一模型](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite) 寫 Maximum output tokens 65,536。兩處一致，且 ≥ 8,192。v1.12 的「不確定」作廢。
3. **`monthly_paid_cap_ntd` 可以是 null；合法數字是 ≥ 0 的整數元，目前沒有產品上限。** 這是把既有 schema、migration 和 `grantPaidConsent` 寫清楚，不改需求。
   - null 是未同意時的預設；撤回同意會刪掉這個鍵。`grantPaidConsent` 把 null 當成 `no_consent`；上限 0 會立刻 `monthly_cap_reached`。
   - PRD v1.5 NFR-03：預設每月 NT$0，上限由 Hansheng 訂（Q-07）。Q-07 已決定「由 Hansheng 訂」，建議值 NT$300，但還沒寫進預設值。
   - 同意時是否必填、要不要禁止 0、要不要加產品上限、打開開關時預填 300，待 Hansheng／PM 決定（建議見 ARCHITECTURE §4.15.4）。未決定前，T-020 不收緊 schema。
4. **「本月付費用量」目前沒有金額資料，由 T-020 補最小設計。** 沒有 `api_usage` 表；既有 `provider_call` 不記 token 或金額。
   - T-020 給 `provider_call` 加上 `cost_ntd`、`input_tokens`、`output_tokens`；寫入時用官方單價和匯率常數估算新台幣整數元（**估算，不是實際帳單**）。
   - 「本月」＝台北時區日曆月，從該月 1 日 00:00 起。加總函式 `sumPaidUsageThisMonthNtd` 供 `registry.resolve` 和設定頁共用。
   - 契約：`GET /settings` 與 `POST /settings` 都回 `SettingsResponseSchema`（`settings`、`slotStart`、`paidUsageThisMonthNtd`），放在 contracts `src/settings.ts`。每次請求即時加總，不另做快取。
   - 匯率常數 `USD_TO_NTD` 建議先用 35（偏保守），待 Hansheng 決定。

## 後果
- T-020 寫單時：設定驗證用 `validation`；範圍加上 `GET /settings`、`SettingsResponseSchema`、`provider_call` 加欄、`_shared/billing/estimate.ts`、`_shared/db/paid-usage.ts`、設定頁顯示估算並註明「非帳單」。§4.15.4 的待決若在寫單前還沒定，維持既有 nullable／≥ 0、不設上限。
- T-025b 寫單時：中午素材一次呼叫、`maxOutputTokens: 8192`，不必準備 2 批退路。
- 之後會呼叫 `registry.resolve` 的單（T-021、T-025a、T-025b、T-027、T-030、T-034 等）傳 `sumPaidUsageThisMonthNtd` 的結果，不要自己算或傳 0。
- 設定頁設計稿裡若還寫舊的錯誤種類，由 Designer 在後續 D2 對齊，本 ADR 不改設計稿。

## 參考（2026-11-28 讀取）
- Gemini 3.5 Flash-Lite（Gemini API 模型頁）：https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- Gemini 3.5 Flash-Lite（Vertex AI／Agent Platform 模型頁）：https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite
