# 畫面規格（D2a）
每個畫面：原型檔、用途、手機 360 與電腦 1280 版面、狀態、互動、對應 AC。截圖在 `shots/<畫面>-<mobile-360|desktop-1280>-<light|dark>.png`（跟隨系統、系統為淺／深時拍的完整頁）。

| 規格 | 原型 | 流程 |
|---|---|---|
| [login.md](login.md) | `login.html` | 登入 → 首頁 |
| [home.md](home.md) | `index.html` | 首頁今日任務（早／中／晚） |
| [morning.md](morning.md) | `news.html` → `shadow.html` | 早上閱讀 → 跟讀闖關 |
| [noon.md](noon.md) | `review.html` → `review-order.html`；`review-short.html` | 中午複習；今天只有 N 張 |
| [evening.md](evening.md) | `evening.html` → `evening-record.html` → `diagnosis.html` → `retell.html` → `retell-cue.html` → `result.html` | 晚上口說 |
| [theme.md](theme.md) | 任一頁 `#account`、`system.html` | 主題三段切換 |

- 元件展示：`../prototype/screens/system.html`。D2b 佔位：`later.html`（字卡／紀錄／設定）。
- 共通：手機底部分頁（首頁）或頂部返回列（子頁）；電腦頂部導覽＋右側 rail。右上頭像開「帳號與外觀」。
