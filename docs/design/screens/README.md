# 畫面規格（D2a、D2b 第 1、2 批）
每個畫面：原型檔、用途、手機 360 與電腦 1280 版面、狀態、互動、對應 AC。截圖在 `shots/<畫面>-<mobile-360|desktop-1280>-<light|dark>.png`（跟隨系統、系統為淺／深時拍的完整頁）。

| 規格 | 原型 | 流程 |
|---|---|---|
| [login.md](login.md) | `login.html`；錯誤狀態 `login-empty.html`、`login-server.html`、`login-offline.html` | 登入 → 首頁；登入錯誤 |
| [home.md](home.md) | `index.html` | 首頁今日任務（早／中／晚） |
| [morning.md](morning.md) | `news.html` → `shadow.html` | 早上閱讀 → 跟讀闖關 |
| [noon.md](noon.md) | `review.html` → `review-order.html`；`review-recall.html` → `review-recall-answer.html`（自行回想）；`review-short.html`（模式 B）；`add-card.html` → `add-card-stream.html` → `add-card-ready.html`（或 `add-card-partial.html`）→ `add-card-saved.html` | 中午複習（一步）；今天只有 N 張；新增字卡（隨時可用） |
| [evening.md](evening.md) | `evening.html` → `evening-record.html` → `diagnosis.html` → `retell.html` → `retell-cue.html` → `result.html`；`result-milestone.html`／`-seen`／`-60` | 晚上口說；M2 里程碑 |
| [../pwa.md](../pwa.md) | `notice-offline.html`、`notice-offline-cold.html`、`notice-update.html`、`preview-banner.html`、`preview-banner-unknown.html`、`pwa-icons.html` | 斷線、新版、預覽假資料提示；manifest 與圖示 |
| [prep.md](prep.md) | `home-prep-pending.html`、`home-prep-failed.html`、`news-fallback.html` | 素材準備中／沒備好／改用舊文章 |
| [errors.md](errors.md) | `error-quota.html`、`error-paid-cap.html` | 錯誤卡；免費額度用完、付費上限用完 |
| [dashboard.md](dashboard.md) | `records.html` | 紀錄：儀表板＋打卡日曆 |
| [growth.md](growth.md) | `growth.html`；`log.html` → `log-detail.html` | 紀錄：成長曲線；練習紀錄 |
| [resume.md](resume.md) | `resume-empty.html` → `resume-generating.html` → `resume.html`（`#del` 刪除確認）→ `resume-deleted.html` | 履歷上傳、題目、刪除 |
| [settings.md](settings.md) | `settings.html`；錯誤狀態 `settings-error.html` | 設定：外觀、時段、複習間隔、供應商、付費、新聞輪替、履歷、帳號 |
| [theme.md](theme.md) | 任一頁 `#account`、`system.html` | 主題三段切換 |

- 元件展示：`../prototype/screens/system.html`。D2b 佔位：`later.html`（字卡清單與搜尋）。所有頁的底部分頁／頂部導覽：今天 `index.html`、字卡 `later.html?s=cards`、紀錄 `records.html`、設定 `settings.html`（D2b 第 2 批統一）。
- 共通：手機底部分頁（首頁）或頂部返回列（子頁）；電腦頂部導覽＋右側 rail。右上頭像開「帳號與外觀」。
