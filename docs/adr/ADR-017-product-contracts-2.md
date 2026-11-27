# ADR-017：產品契約第二批（設定、時段、LLM 呼叫、建卡補齊、晚上作答、跟讀計次）
- 狀態：**已接受**（Architect，2026-11-27；G2 PR，Hansheng Merge 即核准；「待 Hansheng 決定」以 Merge 時的決定為準）｜日期：2026-11-27｜提出：Architect
- 相關：PRD v1.5 AC-03～AC-06、AC-10、AC-11、AC-15～AC-18、AC-25、AC-26、Q-36～Q-41；ARCHITECTURE v1.11 §3.2、§4.13、§4.14、§4.15～§4.18、§5.8、§5.9、§6、§9.1.5、§9.3、§10；ADR-003、ADR-004、ADR-005、ADR-012、ADR-016；TASKS T-020、T-025a、T-025b、T-027、T-028、T-030、T-034、T-036、T-038、T-041～T-044、T-047、T-053、A-001
- 來源：2026-11-27 契約缺口稽核（S5、S6、S8～S10 與各單的問題）、D2b（PR #93）Designer 的不確定事項、TechLead 對 `VITE_` 掃描的三個問題、BOARD 的 §9.1.5 候選。

## 背景
第一批 G2（ADR-015、ADR-016）定了語音 adapter、種子庫、複習、備料和中午題目。還沒有契約的部分會擋住設定頁、建卡、手動生卡、晚上診斷、重送、跟讀計次的寫單。PRD v1.5 已經決定時段的預設時間和規則（Q-36～Q-38）與中午的步驟（Q-41），這次照它寫，不改需求。

## 決定
### 設定與時段（§4.15）
1. **`SettingsSchema` 是 `profile.settings` 的完整形狀**，預設值只寫在 schema。鍵名維持現在的平面寫法，只加鍵：`llm.diagnose_model`、`pronunciation.scoring`（「不評分」）、`tts.voice`、`cards.prefetch`、`ui.m2_seen`。每個能力的 `provider` 用各自的 enum，錯的組合存不進去。
2. **修改用 patch**：一般群組逐鍵覆蓋；`srs`、`news` 整組取代；`ui.m2_seen` 取聯集；付費鍵只能經 `set_paid_consent()`；合併後整份再驗證，不合格就什麼都不寫。
3. **`slot_start`** 的預設和規則照 PRD v1.5 Q-36～Q-38。「不重新判定」做在寫入端：`POST /checkins` 收到 `opened` 時用當下的設定判斷是否在時段內，不在就不寫；判定只讀事件。`SLOT_STEPS.noon` 依 Q-41 維持 `['cards']`。

### 建卡補齊（§4.17、§5.8.3）
4. **enrich 由前端在建卡後呼叫**，不依賴「回應後繼續在背景跑」（未驗證）。只補空欄位（SQL `coalesce`），不覆蓋；不產生 TTS。
5. **舊卡和補失敗的卡由 `daily-prep`（T-025b）順手補**：選卡後對缺欄位的卡呼叫一次批次 enrich，寫回卡片，再做中午素材。不另寫一次性補資料程式。
6. **取代 ADR-016 決定 13 的「暫時補例句、不寫回卡片」**：`NoonItemSchema` 刪掉 `temp_example_en`、`temp_meaning_zh`（還沒有任何程式或任務單用到）。當初不寫回的兩個理由（和 T-027 重疊、`ready` 後不改卡片）不再成立：現在兩邊共用同一個寫入函式，而且在 `ready` 之前、只補空欄位。

### 晚上作答（§4.16）
7. **`Diagnosis` 的標記位置用逐字稿的字序號**；`filler` 和統計由 domain 算，LLM 只回 `grammar`、`plain`、Senior 版（每句附對應的原文範圍）、3～5 個升級語塊（必須出現在 Senior 版裡）。
8. **chunk 命中不用 LLM**（修正 §1）。chunk 命中的正規化另外去掉字頭尾的引號，不改 `normalizeWords`；重複字時 `matchedText` 取「命中字數最多 → 最短 → 最早」。
9. **`/retry` 從 `failure.step` 重做**，條件是 `failed`＋`retryable`＋已經過了 `retryAfterSec`；用當下的設定（使用者可以先手動換供應商），不自動換；伺服器不設次數上限。
10. **M2 里程碑記在 `settings.ui.m2_seen`**，跨裝置同步，只加不刪，所以數量回落後再跨過不會再出現（產品行為，待 Hansheng 確認）。

