# ADR-014：前端設計基礎（PR 預覽假資料模式、字型、動畫、主題、token）
- 狀態：**已接受**（Architect，2026-11-26；送 G2 PR `[G2] frontend design`，Hansheng Merge 即核准；PR 內「需要 Hansheng 確認」的項目以 Merge 時的決定為準）｜日期：2026-11-26｜提出：Architect
- 相關：憲章 v7 §15（設計路線、§15.5 預覽、§15.8 響應式、§15.9 UI 檢查）；O-020；Q-35；D1 決定（2026-11-26 18:40 Hansheng：R2-C 夜幕焦點、只用系統字、深色模式＝跟隨系統＋手動切換三態）；ADR-001、ADR-007；ARCHITECTURE §7、§9、§9.1、§12
- 介面與規則在 ARCHITECTURE §9.1。本 ADR 只寫決策和理由。**ADR-001 的依賴清單不變**：本 ADR 的五個決定都不新增套件。

## 背景
Designer 的計畫第 5 步要一份小的 G2 增補，處理五件事：前端 PR 預覽用的假資料模式、字型來源、動畫做法、主題偏好怎麼存、`tokens.json` 怎麼變成 CSS。這五件都會影響 T-018（`apps/web` 骨架）和 T-019（PWA），也會影響 SRE 接前端預覽與 UI 檢查的 O 單。目前的狀態：
- `apps/web` 還不存在。
- `docs/design/tokens.json` 還沒產生（D2a 才會有）。
- `design/style` 分支上的 R2-C 原型已經用 CSS 變數，並用 `prefers-color-scheme` 做深淺色。

## 決定 1：前端 PR 預覽用假資料模式，不連測試用 Supabase
- 前端用建置變數 `VITE_DATA_MODE` 選資料來源，**只能是 `mock` 或 `supabase`，沒有預設值**，沒設或值不對就建置失敗。
  - 前端預覽的 Cloudflare Pages 專案，正式和預覽環境都只設 `VITE_DATA_MODE=mock`，**不設任何 `VITE_SUPABASE_*`**。
- `mock` 模式的做法：
  - `apps/web/src/api` 換成記憶體內的假實作，登入閘門用固定的示範身分，畫面一直顯示「預覽：假資料」。
  - 重新整理就回到初始資料。
  - 用網址參數 `?scenario=` 切換狀態：空狀態、錯誤、備援文章、素材沒備好等。
- 為什麼不連測試用 Supabase：
  1. **沒有測試專案**：Hansheng 2026-11-24 決定不另建 staging 專案（憲章 §0.1），要做就要多一個雲端資源和 G4 核准。
  2. **金鑰與資料的暴露面**：
     - Cloudflare Pages 的 Preview 環境變數會套用到**所有**預覽分支的建置（官方 Build configuration 與 Bindings 頁），連到 Supabase 就等於每個 PR 的程式（還沒驗收的）都能拿 Hansheng 的登入狀態讀寫資料。
     - publishable 金鑰本身可以公開，安全靠 RLS。但 RLS 擋的是「別人的資料」，擋不住「自己的 PR 程式寫壞自己的資料」。
  3. **登入轉址**：每個預覽網址都是不同的子網域，Supabase Auth 的 Redirect URLs 要加 `https://*.<專案>.pages.dev/**` 這種萬用字元。官方說明萬用字元以 `.`、`/` 為分隔，並建議正式環境用精確網址。雖然有 Access 保護，還是多一個要維護、會放太寬的設定。
  4. **資料重設**：多個 PR 預覽共用同一份資料，彼此干擾，沒有乾淨的重設方式。假資料重新整理就重設。
  5. **測試重用**：
     - 憲章 §15.9 的截圖比對要在 CI 的 Linux 環境產生固定的基準圖，畫面資料必須固定，假資料模式剛好是同一套。
     - axe、48 px、360 寬的檢查也可以直接跑在 `mock` 建置上，不需要後端。
- 範圍界線：要走到後端的 AC 級 E2E，照 TASKS 原本的寫法，用 `supabase start`＋假供應商，不用 `mock` 模式。`mock` 只負責「看畫面」。
- 正式環境（G4）用 `VITE_DATA_MODE=supabase`，部署方式仍由 SRE 在 G4 決定（§13）。正式建置**不得包含** mock 程式和假資料，假資料模式的建置也**不得包含** Supabase 網址，兩者都由 CI 掃描 `dist/` 檢查。
- 之後如果建了正式免費 Supabase 專案，要不要開一個「連真資料的預覽」，另外決定（ARCHITECTURE §9.1.6 不確定 U-1）。

## 決定 2：字型只用系統字，不新增字型依賴（Q-35 結案）
- D1 選的 R2-C 只用系統字堆疊，所以**不打包字型、不用字型服務**（Google Fonts 等），ADR-001 的依賴清單不變。
- 理由：
  - 少一個需要授權、版本、子集化和快取的資產，也不影響 §8 首屏 JS ≤ 200 KB 的預算。
  - Designer 實測 Hansheng 的 Android Chrome 實際顯示 Roboto＋Noto Sans CJK TC，截圖就是實際看到的樣子。
  - 高級感照 D1 的方向，靠間距、層次、字級、配色來做。
- 字型堆疊是 token（`--font-sans`），值以 Designer 的 `tokens.json` 為準。ARCHITECTURE §9.1.2 寫的是目前原型的值。
- 數字用 `font-variant-numeric: tabular-nums`，讓數字寬度一致。
- 不採用的替代方案：自己放 woff2（約 20 KB／字重）。只有回頭選 round 1 的方向才需要，已經不適用。

## 決定 3：動畫只用 CSS，尊重「減少動態」
- 只用 CSS `transition`／`@keyframes`。需要用 JS 控制時，用瀏覽器原生的 Web Animations API（`element.animate`）。**不加動畫函式庫**（Framer Motion、GSAP、react-spring 等）。
- 理由：
  - 原型用到的動態（進度生長、淡入、焦點呼吸、按壓）全部是 CSS 寫的，D1 的方向也是「克制的動態」。
  - 動畫函式庫會吃掉首屏預算，也違反 ADR-001「不加 UI 框架」的精神。
- 所有非必要的動態，都包在 `@media (prefers-reduced-motion: no-preference)` 裡（原型已經這樣做）。開啟「減少動態」時，狀態直接跳到最後的樣子。
- 時間長度和 easing 都是 token（例如 `--motion-duration-short`），不在元件裡寫死毫秒數。
- 之後真的需要函式庫時（例如複雜的手勢），先寫進 OPEN_QUESTIONS，走 G2 增補（憲章 §15.2）。

## 決定 4：主題偏好存在 localStorage，第一次繪製前就套用
- 三種狀態：`system`（預設）、`light`、`dark`。存在 `localStorage` 的 `ec-theme`，**不存在帳號設定（`profile.settings`）**。
- 理由：
  1. 第一次繪製時還沒登入、也還沒拿到網路資料，只有本機儲存能在第一個畫面之前讀到。存在帳號裡，一定要等網路，就會閃一下錯的主題。
  2. 手機和電腦用不同的主題是合理的，這是裝置偏好，不是學習設定。
  3. 不必改 `SettingsSchema`、`POST /settings` 或資料庫（YAGNI）。
- 替代方案：同時存在帳號、跨裝置同步。不採用，列在「需要 Hansheng 確認」。
- **避免閃錯主題**：
  - `index.html` 的 `<head>` 裡，在任何樣式表之前放一段很短的 inline script。它讀 `ec-theme`（用 `try/catch`，讀不到就當 `system`），只有 `light`／`dark` 才在 `<html>` 設 `data-theme`。`system` 不設，交給 CSS 的 `prefers-color-scheme`。
  - `<meta name="color-scheme" content="light dark">`，各主題的 CSS 也設 `color-scheme`，讓捲軸和表單控制項跟著變。
  - `<meta name="theme-color">` 兩個，用 `media="(prefers-color-scheme: …)"` 分開（Android 的狀態列顏色）。手動切換時，由 script 改成單一值。manifest 的 `theme_color` 只能有一個值（ADR-007），用淺色主題的值。
