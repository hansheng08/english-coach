# OPEN_QUESTIONS：english-coach（v1.2，對應 PRD v1.2 定稿凍結；PR #16 於 2026-11-24 合併）
- 用法：Q-01～Q-10 已於 2026-11-22 12:35 由 Hansheng 決定（幕僚長轉達）。Q-11～Q-13 與種子庫數量已於 2026-11-22 12:54 G1 由 Hansheng 決定（幕僚長轉達）。Q-14～Q-20 已於 2026-11-22 18:46 G2 由 Hansheng 決定；Q-21 已於 2026-11-22 19:45 由 Hansheng 決定。Q-22～Q-24 與 Q-25 已於 2026-11-24 由 Hansheng 以 G1 PR #16 Merge（＝採用建議）決定。Q-01～Q-25 全部已決定，目前沒有待決定的題目；內容與 PRD v1.2 一致。Q-01～Q-13、Q-21～Q-24 提出者為 PM（PRD-001），Q-14～Q-20 提出者為 Architect，Q-25 提出者為 TechLead。

| 編號 | 狀態 | 問題 | 最終答案 | 理由 | 影響 |
|---|---|---|---|---|---|
| Q-01 | 已決定 | 要不要登入？只有一位使用者嗎？ | 要登入；只有 Hansheng 一位使用者，不開放註冊。 | 雲端同步需要辨識身分；單人可省帳號管理。 | AC-23、範圍 |
| Q-02 | 已決定 | 主要驗收裝置？ | Android＋Google Chrome；電腦為輔助。 | Hansheng 決定。 | NFR-01、AC-06、AC-14 |
| Q-03 | 已決定 | 要不要離線使用？ | 這版不做，需連網。 | 每日備料、批改、同步都要連網。 | NFR-06、範圍 |
| Q-04 | 已決定 | 成功指標的基準與目標值？ | 以 App 第 1 週紀錄為基準；目標值照 PRD 第 3 節 M1～M5。 | 沒有現成數據，第 1 週紀錄最一致。 | M1～M5 |
| Q-05 | 已決定 | 口說診斷有哪些維度？ | 文法錯誤、卡頓贅詞、太口語或不精確的簡單字、停頓次數、語速、目標 chunk 是否講出；跟讀另顯示發音分數（只顯示、不擋關）；不評語調與口音。 | 對應卡頓、用字簡單、不精確不專業三個痛點。 | AC-06、AC-15、AC-18 |
| Q-06 | 已決定 | 履歷和錄音的隱私？ | 送 AI 前移除電話、Email、地址；履歷保存到使用者刪除為止；所有錄音（跟讀與晚上作答）保存 90 天後自動刪除，逐字稿、診斷與分數保留。 | 降低外洩風險、控制儲存量，同時保留學習紀錄。 | AC-12、AC-22、NFR-04 |
| Q-07 | 已決定 | 免費額度用完怎麼辦？付費上限？ | 提示並保留錄音，可稍後重送或手動切換；絕不自動改付費；每月付費上限由 Hansheng 訂（建議 NT$300）。 | 避免意外扣款，又不中斷練習。 | AC-25、NFR-03 |
| Q-08 | 已決定 | 課表能不能調整？ | 可調早中晚三個時段的開始時間、可跳過單一步驟；時段內步驟與分鐘數固定（早 30／午 20／晚 30）；不做依表現自動重排。 | 作息會變；自動重排屬範圍膨脹。 | AC-01、F1 |
| Q-09 | 已決定 | 履歷支援哪些格式？ | PDF 和 DOCX，只限英文，一次保留一份（新上傳取代舊的）。 | 涵蓋常見格式，題目來源單一。 | AC-11 |
| Q-10 | 已決定 | 「外商軟體工程師高頻面試與會議 Chunk 種子庫」從哪裡來、誰把關？ | 種子庫 ≥ 600 條（G1 決定，原建議 150 條）；由 AI 產生，G2 前由 Hansheng 抽查 20 條確認可用；中午新卡不足時從此庫補齊。 | 不必授權外部教材，又能保證基本品質。 | AC-07 |
| Q-11 | 已決定 | 每日新聞的來源、內容形式和失敗處理？ | 從 2～3 個公開的科技新聞來源自動取得（來源由 Architect 提名、Hansheng 確認），AI 依原文改寫成 250～300 字並附原文連結，不轉貼全文；當天抓不到時改用最近一篇未讀文章，並在頁面註明。（**已被 Q-16 部分取代**：「2～3 個公開的科技新聞來源」改為三類每日輪替與 Q-16 的來源規則；其餘仍有效。） | 原文長度不一，改寫才能固定 250～300 字並避免轉貼全文的版權問題；失敗時仍維持零準備。 | AC-01、AC-02 |
| Q-12 | 已決定 | 到期舊卡不足 15 張（例如第一週）時怎麼辦？ | 用新卡補滿，維持每天 25 張。 | 中午 15 分鐘固定任務量不變；缺點是前期新卡多、種子庫消耗快。 | AC-07、Q-10 |
| Q-13 | 已決定 | Reviewing 從何時開始？哪些晚上作答算「自然講出」？ | 中午答對 2 次即進 Reviewing，開始 3／7／14 天間隔，在 Reviewing 時忘記就退回 Learning；晚上首答和無稿重答都算偵測範圍。 | 若要等 14 天測試通過才算 Reviewing，前 3 週晚上沒有 Reviewing 卡可引導，Mastered 會延後約 24 天。 | AC-19、AC-20、M2 |

