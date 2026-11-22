# ADR-006：每日新聞來源與取得方式（Q-11）
- 狀態：**提議中**（Hansheng 於 G2 確認來源）｜日期：2026-11-22｜提出：Architect（ARCH-001）
- 相關：AC-01、AC-02、Q-11

## 背景
Q-11：從 2～3 個公開科技新聞來源自動取得，AI 改寫成 250～300 字並附原文連結，不轉貼全文；抓不到就用最近一篇未讀文章並註明。主題要屬於半導體設備／軟體工程／AI 應用（AC-02）。需求：官方 RSS 或 API、免費、條款允許或至少不明文禁止這種個人用途。

## 候選比較（RSS 於 2026-11-22 18:0x 台北時間實際抓取）
| 來源 | 主題契合 | 取得方式（實測） | 全文在 RSS？ | 條款重點 | 判斷 |
|---|---|---|---|---|---|
| **IEEE Spectrum** | 半導體、AI、運算（工程師導向） | 官方 RSS，200 OK：`https://spectrum.ieee.org/feeds/topic/semiconductors.rss`、`.../artificial-intelligence.rss`（各 30 則）、總表 `https://spectrum.ieee.org/feeds/feed.rss` | 是（description 約 1,400 字） | IEEE Spectrum 刊物聲明：可為私人用途影印，其他重製或轉載需聯絡編輯（來源：Spectrum PDF，經搜尋摘要，**未驗證**原文）；ieee.org 網站條款頁 403 讀不到（**未驗證**） | **主要** |
| **Semiconductor Engineering** | 半導體製程、設備、EDA、封裝（最貼近「半導體設備」） | 官方 RSS，200 OK：`https://semiengineering.com/feed/`（10 則） | 是（`content:encoded` 約 2,500 字） | 條款：授權「個人、非商業」瀏覽；不得複製網站內容；可為個人用途下載或列印一份並附版權聲明（https://semiengineering.com/terms-of-service/） | **主要**（只存改寫與連結） |
| **NIST News** | CHIPS 半導體、AI 標準與評測、資安 | 官方 RSS，200 OK：`https://www.nist.gov/news-events/news/rss.xml`（40 則） | 否（摘要約 25 字；正文要抓官方頁面） | 「除標示有版權的內容外，NIST 網站資訊視為公開資訊，可散布或複製；請標示出處」（https://www.nist.gov/oism/copyrights） | **主要**（授權最清楚；但半導體／AI 文章不是每天都有） |
| The GitHub Blog | 軟體工程、AI 開發工具 | 官方 RSS，200 OK：`https://github.blog/feed/` | 是（約 900 字） | 部落格內容授權：**未驗證** | 備用 |
| InfoQ | 軟體架構、AI 工程 | 官方 RSS，200 OK：`https://feed.infoq.com/` | 否（約 55 字） | 條款頁存在（https://www.infoq.com/terms-and-conditions/），內容**未驗證** | 備用 |
| MIT Technology Review | AI | 官方 RSS，全文 | 是 | 條款明文：禁止把內容用於建立、訓練、改善任何 AI 系統（2023-09-06 版）；Gemini 免費層會把輸入用於改善產品 | **不建議** |
| EE Times | 半導體產業 | RSS 只有約 34 字摘要 | 否 | 未查 | 不採用（要抓網頁） |

## 決定（建議）
- **主要 3 個**（符合 Q-11 的 2～3 個）：IEEE Spectrum（半導體＋AI 兩個主題 feed）、Semiconductor Engineering、NIST News。
- **備用 2 個**（預設停用，`news_source.enabled=false`）：The GitHub Blog、InfoQ。主要來源失效時由 Hansheng 決定是否啟用。
- 軟體工程主題目前只有備用來源；若 Hansheng 希望三個主題每天平均出現，可把 GitHub Blog 升為主要、NIST 降為備用（G2 決定，見 Q-16）。

## 取得與處理流程（`supabase/functions/_shared/news`）
1. 05:00 備料時，每個啟用來源抓 1 次 RSS（帶 `If-Modified-Since`／`ETag`；User-Agent 寫明 `english-coach personal reader`）。
2. 依主題關鍵字＋發布時間（48 小時內）篩選，排除已讀（原文 SHA-256 去重）。
3. 取正文：RSS 有全文就用 RSS；沒有（NIST、InfoQ）才抓該篇官方頁面，並先檢查 robots.txt。
4. 送 Gemini 改寫成 250～300 字＋標 5 個語塊＋中文＋「/」斷句；**原文只在記憶體中，不寫入資料庫**，資料庫只存改寫、原文連結、標題、來源、雜湊。
5. 頁面顯示「改寫自：<來源名稱>」＋原文連結（AC-02）；NIST 另依其要求標示出處。
6. 全部來源都沒有新文章 → 用最近一篇未讀的已改寫文章，頁面註明「今天沒有新文章，這是 <日期> 的文章」（AC-01）。

## 後果
- 好處：三個來源都有官方 RSS、免費、不需金鑰；實測都能抓到；只存改寫與連結，不轉貼全文。
- 風險（不確定）：Semiconductor Engineering 與 IEEE 的條款只明確允許個人瀏覽／影印，把全文交給 AI 改寫是否在允許範圍內「不確定」（這不是法律意見）。降低風險的作法：單一使用者、不公開、非商業、不保存原文、附原文連結。需 Hansheng 在 G2 接受（Q-16）。
