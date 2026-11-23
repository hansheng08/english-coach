# QA_REPORT

QA 擁有的工作文件。每個進 QA 的 PR 追加一節，不覆寫舊內容（憲章 v4 §5）。

## PR #9：T-900 模式 C 試跑（2026-11-23 21:11 台北時間）

- PR：https://github.com/hansheng08/english-coach/pull/9（task/T-900，library PR，只驗單元層）
- head SHA：24a008cc4659b74b86294707af50c5730e122c8b
- CI run：https://github.com/hansheng08/english-coach/actions/runs/45180613771（pull_request，同 SHA，`## ci-ok: PASS`）
  - 略過、未驗證的 job：bundle、db、e2e
- QA 自跑（worktree /workspace/projects/english-coach-qa）：`pnpm install --frozen-lockfile`、typecheck、lint、arch（25 modules，0 violations）、`vitest run --no-cache`（Tests 251 passed (251)）、`pnpm check`，全部 exit 0；`git diff --name-only origin/main...HEAD` 只有 4 個範圍內的檔案。
- 結論：通過。AC-T900-1、AC-T900-2、AC-T900-3 通過。PR 留言：https://github.com/hansheng08/english-coach/pull/9#issuecomment-7102186092
  - AC-T900-2 的突變要求（改壞常數後測試失敗）是對照測試斷言判定的，沒有實際改程式重跑，因為 QA 不得修改產品程式。這類 AC 的做法待 Hansheng 決定。
- 缺陷：無。
- 待補驗 AC：無。