## G2 決定（提出者：Architect，ARCH-001；2026-11-22 18:46 Hansheng 於 G2 決定；依憲章 §1 新增）
| 編號 | 狀態 | 提出者 | 問題 | 最終答案（2026-11-22） | 理由 | 影響 |
|---|---|---|---|---|---|---|
| Q-14 | 已決定 | Architect | AC-10（與 AC-03 的「反白任意詞句看中文」）要求 3 秒內完成 AI 生卡，Gemini 免費層能否可靠做到？ | 依建議：AC-03 維持 3 秒（建卡不等 AI；反白查詢 p95 不保證）。AC-10 改為「3 秒內顯示核心 chunk 並可播放發音；8 秒內（p95）補齊例句與 ≥ 2 個同義替換」。已回寫 PRD v1.1 AC-10。 | 估算 p50 約 1.5 s、p95 約 3.8～9 s（未驗證，ADR-005）。 | AC-03、AC-10 |
| Q-15 | 已決定 | Architect | Gemini 免費層會把送出的內容用於改善 Google 產品，是否接受把去個資的履歷文字、逐字稿送免費層？ | 依建議：接受；錄音不送 Gemini，履歷先在瀏覽器移除電話、Email、地址。 | 官方定價頁免費層標示「Used to improve our products: Yes」。 | NFR-04、Q-06、AC-11、AC-15 |
| Q-16 | 已決定（**與建議不同**） | Architect | 新聞來源怎麼選？ | 新聞分 AI、軟體工程、半導體產業三類，每天輪到一類；當天該類沒有新聞就換下一類（三類都沒有才用最近一篇未讀文章並註明）。只用一般新聞與科技新聞媒體，不用學術來源（撤下 IEEE Spectrum、NIST）；條款禁止 AI 使用的來源一律排除。重新提名：AI＝The New Stack AI 分類（主）、SiliconANGLE AI、MarkTechPost（備）；軟體工程＝SD Times（主）、InfoQ、The New Stack 全站（備）；半導體產業＝Semiconductor Engineering（主）、eeNews Europe、Semiconductor Digest（備）。取代 Q-11「2～3 個來源」的部分。已回寫 PRD v1.1 AC-01、AC-02。 | Hansheng 決定；來源的條款、風險與 RSS 實測見 ADR-006、ARCHITECTURE §11。 | AC-01、AC-02、Q-11 |
| Q-17 | 已決定 | Architect | AC-19「中午答對」是否包含評「猶豫」？ | 依建議：包含（中午評「秒答」或「猶豫」都算答對，累計答對 2 次進入 Reviewing）；在 Reviewing 時評「猶豫」停在同一階間隔、不前進。已回寫 PRD v1.1 AC-19。 | 符合 AC-09「猶豫的間隔不長於秒答」。 | AC-09、AC-19 |
| Q-18 | 已決定（**與建議不同**） | Architect | Reviewing 卡走完 3／7／14 天後還沒 Mastered，下一次間隔多久？ | 預設維持每 14 天一次；但**所有複習間隔都可在設定頁手動調整**：第 1～3 階（預設 3／7／14）、第 3 階之後（預設 14）、忘記後（預設 1 天）。驗證：整數 1～365、各階嚴格遞增、之後間隔 ≥ 第 3 階、忘記後 ≤ 第 1 階；只影響之後的排程。已回寫 PRD v1.1 AC-09、AC-19。 | Hansheng 決定；設計見 ARCHITECTURE §4.2。 | AC-09、AC-19、AC-24、M2 |
| Q-19 | 已決定 | Architect | Supabase 免費專案連續 7 天無活動會被暫停，是否接受？ | 依建議：接受；停用超過一週時，回來在 Supabase 後台手動恢復。 | 免費、不綁卡，不會意外計費（ADR-002）。 | NFR-02、NFR-03、AC-01 |
| Q-20 | 已決定 | Architect | 需要 Hansheng 本人開的帳號與金鑰，以及 Whisper 可能省略贅詞的風險。 | 依建議：同意開 Supabase、Gemini（**沒有連結帳單**的專案）、Groq（免費方案）、Azure（Speech F0）帳號；金鑰由 Hansheng 在自己電腦用 `supabase secrets set` 輸入，不經過對話。贅詞保留程度在 PoC 實測，不足時手動改用 Gemini Transcribe。 | 金鑰不得出現在對話或檔案（憲章 §11、NFR-05）。 | AC-14、AC-15、AC-24、NFR-05、M3 |

