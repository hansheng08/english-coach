# DESIGN：english-coach 設計系統（D2a，v1.1）

- 編號：D-003（D2a）。分支 `design/system`。依據：`docs/design/BRIEF.md` v1.0、PRD v1.3（PR #52；v1.2 也比對過）、`english-coach-plan.md`、D1 決定（§11）、ARCHITECTURE v1.9 §9.1／ADR-014（PR #53 已於 2026-11-26 20:03 合併，f1a6077）。
- v1.1（D2 第 2 輪，2026-11-26）：依 PM 文案檢查（PR #54 留言 13 點）與 Hansheng 19:48 決定修訂：streak 條件文案、Mastered 改 M2 刻度、AC-15 無 `:has()` 退回、診斷標記可點、新增「今天只有 N 張」畫面。
- 方向：**R2-C 夜幕焦點**（Hansheng 2026-11-26 18:40 選定）。深色模式＝**跟隨系統＋手動三段切換（淺色／深色／跟隨系統）**。
- 交付物：本文件、`tokens.json`、元件展示頁 `prototype/screens/system.html`、可點的靜態原型 `prototype/screens/*.html`（假資料）、畫面規格 `screens/*.md`、基準截圖 `screens/shots/`。
- 範圍：D2a＝登入、首頁今日任務、早上閱讀、跟讀闖關、中午複習、晚上口說（診斷 AC-15、跟讀改寫、無稿重答、結果）＋主題切換。字卡／紀錄／設定完整頁屬 D2b（原型以 `later.html` 佔位）。

## 1. 原則
1. **一次只聚焦一件事**。每個畫面頂部一個深藍「焦點卡」（hero），只放「現在要做的那一步」和一個主按鈕；其餘資訊在下方淺色面板。
2. **安靜的高級感，不是 AI 樣子**。不用紫色漸層、玻璃擬態、發光、emoji 圖示、吉祥物、彩帶。顏色只有深藍（墨）、一個金色強調、語意綠紅。
3. **鼓勵要真實、要節制**。只顯示 PRD 有的東西：streak（AC-21、AC-26）、Mastered 數與 M2 目標刻度（AC-20、AC-21、PRD §3 M2）、目標語塊有沒有講出與加分（AC-18）。數字是主角，不用誇張文案，不用「太棒了！」。
4. **手機與電腦同樣用心**。手機 360 是單欄＋底部分頁；電腦 1280 是頂部導覽＋主欄＋右側 rail，不是把手機版放大。
5. **狀態不只靠顏色**。卡片狀態、對錯、診斷標記都用形狀／線型／文字區分，色盲與深色模式下仍可辨識。

## 2. 版面與格線
| 項目 | 手機（<900px） | 電腦（≥900px） |
|---|---|---|
| 外距 | `--space-gutter-mobile` 16px | `--space-gutter-desktop` 40px |
| 最大寬 | 100% | `--space-content-max` 1240px，置中 |
| 導覽 | 底部分頁 `.tabbar`（今天／字卡／紀錄／設定），子頁頂部 `.navbar`（返回＋標題＋頭像） | 頂部 `.dnav` 置中膠囊分頁，右側頭像 |
| 主內容 | 單欄 | `.cols`：主欄 1fr＋rail `--space-rail` 340px，間距 24px |
| 主要動作 | 底部固定 `.actionbar`（含 safe-area） | 放在焦點卡內或 rail 底部，不固定 |
| 閱讀行寬 | 100% | `--space-read-max` 68ch |
- 斷點只有一個：**900px**（CSS 變數不能用在 media query，所以寫在這裡，不進 tokens）。412／768 走手機版，768 為單欄加寬；1440 只是置中加留白。
- 輸入方式：`(hover:hover) and (pointer:fine)` 才顯示鍵盤快捷鍵提示（`kbd`）與 hover 提示；觸控裝置一律隱藏。

## 3. 字體
- 只用系統字（Q-35 結案「不新增字型依賴」）。`--font-sans`：
  `-apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, "Segoe UI", "Noto Sans TC", "Noto Sans CJK TC", "PingFang TC", "Microsoft JhengHei", sans-serif`
- 字級（rem，以 16px 為底）：

| token | 尺寸 | 用途 |
|---|---|---|
| `--font-size-display` | 2.75rem | 結果頁大數字（streak） |
| `--font-size-timer` | 3.25rem | 錄音計時（300 字重，tabular-nums） |
| `--font-size-title-1` | 1.75rem | 焦點卡標題 |
| `--font-size-title-2` | 1.375rem | 頁內大標、統計數字 |
| `--font-size-headline` | 1.0625rem | 面板標題、清單主文字 |
| `--font-size-read` | 1.0625rem | 英文閱讀內文（行高 `--font-leading-read` 1.75） |
| `--font-size-body` | .9375rem | 一般內文 |
| `--font-size-callout` | .8125rem | 次要說明 |
| `--font-size-caption` | .75rem | 標籤、單位 |
| `--font-size-micro` | .6875rem | 底部分頁文字（只限這裡） |
- 字重：300（只用在拉丁數字，如計時）、400、500、600（標題）、700（極少）。中文只用 400／600。
- 數字一律 `font-variant-numeric: tabular-nums`。

## 4. 色彩（淺色／深色）
完整值見 `tokens.json`；展示見 `system.html`。角色：
- **底與面**：`bg`、`surface`（卡片）、`sunken`（凹槽、輸入框底）、`raised`（分段控制選中的那一格；深色時比 surface 亮）。
- **文字**：`ink`（主）、`ink-2`（次）、`ink-3`（第三層、已跳過）。
- **焦點卡**：`hero`／`hero-2`（深藍漸層），上面用 `on-hero`、`on-hero-2`、`hero-track`、`hero-line`、`good-on-hero`。深色模式下 hero 比 bg 亮一階，仍是「夜幕」。
- **金色強調**：`gold`（主按鈕底、進度、焦點）、`gold-hover`、`on-gold`；文字用 `gold-text`（淺色模式加深成 #8A6200 才夠對比）、`gold-soft`（底色標記）。
- **語意**：`good`／`good-soft`／`on-good`，`bad`／`bad-soft`，`grammar`（文法波浪線），`up`（升級語塊底線）。
- **按鈕**：`btn`／`on-btn`／`btn-hover`。淺色＝墨底白字；深色＝金底墨字。
- **其他**：`line`、`track`、`scrim`（遮罩）、`theme-bar`（瀏覽器 theme-color）。
- 規則：金色只用在「現在該做的」與「進度」；一個畫面只有一個金色主按鈕。

## 5. 間距、圓角、陰影
- 間距 4 的倍數：`--space-1`…`--space-14` = 4/8/12/16/20/24/32/40/56px。
- 觸控最小 `--space-tap-min` 48px（Android 主驗收裝置）。
- 圓角：`xs` 6（kbd、小標）、`sm` 10（chip、輸入）、`md` 14（按鈕、清單）、`lg` 18（面板）、`xl` 22（焦點卡、sheet）、`pill`。
- 陰影只有兩個：`--shadow-float`（sheet／popover）、`--shadow-seg`（分段控制選中格，深色為 none，改用 `raised` 顏色區分）。卡片不用陰影，用 `line` 細框或底色層次。

## 6. 動態
- 只用純 CSS（keyframes）；產品端可用原生 `element.animate`（ADR-014）。**只動 `transform` 與 `opacity`**，不動顏色、尺寸、陰影。
- 全部動畫放在 `@media (prefers-reduced-motion: no-preference)` 內；使用者開「減少動態」時畫面直接是最終狀態。
- 時長：`--motion-duration-fast` 140ms（按壓）、`base` 240ms（出現）、`slow` 900ms（進度填滿）、`breathe` 2400ms（呼吸）。曲線 `--motion-ease-out`、`--motion-ease-standard`。

| 名稱 | 用在 | 做法 |
|---|---|---|
| ec-fill | 進度條、三段進度 | scaleX 0→1 |
| ec-rise | 7 天長條 | scaleY 0→1 |
| ec-breathe | 「下一步／進行中」圓點 | opacity 1↔.55 |
| ec-up | 里程碑（待確認，見 §14）、結果 | translateY＋opacity |
| ec-in | 列表出現 | translateY 4px＋opacity |
| ec-level | 錄音音量條 | scaleY |
| ec-ring | 錄音中外環 | ::after scale＋opacity |
| ec-fade | 電腦版 sheet／popover | opacity |
- 按鈕按壓：`transform: scale(.98)`，140ms。

## 7. 元件規格（展示：`system.html`）
- **按鈕**：`.btn`（52px 高，圓角 md）、`.btn-lg`（56px）、`.btn-gold`（焦點卡內主動作）、`.btn-2`（次要，sunken 底）、`.btn-ghost`、`disabled`（ink-3 文字＋說明原因，如「還差 2 個語塊」）。`.icon-btn` 48×48。電腦版按鈕右側可帶 `kbd` 快捷鍵。
- **焦點卡 `.hero`**：深藍漸層＋右上微弱放射光（::before）；結構＝時段標籤（gold）→ 標題 → 內容 → 進度 → 主按鈕 → 一句鼓勵（on-hero-2）。
- **步驟狀態 `.dot`**（AC-26）：完成＝綠底白勾、下一步／進行中＝金框＋實心點（呼吸）、未做＝空心圈（可「跳過」）、已跳過＝跳過圖示＋刪除線＋「已跳過」文字。
- **字卡狀態 `.state`**（AC-19）：名稱照 PRD 用英文 Collected／Learning／Reviewing／Mastered；形狀＝空心圈 → 半滿 → 實心 → 金色菱形；形狀＋文字，不靠顏色。
- **進度**：`.segs` 三段（錄音／診斷／跟讀重答）、`.m2`（Mastered 累積，量尺 0～60，刻線在 15＝第 4 週、60＝第 12 週，PRD §3 M2；達成的刻線變金色，下方標數字與週次；`aria-label` 讀出是否達成）、`.meter`（一般進度，如複習 8／25）、`.spark` 7 天長條（今天＝外框）、`.pips` 次數點（跟唸 0/2、TTS 3/3）。
- **清單 `.item`**：左圖示＋主文字＋說明＋右側時間或動作；「跳過」按鈕 ≥48px。
- **分段控制 `.seg`**：radio 實作，每格 ≥48px 高；用在主題切換、AC-15 手機檢視切換。
- **底部 sheet `.sheet`**：手機從底部升起（scrim＋把手）；電腦版置中對話框，帳號 sheet 改為右上 popover（`.pop`）。
- **表單**：`.field` 標籤在上、輸入框 52px、錯誤＝bad 文字＋圖示＋框線，訊息寫原因與下一步。
- **診斷標記**（AC-15）：文法＝`grammar` 波浪底線、贅詞＝刪除線、太口語＝`gold-soft` 底色、停頓＝`停 3.4 秒` 膠囊、升級語塊＝`up` 粗底線。每種都有圖例；電腦版 hover 顯示說明（`data-tip`）。
  - **可點的說明（觸控與鍵盤等效）**：文法、贅詞、太口語三種標記是 `<button class="mk">`。點一下（或 Tab 到標記按 Enter／Space）在該句下方開一則說明（`.mnote`，深藍底，例：「have　文法：have → had」），`aria-expanded` 同步；再點同一個、按說明的 ✕（48×48）或按 Esc 關閉，焦點回到標記。一次只開一則。電腦（`hover:hover and pointer:fine`）hover 仍顯示同樣的短提示。
  - **點擊範圍**：標記用 `::before` 擴大到 48×48（置中）。相鄰兩行的標記擴大範圍會重疊，所以字本身（`.w`）疊在所有擴大範圍之上：看得到的字永遠點到自己，重疊的邊緣由相鄰標記共用（符合 WCAG 2.5.8 的間距規則）。停頓膠囊本身就寫秒數，不做成按鈕。
  - **沒有 JS 時**：按鈕不會開說明，但圖例仍說明每種標記。
- **AC-15 手機切換的退回**：切換用 `:has()` 隱藏欄位，選擇器錨在對照區塊 `.cmp`（不錨在 `:root`／`body`，照 ARCH §9.1）。瀏覽器不支援 `:has()` 時，`@supports not selector(:has(*))` 把切換列整個藏起來，畫面固定是預設的「逐句對照」（原逐字稿＋Senior 版上下排），所以一定看得到原逐字稿；`:has()` 的隱藏規則在不支援的瀏覽器會整條失效，不會誤藏。
- **語塊 `.chunk`**：內文中點狀底線，可點開 sheet（意思、例句、播放、跟唸、收錄）。

