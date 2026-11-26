# 登入（`login.html`）｜AC-23
- 用途：只有 Hansheng 一個帳號，不開放註冊（Q-01）。
- 手機：品牌字樣＋一句說明 → Email、密碼（52px 輸入框，標籤在上）→ 墨色「登入」按鈕。錯誤狀態：密碼框紅框＋圖示＋「Email 或密碼不對，再試一次。」；下方「連線加密。履歷與錄音只供你自己練習。」
- 電腦：左右分割。左＝深藍焦點卡，「每天 80 分鐘，把英文講得像 Senior。」＋今天的份量（1 篇科技新聞、5 句跟讀、25 張字卡、1 題面試題）；右＝同一張表單，最大寬 400px。
- 不放：註冊、社群登入、忘記密碼流程（PRD 未列；如需要由 PM 補）。
- 截圖：`shots/login-*`。

## 錯誤狀態（D-004 增補，2026-11-26）
依據：ARCHITECTURE §6 錯誤碼表（`unauthenticated`＝帳密錯；其他）、§7（Supabase Auth email＋密碼、關閉註冊）、T-018「介面」（`signInWithPassword` 錯誤對應：帳密錯 → `unauthenticated`，其他 → `internal`）、NFR-06（需連網）、T-019（`subscribeOnlineStatus`）。

兩種位置：
- **欄位訊息**（`.hint.err`）：欄位下方，`bad` 字＋警告圖示；輸入框 2px `bad` 框；欄位 `aria-invalid="true"`，訊息用 `aria-describedby` 連到欄位。
- **表單訊息**（`.alert`）：表單最上面、Email 欄之上；`bad-soft` 底＋1px `bad` 框＋圖示＋粗體標題＋一句說明；`role="alert"`。用在「不是某一欄寫錯」的錯誤。

| # | 情況 | 怎麼判定 | 位置 | 文案 | 原型／截圖 |
|---|---|---|---|---|---|
| 1 | Email 空白 | 按「登入」時前端檢查（不送出） | Email 欄訊息 | 請輸入 Email。 | `login-empty.html`／`shots/login-empty-*` |
| 2 | 密碼空白 | 同上 | 密碼欄訊息 | 請輸入密碼。 | 同上（兩欄都空時兩則都出現） |
| 3 | Email 格式不對（沒有 @ 等） | 同上 | Email 欄訊息 | Email 格式不對，例如 name@example.com。 | 只有規格 |
| 4 | 帳密錯 | `signInWithPassword` 回 `unauthenticated` | 密碼欄訊息（Email 欄不標紅，不透露哪一個錯） | Email 或密碼不對，再試一次。 | `login.html`／`shots/login-*`（原有） |
| 5 | 離線 | 按「登入」時 `navigator.onLine` 為 false（不送出）；或送出後網路失敗且此時離線 | 表單訊息＋頁面頂端「需要連網」條（pwa.md §3.2） | **需要連網才能登入**　目前沒有網路。連上網路後再按一次「登入」。 | `login-offline.html`／`shots/login-offline-*` |
| 6 | 服務錯誤 | `signInWithPassword` 回 `unauthenticated` 以外的錯（T-018：`internal`）：伺服器錯誤、逾時、在線上但連不到、請求太頻繁等 | 表單訊息 | **現在登不進去**　登入服務沒有回應或暫時出錯。輸入的內容已保留，稍後再按一次「登入」。 | `login-server.html`／`shots/login-server-*` |
| 7 | 登入中 | 送出後等待回應 | 按鈕 | 按鈕文字改「登入中…」、disabled、`aria-busy="true"`（不能連按） | 只有規格 |

規則：
- 前端檢查只在按「登入」時做，不在打字或離開欄位時跳紅字；`<form novalidate>`，不用瀏覽器內建泡泡（樣式與文案不一致）。
- 檢查順序：1～3（欄位）→ 5（離線）→ 送出 → 4、6。有欄位錯時不送出、不顯示表單訊息。
- 焦點：有欄位錯時，焦點移到第一個錯的欄位；表單訊息靠 `role="alert"` 念出，焦點留在「登入」按鈕。
- 清除：改了某一欄就清掉那一欄的訊息；再按「登入」時先清掉表單訊息。
- 輸入的內容一律保留（密碼也保留，不清空），只有使用者自己改。
- 文案的寫法：原因＋下一步，不寫錯誤代碼、不寫英文原文訊息、不說「發生錯誤」。
- 不新增 token：`bad`、`bad-soft`、`ink`（對比淺深色都 ≥4.5:1）。

不確定（列在這裡，不畫）：
- 請求太頻繁（Supabase Auth 會回 429）：照 T-018 現在的對應會落到 #6 的通用文案。若要分開顯示「試太多次了，請等幾分鐘再登入。」，要先在 `api/supabase` 把它對應成 `rate_limited` → Architect／TechLead。
- 登入過期：ARCH §6 `unauthenticated` 是「不顯示，直接導向登入頁；登入後回原頁」，所以登入頁不顯示「已過期」字樣；若要顯示一行說明（例如「登入已過期，請再登入一次。」）→ Architect／PM。
- 帳號被停用、需要驗證 Email 等：只有一個帳號、關閉註冊，這版不設計。
- T-018 寫「畫面只做 login.md 列出的狀態」：本節新增的 #1～3、#5～7 若 T-018 已經在做，要不要併進 T-018 或另開單 → TechLead。
