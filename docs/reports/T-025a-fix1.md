# T-025a-fix1 報告

## 完成摘要
- `supabase/functions/api/test-deps.test.ts` 第 20 行：`reviewDb` 的斷言從 `toBeUndefined()` 改成 `typeof … toBe('function')`；測試名稱沒動。
- `supabase/tests/t005_rls_test.sql` 第 31 行：`daily_plan` 的 `columns_are` 補上 `claimed_at`、`noon_items`、`failure`、`seed_remaining`，行數與 `plan(69)` 不變。
- `supabase/functions/_shared/plan/test/mem-store.ts` 內容沒動，只靠任務單把它納入範圍。
- `tooling/t025a-static.test.ts` 新增 `T-025a-fix1 (static text)`，涵蓋 AC-T25-30～32、TC-44～46，用 `?raw` 讀檔。
- 本輪只改任務單列出的檔案，沒有碰產品程式、migration 或 QA 檔案。

## 變更檔案
- `supabase/functions/api/test-deps.test.ts`
- `supabase/tests/t005_rls_test.sql`
- `tooling/t025a-static.test.ts`
- `docs/reports/T-025a-fix1.md`

## 設計決定
- 靜態測試的換行數用 `split('\n').length - 1` 比對 128，對應任務單的「換行 128 個」。

## 未完成事項
- 本機沒有資料庫，pgTAP（t005 與 T-025a 的測試）沒在本機跑，要靠 CI 的 `db` job 與 `taskcheck` 的 `pnpm db:test`。
- 本輪用的回合數遠低於上限，沒有逼近。

## 需要人類決定的問題
- 無。

## 權限被拒
- 次數：1 次
- 被擋的指令：
  - `Bash`：用 `cat` 搭配 heredoc 把新的 `describe` 附加到 `tooling/t025a-static.test.ts`
- 後續處理：沒有重送，也沒有換寫法繞過。改用 Edit 工具編輯該檔，這是 run-task 指定的檔案編輯方式。