## 8. 遊戲化鼓勵的呈現
- 只用 PRD 功能：streak（連續天數，含 7 天長條）、Mastered 數＋M2 刻度（第 4 週 15、第 12 週 60；Hansheng 2026-11-26 19:48 決定，取代舊的單一目標刻度）、目標語塊講出與否（講出＝綠勾＋點數；沒講到＝空心 ✕＋「這次沒講到，下次再試」；不承諾哪天出現，到期日照 AC-09）、跟讀解鎖（「第 4 句解鎖了」）。
- 樣式：數字大、文案短、語氣平實。里程碑 `.milestone`（金色細框＋ec-up 一次）只在 `system.html` 示範「跨過 M2 刻度時出現一次」，產品要不要做待 Hansheng 確認（§14）；不放彩帶、不放動畫角色、不放音效。
- **streak 條件文案**（AC-26；Hansheng 19:48 定義「打開時段」＝在該時段內進入該時段的第一步）：
  - 已跳過的步驟：「已跳過，不算完成；早中晚都有進入第一步，streak 就不中斷」。
  - 首頁晚上還沒開始時，焦點卡：「按下開始就算進入晚上這段，連續會變成 24 天」（晚上這段顯示「還沒開始」，第一步標「下一步」）。
  - 結果頁：「今天三段都打開了」（不用「完成」）＋「中午跳過的『手動新增』不算完成；早中晚都有進入第一步，所以 streak 不中斷。」
  - 「完成」只用在步驟與時段本身（例：早上 2／2 完成），「打開」只用在 streak 條件，兩者不混用。

## 9. 主題（深色模式）規格，對齊 ADR-014
- 三個狀態：淺色、深色、跟隨系統（預設）。
- **位置**：每頁右上頭像 →「帳號與外觀」sheet（手機底部 sheet／電腦右上 popover），裡面第一個控制項就是三段 `.seg`（太陽／月亮／半圓圖示＋文字）。下方即時說明：「跟隨系統，現在是淺色。只存在這台裝置。」D2b 的設定頁放同一個控制項。
- **儲存與套用**（照 ADR-014，原型已照做）：`localStorage['ec-theme']` = `system`｜`light`｜`dark`；手動時在 `<html>` 設 `data-theme`，跟隨系統時移除。`<head>` 先放 `color-scheme` meta、兩個依 media 的 `theme-color` meta、再放極小 inline script（避免閃白），再載 CSS。手動模式時 theme-color 改成單一值（`--color-theme-bar`）。
- **CSS 三段**：`:root`（淺色）→ `@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]) }` → `:root[data-theme="dark"]`。原型的 `app.css` 這段由 tokens.json 產生。
- 原型專用：網址參數 `?theme=light|dark` 只為截圖，產品不需要。

## 10. 無障礙
- 對比：所有文字 ≥4.5:1（大字 ≥3:1），淺色、深色都檢查過（token 配對表＋逐頁實際文字檢查，見 PR）。
- 觸控目標 ≥48×48。例外：英文內文中的語塊連結（24px 高，屬 WCAG 2.5.8 行內例外），同一頁下方語塊清單另有 48px 的入口。診斷標記用擴大點擊範圍（§7）。
- 標記與狀態都用形狀＋文字，不只靠顏色。
- 圖示一律 inline SVG（`currentColor`），按鈕有文字或 `aria-label`；裝飾圖示 `aria-hidden`。
- 焦點：`:focus-visible` 2px `gold-text` 外框（焦點卡上改 `gold`）＋2px 位移。
- 鍵盤：電腦版主要動作有快捷鍵（R 開始錄音、1–3 評分、1–5 勾語塊、Space 停止、N 無稿）；只是加速，不取代按鈕。
- 減少動態見 §6。語言標示：英文內容 `lang="en"`。

## 11. Token 格式（U-4，Designer 決定）
- 採 ARCH §9.1 最小格式，`tooling/tokens-css.mjs` 可直接吃：
  - 第一層群組只有 `color`、`space`、`radius`、`font`、`shadow`、`motion`。
  - 名稱 `[a-z0-9-]`；字串值＝兩種主題共用；`{ "light": …, "dark": … }`＝分主題。
  - 輸出 `--<group>-<name>`，例如 `--color-ink`、`--space-4`、`--radius-lg`。
