# ADR-018：寫單契約補充（檢查器套件、CI probe、secret 金鑰例外、計畫失敗、TTS、種子剩餘數、題庫、Groq 訊息比對）
- 狀態：**已接受**（Architect，2026-11-27；G2 PR，Hansheng Merge 即核准；「待 Hansheng 決定」以 Merge 時的決定為準）｜日期：2026-11-27｜提出：Architect
- 相關：ARCHITECTURE v1.12 §4.6、§4.18、§5.1.1、§4.10.1、§4.12.4、§4.12.5、§4.13.1、§4.19、§4.20、§5.7.4、§11.2；ADR-009、ADR-010、ADR-015、ADR-016、ADR-017；TASKS T-021、T-024、T-025a、T-025b、T-033、T-046、T-050、B-004、T-016
- 來源：TechLead 寫單 PR #97 的「待確認問題」第 1～5、8～10 題；第 2 個 commit 加 TechLead 核對 v1.11 的兩題（決定 9、10）。**依賴 ADR-017（PR #96）**：本 ADR 的決定 4、5 引用 ADR-017 的 `daily_plan.failure` 和 `settings.tts.voice`。

## 決定
1. **種子庫和題庫的檢查器放在新的 workspace 套件 `@english-coach/seed-data`（`packages/seed-data/`）**，只依賴 contracts、domain；dependency-cruiser 加 2 條規則；不改根目錄 `package.json`（o010 TC-15 不受影響），不加 script。
2. **拿掉 `supabase/config.toml` 和 CI probe 的逐行比對**（AC-T3-1 第一個測試改成檢查產品設定本身）。理由：T-003 之後 CI 直接用根目錄的設定，probe 已經不會被用到。刪除 probe 是 SRE 的 O 單，不擋任何產品單。
3. **secret 金鑰查詢的 `user_id` 規則只有兩個例外**：`audio-purge.ts` 的過期錄音清除、`service-db.ts` 的 `listProfileUserIds`。用測試強制：固定的檔案清單、記錄呼叫的假 client 檢查每個查詢都帶 `user_id`。
4. **`POST /plan/today` 沒有舊文章時回 200＋`failed`＋`failure`（`step: 'news'`、`news_unavailable`）**，作廢 §11.2 的 503；`plan_not_ready` 只留給其他端點。T-025a 從前一晚的 `diagnosis.senior[].text` 讀改寫句，沒有就是 null。
5. **TTS**：預設語音 `azure:en-US-AvaNeural`（＝ADR-017 的 `tts.voice` 預設），請求不帶語音；快取鍵先正規化文字再算雜湊，只有一個函式；`/tts` schema 放 contracts `tts.ts`；文字上限 **1,000 字元**（Azure REST 沒有公開字元上限：不確定；取保守值，因為所有功能都是一句一句念）；定 `audio/player` 的狀態與介面。
6. **種子庫剩餘數放在 `DailyPlan.seedRemaining`**（`daily_plan.seed_remaining`，T-025a 加欄位、寫 null；T-025b 在種子轉卡後計算）。
7. **面試題庫**：JSON 資料檔＋檢查規則 QB1～QB6＋Claude 手寫 migration＋drift 測試＋每批抽 5 題。題目語言和技術題主題清單待 PM。
8. **Groq 每日額度的訊息比對改成完整單字**：片語（`per day`、`audio seconds`）不分大小寫、要有字邊界；縮寫（`RPD`、`ASD`、`ASH`）要大寫、要有字邊界，所以 `hash`、`crash` 不會命中。
9. **一般模式下缺 `PronScore` 是 `invalid_response`，不是「沒有分數照樣解鎖」**（ARCHITECTURE v1.12 §4.18、§6 第 5 點；TechLead 核對 v1.11 時挑出）：
   - v1.11 §4.18 寫「Azure 有辨識文字、沒有分數 → `pronScore = null`，照樣解鎖」，和 §5.6.2（ADR-015；缺 `PronScore` → `invalid_response`）以及 contracts `score0to100` 不允許 null 互相矛盾。v1.11 會寫成 null，是沿用 v1.0 §6 第 5 點「發音評分失敗 → 仍顯示正確率與語速」的降級描述，沒有對回 §5.6.2；`ShadowResultSchema.pronScore` 可以是 null 本來是給「不評分」模式用的。
   - 採 §5.6.2。PRD v1.5 AC-06 只寫「發音分數不影響解鎖」（分數高低不影響），沒有要求「拿不到分數也要解鎖」；AC-25 要的是「顯示原因、保留錄音、可重送或手動改用其他供應商」，正好是 §4.18「Azure 失敗」分支（重送／改用不評分）。
   - 缺 `PronScore` 時 adapter 回 `invalid_response`，前端走「Azure 失敗」分支；`ShadowResult.pronScore` 只有「不評分」模式是 null。「不評分」模式走 `settings.stt`，不受影響。
   - contracts、T-017（AC-T17-4、TC-7）都不用改。
10. **測試依賴用工廠函式建，新依賴維持必填**（ARCHITECTURE v1.12 §5.1.1）：
   - 起因：T-053 的 QA probe 用字面值寫出完整的 `UserDb`、`RouteDeps`、`DbClient`，任何單加必填欄位都會讓 QA 檔編譯失敗，而 Claude 不能改 QA 檔；T-032 v1.1 改用選填的 `reviewDb` 避開。
   - 不採「新依賴一律選填」：型別就擋不住「忘了接上」，違反「錯的程式寫不出來」。
   - 改成：`_shared/db/test/fakes.ts`（`makeTestDbClient`、`makeTestUserDb`）、`api/test/route-deps.ts`（`makeTestRouteDeps`、`makeTestRouterDeps`），由 Claude 維護；沒覆寫的方法回錯誤；加必填欄位的單同時補預設值；測試（含 QA probe）只傳要覆寫的部分。
   - 過渡：先派工、會改這些介面的單（目前是 T-032）建工廠函式，`reviewDb` 暫時選填；QA 驗收那張單時把兩個 probe 改用工廠函式；合併後下一張改這些介面的單（目前是 T-025a）把暫時選填的依賴改回必填。
   - 憲章 v6 §1.1、§5：QA 寫驗收測試並追加在被驗證的 `task/T-xxx` 分支上；RUNBOOK：`*.qa.test.ts` 是 QA 檔，`test/` 裡的 fake 不是。和這個安排一致。

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
- T-030 的單照 v1.12 §4.18 寫：一般模式缺分數走「Azure 失敗」分支；T-017 不用改。
- T-032 要多建兩個工廠函式檔，`reviewDb` 暫時選填並在 TASKS 註明；T-025a 要把暫時選填的依賴改回必填（前提：QA 改好的 probe 已合併）。
- QA 要把 `checkins-path.qa.test.ts`、`checkins.qa.test.ts` 改用工廠函式。

## 參考（2026-11-27 讀取）
- Azure Speech quotas and limits（TTS：每次最多 10 分鐘音檔、F0 每 60 秒 20 次）：https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits
