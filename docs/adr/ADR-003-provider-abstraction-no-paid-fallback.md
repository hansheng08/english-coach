# ADR-003：供應商介面與「絕不自動轉付費」
- 狀態：**已接受**（G2，2026-11-22 18:46 Hansheng 核准）｜日期：2026-11-22｜提出：Architect（ARCH-001）
- 相關：AC-24、AC-25、NFR-03、Q-07

## 背景
- AC-24／NFR-03：Gemini 模型、STT、發音評分供應商要能在設定頁切換，下一次請求就生效，不改程式。
- AC-25／Q-07：免費額度用完或供應商失敗時，顯示原因、保留錄音、可稍後重送或**手動**改用其他供應商；**絕不自動改用付費**。
- 事實：Gemini API 的免費或付費由「Google Cloud 專案有沒有連結帳單帳戶」決定（同一把金鑰，專案一綁帳單就變成付費層）；速率限制以專案計算，不是以金鑰計算。Groq 免費方案不需要信用卡。Azure Speech F0 資源超過每月 5 小時會被限制而不是計費（「超過時的確切錯誤碼」未驗證）。

## 選項
| 準則 | A. 單一選擇＋無備援（三層防護） | B. 自動備援鏈（免費 A 失敗 → 免費 B） | C. 只靠雲端預算警示 |
|---|---|---|---|
| 會不會意外付費 | 不會（見三層） | 備援鏈若誤含付費項就會 | 會（警示只通知，不會停） |
| AC-25「手動」切換 | 符合 | 不符合（自動換） | — |
| 使用者知道用了誰 | 是（結果頁顯示） | 容易混淆 | — |
| 可測性 | 高（一個選擇、一條路） | 中 | 低 |

## 決定
採用 **A**，三層防護：
1. **帳號層（不靠程式）**：免費用的 Gemini 金鑰必須來自**沒有連結帳單帳戶**的專案；Groq 用免費方案；Azure 用 F0 資源。付費金鑰（如果 Hansheng 日後要用）使用**不同的 secret 名稱**（`GEMINI_PAID_API_KEY`），MVP 不設定。
2. **型別層**：
   - 每個供應商描述檔都有 `tier: 'free' | 'paid'`。`registry.resolve(capability, settings)` 只回傳 `settings` 中被選中的那**一個**供應商；型別上沒有「備援清單」欄位，也沒有「下一個」函式。
   - `tier === 'paid'` 的供應商只能由 `resolvePaid(…, consent: PaidConsent)` 取得；`PaidConsent` 是只能由 `/settings` 驗證 `paid_consent_at` 存在且本月付費用量 < `monthly_paid_cap_ntd` 後才建立的品牌型別（branded type：只有特定函式能產生的型別）。沒有它就編譯不過。
   - 讀付費金鑰的程式只允許在 `config/paid.ts`；dependency-cruiser 規定只有 `registry` 可以 import 它。
3. **執行層**：
   - 供應商回 `quota_exhausted`／`rate_limited`／`unavailable` → 直接回給前端（HTTP 429/502＋`kind`＋`provider`＋`retryAfterSec`），**不重試別家**；同一家只在 `invalid_response` 時重試 1 次。
   - 前端錄音先存 IndexedDB＋Storage，錯誤畫面提供「稍後重送」與「到設定改用其他供應商」。
   - 預設值全部是 `tier: 'free'`；設定頁選付費時要再按一次確認，並顯示本月上限。

## 測試（CI 必過）
- **registry 單元測試**：用假 adapter 計數，對每一種 `ProviderErrorKind` 驗證「只呼叫被選中的 adapter，次數 ≤ 2（含 1 次 invalid_response 重試），其他 adapter 呼叫次數 = 0」。
- **預設值測試**：`DEFAULT_SETTINGS` 每一項的 `tier` 都是 `free`。
- **付費同意測試**：沒有 `paid_consent_at`、或本月用量 ≥ 上限時，選付費回 `paid_not_allowed`，且付費 adapter 呼叫次數 = 0。
- **型別測試**（`expectTypeOf`／`// @ts-expect-error`）：不帶 `PaidConsent` 呼叫 `resolvePaid` 必須編譯失敗。
- **架構測試**：只有 `registry` 能 import `config/paid.ts`。
- **E2E**：假 STT 回 429 → 畫面顯示供應商名稱與原因、IndexedDB 仍有錄音、重送成功後才刪除本機錄音。

## 後果
- 好處：就算程式有 bug，免費金鑰本身也無法產生費用（第 1 層）；第 2、3 層讓錯誤在編譯或 CI 就被擋下。
- 代價：免費額度用完時練習會中斷，要等重置或手動切換；這是 AC-25 要的行為。
- 風險：若 Hansheng 日後在同一個 Google Cloud 專案啟用帳單，免費金鑰會變成付費。運維規則寫進 CLAUDE.md 與 G4 發佈清單：「免費 Gemini 金鑰所屬專案不得連結帳單」。程式能否偵測專案目前的 tier：不確定（沒找到官方 API），所以不依賴偵測。