- Designer 的補充規則：
  1. **`$` 開頭的 key 一律是說明**（目前只有頂層 `$meta`），產生器略過（Architect 已在 PR #53 9194b83 確認：`$` 開頭的 key 略過，#54 的 token 形狀完全相符）。
  2. 不新增群組，子類別寫進名稱：字級 `font-size-*`、字重 `font-weight-*`、行高 `font-leading-*`；版面尺寸放 `space`（`space-tap-min`、`space-content-max`、`space-rail`、`space-read-max`、`space-gutter-*`）；時長與曲線 `motion-duration-*`、`motion-ease-*`。
  3. `color-theme-bar` 給 theme-color meta 用（manifest `theme_color` 照 ADR-014 用淺色 `--color-hero`）。
  4. 斷點、z-index 不進 tokens（不能當 media query 變數），寫在本文件。
  5. 元件內部的臨時變數（如 `--h`、`--l`、`--d`，長條高度與延遲）不是 token，不受 css-literals 限制以外的規則影響。
- 目前 82 個 token，其中 29 個有深色值。

## 12. 字型堆疊與 Segoe UI（U-5：已加入，放在 Roboto 之後、中文字型之前；tokens.json `font-sans`、`app.css` 由 token 產生）
- **拉丁／中文退回順序**：瀏覽器逐字找字型。拉丁字母在 Mac/iOS 用 SF（`-apple-system`／`BlinkMacSystemFont`）、Android 用 Roboto、Windows 用 Segoe UI；中文字落到後面的 Noto Sans TC／Noto Sans CJK TC（Android）、PingFang TC（Apple）、Microsoft JhengHei（Windows）。不加 Segoe UI 時，Windows 的英文會改用 Microsoft JhengHei 內附的拉丁字，字距與數字形狀較差，和其他平台差很多。
- **字重**：Segoe UI 有 Light 300／Semilight／Regular／Semibold 600／Bold，正好對應本系統用到的 300/400/600；Microsoft JhengHei 只有 Light／Regular／Bold，中文 600 會用 Bold 顯示（略重，可接受）。
- **Windows 太細的疑慮**：之前擔心的是「中文細字在 Windows 上發虛」。R2-C 的中文只用 400／600，300 只用在拉丁數字（計時），而 Segoe UI Light 在 ClearType 下清楚，所以疑慮基本消失。
- **Roboto 放在 Segoe UI 前面**：Windows 有裝 Roboto 時，Android 與電腦的英文看起來一致（主驗收裝置是 Android）。
- 未驗證：box 只能看 Android 系字型（Roboto＋Noto Sans CJK TC）；Windows 真機尚未看過（不確定）。Win11 可另加 `"Segoe UI Variable Text"`，這版先不加。

## 13. 原型與檔案
- `prototype/screens/index.html` 首頁；其他畫面與流程連結見 `screens/README.md`。直接用瀏覽器開檔即可，不需伺服器、不連外。
- `app.css` 的 token 區塊由 tokens.json 產生（Designer 本機產生器，不進 repo）；其餘 CSS 引用 token，不寫死顏色（頁面內只有長條高度等元件變數）。
- inline JS（不確定，交 Architect）：(a) 主題切換（head 防閃＋切換／同步）；(b) 診斷頁勾選語塊的計數與診斷標記說明的開關（Esc 關閉）；(c) 首頁 R 鍵、診斷頁 1–5 鍵快捷鍵示意。無函式庫、無網路請求。產品端由 Architect／TechLead 依 ADR-014 實作，不照抄原型 JS。

## 14. 不確定（待確認）
1. 原型 inline JS（§13）是否符合產品端寫法 → Architect。
2. （已解決）主題偏好只存在這台裝置、不跨裝置同步（ADR-014，PR #53 合併）。
3. Windows 字型呈現未真機驗證（§12）。
4. 「在該時段內進入第一步」的時段邊界（例如晚上時段到幾點結束、跨午夜怎麼算）→ Architect 落實 streak 計算時定義；文案目前不寫時間邊界。
5. 「跨過 M2 刻度（15、60）時出現一次」的里程碑提示要不要做（只在 `system.html` 示範，畫面上沒用）→ Hansheng。
6. 「今天只有 N 張」頁的說明文案與組成（舊卡／新卡／種子庫剩餘）→ PM 確認。
7. D2b 畫面（字卡清單／搜尋、紀錄、設定、錯誤與額度用完狀態）尚未設計。
8. 診斷標記點擊範圍：相鄰標記重疊處共用邊緣（字本身一定點得到），若 QA 要求每個標記都有完整不重疊的 48×48，需要加大行高（會讓逐字稿變鬆）→ QA／TechLead。
