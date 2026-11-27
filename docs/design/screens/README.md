# 畫面規格（D2a、D2b 第 1 批）
每個畫面：原型檔、用途、手機 360 與電腦 1280 版面、狀態、互動、對應 AC。截圖在 `shots/<畫面>-<mobile-360|desktop-1280>-<light|dark>.png`（跟隨系統、系統為淺／深時拍的完整頁）。

| 規格 | 原型 | 流程 |
|---|---|---|
| [login.md](login.md) | `login.html`；錯誤狀態 `login-empty.html`、`login-server.html`、`login-offline.html` | 登入 → 首頁；登入錯誤 |
| [home.md](home.md) | `index.html` | 首頁今日任務（早／中／晚） |
| [morning.md](morning.md) | `news.html` → `shadow.html` | 早上閱讀 → 跟讀闖關 |
| [noon.md](noon.md) | `review.html` → `review-order.html`；`review-short.html` | 中午複習；今天只有 N 張 |
| [evening.md](evening.md) | `evening.html` → `evening-record.html` → `diagnosis.html` → `retell.html` → `retell-cue.html` → `result.html`；`result-milestone.html`／`-seen`／`-60` | 晚上口說；M2 里程碑 |
| [../pwa.md](../pwa.md) | `notice-offline.html`、`notice-offline-cold.html`、`notice-update.html`、`preview-banner.html`、`preview-banner-unknown.html`、`pwa-icons.html` | 斷線、新版、預覽假資料提示；manifest 與圖示 |
| [prep.md](prep.md) | `home-prep-pending.html`、`home-prep-failed.html`、`news-fallback.html` | 素材準備中／沒備好／改用舊文章 |
| [errors.md](errors.md) | `error-quota.html`、`error-paid-cap.html` | 錯誤卡；免費額度用完、付費上限用完 |
| [dashboard.md](dashboard.md) | `records.html` | 紀錄：儀表板＋打卡日曆 |
| [growth.md](growth.md) | `growth.html`；`log.html` → `log-detail.html` | 紀錄：成長曲線；練習紀錄 |
| [resume.md](resume.md) | `resume-empty.html` → `resume-generating.html` → `resume.html`（`#del` 刪除確認）→ `resume-deleted.html` | 履歷上傳、題目、刪除 |
| [theme.md](theme.md) | 任一頁 `#account`、`system.html` | 主題三段切換 |

- 元件展示：`../prototype/screens/system.html`。D2b 佔位：`later.html`（字卡／設定；紀錄已由 `records.html` 取代）。D2b 第 1 批的新頁底部「紀錄」連 `records.html`；D2a 舊頁仍連 `later.html`，為了不在 G1 期間改動中午畫面，等第 2 批再一起換。
- 共通：手機底部分頁（首頁）或頂部返回列（子頁）；電腦頂部導覽＋右側 rail。右上頭像開「帳號與外觀」。
