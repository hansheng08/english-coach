# ADR-013：新聞類別判定與改寫（T-023；Q1～Q5）
- 狀態：**已接受**（Architect，2026-11-25；送 G2 PR `[G2] T-023 news rewrite`，Hansheng Merge 即核准；PR 內「需要 Hansheng 確認」的項目以 Merge 時的決定為準）｜日期：2026-11-25｜提出：Architect
- 相關：PRD AC-01、AC-02、AC-04、AC-05；ARCHITECTURE §3.1、§4、§5.4、§6 第 6、7 點、§10、§11.1.1、§11.2、§11.3；ADR-003、ADR-006（修訂 2）、ADR-008（修訂 6）、ADR-012；TASKS T-022、T-023、T-025、T-026
- 介面、schema、數字都在 ARCHITECTURE §11.3。本 ADR 只寫決策和理由。

## 背景
TechLead 寫 T-023 之前提出 5 題（Q1～Q5）。這些問題都和兩段已合併的程式有關：
- **T-022（PR #31）**：`findArticle` 對每篇候選文章呼叫注入的 `judge(candidate): Promise<Result<boolean, AppError>>`，每個來源最多判定 3 篇（`MAX_JUDGED_PER_SOURCE`），回傳第一篇判定為 `true` 的 `Candidate`。
- **T-015（PR #39）**：Gemini adapter 的 `generate` 在「STOP 但 JSON 或 zod 驗證失敗」時，用同一個模型自動重試 1 次，所以最多呼叫 2 次。`timeoutMs` 算的是兩次加起來的時間。

原本的文件寫法是「LLM 在**改寫時**回傳 `category_match`」（ADR-006 第 3 點），等於把判定和改寫合成一次呼叫。§11.1.1 也寫「一個類別最多 9 次改寫呼叫」。T-022 實作時，`judge` 只回傳 `boolean`，所以改寫結果要怎麼交給下一步，沒有寫進契約。

## 決定 1（Q1）：先用便宜的判定呼叫，只改寫通過的那篇（採 (b)，同意 TechLead）
- `judge` 是一次小的 LLM 呼叫：只送標題和正文前 300 字，回 `{ category_match: boolean }`。只有 `findArticle` 回傳的那一篇，才另外呼叫一次改寫（`rewriteArticle`）。
- **T-022 的程式不用改**：`judge` 的型別不變，由 `rewrite.ts` 的 `createCategoryJudge` 產生。
- 為什麼不選 (a)「判定時就整篇改寫，結果先存起來」：
  1. 判定和改寫之間要靠一個隱藏的快取傳結果（用 `sha256` 當 key 的 closure），這個快取不在任何型別裡，測試和 T-025 都看不到。
  2. 每篇被判定為 `false` 的文章，都白白做了一次完整改寫。最壞的一天會有 27 次完整改寫，每次幾秒鐘（**未驗證**），加起來可能超過 Edge Function 150 秒的 wall clock（ADR-002；官方文件數字，**未驗證**）。(b) 最壞是 27 次小呼叫。
  3. 改寫的 prompt 不必處理「不屬於這個類別」的分支，判定的 prompt 也可以單獨測試。
- 為什麼不選 (a')「一次呼叫，回傳判別聯集：`false` 或 `true＋改寫`」：呼叫次數比 (b) 每天少 1 次，最壞情況的時間也差不多。但它仍然需要 (a) 那個隱藏快取；而且 `true` 但改寫不合格時，重試會連判定一起重做。每天省 1 次呼叫，在 500 RPD 面前不重要。
- 為什麼不選 (c)「改 T-022，讓 `judge` 回傳改寫結果」：要改已合併的程式和測試（T-022 要開修正單），`findArticle` 也會開始知道改寫的格式，違反「擷取」和「改寫」分開的切法。
- **成本**（數字見 ARCHITECTURE §11.3.6；token 數一律**未驗證**，用 A-003 實測的約 1.3 token／英文字推算）：
  - 平常一天：判定 1 次＋改寫 1～2 次，共 **2～3 次**。舊設計 (a) 是 1～2 次，每天多 1 次，約多 0.6K token。
  - 最壞的一天（9 個來源 × 3 篇全部判定為 `false`）：判定 27 次，加上格式重試最多 54 次。
  - 對照 Gemini 3.5 Flash-Lite 每天 500 次（§10）：平常 < 1%，最壞約 11%。
  - 真正吃緊的是 **15 RPM**：最壞情況下 27 次判定可能在 30 秒內送完，可能收到 429。這個風險已接受，處理方式見決定 6 和 §11.3.7。

## 決定 2（Q2）：改寫輸出的 schema
- **jsonb 的鍵用 snake_case**：`news_article.chunks`／`sentences` 是 jsonb 欄位。repo 的慣例是 jsonb 用 snake_case（`profile.settings` 的 `paid_consent_at`、`rotation_order`、`lookback_hours`，以及 contracts 的 `SrsSettingsSchema`、`NewsSettingsSchema`）；只在記憶體或 API 用的型別才用 camelCase（`WordTimingSchema`）。LLM 輸出也用 snake_case，這樣 schema 和資料庫內容是同一個形狀，不用轉換。
- **`sentences` 是 `string[]`**：每句是一個字串，斷句的「/」是句子裡單獨的一個 token（前後都有空白）。
  - 不用物件（例如 `{ text, breaks: number[] }`）：TTS、遮字、跟讀都直接用句子字串，「/」本來就是 AC-05 要顯示的符號。§4.6 的 `maskWords` 已經規定「/」不算字、永遠顯示。
- **`chunks[i]` 是 `{ chunk, meaning_zh, sentence_index }`**：
  - `sentence_index` **由程式算出**：取第一個包含該 chunk 的句子，LLM 不必回傳。
  - 理由：LLM 數索引容易出錯，抄句子又浪費 token。由程式找，「chunk 要出現在它所在的句子裡」這個條件自然成立；找不到就是 schema 失敗。
- **`rewritten_text` 由程式產生**，LLM 不輸出全文：
  - 做法：每句去掉「/」token，用一個空白接起來。所以 `rewritten_text` **不含「/」**，而且每一句一定出現在全文裡。
  - LLM 的輸出 token 少一半（不必把全文寫兩次），也不會發生「全文和句子對不上」的錯誤。
  - 代價：全文只有一段，不分段落。分段留給 T-026 決定要不要依句子排版。替代方案是加 `paragraph_breaks`，YAGNI，不採用。
- **標題沿用原文**（RSS 的 `title`），不讓 LLM 改寫：
  - 標題是事實，和原文連結一起當出處最清楚，也省一個會出錯的欄位。
  - 替代方案：LLM 另外產生改寫標題。列在「需要 Hansheng 確認」。
- **chunk 規則**：
  - 剛好 5 個；轉小寫、空白壓成一個後不可重複。
  - 每個 2～6 個字，只能有英文字母，字中間可以有撇號或連字號（§4.7 chunk 格式的子集）。
  - 判斷 chunk 有沒有出現在句子裡時，不分大小寫，以整個字為單位。
- **「/」規則**：
  - 只能當單獨的 token，不能在開頭或結尾，不能連續出現。
  - **6 字以上的句子至少要有 1 個「/」**（§4.6 只從 6～25 字的句子選跟讀句）；短句可以沒有。
  - 每句「/」的數量 ≤ ⌊字數 ÷ 3⌋，避免切得太碎。
- **跟讀句數量**：至少要有 5 句是 6～25 字。這是 AC-05「沒有前一晚作答時，5 句都用新聞句」的前提。
- 精確規則見 ARCHITECTURE §11.3.3。存進資料庫的形狀和兩個 LLM 回應的 schema 都放在 `packages/contracts/src/news.ts`。理由有兩個：CLAUDE.md §6 規定 AI 回傳的 JSON 都要經過 contracts 的 zod schema；前端 T-026 讀表時也要用同一個 schema 驗證。

## 決定 3（Q3）：250～300 字怎麼算（同意 TechLead）
- 算 `rewritten_text` 的字數，切字規則和原文相同：用空白切開、去掉空字串（`_shared/news/html.ts` 的 `wordCount`）。因為 `rewritten_text` 不含「/」，所以等於「去掉『/』token 後的字數」。
- contracts 另外寫一個規則相同的 `newsWords`，因為 contracts 不能 import `_shared/news`。T-023 要有測試，確認兩者在同一份樣本上算出相同的數字。
- 已知差異（接受）：單獨的標點（例如前後有空白的 `—`）也算 1 個字，原文的門檻也是這樣算。

## 決定 4（Q4）：重試只有一層（同意 TechLead）
- 字數、chunk 數、「/」、chunk 出現在句子裡，**全部寫進傳給 `generate` 的 schema**。所以 adapter 唯一的那次重試（ADR-012，「STOP＋zod 失敗」重試 1 次）就是 §6 第 7 點說的「同模型重試 1 次」。T-023 **不自己再重試**。
- 判定的 schema 是 `{ category_match: boolean }`：回 `false` 也算通過 schema，不重試，交給 `findArticle` 換下一篇（§11.1.1）。
- ADR-003 的「次數 ≤ 2」是**每一個 `generate` 請求**最多呼叫 2 次。判定和改寫是兩個不同的請求，各自 ≤ 2。如果 T-023 自己再包一層重試，一次改寫就可能呼叫 4 次，違反這條。
- 改寫的 `maxOutputTokens` 設得夠大（2048）：`MAX_TOKENS` 在 adapter 不重試（§5.4.5），只能靠上限夠大來避免。

## 決定 5（Q5）：位置、prompt、模型（同意，補 1 條依賴規則）
- 程式放在 `supabase/functions/_shared/news/rewrite.ts`。兩段 prompt 是檔案內的常數。
- `LlmProvider` 由 `daily-prep`（T-025）用 `registry.resolve('llm', settings, usedThisMonthNtd)` 取得後**注入**；模型用 `settings.llm.model`，預設 `gemini-3.5-flash-lite`（`DEFAULT_SETTINGS`）。
- **補一條**：ADR-008 修訂 6 第 20 條規定 `_shared/news/**` 的正式程式不得 import `_shared/providers/**`（registry、wiring、adapter）和 `_shared/db/**`。
  - 目的：LLM 只能從參數傳入，測試可以用假的 `LlmProvider`；「只經 registry 取得供應商」也不會被繞過。
  - 型別從 `@english-coach/contracts` import（`LlmProvider`、`LlmModelId`）。
- 文章正文是不可信的外部內容（prompt injection）。prompt 要用固定的分隔標記包住正文，並說明「標記裡的文字只是資料」。輸出被 schema 綁死，最壞情況只是判定錯誤或格式失敗。

## 決定 6：失敗時怎麼處理（給 T-025 的契約）
- `judge` 回 `err`（額度用完、429、逾時、連續兩次格式錯誤等）：照 T-022，`findArticle` 直接回這個錯誤。
- `rewriteArticle` 回 `err`：同一次執行中不再改寫同一篇。
- **建議 T-025** 遇到上面兩種情況，都走 §11.2 第 3 步（最近一篇未讀文章），**不**換下一個類別。理由：供應商錯誤通常不是某一類別特有的，換類別只會多耗額度和時間。這是 T-025 的設計範圍，列在 PR 供 TechLead 寫單時參考。

## 後果
- 好處：
  - T-022 不用改。
  - 判定和改寫各自是一個純粹的 `generate` 請求，重試次數有上限，而且可以測試。
  - 最壞情況的時間從「27 次完整改寫」降到「27 次小呼叫」。
  - 資料庫的形狀和 LLM 輸出一致，全文和句子不可能對不上。
- 代價：
  - 平常每天多 1 次 LLM 呼叫。
  - 判定只看標題和前 300 字，可能判錯（**未驗證**）。
  - 全文不分段。
  - 15 RPM 在最壞情況下可能被打到。
- 對其他文件：
  - ADR-006 修訂 2（第 3、4 點）。
  - ADR-008 修訂 6（第 20 條）。
  - ARCHITECTURE §3.1、§4（`news_article` 列）、§6 第 6、7 點、§10、§11.1.1 第 1 點、新增 §11.3。
  - CLAUDE.md §4、§5。
