# ADR-016：產品單資料契約（種子庫、複習寫入、Storage 與排程、每日備料、中午題目）
- 狀態：**已接受**（Architect，2026-11-27；與 ADR-015 同一個 G2 PR，Hansheng Merge 即核准；「待 Hansheng 決定」以 Merge 時的決定為準）｜日期：2026-11-27｜提出：Architect
- 相關：PRD v1.5（PR #90）AC-05～AC-09、Q-39、Q-40、AC-13、AC-19、AC-22、NFR-01、NFR-04、Q-06、Q-10；ARCHITECTURE §4.10～§4.14、§9.2；ADR-007、ADR-008、ADR-010、ADR-011；TASKS T-021、T-024、T-025、T-030、T-032、T-033、T-036、T-037、T-043、T-045、T-046、T-050
- 來源：TechLead 寫單前的問題、2026-11-27 契約缺口稽核。

## 決定 1～3：種子庫（§4.10）
1. 種子資料放 `supabase/seed-chunks/batch-<n>.json`，由 `tooling/seed-chunks.ts` 的純函式檢查（R1～R8）並產生固定格式的 migration；vitest 比對 JSON 與 migration 逐字一致。不在 run-task 跑 node，也不加 package.json script（`tooling/o010.test.mjs` 固定 scripts）。
2. 每批剛好 100 條（Q-10），跨批正規化後不可重複；標籤只能是 `SEED_TAGS`（清單待 Hansheng 決定）。
3. 第 1 批的抽查樣本用 `mulberry32`（一種很短的決定性亂數演算法：同一個種子永遠產生同一串數字）＋固定種子抽 20 條，結果 commit 成檔、vitest 比對。

## 決定 4～5：`POST /reviews`（§4.11）
4. 一次評分＝一個 SQL 函式 `record_card_review`（鎖卡、比對、更新卡片、寫評分紀錄在同一個交易）；SRS 計算仍在 TS（`applyReview`）。
5. 同一張卡同一天只能評一次由資料庫保證：`card_review.review_date`（寫入時的台北日期，存成欄位）＋`unique (card_id, review_date)`。說明：`(ts AT TIME ZONE 'Asia/Taipei')::date` 其實是 IMMUTABLE、可以建索引（Postgres 維護者 Tom Lane 的說明），但仍選存欄位：好讀、寫入當下就固定、時區資料更新時不必重建索引。

## 決定 6～8：Storage 與排程（§4.12）
6. 三個 private bucket（`audio`、`tts`、`resume`）都用 migration 建；Storage RLS 只允許本人資料夾；`audio` 不給使用者刪除與修改。
7. TTS 快取鍵是 `sha256(voice + "\n" + text)`，物件不清除；signed URL：TTS 3600 秒、錄音 600 秒；SW 比對時忽略查詢字串。
8. `purge-audio`（台北 03:30）和 `daily-prep`（台北 05:00）各自一個 pg_cron job，用 pg_net 呼叫、Vault 存網址和 secret 金鑰；本機能不能跑**未驗證**，不擋開發。

## 決定 9～10：錄音與更新（§9.2）
9. 錄音中用 `holdUpdatePrompt()` 暫停「有新版」卡片，最後一個 hold 釋放後才顯示。
10. 錄音不分段寫入 IndexedDB，錄完整段寫入；錄音超過 5 分鐘或有遺失回報時重評（影響 T-029）。

## 決定 11～12：每日備料（§4.13）
11. `DailyPlan`、`shadow_items` 元素、`evening_answer.failure` 的 zod schema 放 contracts 新檔 `plan.ts`；`failure` 記錄失敗步驟、錯誤內容、時間、第幾次。重試規則在下一張 G2。
12. 備料並發用主鍵 `insert … on conflict do nothing` 認領＋`claimed_at` 租約（180 秒）＋條件式 update 接手；不用 advisory lock（PostgREST 連線不固定，備料中間有 HTTP 呼叫不能放進交易）。