## v1.1 定稿時新增
| 編號 | 狀態 | 提出者 | 問題 | 最終答案 | 決定者／日期 | 影響 |
|---|---|---|---|---|---|---|
| Q-21 | 已決定 | PM | 跳過步驟是否算完成／streak？ | 跳過不算完成，當天三個時段都有打開就不中斷 streak。已寫入 PRD v1.1 AC-26。 | Hansheng／2026-11-22 | AC-21、AC-26、M1 |

## v1.2 定稿時新增（G1 PR #16；2026-11-24 G1 PR #16 Merge＝建議；PRD v1.2 已於 PR #16 合併定稿凍結。）
| 編號 | 狀態 | 提出者 | 問題 | 最終答案 | 理由 | 決定者／日期 | 影響 |
|---|---|---|---|---|---|---|---|
| Q-22 | 已決定 | PM | 種子庫 600 條用完之後怎麼辦？（少自己收錄時約第 7～8 週用完，粗估，未驗證） | 第一版不自動補種子；新卡與種子都用完時，先用多出來的到期舊卡補，仍不足就少於 25 張並註明「今天只有 N 張」；中午頁顯示種子庫剩餘條數。2026-11-24 G1 PR #16 Merge＝建議；PRD v1.2 已於 PR #16 合併定稿凍結。 | 第一版只做最必要的；與 ARCHITECTURE v1.4／ADR-011（PR #13 第 5 點）一致；顯示剩餘條數讓 Hansheng 提早多收錄（新聞語塊、晚上升級語塊、手動新增）。 | Hansheng／2026-11-24 | AC-07、T-010 |
| Q-23 | 已決定 | PM | 面試題庫的內容從哪裡來？ | 有履歷題時只出履歷題（被問最少優先）；另由 AI 產生 ≥ 30 題內建題庫（自我介紹／行為題／技術題各 ≥ 10，技術題涵蓋半導體設備系統軟體與 AI 開發應用），Hansheng 抽查 5 題後匯入，只在沒有履歷題時使用。2026-11-24 G1 PR #16 Merge＝建議；PRD v1.2 已於 PR #16 合併定稿凍結。 | 履歷題最貼近實際面試；內建題庫只作沒有履歷時的備援；與 PR #13 第 6、7 點一致。 | Hansheng／2026-11-24 | AC-11、AC-13、T-010、題庫內容單 |
| Q-24 | 已決定 | PM | 字卡到 Mastered 之後怎麼處理？ | Mastered 是終點：不再排入中午複習、不會退回，仍計入儀表板與成長曲線，並可在紀錄中查到。2026-11-24 G1 PR #16 Merge＝建議；PRD v1.2 已於 PR #16 合併定稿凍結。 | 規則最單純，Mastered 數（M2）不會倒退；與 ADR-011（PR #13 第 3 點）一致。 | Hansheng／2026-11-24 | AC-19、AC-20、AC-21、T-009、M2 |

