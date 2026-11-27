# 素材沒備好（D-005，D2b 第 1 批）｜AC-01、ARCH §6 第 5 點、§11.2
原型：`home-prep-pending.html`（準備中）、`home-prep-failed.html`（沒備好）、`news-fallback.html`（改用舊文章）。截圖：`shots/{home-prep-pending,home-prep-failed,news-fallback}-*`。
依據：PRD AC-01（05:00 備好；當天抓不到新聞時用最近一篇未讀文章並註明）；ARCHITECTURE §1（05:00 `daily-prep`，排程失敗時 App 第一次開啟呼叫冪等的 `POST /plan/today` 補做）、§5.0.4 錯誤碼對照表 `plan_not_ready`（「今天的素材沒備好。」＋「重試」，字卡複習照常）、§6 第 5 點降級模式、§11.2 備援順序第 4 步（連舊文章都沒有 → `daily_plan.status=failed`，首頁顯示原因與重試）；**ARCH v1.11 §5.9.1～§5.9.2**（D2b 第 2 批對齊：「準備中」存在、自動輪詢 180 秒、`daily_plan.failure` 與原因句分支）。

## 1. 三種狀態
| 狀態 | 什麼時候 | 焦點卡 | 時段清單 |
|---|---|---|---|
| 準備中 | §5.9.1：`POST /plan/today` 回 `{status:'pending'}`（05:00 排程或另一台裝置正在備料），或自己的 `POST /plan/today` 還沒回來（自己正在備料） | 小標「早上 · 07:30」＋右側呼吸點「準備中」；標題「今天的素材還在準備」；說明「每天 05:00 自動備料。今天的新聞、跟讀句和今晚題目還沒好，好了這裡會換成第一步。」「中午的字卡複習不需要今天的素材。」；狀態列（`role="status"`）「會自動再檢查（每 5 秒一次，最多等 3 分鐘）；還沒好就顯示原因和『重試』。」（D2b 第 2 批：拿掉批次 1 的「重新檢查」按鈕，因為 §5.9.1 定了自動輪詢） | 早上兩步、晚上三步用「等待」點（斜紋圓）＋灰字，不能點；中午一步（字卡複習）照常可點；「隨時可用」面板照常顯示 |
| 沒備好 | §5.9.1：收到 `failed` 後前端自動再呼叫 1 次 `POST /plan/today`，還是 `failed`；或「準備中」等超過 180 秒 | 右側「已自動重試 1 次」；標題「今天的素材沒備好」；「原因」框（`role="alert"`）放 `planFailureMessage(failure)` 的一句話（§5.9.2）；「中午的字卡複習不需要今天的素材，照常可以做。」；金色按鈕「重試」 | 同上；等待步驟的說明改「素材沒備好，重試成功後就能開始」 |
| 改用舊文章 | 今天三類都沒有新文章，`daily-prep` 改用最近一篇未讀文章（AC-01） | 首頁不變（正常的第一步） | — 早上閱讀頁類別列下方加說明框：**今天沒有新文章，這是 11/24 的文章**　AI、軟體工程、半導體產業三類今天都沒有新文章，改用最近一篇還沒讀過的文章。 |

- 「準備中」：收到 `pending` 後每 5 秒再呼叫一次 `POST /plan/today`，最多等到第一次 `pending` 之後 180 秒（§5.9.1）；好了 → 焦點卡換成正常第一步；超過 → 「沒備好」。
- 「重試」呼叫 `POST /plan/today`（冪等）。等待回應時按鈕改「重試中…」、disabled、`aria-busy="true"`；成功 → 焦點卡換回正常第一步；回 `pending` → 回到「準備中」；仍失敗 → 停在「沒備好」，原因更新。
- 「原因」文字（§5.9.2，前端 `error-messages.ts` 的 `planFailureMessage(failure)`；文字由 PM／Designer 寫，Architect 只定欄位）：
  | `failure.error.kind` | 用到的欄位 | 原因句 |
  |---|---|---|
  | `news_unavailable` | — | 「AI、軟體工程、半導體產業三類都沒有新文章，也沒有還沒讀過的舊文章。」（ARCH 例句省略三類名稱；Designer 保留類別名，較具體） |
  | `timeout` | `error.provider`（顯示名稱 §5.9.4）、`timeout_sec` | 「Gemini 超過 60 秒沒有回應。」（秒數來自 `timeout_sec`，不寫死） |
  | 其他供應商錯誤（`quota_exhausted`、`rate_limited`、`unavailable`、`not_configured`…） | `error.kind`、`error.provider`、`error.retryAfterSec` | 照 `errors.md` §2 的範本；沒有 `retryAfterSec` 時照 `errors.md` §3 |
  | `db_failed`、`internal` 等 | `error.kind` | 「發生未預期的錯誤。」 |
  - `failure.step`（news、rewrite、cards、save、internal）不顯示給使用者，只用在紀錄與除錯。
- 晚上的「今晚題目」在 `daily_plan` 裡，所以素材沒備好時晚上第一步也在等待。
- 首頁的「連續」與「Mastered」不受影響，照常顯示。
- 「準備中」的呼吸點在 `prefers-reduced-motion: reduce` 時不動。
- 新元件：`.dot.wait`（等待點：斜紋圓，和「未開始」空心圓、「完成」實心勾用形狀區分）、`.hero .why`（焦點卡上的原因框）、`.note-soft`（一般頁面上的說明框，`sunken` 底）。

## 不確定
1. ~~「準備中」要不要存在、要等多久~~ 已由 ARCH v1.11 §5.9.1 回答：存在（`pending` 或自己正在備料）；每 5 秒輪詢、最多 180 秒，超過顯示「沒備好」。原型拿掉「重新檢查」按鈕、改成自動檢查的說明。
2. ~~`daily_plan.error` 怎麼變成一句話~~ 已由 ARCH v1.11 §5.9.2 回答：新增 `daily_plan.failure jsonb`（step、error、timeout_sec、failed_at），前端 `planFailureMessage` 照上表分支。
3. ~~契約不一致：`SLOT_STEPS.noon`~~ 已解決：PRD v1.5 Q-41 中午只有字卡複習一步，和 ARCH §4.8.3／v1.11 §4.15.4 `SLOT_STEPS.noon = ['cards']` 一致；原型（`home-prep-*`）中午已改成一步，下方加「隨時可用」面板。
4. 素材沒備好時，「新增字卡」（隨時可用，要 AI 生卡）能不能用：原型照常可按，失敗時走錯誤卡 → PM（同 `noon.md` 不確定 2）。
5. 改用舊文章時，跟讀 5 句是否也來自那篇舊文章（應該是，`daily-prep` 同一篇）→ TechLead 確認。
