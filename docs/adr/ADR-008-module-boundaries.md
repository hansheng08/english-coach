# ADR-008：模組邊界與架構測試
- 狀態：**已接受**（G2，2026-11-22 18:46 Hansheng 核准）｜日期：2026-11-22｜提出：Architect（ARCH-001）
- 相關：ARCHITECTURE §3；ADR-003

## 背景
主要由 Claude Code 寫程式。要讓錯誤（例如在畫面直接呼叫 AI、在 domain 裡讀時間、在 handler 跳過 registry）在 CI 就失敗，而不是靠 Review 抓。

## 選項
| 準則 | A. dependency-cruiser＋ESLint 規則 | B. eslint-plugin-boundaries | C. 只靠 Review |
|---|---|---|---|
| 規則表達力 | 高（路徑、循環、孤兒檔案） | 中高 | — |
| 跨 Deno／Node 程式碼 | 可（只看檔案路徑） | 需 ESLint 能解析兩邊 | — |
| 速度 | 秒級 | 秒級 | 慢且不穩定 |
| AI 熟悉度 | 中高 | 中 | — |

## 決定
採用 **A**。規則（第一版）：
1. `packages/domain/**` 只能 import `packages/contracts/**`。
2. `packages/contracts/**` 只能 import `zod`。
3. `apps/web/src/features/X/**` 不得 import `apps/web/src/features/Y/**`（X≠Y）。
4. 只有 `apps/web/src/api/**` 可以 import `@supabase/supabase-js`。
5. `supabase/functions/<endpoint>/**` 不得直接 import `_shared/providers/<adapter>`，只能經過 `_shared/providers/registry.ts`。
6. 只有 `_shared/providers/registry.ts` 可以 import `_shared/config/paid.ts`。
7. 只有 `_shared/config/**` 可以出現 `Deno.env`（ESLint `no-restricted-syntax`）。
8. `fetch` 只允許在 `_shared/providers/**`、`_shared/news/**`、`apps/web/src/api/**`。
9. `packages/domain/**` 禁用 `Date.now`、`new Date()`（無參數）、`Math.random`、`throw`。
10. 禁止循環依賴。

## 後果
- 好處：AI 寫錯的 import 在 `pnpm check` 秒級失敗；TechLead Review 專注在邏輯。
- 代價：新增模組要先改規則（改規則要 Architect Review，結論只會是「符合／需修改／需要新的 ADR」）。
