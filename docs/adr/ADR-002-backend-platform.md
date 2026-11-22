# ADR-002：後端平台、資料庫與儲存
- 狀態：**提議中**（Hansheng 於 G2 決定）｜日期：2026-11-22｜提出：Architect（ARCH-001）
- 相關：AC-01、AC-12、AC-22、AC-23、AC-25、NFR-02～05、Q-01、Q-06

## 背景
需要：登入（單一使用者）、雲端資料庫（同步 ≤ 60 秒）、檔案儲存（履歷、錄音 90 天）、放金鑰並呼叫 AI 的後端程式、每天定時備料。限制：預設每月 NT$0，**超出免費額度時不能自動計費**（AC-25、Q-07 精神）。

## 選項
| 準則 | A. Supabase Free | B. Cloudflare Workers Free＋D1＋R2＋Access | C. Firebase（Firestore＋Functions） |
|---|---|---|---|
| 登入 | 內建 Auth，可關閉註冊 | Cloudflare Access（Zero Trust）擋在前面，或自寫 | 內建 Auth |
| 資料庫 | Postgres 500 MB＋RLS，SQL 適合統計（成長曲線） | D1（SQLite）5 GB | Firestore（文件型，統計查詢較麻煩） |
| 檔案 | Storage 1 GB | R2 10 GB（啟用 R2 是否必須綁付款方式：未驗證） | Storage（新專案需 Blaze 方案：未驗證） |
| 後端程式 | Edge Functions：每月 50 萬次、CPU 2 s、wall clock 150 s | Workers：每天 10 萬次、**CPU 10 ms**／請求、wall time 不限 | Cloud Functions **需要 Blaze（綁帳單、用量計費）** |
| 定時工作 | pg_cron＋pg_net 呼叫函式 | Cron Triggers（免費 5 個） | Cloud Scheduler（計費） |
| 超量時 | 免費方案不計費，超量限制服務；**7 天無活動暫停專案** | 免費方案超量回錯誤，不計費 | Blaze 依用量計費（可設預算警示，但警示不會自動停） |
| 可選區域 | 東京、首爾、新加坡等（Edge Function 可用 `x-region` 固定） | 自動就近（可能在 Gemini 不支援地區執行：不確定） | 多區 |
| 本機開發 | `supabase start`（Docker）完整模擬 | `wrangler dev` | Emulator Suite |
| AI 熟悉度 | 高 | 高 | 高 |

## 決定（建議）
採用 **A：Supabase Free**，專案區域 **ap-northeast-1（東京）**，Edge Functions 固定東京執行（與 DB 同區，也在 Gemini 支援地區內）。
- 前端靜態檔另放免費靜態託管（Cloudflare Pages 或 GitHub Pages；G4 由 SRE 決定），因為 Supabase Edge Functions 不直接提供 HTML 頁面（官方限制頁：沒有自訂網域時 `text/html` 會被改成 `text/plain`）。
- 每天 05:00（台北）pg_cron 觸發 `daily-prep`；每天 03:00 觸發 `purge-audio`（刪 90 天前錄音）。
- 拒絕 C：後端函式必須綁帳單，與「不自動付費」衝突。
- B 是合格的替代方案；若 Hansheng 偏好不會暫停的平台，可選 B，但 Workers 免費版每請求 CPU 10 ms，對 PDF 以外的工作夠用（I/O 等待不算 CPU），登入需要另外設計。

## 後果
- 好處：Auth、DB、Storage、排程都在同一處，RLS 保護資料；免費方案沒有綁卡，就算程式有 bug 也不會被收費。
- 代價：
  - 7 天沒有活動會暫停（Q-19）；pg_cron 自己的排程是否算「活動」：不確定。
  - Edge Function 冷啟動時間：未驗證（列入 3 秒評估的變數）。
  - 免費方案沒有每日備份（Pro 才有 7 天備份）；MVP 接受，G4 由 SRE 評估是否加定期匯出。