## 決定 13：中午題目（§4.14；依 PRD v1.5（PR #90，head `4b88c04`）AC-07、AC-08、Q-39、Q-40）
- **題型**：`selectNoonMode`（domain `noon.ts`）依卡片狀態決定：Reviewing 而且模式 B 素材齊全出 B，否則選項素材齊全出 A（選項），否則出 A（自行回想）。「素材齊全」的定義寫在 §4.14.1。
- **素材**：`daily-prep` 選完卡後，一次批次 LLM 呼叫（最多 25 張）產生簡單句、3 個干擾選項、中文情境和語塊切分。挖空句和打散順序用規則產生（打散用固定種子的 mulberry32，保證排出的文字和原句不同）。全部存進 `daily_plan.noon_items`，前端只讀。`card`、`seed_chunk` 不加欄位（撤回 v1.10 初稿的 `plain_en`、`example_zh`）。
- **檢查**：schema 只檢查形狀；內容規則（不含 chunk 的實詞、不等於正解和同義替換、不重複、3～6 塊而且能接回原句）在備料後逐張檢查，不合格的欄位設成 null，那張卡依上面的順序退回。這是 CLAUDE.md §5 第 18 條的例外，因為整批重試會讓 1 張不合格就拖垮 25 張。
- **題幹與順延**：自行回想的題幹依序用簡單句 → 克漏字句 → 中文意思（`recallPrompt`）。備料後仍然沒有例句、也沒有中文意思的卡，`selectNoonMode` 回 `postpone`：當天不排入，卡片的狀態和間隔不動。空出的名額用 `selectDailyCards` 拿掉順延卡後再選一次來補（就是 AC-07 的補卡順序），補位卡不再呼叫 LLM，一律出 A（自行回想）。
- **缺例句或中文意思的卡**：同一次批次呼叫為它暫時產生例句和中文意思，再由這個例句產生其他素材，只存在當天的 `noon_items`。輸出上限從 4,096 提高到 8,192，不分批（最壞 25 張都缺時約 5K tokens，未驗證）。
- **為什麼不寫回卡片**：永久補齊例句和中文意思是 enrich（T-027，第二張 G2）的範圍，寫回卡片會和 T-027 重疊（兩個地方寫同一欄，規則和品質檢查要維護兩份）。而且 `ready` 之後的計畫不該改卡片內容：每日計畫是當天的快照，備料不應該有改動使用者字卡的副作用。在 T-027 之前，daily-prep 每天只為當天中午暫時補上。
- **階段**：LLM 素材和 `shuffleBlocks` 屬 T-025b；T-025a 只用純函式（決定 14）。
- **失敗**：LLM 任何錯誤都不讓備料失敗。計畫照樣 `ready`；有例句或中文意思的卡出 A（自行回想），兩者都沒有的卡順延。
- **替代方案（不採用）**：
  - 用同一天其他卡的 chunk 當干擾選項：那些本身就是專業說法，違反 Q-40。
  - 每 2 個字切一塊：違反 3～6 塊的規定。
  - 存在 `card` 欄位、即時產生：違反「當天素材預先備好」，而且種子卡要手寫 1,200 個欄位。
  - 和新聞改寫合併成一次呼叫：會超過輸出上限，而且一個失敗會拖累另一個。
  - 補位卡再呼叫一次 LLM：每天多 1 次呼叫、多一次失敗機會，時間也更接近 150 秒；補位卡用克漏字句或中文意思出 A 已經符合 AC-08。

- **修訂（2026-11-27，ADR-017 決定 4～6）**：上面「暫時補的例句和中文意思只存在當天、不寫回卡片」與 `temp_example_en`、`temp_meaning_zh` 兩欄由 ADR-017 取代：缺欄位的卡由 enrich 永久補齊、寫回卡片（ARCHITECTURE §4.17）。其他部分不變。

## 決定 14：T-025 拆兩階段（§4.13.3；Hansheng 2026-11-27 決定）
- **T-025a**：備料核心、認領與並發、新聞、選卡（不含種子補位）、跟讀 5 句（`tts_path` 一律 null）、今晚題目、只用純函式產生的 `noon_items`（全部出 A「自行回想」，含順延與補位）、05:00 排程、新欄位 migration。
- **T-025b**：延伸同一個 `preparePlan`，多做種子補位、預先產生 TTS、中午素材 LLM 呼叫。中午素材 LLM 放 T-025b 是幕僚長的決定，理由：首頁要先跑起來，第一階段要簡單、要快。
- **契約在 T-025a 就全部定好**，T-025b 只把原本是 null 的欄位填上：不改形狀、不加欄位、不改 API；認領、「完成」寫入、`ready` 之後不改的規則都不變。
- **第一階段缺東西時**：缺 TTS 由前端呼叫 `/tts` 即時合成（T-021）；缺種子補位時照實際張數（AC-07「今天只有 N 張」）。這兩種情況都不算備料失敗。
- **依賴**：T-026 只依賴 T-025a；T-033 依賴 T-025a 就能做自行回想，選項題和模式 B 的實際素材要等 T-025b。
- **替代方案（不採用）**：T-025b 另開一個 job 或步驟，事後補填已經 `ready` 的計畫。這會打破「`ready` 之後不改」，也要多一套並發規則。

## 後果
- 主線 T-021 → T-025a → T-026 → T-033 的資料形狀都已固定，可以寫單；T-025b 接在 T-025a 之後，不改契約。
- 代價：contracts 新增 `plan.ts` 和 `card.ts` 的種子 schema、資料庫加欄位（`card_review.review_date`、`daily_plan.claimed_at`、`daily_plan.noon_items`）；`daily-prep` 每天多 1 次 LLM 呼叫（§10），都由各自的單在 migration 和 contracts 實作。

## 參考（2026-11-27 讀取）
- Supabase 建立 bucket：https://supabase.com/docs/guides/storage/buckets/creating-buckets
- Supabase 排程 Edge Function（pg_cron、pg_net、Vault）：https://supabase.com/docs/guides/functions/schedule-functions
- Supabase Edge Function 限制：https://supabase.com/docs/guides/functions/limits
- Postgres 日期換算的 volatility（Tom Lane）：https://www.postgresql.org/message-id/1012707.1621880687@sss.pgh.pa.us
