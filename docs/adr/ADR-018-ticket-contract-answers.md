# ADR-018：寫單契約補充（檢查器套件、CI probe、secret 金鑰例外、計畫失敗、TTS、種子剩餘數、題庫、Groq 訊息比對）
- 狀態：**已接受**（Architect，2026-11-27；G2 PR，Hansheng Merge 即核准；「待 Hansheng 決定」以 Merge 時的決定為準）｜日期：2026-11-27｜提出：Architect
- 相關：ARCHITECTURE v1.12 §4.6、§4.10.1、§4.12.4、§4.12.5、§4.13.1、§4.19、§4.20、§5.7.4、§11.2；ADR-009、ADR-010、ADR-015、ADR-016、ADR-017；TASKS T-021、T-024、T-025a、T-025b、T-033、T-046、T-050、B-004、T-016
- 來源：TechLead 寫單 PR #97 的「待確認問題」第 1～5、8～10 題。**依賴 ADR-017（PR #96）**：本 ADR 的決定 4、5 引用 ADR-017 的 `daily_plan.failure` 和 `settings.tts.voice`。

## 決定
1. **種子庫和題庫的檢查器放在新的 workspace 套件 `@english-coach/seed-data`（`packages/seed-data/`）**，只依賴 contracts、domain；dependency-cruiser 加 2 條規則；不改根目錄 `package.json`（o010 TC-15 不受影響），不加 script。
2. **拿掉 `supabase/config.toml` 和 CI probe 的逐行比對**（AC-T3-1 第一個測試改成檢查產品設定本身）。理由：T-003 之後 CI 直接用根目錄的設定，probe 已經不會被用到。刪除 probe 是 SRE 的 O 單，不擋任何產品單。
3. **secret 金鑰查詢的 `user_id` 規則只有兩個例外**：`audio-purge.ts` 的過期錄音清除、`service-db.ts` 的 `listProfileUserIds`。用測試強制：固定的檔案清單、記錄呼叫的假 client 檢查每個查詢都帶 `user_id`。
4. **`POST /plan/today` 沒有舊文章時回 200＋`failed`＋`failure`（`step: 'news'`、`news_unavailable`）**，作廢 §11.2 的 503；`plan_not_ready` 只留給其他端點。T-025a 從前一晚的 `diagnosis.senior[].text` 讀改寫句，沒有就是 null。
5. **TTS**：預設語音 `azure:en-US-AvaNeural`（＝ADR-017 的 `tts.voice` 預設），請求不帶語音；快取鍵先正規化文字再算雜湊，只有一個函式；`/tts` schema 放 contracts `tts.ts`；文字上限 **1,000 字元**（Azure REST 沒有公開字元上限：不確定；取保守值，因為所有功能都是一句一句念）；定 `audio/player` 的狀態與介面。
6. **種子庫剩餘數放在 `DailyPlan.seedRemaining`**（`daily_plan.seed_remaining`，T-025a 加欄位、寫 null；T-025b 在種子轉卡後計算）。
7. **面試題庫**：JSON 資料檔＋檢查規則 QB1～QB6＋Claude 手寫 migration＋drift 測試＋每批抽 5 題。題目語言和技術題主題清單待 PM。
8. **Groq 每日額度的訊息比對改成完整單字**：片語（`per day`、`audio seconds`）不分大小寫、要有字邊界；縮寫（`RPD`、`ASD`、`ASH`）要大寫、要有字邊界，所以 `hash`、`crash` 不會命中。

## 替代方案
- **根目錄加 `workspace:*` devDependencies**：要改 SRE 的 o010 TC-15，`tooling/` 也會變成可以 import 任何套件，沒有邊界。不採用。
- **SRE 先把新的 function 區塊加進 probe**：probe 沒有被用到，只是讓產品單排隊等 SRE。不採用。
- **secret 金鑰的 `user_id` 用 lint 擋**：lint 看不出一條查詢鏈有沒有帶條件，會誤判。不採用。
- **`/tts` 上限 3,000 字元**：沒有功能需要，又接近 2 MB 單檔上限。不採用；需要時改常數。
- **種子剩餘數讓前端即時查**：要 view 或 RPC，數字也會和當天的計畫對不上。不採用。

## 後果
- T-024、T-050、B-004、T-046、T-025a、T-021、T-033 可以照 v1.12 改單後派工；T-025b 的預設語音問題已解決。
- T-025a 的 migration 再多一欄 `seed_remaining`；`DailyPlan` 多 `seedRemaining`。
- contracts 新增 `tts.ts`、`question.ts`；`evening.ts` 可能由 T-025a 先建。
- T-016 的 AC-T16-6、TC-12 要照新規則改，並加反例。

## 參考（2026-11-27 讀取）
- Azure Speech quotas and limits（TTS：每次最多 10 分鐘音檔、F0 每 60 秒 20 次）：https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits
