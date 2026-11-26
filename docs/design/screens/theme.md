# 主題切換（淺色／深色／跟隨系統）｜AC-27～AC-29（PRD v1.3）
- 入口：每頁右上頭像 →「帳號與外觀」。手機＝底部 sheet；電腦＝右上 popover。D2b 設定頁放同一個控制項；`system.html` 頁首也有一份。
- 控制項：三段 `.seg`，順序 淺色（太陽）／深色（月亮）／跟隨系統（半圓），預設跟隨系統。每格 ≥48px。
- 即時說明：「跟隨系統，現在是淺色。只存在這台裝置。」手動時：「現在是深色。只存在這台裝置。」
- 切換：立即套用，無轉場動畫（避免顏色過渡，ADR-014 只准 transform/opacity）。
- 技術對齊：見 `DESIGN.md` §9（ADR-014：`localStorage['ec-theme']`、`data-theme`、theme-color）。
- 截圖：`shots/theme-switch-mobile-360-{light,dark}.png`、`shots/theme-switch-desktop-1280-{light,dark}.png`。
