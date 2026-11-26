# frontend-design 專案補充（english-coach）

本檔補充官方 `SKILL.md`，由專案撰寫，不屬於上游。有畫面的任務先讀 `SKILL.md`，再讀本檔。

## 優先順序
與 `docs/design/DESIGN.md`、`docs/design/tokens.json`、ARCHITECTURE §9.1、ADR-014 衝突時，一律以後者為準。官方 skill 要你自訂字型或配色的地方，全部不適用。

## 限制
- 不得新發明字型、配色或 token。顏色、字級、間距、圓角、陰影、時間長度只用 `var(--…)`，來源是 `docs/design/tokens.json` 產生的 CSS 變數。
- 字型只用系統字（§9.1.2、Q-35）。不加 Google Fonts、不放字型檔、不新增字型服務。
- 動畫限 CSS `transition`／`@keyframes` 或原生 Web Animations，只動 `transform`／`opacity`，並尊重「減少動態」（§9.1.3，包在 `prefers-reduced-motion: no-preference` 裡）。
- 主題為 `system`／`light`／`dark`（§9.1.4），只經 `ui/theme.ts` 讀寫。
- 不新增動畫函式庫（Framer Motion、GSAP）或 UI 套件（MUI、Tailwind）。
- `docs/design/prototype/` 只當規格參考，不得複製其 JS 或檔案（§15.4）。

## 官方 skill 在本專案的用途
只限三件事：
1. 避免制式的 AI 視覺（千篇一律的版面與裝飾）。
2. 在既有 token 內安排字級階層與留白節奏。
3. 文案語氣。