- **CSP 的影響**：
  - 目前沒有 CSP（§7 沒有寫），所以 inline script 現在沒有阻礙。
  - 之後在 Cloudflare Pages 用 `_headers` 加 CSP 時（官方 Headers 頁），`script-src` 要加這段 script 內容的 `'sha256-…'`，**不可以**用 `'unsafe-inline'`。
  - 內容固定、很短，所以 hash 不會常變。加 CSP 的那張單要附一個測試，確認 hash 和 `index.html` 裡的 script 一致。
- 不採用的替代方案：外部檔案 `/theme-init.js`（同步載入）。它不需要 hash，但第一次開啟要多一個會擋住繪製的請求。

## 決定 5：`tokens.json` → 產生的 CSS 變數檔，CI 檢查一致
- **來源**是 `docs/design/tokens.json`（Designer 擁有，D2 PR 核准）。
- **產物**是 `apps/web/src/ui/tokens.css`，由 `tooling/tokens-css.mjs`（只用 Node 內建模組，不加依賴）產生，**產生的檔案也 commit**，不要手改。
- 為什麼要產生並 commit，而不是建置時才轉：
  - 產品程式不必在建置時讀 `docs/`。
  - PR 裡看得到 CSS 變數的差異。
  - 和 Style Dictionary 之類的工具比，不加依賴。
- CI 跑 `node tooling/tokens-css.mjs --check`：重新產生後跟 commit 的檔案比，不同就失敗。這是憲章 §0「機械性檢查寫成 CI」。
- **命名**：`--<群組>-<名稱>`，kebab-case，例如 `--color-ink`、`--color-hero`、`--space-4`、`--radius-card`、`--font-sans`、`--motion-duration-short`。群組固定為 `color`、`space`、`radius`、`font`、`shadow`、`motion`。
- **深淺色**：
  - 只有 `color`（和 `shadow`，如果深色不同）分 `light`／`dark` 兩個值。
  - 產生三段：`:root`（淺色）；`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`（系統深色）；`:root[data-theme="dark"]`（手動深色）。
  - 兩段深色內容相同，由產生器寫兩次。
- **使用規則**：
  - CSS Modules 裡的顏色、間距、圓角、字型、時間長度，一律寫 `var(--…)`，不直接寫色碼或毫秒數。
  - CI 掃 `apps/web/src/**/*.module.css`，`tokens.css` 以外出現 `#rgb`、`rgb(`、`hsl(` 就失敗。用一個小腳本做，不加 stylelint。
- **`tokens.json` 的格式還沒定**（D2a 才會有）。ARCHITECTURE §9.1.5 寫了產生器需要的最小形狀，Designer 在 D2a 依此產出，或在 D2 PR 說明差異，Architect 再對齊。

## 後果
- 好處：
  - 預覽不碰任何真實資料或金鑰，截圖比對有固定資料。
  - 不加任何新依賴。
  - 主題第一次繪製就正確。
  - token 只有一個來源，CI 會擋手改和寫死的色碼。
- 代價：
  - `api` 層要多一套 mock 實作和假資料，要和 contracts schema 保持一致（假資料要通過 schema 驗證）。
  - 主題不跨裝置同步。
  - inline script 在加 CSP 時要維護 hash。
  - 多兩個小腳本（`tokens-css.mjs`、CSS 色碼掃描）。
- 實作分工（TechLead 寫單）：
  - T-018：`api` 的 `mock`／`supabase` 切換、主題 inline script、`tokens.css` 接入。
  - T-019：`theme-color` 與 manifest。
  - SRE 的 O 單：前端 Pages 專案、`tokens-css --check`、色碼掃描、`dist/` 掃描接進 CI。
  - `tooling/tokens-css.mjs` 由 Claude Code 在上面任一張單寫。