### 跟讀評分（§4.18）
11. **Azure 整個失敗時回錯誤、不解鎖、不自動改用 Groq**；畫面提供「重送」和手動「改用不評分」。「不評分」＝`pronunciation.scoring = false`：用設定的 STT 算正確率和語速比，發音分數是 null。修正 §6 第 5 點的範圍。

### LLM 呼叫與畫面資訊（§5.8、§5.9）
12. **每個 LLM 呼叫一個檔案放在 `_shared/ai/`**，可以機械檢查的規則都放進 schema（批次例外）；手動生卡的串流**一行一個 JSON**，伺服器逐行驗證後馬上轉送，串流不重試；**確認後才建卡**，所以 `CardStreamEvent.done` 拿掉 `cardId`、`POST /cards` 加選填的 `exampleEn`、`synonyms`（contracts 變更，T-034 做）。
13. **`daily_plan` 加 `failure jsonb`**（`step`、`error`、`timeout_sec`、`failed_at`），失敗的 `DailyPlan` 帶它，前端照分支表產生原因句。`pending` 的輪詢改成等到 180 秒（租約時間）。
14. **畫面文字歸前端**（`ui/error-messages.ts`、`ui/provider-labels.ts`，PM／Designer 寫字）；沒有 `retryAfterSec` 時前端照供應商的重置規則算；「付費」標籤看供應商，不看模型。

### 跟唸計次（§9.3）
15. **前端純函式用音量數列計次**（20 ms 一格、背景噪音 ＋10 dB、至少 min(1 秒, 句長 40%)、安靜 700 ms 算一遍），「手動 +1」一直都在；數字全部未驗證，寫成常數。

### 其他
16. **A-001 在 T-034 合併後才開**，不是任何單的前提；標準照 AC-10。
17. **`VITE_` 掃描**：原始碼端改成三個名稱的精確白名單，範圍加上 `index.html`、`vite.pwa.ts`、`playwright.config.ts`（Claude 小單）；建置後的 bundle 另加「變數名稱」掃描（SRE 的 O 單，接在現有 `bundle` job）。
18. **§9.1.5 tokens 解析**補三條：照原文順序（含像整數的鍵）、重複鍵失敗、空物件失敗並帶路徑（T-018-fix3 已實作，這次只是寫進文件）。

## 替代方案
- **「不評分」做成一個新的供應商 ID**：要改 `ProviderId`、`PROVIDER_TIERS`、registry，而且「不評分」不是一家供應商。不採用。
- **Azure 失敗時自動用 Groq 算正確率**：違反 ADR-003「絕不自動改用其他供應商」。不採用。
- **enrich 用 Edge Function 回應後繼續跑**：平台行為未驗證，失敗時使用者也看不到。不採用；以後驗證過可以改，契約不變。
- **保留 `temp_*` 欄位、恆為 null**：沒有相容性需要（沒有程式用到），留著只會被誤用。不採用。
- **時段判定在讀取端用最新的 `slot_start` 重算**：改時間就會改掉今天已經有的結果，違反 Q-37。不採用。
- **`/retry` 設次數上限（例如 5 次）**：AC-25 沒有這個限制；「還沒到 `retryAfterSec` 就擋」已經避免浪費額度。不採用。
- **輪詢維持 6 次（30 秒）**：比備料可能需要的時間短很多。不採用。

## 後果
- 設定頁（T-020、T-047）、建卡（T-027）、手動生卡（T-034）、履歷出題（T-036）、診斷（T-038）、chunk 命中（T-041）、改寫跟讀（T-042）、重送（T-043）、跟讀評分（T-030）、跟唸計次（T-028）可以寫單。
- T-025a 的 migration 多一欄 `daily_plan.failure`；T-025b 多一步批次 enrich。
- contracts 會改：`plan.ts`（`PlanFailureSchema`、`NoonItemSchema` 刪兩欄、`DailyPlan.failed`）、`settings.ts`、新增 `evening.ts`、`shadow.ts`，改 `api.ts`（`CardStreamEvent.done`、`POST /cards` 請求）；domain 新增 `text-rules.ts`、`slots.ts`。
- 多數數字（逾時、token、VAD 門檻、備料時間）是**未驗證**的起始值，寫成常數，量過之後改常數就好。

## 參考（2026-11-27 讀取）
- MDN `AnalyserNode`：https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode
- Vite 環境變數與 HTML 取代：https://vite.dev/guide/env-and-mode
- Supabase Edge Function 限制：https://supabase.com/docs/guides/functions/limits
