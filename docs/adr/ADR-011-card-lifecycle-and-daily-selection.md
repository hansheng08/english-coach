# ADR-011：字卡生命週期、每日選內容與 chunk 命中的規則
- 狀態：**已接受**（Architect，ARCH-005，2026-11-23；送 G2 PR `[G2] domain 規則補充（T-049/T-009/T-010/T-011/T-013）`，Hansheng Merge 即核准；PR 內「需要 Hansheng 確認」各項以 Merge 視為採用建議預設值）｜日期：2026-11-23｜提出：Architect
- 相關：PRD AC-01、AC-05～AC-09、AC-13、AC-16、AC-18～AC-20；Q-10、Q-12、Q-13、Q-17、Q-18；ARCHITECTURE §4、§4.3～§4.7、§11.2；ADR-004、ADR-008、ADR-009；TASKS §5 第 28 點；T-009、T-010、T-011、T-013、T-049

## 背景
TechLead 寫 domain 純邏輯單時發現 PRD 與 ARCHITECTURE 只寫了數量與箭頭，沒寫選法與邊界（TASKS §5 第 28 點）。domain 不能讀時鐘、不能用 `Math.random`（ADR-008 第 9 條），所以每條規則都必須是「同樣輸入 → 同樣輸出」。PRD 沒有決定、屬於產品取捨的地方，本 ADR 給出預設值並在 PR 列為「需要 Hansheng 確認」；不改需求範圍。

## 決定 1：狀態由 `state` 決定，`correct_count` 只是累計（T-009）
| 選項 | Reviewing 忘記退回 Learning 後 | 評語 |
|---|---|---|
| A. `correct_count` 歸零 | 要再答對 2 次才回 Reviewing | 和 AC-19「累計答對 2 次」字面不符；退回 Learning 卻不是「答對 1 次」的狀態 |
| B. 設成 1 | 再答對 1 次回 Reviewing | 結果同 C，但改寫了歷史數字 |
| **C. 不動（只增不減）＋轉換只看 `state`** | 再答對 1 次回 Reviewing 第 1 階 | 符合「累計」字面；數字可直接當統計用；轉換規則最簡單 |

採用 **C**。完整轉換表在 ARCHITECTURE §4.3。重點：
- 「答對」＝秒答或猶豫（Q-17）；Collected 答對 → Learning；Learning 答對 → Reviewing 第 1 階。
- Learning（以及評「忘記」的 Collected／Learning）下次出現用「忘記後」間隔（`forgot_days`，預設 1＝隔天）。理由：AC-09 的 5 個設定裡只有這個是「短期」間隔，且已驗證 ≤ 第 1 階，所以「Learning 比 Reviewing 先出現」在任何設定下都成立；不新增設定欄位（不擴大 AC-09 範圍）。**需要 Hansheng 確認**。
- Reviewing 忘記 → Learning，回 Reviewing 時從第 1 階重新開始：AC-09 寫「**連續**秒答的卡依第 1～3 階」，忘記打斷了連續。
- 到期日一律從「這次作答的台北日期」起算，不從原本的到期日起算（遲到的複習不會被排得更早）。

## 決定 2：Mastered 是終點，不再排入中午複習（T-009）
- 選項：A. 終點（`due_date = null`，狀態不再改變）；B. 繼續用「第 3 階之後」間隔排程，忘記退回 Learning。
- 採用 **A**，**需要 Hansheng 確認**。理由：AC-20 的「晚上自然講出」是比中午不出聲回想更強的證據；中午舊卡名額只有 15 張，要留給還沒穩定的卡；M2 是「累積」Mastered 數，B 會讓數字倒退、與儀表板的意義衝突。代價：Mastered 的語塊久了可能忘記（MVP 接受；要改走變更路線）。
- `markMastered` 只對 Reviewing 生效；其他狀態回「沒有改變」而不是錯誤（晚上偵測到非 Reviewing 卡的 chunk 很正常）。

## 決定 3：卡片狀態與評分的 zod schema 放 `@english-coach/contracts`（T-009）
- `state`、`rating`、`mode` 與排程欄位會跨網路（`POST /reviews` 的請求、回傳的 `Card`），依 ARCHITECTURE §5.0 原則 2 必須是 zod schema。新增 `packages/contracts/src/card.ts`（內容見 ARCHITECTURE §4.3），用 `state` 做 discriminated union，讓「Mastered 卻有到期日」這類不合法組合在型別與 schema 層就被擋下。
- 完整的 `Card` 回應 schema（`chunk`、`meaningZh` 等）不在 T-009，留給第一張回傳 `Card` 的 API 單。

## 決定 4：每日選內容一律「固定排序＋取前 N」（T-010）
- 每一種選擇（舊卡、新卡、種子、今晚題目、跟讀句、晚上提示 chunk）都寫成「篩選 → 依固定鍵排序 → 取前 N」，最後一個排序鍵一定是 id（字串比較），保證可重現。細節見 ARCHITECTURE §4.4～§4.6。
- 會影響 Hansheng 每天看到什麼、PRD 沒寫的部分（舊卡超過 15 張選哪些、跟讀 3＋2 的比例、題目「最少被問」優先、種子用完時怎麼辦、面試題庫的來源）列為「需要 Hansheng 確認」。

## 決定 5：chunk 命中用「整字＋規則詞形＋小型不規則動詞表＋佔位詞萬用字」，只有完整命中算講出（T-013）
- 不新增字典或 NLP 依賴（ADR-001／CLAUDE.md §5 第 5 點）；不規則動詞用 domain 內的常數表（約 100 個常見動詞）。
- 「部分命中」只顯示（「差一點」），**不加分、不算講出率、不讓卡片變 Mastered**；講出（完整命中）每個 chunk 1 分，所以分數 ÷ 目標數＝講出率，和 `weekly_metric` 同一個定義。**需要 Hansheng 確認**。
- chunk 的文字格式由資料端保證（只含英文字、撇號、連字號、空白與指定佔位詞；不含括號、斜線），種子庫與 AI 產生的 chunk 都要通過同一個 schema 檢查。

## 決定 6：新聞輪替的 `anchor_date` 預設為固定日期 `2026-11-22`（T-049）
- 選項：A. schema 給固定日期；B. 必填，由建立 `profile` 的程式填當天。
- 採用 **A**：`NewsSettingsSchema.parse({})` 能成功、「還原預設」有確定的值、測試不用注入日期；輪替只看日期差，起點選哪天只影響「哪一天是哪一類」。`2026-11-22` 是 G2 通過日（專案正式開工）；這天是 `rotation_order[0]`＝AI，2026-11-23 軟體工程、11-24 半導體產業，依此類推。**需要 Hansheng 確認**（他若希望某一天固定是某一類，可以改這個日期或順序）。

## 後果
- T-009、T-010、T-011、T-013、T-049 的 v1.1 可以照 ARCHITECTURE §4.3～§4.7、§11.2 寫，不用 TechLead 或 Claude Code 自己發明。
- 資料模型小改（ARCHITECTURE §4 `card` 列）：`due_date` 可為 null（新收錄還沒排程、Mastered）；`correct_count` 定義為累計；新增 `seed_chunk_id`（從種子庫轉來的卡，用來判斷種子「用過」）。T-004 尚未執行，直接照新定義做。
- 待其他人處理：面試題庫（`question.source = 'bank'`）的內容來源還沒有任務單；種子庫 600 條在「幾乎不自己收錄字卡」的最壞情況下約第 7～8 週用完（粗估，未驗證），見 ARCHITECTURE §4.4。
