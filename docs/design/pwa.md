# PWA 外觀：manifest、圖示、系統提示（D-004，D2a 增補）

- 編號：D-004（D2a 增補，T-019 的前置）。分支 `design/pwa-assets`。日期：2026-11-26。
- 依據：ADR-007（manifest 欄位、`registerType: 'prompt'`、離線時顯示「需要連網」）、ARCHITECTURE §9（可安裝條件、SW 策略、新版本）、§9.1.1（mock 模式：每頁頂端「預覽：假資料」、`?scenario=`）、§9.1.4（`theme-color`、manifest `theme_color` 用淺色 `--color-hero`）、ADR-014 決定 1、4；PRD v1.4 NFR-01、NFR-06；任務單 T-018（登入、mock 情境）、T-019（manifest、斷線、新版）。
- 範圍：只有這三件：manifest 與圖示、三種系統提示（斷線、新版、預覽假資料）、登入錯誤文案（在 `screens/login.md`）。不含 D2b 畫面。
- 沒有新增 token：全部用 `tokens.json` 既有的值（82 個不變）。

## 1. manifest 的值
| 欄位 | 值 | 來源／理由 |
|---|---|---|
| `name` | `english-coach` | 和登入頁品牌字樣一致；安裝對話框、啟動畫面、電腦版視窗標題用 |
| `short_name` | `EN Coach` | 主畫面圖示下的名稱。`english-coach` 13 個字元，Android 桌面約 12 字元就會截成「english-coa…」，所以用 8 個字元的短名（不確定 #1） |
| `description` | `每天 80 分鐘，把英文講得像 Senior。` | 登入頁焦點卡同一句 |
| `lang`／`dir` | `zh-Hant-TW`／`ltr` | 和 `<html lang>` 一致（T-018） |
| `start_url`／`scope` | `/`／`/` | ADR-007、ARCH §9 |
| `display` | `standalone` | ADR-007、ARCH §9 |
| `theme_color` | `#0F2236` | `tokens.json` 的 `color.hero.light`（ARCH §9.1.4、T-019：建置時從 tokens 讀，不另寫一份） |
| `background_color` | `#0F2236` | 同樣取 `color.hero.light`，建置時從 tokens 讀。理由：啟動畫面＝深藍底＋圖示，和 `theme_color` 同色，狀態列與底色連成一片；深色模式開啟時不會先閃一整片白；淺色模式從深藍啟動畫面進到 App，和登入頁的深藍焦點卡同一套。manifest 只能有一個值（不分淺深） |
| `orientation` | 不設 | 電腦版也要用（NFR-01），不鎖方向 |
| `icons` | 見下表 | ADR-007：192／512 px，含 maskable |

```json
{
  "name": "english-coach",
  "short_name": "EN Coach",
  "description": "每天 80 分鐘，把英文講得像 Senior。",
  "lang": "zh-Hant-TW",
  "dir": "ltr",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "theme_color": "#0F2236",
  "background_color": "#0F2236",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```
- 上面是**值的參考**，實際 manifest 由 `vite-plugin-pwa` 產生（T-019）；`theme_color`、`background_color` 由建置從 `tokens.json` 讀。`/icons/` 路徑是建議（`apps/web/public/icons/`），實際路徑由 T-019 決定。
- 和 `theme-color` meta 的關係（ADR-014 決定 4，不變）：頁面載入後由兩個 `theme-color` meta（`color.theme-bar` 淺 `#F4F5F7`／深 `#0A1420`，手動模式改成單一值）接手；manifest 的 `theme_color` 只在頁面還沒載入（啟動畫面）時用。所以啟動畫面是深藍、進到 App 後狀態列變成淺灰或深色，這是預期行為。
- 不提供 `purpose: "any maskable"` 合併寫法（同一張圖兩種用途會一邊太小或一邊被切）。

## 2. 圖示
| 檔案 | 尺寸 | purpose | 用在 |
|---|---|---|---|
| `assets/icons/icon.svg` | 512 viewBox | 來源檔（any） | 產生下面兩張 |
| `assets/icons/icon-192.png`、`icon-512.png` | 192、512 | `any` | 電腦版 Chrome／Edge 的視窗、工作列、應用程式清單（透明圓角，不加遮罩） |
| `assets/icons/icon-maskable.svg` | 512 viewBox | 來源檔（maskable） | 產生下面兩張 |
| `assets/icons/icon-maskable-192.png`、`icon-maskable-512.png` | 192、512 | `maskable` | Android 主畫面、啟動畫面（系統套用圓形、方圓等遮罩） |

- **圖形**：登入頁品牌標誌放大：深藍底（`hero` `#0F2236` → `hero-2` `#1C3654` 對角漸層）＋三條圓頭線：兩條白線（`on-hero`，像一段文字）＋一條進度軌（`hero-track` `#3A4D66`）上面金色進度（`gold` `#F2C14E`）。不用字母、麥克風、對話框或 emoji，和 R2-C「安靜的高級感」一致。
- **一般圖示（any）**：512 格，圓角方形 `rx 140.8`（＝標誌 40 格的 11，27.5%），四角透明；線寬 38.4，三條線 y＝173／243.4／339.4，x 從 140.8 到 371.2（上面短線到 268.8、金色到 294.4）。
- **maskable 安全區規格**：
  - 背景**滿版**到四邊（不留透明），因為系統遮罩可能裁掉任何邊角。
  - 所有有意義的內容必須在**中心點為圓心、半徑 40%（512 格＝204.8 px；192 格＝76.8 px）的圓內**，也就是中央 80% 直徑的圓（W3C manifest 的 maskable 安全區）。
  - 這版內容外框（含圓頭）x 121.6～390.4、y 153.8～358.6，最遠角落離中心 169.1 px＝安全區半徑的 83%，留了約 36 px 的餘裕。
  - 改圖時用 `prototype/screens/pwa-icons.html` 的「原圖＋安全區」檢查：虛線圈外只能有背景。
- **輸出方式**：SVG 是來源；PNG 由 headless Chrome 依 SVG 原尺寸輸出（box 上的 Designer 工具，不進 repo、不加依賴）。SVG 裡的顏色是 `tokens.json` 淺色值的複本（獨立的 SVG 讀不到 CSS 變數）；若 `hero`、`hero-2`、`hero-track`、`gold` 改值，要重出圖示。
- **預覽**：`prototype/screens/pwa-icons.html`（圓形、方圓、圓角方形、水滴四種遮罩＋安全區、一般圖示 512／192／48、主畫面與啟動畫面示意）；截圖 `screens/shots/pwa-icons-*`。

## 3. 系統提示
三種提示都不是頁面內容，是 App 外殼的一部分，每一頁都一樣。

### 3.1 疊放順序
- 頁面頂端：`.sysbars`（`position: sticky; top: 0`，z-index 45，高於 `.top`／`.navbar`、低於 sheet 與 scrim）裡由上到下：①「預覽：假資料」（只有 mock 模式）②「需要連網」（只有離線時）。兩條都推開內容，不蓋住內容。
- 畫面底部：「有新版本」卡片（fixed）。
- 第一條的上內距含 `env(safe-area-inset-top)`。

### 3.2 斷線：「需要連網」（NFR-06、ADR-007、T-019）
- **何時出現**：`navigator.onLine` 為 false（T-019 `subscribeOnlineStatus`），恢復連線就消失。App 不做離線練習（PRD「這版不做：離線使用」、Q-03）。
- **位置**：頁面頂端整條（手機與電腦都是），在預覽條下面。內容置中。
- **樣式**：反白條：底 `ink`、字 `bg`（淺色模式＝深藍底淺字，深色模式＝淺底深字），左邊斷線圖示 18 px。用反白而不用 `bad` 紅色：斷線不是使用者做錯事，也不是 App 壞掉。
- **文案**：粗體「需要連網」＋「目前沒有網路，連上後再繼續。」（「需要連網」四個字獨立成一個元素，T-019 的 E2E 可以直接比對）。
- **行為**：不能關閉（狀態一解除就自動消失）；沒有按鈕，所以沒有觸控目標；`role="status"`（不搶焦點，讀屏會念）。已經開著的畫面內容不清掉，只有要連網的動作會失敗（失敗訊息照各畫面自己的錯誤狀態）。
- **離線時重新開啟 App**（T-019 TC-8：外殼從 precache 顯示）：課表、字卡、紀錄都是 network-only，不在手機上，所以內容區顯示一張面板：斷線圖示＋「今天的課表要連網才能載入」＋「App 外殼已經開好，但課表、字卡和紀錄都在雲端，不存在這台裝置。連上網路後按「重新載入」。」＋次要按鈕「重新載入」（52 px 高）。原型：`notice-offline-cold.html`。
- **動態**：出現時 `ec-fade`（opacity，240ms）；減少動態時直接出現。
- 原型：`notice-offline.html`（開著時斷線）、`notice-offline-cold.html`（離線時開啟）；登入頁見 `login-offline.html`。

### 3.3 新版：「有新版本」＋「更新」（ARCH §9、ADR-007、T-019）
- **何時出現**：SW 有等待中的新版（`registerType: 'prompt'`，T-019 `watchForUpdate` 呼叫 `onNeedUpdate`）。**不自動重新整理**，使用者按「更新」才重新載入成新版。
- **位置**：
  - 手機：底部浮動卡片，左右各 12 px，在底部分頁（`.tabbar`）上方 12 px（`bottom: calc(76px + env(safe-area-inset-bottom))`）；子頁有底部 `.actionbar` 時放在 actionbar 上方（`calc(84px + …)`）。頁面底部內距加大到 184 px，最後一段內容不會被蓋住。
  - 電腦：右下角，距右、下各 24 px，寬 380 px。
- **樣式**：`surface` 卡片＋`line` 細框＋`--shadow-float`、圓角 `lg`；左邊更新圖示（`ink-2`）、中間兩行字、右邊按鈕。按鈕用次要按鈕 `.btn-2`（不是金色）：金色只給「現在該做的」練習主動作，一個畫面一個（DESIGN §4）。
- **文案**：粗體「有新版本」＋「按更新會重新載入頁面。」；按鈕「更新」。
- **行為**：
  - 卡片 `role="status"`，出現時不搶焦點（不打斷錄音、作答）。鍵盤可以 Tab 到「更新」，焦點外框照 DESIGN §10。
  - 按「更新」→ 呼叫 `apply`（重新載入成新版）；按鈕在處理中改成 disabled，避免連按。
  - **沒有「稍後」或關閉鈕**（T-019 只定義「更新」）：卡片一直留到按下「更新」；所有分頁都關掉後再開 App，就會直接是新版（SW 的預設行為）。要不要加「稍後」見不確定 #3。
  - 正在錄音時：按「更新」會中斷錄音頁；錄音本身先寫 IndexedDB（ARCH §9「兩種錄音都先寫 IndexedDB」），但這個情境要不要另外提醒見不確定 #4。
- **觸控**：「更新」按鈕 48 px 高、寬至少 88 px。
- **動態**：出現時 `ec-up`（上移 16 px＋淡入，240ms）；減少動態時直接出現。
- 原型：`notice-update.html`。

### 3.4 預覽：「預覽：假資料」（ARCH §9.1.1、ADR-014 決定 1、T-018）
- **何時出現**：只在 `VITE_DATA_MODE=mock` 的建置（PR 預覽、截圖、E2E）。正式建置不會有（正式建置不得包含 mock 程式）。
- **位置**：每一頁最頂端（含登入頁），在斷線條上面；sticky，捲動時一直看得到（ADR-014：畫面一直顯示）。
- **樣式**：`sunken` 底、下緣 1 px **虛線** `ink-3`（虛線＝「不是真的」），燒杯圖示＋粗體「預覽：假資料」（`ink`，13 px）＋說明「資料只在這個分頁，重新整理就回到初始狀態。」（`ink-2`，12 px）。高約 32～48 px（360 寬時說明換到第二行）。
- **未知情境**（T-018）：`?scenario=` 的名稱不認得時，說明那段換成「未知情境「nope」，改用 default」（`bad` 色字，純文字）。原型：`preview-banner-unknown.html`。
- **行為**：不能關閉（它是安全標示，避免把預覽當成真資料）；沒有按鈕；`role="note"`。
- 原型：`preview-banner.html`。

### 3.5 對比與觸控（自我檢查結果見 PR／交接回報）
- 文字對比 ≥4.5:1（淺、深色都量）：反白條 `bg` on `ink`；預覽條 `ink`／`ink-2`／`bad` on `sunken`；卡片 `ink`／`ink-2` on `surface`；錯誤框 `ink` on `bad-soft`。
- 觸控 ≥48×48：「更新」「重新載入」「登入」與輸入框（52 px）。提示條本身不可點。

## 4. 不確定（待確認）
1. `short_name` 用 `EN Coach`（8 字元，PM §15.6 對照時也建議用這個）是 Designer 提案，**待 Hansheng 確認**；也可以用 `english-coach`（會被 Android 截字）或中文名 → PM／Hansheng。
2. `background_color` 用深藍 `#0F2236`（和 `theme_color` 同）是 Designer 決定；若希望淺色模式的啟動畫面是淺灰 `#F4F5F7`，深色模式開啟時會先閃一下淺色 → Hansheng 可改。
3. 「有新版本」要不要加「稍後」（關閉到下次開 App）：T-019 只有「更新」，這版不加 → TechLead／Hansheng。
4. 錄音或作答中出現新版時，要不要等這一步結束才顯示卡片（相關 PRD AC-14 晚上錄音、AC-25 保留錄音；ARCH §9 只說「不在練習中途自動重整」）：這版一律顯示、不自動重整 → TechLead／Architect。
5. T-019 TC-2 寫「`sizes` 有 `192x192`、`512x512` 各一」，但 ADR-007 要含 maskable，本規格是 192、512 各兩張（any＋maskable）→ TechLead 確認 TC-2 改成「各有 any 與 maskable」。
6. 離線時重新開啟的面板文案依 ARCH §9「資料 network-only」推得；首頁實際的載入失敗狀態屬 T-026 → TechLead。