## TechLead 記錄（2026-11-23；依憲章 §1，不要求擁有者修改）
| 編號 | 狀態 | 提出者 | 問題 | 建議答案 | 影響 |
|---|---|---|---|---|---|
| Q-25 | 已決定（PR #16 Merge＝建議） | TechLead | T-009、T-010 v1.1 照 ARCHITECTURE v1.4／ADR-011 寫，其中三點和 PRD G1 PR #16 的 Q-22～Q-24（未合併）綁在一起：①Q-24 Mastered 是終點（T-009 `applyReview` 對 mastered 回 `err`、`markMastered` 設 `dueDate: null`）；②Q-22 新卡與種子都用完時先用第 16 張以後的到期舊卡補、仍不足就少於 25 張（T-010 `selectDailyCards`）；③Q-23 有履歷題時只出履歷題、否則用內建題庫（T-010 `selectTonightQuestion`；題庫**內容**沒有任務單）。 | 照 ARCHITECTURE v1.4 先做，不等 PR #16；PR #16 若採用建議（Merge）則不用改。若 Hansheng 選替代方案（例如 Q-24 替代 A「Mastered 每 60 天複習」），由 Architect 改 ADR-011、TechLead 開修正單（T-009-fix1／T-010-fix1）。PR #16 合併前 TechLead 不寫題庫內容單。**結果（2026-11-24）**：PR #16 Merge＝建議，T-009／T-010 不需修改；題庫內容單受憲章 §0.1 開發暫停令限制，等 O-004 合併後由 TechLead 開單。 | T-009、T-010、之後的題庫內容單、T-025、T-032 |
| Q-26 | 待決定 | TechLead | T-003 `supabase/config.toml` 的 `[auth] enable_signup` 與 Q-01／ARCHITECTURE §7「關閉註冊」衝突：`.github/scripts/db-job-verify.sh`（第 179–195 行）偵測到根目錄 `supabase/config.toml` 後會改用產品設定，並呼叫 `POST /auth/v1/signup` 建測試帳號取 `access_token`（要求 `enable_signup = true`、`enable_confirmations = false`）；若產品設定照 Q-01 設 `false`，PR 的 `db` job 會必敗。 | **方案 A（最快、免改 CI）**：Hansheng／Architect 確認 `supabase/config.toml` 僅供本機與 CI 使用（保留 `enable_signup = true`、`enable_confirmations = false`），正式環境於 G4 在 Supabase 後台關閉註冊並禁用 `supabase config push`。**方案 B（最安全、需 SRE 小改 CI）**：產品 `config.toml` 設 `enable_signup = false`，由 SRE 改 `db-job-verify.sh` 改用本機 Auth Admin API（secret key）建測試帳號再取 token。 | `T-003`、`db` job、`G4` |
| Q-27 | 待決定 | TechLead | T-003 必須把 `supabase/functions` 加入 `pnpm-workspace.yaml` 並安裝已核准的 `@supabase/supabase-js ^2.119.2`，會改動 `pnpm-lock.yaml`；但 `docs/RUNBOOK.md` §3.1 將「新增套件（改 lockfile）」標為**未驗證**（`.claude/settings.json` 把 `pnpm add *` 與裸 `pnpm install` 列入 `ask`，`pnpm install --no-frozen-lockfile` 雖符合 `claude-run-task.yml` `Bash(pnpm install *)` 但尚未在模式 C 實測；另 `.claude/settings.json` deny `Read(**/.env.*)`，寫出 `supabase/functions/.env.example` 後不能 `Read`）。依憲章 v5 §4、§13 不得把未驗證能力當任務單前提。 | **方案 A（最快）**：Hansheng／幕僚長授權 T-003 任務單直接指定以單次 `pnpm install --no-frozen-lockfile` 更新 lockfile，並加憲章第 12 條停下條款（被擋即停下回報、不繞過），同時註明不呼叫 `Read` 讀 `.env.example`。**方案 B（若 Q-26 選方案 B 可併作小 O-005）**：由 SRE 驗證／放行 `pnpm install --no-frozen-lockfile` 與 `Read(**/.env.example)` 並補齊 RUNBOOK 能力表，順帶處理 B-003 與 `adr010-keycheck.sh` 產品化前綴（目前仍寫死 grep `o003-env`）。 | `T-003`、`RUNBOOK.md` §3.1 |
